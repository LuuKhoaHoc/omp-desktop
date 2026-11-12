//! Download and SHA-256 verification for local STT models and the `uv` runtime.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::catalog::{
    is_model_cached, is_runtime_installed, model_path, venv_dir, venv_python, ModelSpec,
    RUNTIME_MARKER, SILERO_VAD_SPEC, TRANSCRIBE_CPP_SPEC,
};
use crate::child_path::{child_path_dirs, locate_program};
use crate::child_run::{collect_streamed, WaitError};
use crate::json_store::hex_lower;
use crate::private_fs::private_dirs;
use crate::supervisor::ProcessSupervisor;

const UV_MISSING: &str =
    "Local speech-to-text needs uv, which was not found. Install uv (https://docs.astral.sh/uv/), then try again.";
const DOWNLOAD_TIMEOUT: Duration = Duration::from_mins(60);
const RUNTIME_INSTALL_TIMEOUT: Duration = Duration::from_mins(15);
const ERROR_LIMIT: usize = 16 * 1024;
const PROGRESS_STEP_BYTES: u64 = 512 * 1024;
const PROGRESS_STEP_TIME: Duration = Duration::from_millis(250);

/// Event payload emitted on `local-stt://install`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub kind: &'static str,
    pub id: String,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub percent: Option<u8>,
    pub message: String,
    pub done: bool,
    pub error: Option<String>,
}

/// Prevents two concurrent installs/downloads from colliding on the same cache.
static INSTALL_BUSY: AtomicBool = AtomicBool::new(false);

pub struct InstallGuard;

impl InstallGuard {
    /// Claims the global install slot.
    ///
    /// # Errors
    ///
    /// Returns an error if another local STT runtime or model install is already running.
    pub fn begin() -> Result<Self, String> {
        if INSTALL_BUSY.swap(true, Ordering::SeqCst) {
            return Err("another local speech download or setup is already running".to_string());
        }
        Ok(Self)
    }
}

impl Drop for InstallGuard {
    fn drop(&mut self) {
        INSTALL_BUSY.store(false, Ordering::SeqCst);
    }
}

pub fn uv_available() -> bool {
    locate_program(&child_path_dirs(), "uv").is_ok()
}

/// Creates `<cache_root>/venv` and installs `transcribe-cpp==0.4.1` via `uv`.
///
/// # Errors
///
/// Returns an error if `uv` is missing, directory creation fails, or `uv` fails.
pub fn install_runtime(
    cache_root: &Path,
    mut emit: impl FnMut(InstallProgress) + Clone + Send + 'static,
) -> Result<(), String> {
    if is_runtime_installed(cache_root) {
        return Ok(());
    }
    let uv = locate_program(&child_path_dirs(), "uv").map_err(|_| UV_MISSING.to_string())?;
    let venv = venv_dir(cache_root);
    private_dirs(true)
        .create(cache_root)
        .map_err(|e| format!("could not create {}: {e}", cache_root.display()))?;

    emit(InstallProgress {
        kind: "runtime",
        id: "runtime".into(),
        downloaded: 0,
        total: None,
        percent: Some(5),
        message: "Creating isolated Python environment via uv…".into(),
        done: false,
        error: None,
    });

    if venv.exists() {
        let _ = fs::remove_dir_all(&venv);
    }
    let mut venv_cmd = Command::new(&uv.binary);
    venv_cmd.env("PATH", &uv.path).arg("venv").arg(&venv);
    run_uv_step(&mut venv_cmd, "uv venv", |_| {})?;

    emit(InstallProgress {
        kind: "runtime",
        id: "runtime".into(),
        downloaded: 0,
        total: None,
        percent: Some(25),
        message: format!("Installing {TRANSCRIBE_CPP_SPEC}…"),
        done: false,
        error: None,
    });

    let py = venv_python(&venv);
    let mut pip_cmd = Command::new(&uv.binary);
    pip_cmd
        .env("PATH", &uv.path)
        .args(["pip", "install", "--python"])
        .arg(&py)
        .arg(TRANSCRIBE_CPP_SPEC);
    let mut emit_pip = emit.clone();
    run_uv_step(&mut pip_cmd, "uv pip install transcribe-cpp", move |line| {
        if !line.is_empty() {
            emit_pip(InstallProgress {
                kind: "runtime",
                id: "runtime".into(),
                downloaded: 0,
                total: None,
                percent: None,
                message: crate::text::prefix_within(line, 120).to_string(),
                done: false,
                error: None,
            });
        }
    })?;

    if !py.is_file() {
        return Err(format!(
            "uv venv succeeded but Python interpreter is missing at {}",
            py.display()
        ));
    }
    let marker = venv.join(RUNTIME_MARKER);
    crate::private_fs::create_private_file(&marker, b"0.4.1\n")
        .map_err(|e| format!("could not write runtime marker: {e}"))?;
    Ok(())
}

