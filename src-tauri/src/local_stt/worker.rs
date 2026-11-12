//! Persistent Python worker client communicating with `worker.py` over JSON lines.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, PoisonError};
use std::thread::JoinHandle;
use std::time::Duration;

use base64::Engine as _;
use serde::{Deserialize, Serialize};

use super::audio::encode_f32_le;
use super::catalog::{venv_dir, venv_python, Backend};
use crate::child_path::apply_child_path;
use crate::supervisor::ProcessSupervisor;

const WORKER_SCRIPT: &str = include_str!("worker.py");
const STARTUP_TIMEOUT: Duration = Duration::from_secs(20);
const LOAD_TIMEOUT: Duration = Duration::from_secs(60);
const VAD_TIMEOUT: Duration = Duration::from_secs(10);
const TRANSCRIBE_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_LINE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerInfo {
    pub running: bool,
    pub backend: Option<String>,
    pub device: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WireReply {
    id: Option<u64>,
    #[serde(rename = "type")]
    kind: Option<String>,
    ok: Option<bool>,
    error: Option<String>,
    version: Option<String>,
    backend: Option<String>,
    device: Option<String>,
    probs: Option<Vec<f32>>,
    text: Option<String>,
}

#[derive(Debug, Serialize)]
struct LoadVadReq<'a> {
    id: u64,
    cmd: &'static str,
    path: &'a str,
}

#[derive(Debug, Serialize)]
struct LoadAsrReq<'a> {
    id: u64,
    cmd: &'static str,
    path: &'a str,
    backend: &'a str,
}

#[derive(Debug, Serialize)]
struct SimpleReq {
    id: u64,
    cmd: &'static str,
}

#[derive(Debug, Serialize)]
struct VadFeedReq {
    id: u64,
    cmd: &'static str,
    pcm_b64: String,
}

#[derive(Debug, Serialize)]
struct TranscribeReq<'a> {
    id: u64,
    cmd: &'static str,
    pcm_b64: String,
    language: Option<&'a str>,
    vocabulary: &'a [String],
    prompt: Option<&'a str>,
}

type PendingMap = Arc<Mutex<HashMap<u64, mpsc::Sender<Result<WireReply, String>>>>>;

/// One running Python worker process managed via `ProcessSupervisor`.
pub struct Worker {
    stdin: Mutex<Option<ChildStdin>>,
    pending: PendingMap,
    next_id: AtomicU64,
    child: Mutex<Option<(Child, ProcessSupervisor)>>,
    reader: Mutex<Option<JoinHandle<()>>>,
    stderr_thread: Mutex<Option<JoinHandle<()>>>,
    pub info: Mutex<WorkerInfo>,
}

