//! Desktop-native local Speech-to-Text (`Qwen3-ASR` + `Silero VAD` via `transcribe-cpp` / `uv`).
//!
//! Runs completely offline once the `uv` venv (`transcribe-cpp==0.4.1`) and
//! chosen GGUF weights are cached under `<app_cache_dir>/local-stt/`.
//! Captures microphone audio through [`VoiceSpectrum`]'s shared cpal stream so
//! the composer equalizer and dictation never contend for the OS input device.

pub mod audio;
pub mod capture;
pub mod catalog;
pub mod config;
pub mod download;
pub mod worker;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use capture::{AudioQueue, CaptureControl};
use catalog::{is_model_cached, is_runtime_installed, model_path, ModelId, SILERO_VAD_SPEC};
use config::{ConfigPatch, ConfigStore, LocalSttConfig};
use download::{
    download_model, ensure_vad_model, install_runtime, uv_available, InstallGuard, InstallProgress,
};
use worker::{Worker, WorkerInfo};

use crate::config_file::ConfigFile;
use crate::voice_spectrum::VoiceSpectrum;

pub const EVENT_STATE: &str = "local-stt://state";
pub const EVENT_TRANSCRIPT: &str = "local-stt://transcript";
pub const EVENT_END: &str = "local-stt://end";
pub const EVENT_INSTALL: &str = "local-stt://install";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub id: &'static str,
    pub name: &'static str,
    pub hint: &'static str,
    pub size_bytes: u64,
    pub downloaded: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::struct_excessive_bools)]
pub struct StatusSnapshot {
    pub config: LocalSttConfig,
    pub uv_installed: bool,
    pub runtime_installed: bool,
    pub vad_downloaded: bool,
    pub cache_available: bool,
    pub models: Vec<ModelStatus>,
    pub worker: WorkerInfo,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StateEvent<'a> {
    capture_id: &'a str,
    state: &'a str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptEvent<'a> {
    capture_id: &'a str,
    text: &'a str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EndEvent {
    capture_id: String,
    text: String,
    error: Option<String>,
    auto_stopped: bool,
}

/// Top-level coordinator for local STT setup, worker lifecycle, and dictation captures.
pub struct LocalSttManager {
    config: ConfigStore,
    cache_root: Option<PathBuf>,
    pub(crate) spectrum: Arc<VoiceSpectrum>,
    worker: Arc<Mutex<Option<Arc<Worker>>>>,
    pub(crate) active: Mutex<Option<Arc<CaptureControl>>>,
}

impl LocalSttManager {
    #[must_use]
    pub fn new(
        config_path: Option<PathBuf>,
        cache_root: Option<PathBuf>,
        spectrum: Arc<VoiceSpectrum>,
    ) -> Self {
        Self {
            config: ConfigStore::new(ConfigFile::new(config_path)),
            cache_root,
            spectrum,
            worker: Arc::new(Mutex::new(None)),
            active: Mutex::new(None),
        }
    }

    pub fn status(&self) -> StatusSnapshot {
        let cfg = self.config.read();
        let cache = self.cache_root.as_deref();
        let runtime_installed = cache.is_some_and(is_runtime_installed);
        let vad_downloaded = cache.is_some_and(|dir| is_model_cached(dir, SILERO_VAD_SPEC));
        let models = ModelId::ALL
            .into_iter()
            .map(|id| {
                let spec = id.spec();
                ModelStatus {
                    id: spec.id,
                    name: spec.name,
                    hint: spec.hint,
                    size_bytes: spec.size_bytes,
                    downloaded: cache.is_some_and(|dir| is_model_cached(dir, spec)),
                }
            })
            .collect();
        let worker_info = self
            .worker
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_ref()
            .map_or_else(WorkerInfo::default, |w| {
                w.info
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .clone()
            });
        StatusSnapshot {
            config: cfg,
            uv_installed: uv_available(),
            runtime_installed,
            vad_downloaded,
            cache_available: cache.is_some(),
            models,
            worker: worker_info,
        }
    }

    /// Updates `local-stt.json` and unloads any incompatible warm worker if needed.
    ///
    /// # Errors
    ///
    /// Returns an error if `patch` contains invalid fields or saving fails.
    pub fn set_config(&self, patch: ConfigPatch) -> Result<StatusSnapshot, String> {
        let prev = self.config.read();
        let next = self.config.apply(patch)?;
        if prev.model != next.model || prev.backend != next.backend {
            self.shutdown_worker();
        }
        Ok(self.status())
    }

    /// Installs the `uv` venv (`transcribe-cpp==0.4.1`) and Silero VAD GGUF.
    ///
    /// # Errors
    ///
    /// Returns an error if no cache dir is configured, another install is running,
    /// `uv` is missing, or installation fails.
    pub fn install_runtime(&self, app: &AppHandle) -> Result<StatusSnapshot, String> {
        let cache = self
            .cache_root
            .as_deref()
            .ok_or_else(|| "no app cache directory available".to_string())?;
        let _guard = InstallGuard::begin()?;
        let res = install_runtime(cache, emit_install(app))
            .and_then(|()| ensure_vad_model(cache, emit_install(app)));
        emit_install_done(app, "runtime", "runtime", res.as_ref().err().cloned());
        res?;
        Ok(self.status())
    }