/// Downloads `spec` (if missing) into `<cache_root>/models/<filename>` and
/// verifies its SHA-256 digest before atomic rename.
///
/// # Errors
///
/// Returns an error if HTTP download, disk write, or SHA-256 verification fails.
pub fn download_model(
    cache_root: &Path,
    spec: ModelSpec,
    mut emit: impl FnMut(InstallProgress),
) -> Result<(), String> {
    if is_model_cached(cache_root, spec) {
        return Ok(());
    }
    let models_dir = cache_root.join("models");
    private_dirs(true)
        .create(&models_dir)
        .map_err(|e| format!("could not create {}: {e}", models_dir.display()))?;

    let dest = model_path(cache_root, spec);
    let part = models_dir.join(format!("{}.part", spec.filename));
    let _ = fs::remove_file(&part);

    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(DOWNLOAD_TIMEOUT)
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    emit(InstallProgress {
        kind: "model",
        id: spec.id.into(),
        downloaded: 0,
        total: Some(spec.size_bytes),
        percent: Some(0),
        message: format!("Downloading {}…", spec.name),
        done: false,
        error: None,
    });

    let mut response = client
        .get(spec.url)
        .send()
        .map_err(|e| format!("failed to request {}: {e}", spec.name))?;
    if !response.status().is_success() {
        return Err(format!(
            "download failed for {}: HTTP {}",
            spec.name,
            response.status()
        ));
    }
    let total = response.content_length().or(Some(spec.size_bytes));

    let mut file =
        File::create(&part).map_err(|e| format!("could not create {}: {e}", part.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0_u8; 64 * 1024];
    let mut downloaded = 0_u64;
    let mut last_reported_bytes = 0_u64;
    let mut last_reported_at = Instant::now();

    let copy_result: Result<(), String> = (|| {
        loop {
            let n = response
                .read(&mut buf)
                .map_err(|e| format!("download interrupted for {}: {e}", spec.name))?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n])
                .map_err(|e| format!("write error for {}: {e}", spec.name))?;
            hasher.update(&buf[..n]);
            downloaded += n as u64;

            if downloaded.saturating_sub(last_reported_bytes) >= PROGRESS_STEP_BYTES
                || last_reported_at.elapsed() >= PROGRESS_STEP_TIME
            {
                last_reported_bytes = downloaded;
                last_reported_at = Instant::now();
                emit(InstallProgress {
                    kind: "model",
                    id: spec.id.into(),
                    downloaded,
                    total,
                    percent: compute_percent(downloaded, total),
                    message: format_bytes_progress(spec.name, downloaded, total),
                    done: false,
                    error: None,
                });
            }
        }
        file.flush()
            .map_err(|e| format!("flush error for {}: {e}", spec.name))?;
        Ok(())
    })();

    if let Err(err) = copy_result {
        drop(file);
        let _ = fs::remove_file(&part);
        return Err(err);
    }
    drop(file);

    let digest = hex_lower(&hasher.finalize());
    if digest != spec.sha256 {
        let _ = fs::remove_file(&part);
        return Err(format!(
            "SHA-256 mismatch for {} (expected {}, got {digest})",
            spec.name, spec.sha256
        ));
    }

    fs::rename(&part, &dest)
        .map_err(|e| format!("could not move {} into cache: {e}", spec.name))?;
    Ok(())
}