impl Worker {
    /// Spawns `worker.py` using the `uv`-managed venv under `cache_root` and
    /// waits for its initial `ready` frame.
    ///
    /// # Errors
    ///
    pub fn spawn(cache_root: &Path) -> Result<Self, String> {
        let python = venv_python(&venv_dir(cache_root));
        if !python.is_file() {
            return Err(format!(
                "local speech runtime is not installed ({} missing)",
                python.display()
            ));
        }

        let mut cmd = Command::new(&python);
        apply_child_path(&mut cmd);
        cmd.args(["-u", "-c", WORKER_SCRIPT])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        ProcessSupervisor::prepare(&mut cmd);
        let mut child = crate::spawn_gate::spawn(&mut cmd)
            .map_err(|e| format!("could not start local speech worker: {e}"))?;
        let supervisor = ProcessSupervisor::attach(&child);
        let stdin = child.stdin.take().ok_or("worker stdin not piped")?;
        let stdout = child.stdout.take().ok_or("worker stdout not piped")?;
        let stderr = child.stderr.take().ok_or("worker stderr not piped")?;

        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let (ready_tx, ready_rx) = mpsc::channel();
        let stderr_tail = Arc::new(Mutex::new(Vec::<String>::new()));

        let stderr_tail_c = Arc::clone(&stderr_tail);
        let stderr_thread = std::thread::Builder::new()
            .name("local-stt-stderr".into())
            .spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        eprintln!("[local-stt] {trimmed}");
                        let mut tail = stderr_tail_c.lock().unwrap_or_else(PoisonError::into_inner);
                        if tail.len() >= 8 {
                            tail.remove(0);
                        }
                        tail.push(trimmed.to_string());
                    }
                }
            })
            .ok();

        let pending_c = Arc::clone(&pending);
        let reader = std::thread::Builder::new()
            .name("local-stt-stdout".into())
            .spawn(move || {
                read_loop(stdout, &pending_c, &ready_tx, &stderr_tail);
            })
            .map_err(|e| format!("could not start local speech reader: {e}"))?;

        let ready = ready_rx
            .recv_timeout(STARTUP_TIMEOUT)
            .map_err(|_| "local speech worker timed out during startup".to_string())?
            .map_err(|e| format!("local speech worker failed to start: {e}"))?;

        Ok(Self {
            stdin: Mutex::new(Some(stdin)),
            pending,
            next_id: AtomicU64::new(1),
            child: Mutex::new(Some((child, supervisor))),
            reader: Mutex::new(Some(reader)),
            stderr_thread: Mutex::new(stderr_thread),
            info: Mutex::new(WorkerInfo {
                running: true,
                backend: None,
                device: None,
                version: ready.version,
            }),
        })
    }

    pub fn is_alive(&self) -> bool {
        self.stdin
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .is_some()
            && self
                .info
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .running
    }

    /// Ensures the Silero VAD GGUF is loaded in the worker.
    ///
    /// # Errors
    ///
    /// Returns an error if the worker rejects or times out loading VAD.
    pub fn load_vad(&self, vad_path: &Path) -> Result<(), String> {
        let id = self.next_id();
        let req = LoadVadReq {
            id,
            cmd: "load_vad",
            path: &vad_path.to_string_lossy(),
        };
        let _ = self.request(id, &req, LOAD_TIMEOUT)?;
        Ok(())
    }

    /// Ensures the chosen ASR model and backend are loaded in the worker.
    ///
    /// # Errors
    ///
    /// Returns an error if loading fails or times out.
    pub fn load_asr(&self, model_path: &Path, backend: Backend) -> Result<(), String> {
        let id = self.next_id();
        let req = LoadAsrReq {
            id,
            cmd: "load_asr",
            path: &model_path.to_string_lossy(),
            backend: backend.as_str(),
        };
        let reply = self.request(id, &req, LOAD_TIMEOUT)?;
        {
            let mut info = self.info.lock().unwrap_or_else(PoisonError::into_inner);
            info.backend = reply.backend;
            info.device = reply.device;
        }
        Ok(())
    }

    /// Resets the worker's Silero VAD stream state.
    ///
    /// # Errors
    ///
    /// Returns an error if writing to the worker fails.
    pub fn vad_reset(&self) -> Result<(), String> {
        let id = self.next_id();
        let _ = self.request(
            id,
            &SimpleReq {
                id,
                cmd: "vad_reset",
            },
            VAD_TIMEOUT,
        )?;
        Ok(())
    }

    /// Feeds 16 kHz mono float32 samples into Silero VAD and returns frame probabilities.
    ///
    /// # Errors
    ///
    /// Returns an error if the worker fails or times out.
    pub fn vad_feed(&self, pcm: &[f32]) -> Result<Vec<f32>, String> {
        let id = self.next_id();
        let pcm_b64 = base64::engine::general_purpose::STANDARD.encode(encode_f32_le(pcm));
        let req = VadFeedReq {
            id,
            cmd: "vad_feed",
            pcm_b64,
        };
        let reply = self.request(id, &req, VAD_TIMEOUT)?;
        Ok(reply.probs.unwrap_or_default())
    }

    /// Transcribes one 16 kHz mono float32 PCM buffer.
    ///
    /// # Errors
    ///
    /// Returns an error if inference fails or times out.
    pub fn transcribe(
        &self,
        pcm: &[f32],
        language: Option<&str>,
        vocabulary: &[String],
        prompt: Option<&str>,
    ) -> Result<String, String> {
        let id = self.next_id();
        let pcm_b64 = base64::engine::general_purpose::STANDARD.encode(encode_f32_le(pcm));
        let req = TranscribeReq {
            id,
            cmd: "transcribe",
            pcm_b64,
            language,
            vocabulary,
            prompt,
        };
        let reply = self.request(id, &req, TRANSCRIBE_TIMEOUT)?;
        Ok(reply.text.unwrap_or_default())
    }

    /// Unloads models from the worker while keeping the process warm, or shuts down cleanly.
    pub fn shutdown(&self) {
        let id = self.next_id();
        if let Ok(line) = serde_json::to_string(&SimpleReq {
            id,
            cmd: "shutdown",
        }) {
            let mut guard = self.stdin.lock().unwrap_or_else(PoisonError::into_inner);
            if let Some(mut stdin) = guard.take() {
                let _ = stdin.write_all(line.as_bytes());
                let _ = stdin.write_all(b"\n");
                let _ = stdin.flush();
            }
        }
        self.mark_dead();
        let taken_child = self
            .child
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        if let Some((mut child, supervisor)) = taken_child {
            supervisor.kill_tree();
            let _ = child.wait();
        }
        let taken_reader = self
            .reader
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        if let Some(handle) = taken_reader {
            let _ = handle.join();
        }
        let taken_stderr = self
            .stderr_thread
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        if let Some(handle) = taken_stderr {
            let _ = handle.join();
        }
    }

    fn next_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    fn mark_dead(&self) {
        let mut info = self.info.lock().unwrap_or_else(PoisonError::into_inner);
        info.running = false;
        info.backend = None;
        info.device = None;
    }

    fn request<T: Serialize>(
        &self,
        id: u64,
        payload: &T,
        timeout: Duration,
    ) -> Result<WireReply, String> {
        let line = serde_json::to_string(payload).map_err(|e| format!("encode error: {e}"))?;
        let (tx, rx) = mpsc::channel();
        {
            let mut map = self.pending.lock().unwrap_or_else(PoisonError::into_inner);
            map.insert(id, tx);
        }
        let write_result: Result<(), String> = (|| {
            let mut guard = self.stdin.lock().unwrap_or_else(PoisonError::into_inner);
            let stdin = guard
                .as_mut()
                .ok_or_else(|| "local speech worker is not running".to_string())?;
            let res = stdin
                .write_all(line.as_bytes())
                .and_then(|()| stdin.write_all(b"\n"))
                .and_then(|()| stdin.flush())
                .map_err(|e| format!("worker write error: {e}"));
            drop(guard);
            res
        })();
        if let Err(err) = write_result {
            self.pending
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .remove(&id);
            self.mark_dead();
            return Err(err);
        }

        let received = rx.recv_timeout(timeout);
        if received.is_err() {
            self.pending
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .remove(&id);
        }
        let reply = match received {
            Ok(Ok(r)) => r,
            Ok(Err(e)) => return Err(e),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                return Err("local speech worker timed out".to_string());
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                self.mark_dead();
                return Err("local speech worker exited unexpectedly".to_string());
            }
        };
        if reply.ok == Some(false) {
            return Err(reply
                .error
                .unwrap_or_else(|| "local speech worker error".to_string()));
        }
        Ok(reply)
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn read_loop(
    stdout: std::process::ChildStdout,
    pending: &PendingMap,
    ready_tx: &mpsc::Sender<Result<WireReply, String>>,
    stderr_tail: &Arc<Mutex<Vec<String>>>,
) {
    let mut reader = BufReader::new(stdout);
    let mut buf = Vec::with_capacity(4096);
    let mut sent_ready = false;

    loop {
        buf.clear();
        let n = match reader.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        if n > MAX_LINE_BYTES {
            continue;
        }
        let line = String::from_utf8_lossy(&buf[..n]);
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(reply) = serde_json::from_str::<WireReply>(trimmed) else {
            continue;
        };
        if !sent_ready && reply.kind.as_deref() == Some("ready") {
            sent_ready = true;
            let _ = ready_tx.send(Ok(reply));
            continue;
        }
        if let Some(id) = reply.id {
            let tx = pending
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .remove(&id);
            if let Some(tx) = tx {
                let _ = tx.send(Ok(reply));
            }
        }
    }

    let exit_reason = {
        let tail = stderr_tail.lock().unwrap_or_else(PoisonError::into_inner);
        if tail.is_empty() {
            "local speech worker exited".to_string()
        } else {
            tail.join(" · ")
        }
    };
    if !sent_ready {
        let _ = ready_tx.send(Err(exit_reason.clone()));
    }
    let mut map = pending.lock().unwrap_or_else(PoisonError::into_inner);
    for (_, tx) in map.drain() {
        let _ = tx.send(Err(exit_reason.clone()));
    }
}