    /// Downloads a Qwen3-ASR GGUF model (plus runtime and Silero VAD if missing).
    ///
    /// # Errors
    ///
    /// Returns an error if `model_id` is invalid, another install is running, or
    /// download/verification fails.
    pub fn install_model(&self, app: &AppHandle, model_id: &str) -> Result<StatusSnapshot, String> {
        let id = ModelId::parse(model_id)?;
        let cache = self
            .cache_root
            .as_deref()
            .ok_or_else(|| "no app cache directory available".to_string())?;
        let _guard = InstallGuard::begin()?;
        let res = install_runtime(cache, emit_install(app))
            .and_then(|()| ensure_vad_model(cache, emit_install(app)))
            .and_then(|()| download_model(cache, id.spec(), emit_install(app)));
        emit_install_done(app, "model", id.as_str(), res.as_ref().err().cloned());
        res?;
        Ok(self.status())
    }

    /// Deletes a cached Qwen3-ASR model GGUF from disk.
    ///
    /// # Errors
    ///
    /// Returns an error if `model_id` is invalid, a capture is active, or removing
    /// the file fails.
    pub fn delete_model(&self, model_id: &str) -> Result<StatusSnapshot, String> {
        let id = ModelId::parse(model_id)?;
        if self
            .active
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .is_some()
        {
            return Err("stop voice to text before deleting a model".to_string());
        }
        let cache = self
            .cache_root
            .as_deref()
            .ok_or_else(|| "no app cache directory available".to_string())?;
        let cfg = self.config.read();
        if cfg.model == id {
            self.shutdown_worker();
        }
        let path = model_path(cache, id.spec());
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| format!("could not delete {}: {e}", path.display()))?;
        }
        Ok(self.status())
    }

    /// Starts a local dictation capture using the configured Qwen3-ASR model and
    /// Silero VAD.
    ///
    /// # Errors
    ///
    /// Returns an error if the runtime/model is not cached, another capture is
    /// running, or the microphone/worker fails to initialize.
    pub fn start(
        self: &Arc<Self>,
        app: AppHandle,
        capture_id: String,
        auto_stop_ms: Option<u32>,
    ) -> Result<(), String> {
        if capture_id.trim().is_empty() {
            return Err("missing captureId".to_string());
        }
        let cache = self
            .cache_root
            .clone()
            .ok_or_else(|| "no app cache directory available".to_string())?;
        let cfg = self.config.read();
        validate_ready(&cache, &cfg)?;

        let mut active_guard = self.active.lock().unwrap_or_else(PoisonError::into_inner);
        if active_guard.is_some() {
            return Err("Voice to text is already active".to_string());
        }

        emit_state(&app, &capture_id, "starting");
        let worker = match self.ensure_worker(&cache, &cfg) {
            Ok(w) => w,
            Err(err) => {
                emit_end_error(&app, capture_id, &err);
                return Err(err);
            }
        };

        let queue = Arc::new((Mutex::new(AudioQueue::default()), Condvar::new()));
        let tap = make_pcm_tap(&queue);
        if let Err(err) = self.spectrum.set_pcm_tap(Some(tap)) {
            emit_end_error(&app, capture_id, &err);
            return Err(err);
        }

        let control = Arc::new(CaptureControl {
            capture_id: capture_id.clone(),
            stop_flag: Arc::new(AtomicBool::new(false)),
            cancel_flag: Arc::new(AtomicBool::new(false)),
            queue,
            committed: Mutex::new(String::new()),
            thread: Mutex::new(None),
        });
        let handle = spawn_capture_thread(self, &app, &control, &worker, &cfg, auto_stop_ms)?;
        *control
            .thread
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Some(handle);
        *active_guard = Some(control);
        drop(active_guard);

        emit_state(&app, &capture_id, "recording");
        Ok(())
    }

    /// Stops (or cancels) the active local dictation capture and returns the final transcript.
    pub fn stop(&self, capture_id: Option<&str>, cancel: bool) -> String {
        let control = {
            let mut active = self.active.lock().unwrap_or_else(PoisonError::into_inner);
            let Some(ctrl) = active.as_ref() else {
                return String::new();
            };
            if let Some(expected) = capture_id {
                if ctrl.capture_id != expected {
                    return String::new();
                }
            }
            active.take()
        };
        let Some(control) = control else {
            return String::new();
        };

        if cancel {
            control.cancel_flag.store(true, Ordering::SeqCst);
        }
        control.stop_flag.store(true, Ordering::SeqCst);
        self.spectrum.clear_pcm_tap();
        {
            let (lock, cv) = &*control.queue;
            let mut q = lock.lock().unwrap_or_else(PoisonError::into_inner);
            q.closed = true;
            drop(q);
            cv.notify_all();
        }
        let handle = control
            .thread
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        if let Some(thread) = handle {
            let _ = thread.join();
        }
        let text = control
            .committed
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone();
        text
    }

    /// Shuts down the warm Python worker and stops any active capture (called on app exit).
    pub fn shutdown(&self) {
        let _ = self.stop(None, true);
        self.shutdown_worker();
    }

    fn clear_active_if(&self, capture_id: &str) {
        let mut active = self.active.lock().unwrap_or_else(PoisonError::into_inner);
        if active.as_ref().is_some_and(|a| a.capture_id == capture_id) {
            *active = None;
        }
    }

    fn shutdown_worker(&self) {
        let taken = self
            .worker
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        if let Some(w) = taken {
            w.shutdown();
        }
    }

    fn ensure_worker(&self, cache: &Path, cfg: &LocalSttConfig) -> Result<Arc<Worker>, String> {
        let mut guard = self.worker.lock().unwrap_or_else(PoisonError::into_inner);
        let worker = if let Some(w) = guard.as_ref().filter(|w| w.is_alive()) {
            Arc::clone(w)
        } else {
            *guard = None;
            let spawned = Arc::new(Worker::spawn(cache)?);
            *guard = Some(Arc::clone(&spawned));
            spawned
        };
        drop(guard);
        let vad_path = model_path(cache, SILERO_VAD_SPEC);
        let asr_path = model_path(cache, cfg.model.spec());
        worker.load_vad(&vad_path)?;
        worker.load_asr(&asr_path, cfg.backend)?;
        worker.vad_reset()?;
        Ok(worker)
    }
}

