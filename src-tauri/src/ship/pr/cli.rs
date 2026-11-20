use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

const OUTPUT_LIMIT: usize = 2 * 1024 * 1024;
const ERROR_LIMIT: usize = 16 * 1024;
const TIMEOUT: Duration = Duration::from_secs(30);
static TEMP_BODY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub(super) fn cli(program: &crate::child_path::TrustedProgram, work_dir: &Path) -> Command {
    let mut cmd = Command::new(&program.binary);
    cmd.env("PATH", &program.path)
        .env_remove("GH_REPO")
        .env_remove("GH_DEBUG")
        .env_remove("CLICOLOR_FORCE")
        .env_remove("GH_FORCE_TTY")
        .env_remove("GITLAB_HOST")
        .current_dir(work_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    cmd
}

fn failure(status: ExitStatus, stderr: &[u8], tool: &str) -> String {
    let text = String::from_utf8_lossy(stderr);
    if status.code() == Some(4) || text.contains("HTTP 401") {
        return if tool == "gh" {
            "GitHub CLI is not signed in. Run \"gh auth login\" in a terminal, then return to the app.".into()
        } else {
            "GitLab CLI is not signed in. Run \"glab auth login\" in a terminal, then return to the app.".into()
        };
    }
    let redacted = crate::widgets::redact::redact_secrets(text.trim());
    let preview = crate::text::prefix_within(&redacted, 1024);
    if preview.is_empty() {
        format!("{tool} failed ({status})")
    } else {
        format!("{tool} failed ({status}): {preview}")
    }
}

pub(super) fn run(cmd: &mut Command, tool: &str, input: Option<&[u8]>) -> Result<Vec<u8>, String> {
    crate::supervisor::ProcessSupervisor::prepare(cmd);
    let mut child =
        crate::spawn_gate::spawn(cmd).map_err(|e| format!("could not start {tool}: {e}"))?;
    let supervisor = crate::supervisor::ProcessSupervisor::attach(&child);
    // child_run invokes `started` after both pipes are draining, so writing a large
    // body to stdin cannot deadlock against a child blocked on stdout/stderr.
    let done = crate::child_run::collect(
        &mut child,
        &supervisor,
        OUTPUT_LIMIT,
        ERROR_LIMIT,
        Instant::now() + TIMEOUT,
        |child| {
            if let Some(input) = input {
                let mut stdin = child
                    .stdin
                    .take()
                    .ok_or_else(|| "child stdin pipe missing".to_string())?;
                stdin
                    .write_all(input)
                    .map_err(|e| format!("could not write request body: {e}"))?;
                drop(stdin);
            } else {
                // Close the unused pipe so a CLI that probes stdin sees EOF rather
                // than waiting for input until the request deadline.
                drop(child.stdin.take());
            }
            Ok(())
        },
    )
    .map_err(|e| match e {
        crate::child_run::WaitError::Overflow => format!("{tool} output exceeded its size limit"),
        crate::child_run::WaitError::TimedOut => format!("{tool} request timed out"),
        crate::child_run::WaitError::Failed(e) => format!("{tool}: {e}"),
    })?;
    if !done.status.success() {
        return Err(failure(done.status, &done.stderr, tool));
    }
    Ok(done.stdout)
}

pub(super) struct TempBody(pub(super) PathBuf);
impl TempBody {
    pub(super) fn new(body: &str) -> Result<Self, String> {
        let mut opened = None;
        for _ in 0..3 {
            let sequence = TEMP_BODY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "omp-ship-body-{}-{sequence}.tmp",
                std::process::id()
            ));
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            match options.open(&path) {
                Ok(file) => {
                    opened = Some((path, file));
                    break;
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => {
                    return Err(format!("could not create pull-request body file: {error}"));
                }
            }
        }
        let (path, mut file) = opened
            .ok_or_else(|| "could not create pull-request body file: name collision".to_string())?;
        file.write_all(body.as_bytes())
            .map_err(|e| format!("could not write pull-request body file: {e}"))?;
        Ok(Self(path))
    }
}
impl Drop for TempBody {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}