/// Ensures Silero VAD GGUF is downloaded when setting up a local STT model.
///
/// # Errors
///
/// Returns an error if downloading or verifying Silero VAD fails.
pub fn ensure_vad_model(
    cache_root: &Path,
    mut emit: impl FnMut(InstallProgress),
) -> Result<(), String> {
    download_model(cache_root, SILERO_VAD_SPEC, &mut emit)
}

fn run_uv_step(
    cmd: &mut Command,
    label: &str,
    mut on_line: impl FnMut(&str) + Send + 'static,
) -> Result<(), String> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    ProcessSupervisor::prepare(cmd);
    let mut child =
        crate::spawn_gate::spawn(cmd).map_err(|e| format!("could not start {label}: {e}"))?;
    let supervisor = ProcessSupervisor::attach(&child);
    let deadline = Instant::now() + RUNTIME_INSTALL_TIMEOUT;
    let done = collect_streamed(
        child_ref_mut(&mut child),
        &supervisor,
        ERROR_LIMIT,
        deadline,
        move |chunk| {
            let text = String::from_utf8_lossy(chunk);
            for line in text.lines() {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    on_line(trimmed);
                }
            }
        },
    )
    .map_err(|e| match e {
        WaitError::Overflow => format!("{label} printed too much"),
        WaitError::TimedOut => format!("{label} timed out"),
        WaitError::Failed(err) => format!("{label}: {err}"),
    })?;
    if done.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&done.stderr);
    let mut tail = std::collections::VecDeque::with_capacity(4);
    for line in stderr.lines() {
        if tail.len() == 3 {
            tail.pop_front();
        }
        tail.push_back(line);
    }
    let detail = crate::text::join_nonblank(tail, " · ");
    match detail {
        None => Err(format!("{label} failed ({})", done.status)),
        Some(d) => Err(format!("{label} failed ({}): {d}", done.status)),
    }
}

const fn child_ref_mut(child: &mut std::process::Child) -> &mut std::process::Child {
    child
}

#[allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss
)]
fn compute_percent(downloaded: u64, total: Option<u64>) -> Option<u8> {
    let total = total.filter(|&t| t > 0)?;
    let pct = ((downloaded as f64 / total as f64) * 100.0).round();
    Some(pct.clamp(0.0, 100.0) as u8)
}

#[allow(clippy::cast_precision_loss)]
fn format_bytes_progress(name: &str, downloaded: u64, total: Option<u64>) -> String {
    let dl_mb = downloaded as f64 / (1024.0 * 1024.0);
    total.map_or_else(
        || format!("Downloading {name} ({dl_mb:.1} MB)…"),
        |t| {
            let tot_mb = t as f64 / (1024.0 * 1024.0);
            format!("Downloading {name} ({dl_mb:.1} / {tot_mb:.1} MB)…")
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compute_percent_clamps_bounds() {
        assert_eq!(compute_percent(0, Some(100)), Some(0));
        assert_eq!(compute_percent(50, Some(100)), Some(50));
        assert_eq!(compute_percent(150, Some(100)), Some(100));
        assert_eq!(compute_percent(10, Some(0)), None);
        assert_eq!(compute_percent(10, None), None);
    }

    #[test]
    fn install_guard_blocks_concurrent_runs_and_releases_on_drop() {
        let g1 = InstallGuard::begin();
        assert!(g1.is_ok());
        assert!(InstallGuard::begin().is_err());
        drop(g1);
        assert!(InstallGuard::begin().is_ok());
    }
}