fn emit_state(app: &AppHandle, capture_id: &str, state: &str) {
    let _ = app.emit(EVENT_STATE, StateEvent { capture_id, state });
}

fn emit_install(app: &AppHandle) -> impl FnMut(InstallProgress) + Clone + Send + 'static {
    let app = app.clone(); // the closure owns a handle to emit progress events
    move |progress| {
        let _ = app.emit(EVENT_INSTALL, progress);
    }
}

fn emit_install_done(app: &AppHandle, kind: &'static str, id: &str, error: Option<String>) {
    let _ = app.emit(
        EVENT_INSTALL,
        InstallProgress {
            kind,
            id: id.to_string(),
            downloaded: 0,
            total: None,
            percent: error.as_ref().map_or(Some(100), |_| None),
            message: if error.is_some() {
                "Failed".to_string()
            } else {
                "Done".to_string()
            },
            done: true,
            error,
        },
    );
}
fn validate_ready(cache: &Path, cfg: &LocalSttConfig) -> Result<(), String> {
    if !is_runtime_installed(cache) {
        return Err(
            "Local speech runtime is not installed yet. Install it in Settings → Voice."
                .to_string(),
        );
    }
    let model_spec = cfg.model.spec();
    if !is_model_cached(cache, model_spec) {
        return Err(format!(
            "{} is not downloaded yet. Download it in Settings → Voice.",
            model_spec.name
        ));
    }
    if !is_model_cached(cache, SILERO_VAD_SPEC) {
        return Err("Silero VAD model is missing. Reinstall it in Settings → Voice.".to_string());
    }
    Ok(())
}

fn emit_end_error(app: &AppHandle, capture_id: String, err: &str) {
    let _ = app.emit(
        EVENT_END,
        EndEvent {
            capture_id,
            text: String::new(),
            error: Some(err.to_string()),
            auto_stopped: false,
        },
    );
}

fn make_pcm_tap(queue: &Arc<(Mutex<AudioQueue>, Condvar)>) -> crate::voice_spectrum::PcmTap {
    let queue_tap = Arc::clone(queue);
    Arc::new(move |samples, rate| {
        let (lock, cv) = &*queue_tap;
        let mut q = lock.lock().unwrap_or_else(PoisonError::into_inner);
        if q.closed {
            return;
        }
        if q.sample_rate != rate {
            q.sample_rate = rate;
        }
        q.samples.extend(samples);
        drop(q);
        cv.notify_one();
    })
}

fn spawn_capture_thread(
    mgr: &Arc<LocalSttManager>,
    app: &AppHandle,
    control: &Arc<CaptureControl>,
    worker: &Arc<Worker>,
    cfg: &LocalSttConfig,
    auto_stop_ms: Option<u32>,
) -> Result<std::thread::JoinHandle<()>, String> {
    let mgr_c = Arc::clone(mgr);
    let ctrl_c = Arc::clone(control);
    let worker_c = Arc::clone(worker);
    let app_c = app.clone();
    let cfg_c = cfg.clone();
    let auto_stop = auto_stop_ms
        .filter(|&ms| ms > 0)
        .map(|ms| Duration::from_millis(u64::from(ms)));
    std::thread::Builder::new()
        .name("local-stt-capture".into())
        .spawn(move || {
            capture::run(&mgr_c, &app_c, &ctrl_c, &worker_c, &cfg_c, auto_stop);
        })
        .map_err(|e| {
            mgr.spectrum.clear_pcm_tap();
            format!("could not start capture thread: {e}")
        })
}
