//! Bounded child-process runs, shared by widget plugins (`widgets/run.rs`),
//! the PR lookup's `gh` calls (`pr_automation/gh.rs`) and the speech engines
//! (`tts.rs`): [`collect`] runs a spawned child to its exit under a deadline
//! with capped output, [`collect_streamed`] does the same for a child that
//! reports progress on stdout for as long as it runs.
//!
//! A blocking `read` cannot observe the deadline while the child is idle, so
//! the pipes are drained on dedicated threads whose results come back over
//! channels, and the exit wait polls `try_wait` against the deadline every
//! [`POLL`].

use std::collections::VecDeque;
use std::io::Read;
use std::process::{Child, ChildStdout, ExitStatus};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::supervisor::ProcessSupervisor;

const POLL: Duration = Duration::from_millis(25);

/// Why [`collect`] gave up on the child (its tree is already killed).
#[derive(Debug, PartialEq, Eq)]
pub enum WaitError {
    /// Stdout passed its cap.
    Overflow,
    TimedOut,
    Failed(String),
}

/// What [`collect`] got from a child that exited in time.
pub struct Finished {
    pub status: ExitStatus,
    /// At most the cap's worth, from the start.
    pub stdout: Vec<u8>,
    /// The last bytes of stderr, read only for a failed run (empty when it
    /// succeeded or its reader missed the deadline).
    pub stderr: Vec<u8>,
}

/// Run the spawned `child` to its exit by `deadline`: its stdout and stderr
/// are drained on threads (stdout capped at `stdout_cap`, the last
/// `stderr_keep` bytes of stderr kept), then `started` runs (feeding stdin,
/// say). Once the child exits, whatever it left behind is killed at once
/// rather than when the supervisor drops, so a background holder of a pipe
/// cannot stall the readers until the deadline. Every error kills the tree.
pub fn collect(
    child: &mut Child,
    supervisor: &ProcessSupervisor,
    stdout_cap: usize,
    stderr_keep: usize,
    deadline: Instant,
    started: impl FnOnce(&mut Child) -> Result<(), String>,
) -> Result<Finished, WaitError> {
    // The reader thread raises the flag, this thread polls it.
    let overflow = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&overflow);
    run(
        child,
        supervisor,
        stderr_keep,
        deadline,
        &overflow,
        move |pipe| spawn_drain(pipe, stdout_cap, Some(flag)),
        started,
    )
}

/// [`collect`] for a child that prints progress for as long as it runs (a
/// download's rewritten status line): stdout has no cap and none of it is
/// kept (`Finished::stdout` is empty); every chunk read goes to `sink`, on
/// the reader thread. The deadline is the only bound.
pub fn collect_streamed(
    child: &mut Child,
    supervisor: &ProcessSupervisor,
    stderr_keep: usize,
    deadline: Instant,
    sink: impl FnMut(&[u8]) + Send + 'static,
) -> Result<Finished, WaitError> {
    run(
        child,
        supervisor,
        stderr_keep,
        deadline,
        &AtomicBool::new(false),
        |pipe| spawn_feed(pipe, sink),
        |_| Ok(()),
    )
}

/// What a pipe's reader thread hands back: the bytes it kept.
type Drained = Receiver<std::io::Result<Vec<u8>>>;

fn run(
    child: &mut Child,
    supervisor: &ProcessSupervisor,
    stderr_keep: usize,
    deadline: Instant,
    overflow: &AtomicBool,
    read_stdout: impl FnOnce(ChildStdout) -> Result<Drained, String>,
    started: impl FnOnce(&mut Child) -> Result<(), String>,
) -> Result<Finished, WaitError> {
    let (Some(out_pipe), Some(err_pipe)) = (child.stdout.take(), child.stderr.take()) else {
        terminate(supervisor, child);
        return Err(WaitError::Failed("stdout or stderr pipe missing".into()));
    };
    let setup = (|| {
        let stdout_rx = read_stdout(out_pipe)?;
        let stderr_rx = spawn_drain(err_pipe, stderr_keep, None)?;
        started(child)?;
        Ok((stdout_rx, stderr_rx))
    })();
    let (stdout_rx, stderr_rx) = setup.map_err(|e: String| {
        terminate(supervisor, child);
        WaitError::Failed(e)
    })?;
    let status = wait_for_exit(child, supervisor, overflow, deadline)?;
    supervisor.kill_tree();
    let stdout = recv_until(&stdout_rx, deadline)
        .ok_or(WaitError::TimedOut)?
        .map_err(|e| WaitError::Failed(format!("could not read stdout: {e}")))?;
    if overflow.load(Ordering::Relaxed) {
        return Err(WaitError::Overflow);
    }
    let stderr = if status.success() {
        Vec::new()
    } else {
        recv_until(&stderr_rx, deadline)
            .and_then(Result::ok)
            .unwrap_or_default()
    };
    Ok(Finished {
        status,
        stdout,
        stderr,
    })
}

/// Drain `pipe` on a thread. With `overflow`, at most `keep` bytes are kept
/// from the start; exceeding that raises the flag and stops reading (the
/// caller kills the child). Without it the last `keep` bytes are kept and the
/// rest is read and discarded so the writer never blocks on a full pipe.
fn spawn_drain(
    mut pipe: impl Read + Send + 'static,
    keep: usize,
    overflow: Option<Arc<AtomicBool>>,
) -> Result<Drained, String> {
    let (tx, rx) = mpsc::channel();
    std::thread::Builder::new()
        .name("child-drain".to_string())
        .spawn(move || {
            let mut buf: VecDeque<u8> = VecDeque::new();
            let mut chunk = [0u8; 8192];
            let result = loop {
                match pipe.read(&mut chunk) {
                    Ok(0) => break Ok(Vec::from(buf)),
                    Ok(n) => {
                        if let Some(flag) = &overflow {
                            if buf.len() + n > keep {
                                flag.store(true, Ordering::Relaxed);
                                break Ok(Vec::from(buf));
                            }
                            buf.extend(&chunk[..n]);
                        } else {
                            buf.extend(&chunk[..n]);
                            let excess = buf.len().saturating_sub(keep);
                            buf.drain(..excess);
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
                    Err(e) => break Err(e),
                }
            };
            let _ = tx.send(result); // the receiver is gone after a timeout; nobody wants the bytes then
        })
        .map_err(|e| format!("could not start reader thread: {e}"))?;
    Ok(rx)
}

/// Read `pipe` to its end on a thread, handing every chunk to `sink` and
/// keeping nothing.
fn spawn_feed(
    mut pipe: impl Read + Send + 'static,
    mut sink: impl FnMut(&[u8]) + Send + 'static,
) -> Result<Drained, String> {
    let (tx, rx) = mpsc::channel();
    std::thread::Builder::new()
        .name("child-feed".to_string())
        .spawn(move || {
            let mut chunk = [0u8; 8192];
            let result = loop {
                match pipe.read(&mut chunk) {
                    Ok(0) => break Ok(Vec::new()),
                    Ok(n) => sink(&chunk[..n]),
                    Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
                    Err(e) => break Err(e),
                }
            };
            let _ = tx.send(result); // the receiver is gone after a timeout
        })
        .map_err(|e| format!("could not start reader thread: {e}"))?;
    Ok(rx)
}

/// Poll until the child exits. Kills the process tree and errors on deadline
/// or when the stdout reader raises `overflow`.
fn wait_for_exit(
    child: &mut Child,
    supervisor: &ProcessSupervisor,
    overflow: &AtomicBool,
    deadline: Instant,
) -> Result<ExitStatus, WaitError> {
    loop {
        if overflow.load(Ordering::Relaxed) {
            terminate(supervisor, child);
            return Err(WaitError::Overflow);
        }
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) if Instant::now() >= deadline => {
                terminate(supervisor, child);
                return Err(WaitError::TimedOut);
            }
            Ok(None) => std::thread::sleep(POLL),
            Err(e) => {
                terminate(supervisor, child);
                return Err(WaitError::Failed(format!("wait failed: {e}")));
            }
        }
    }
}

/// Result of a drain thread, or `None` if it has not finished by `deadline`.
fn recv_until(rx: &Drained, deadline: Instant) -> Option<std::io::Result<Vec<u8>>> {
    rx.recv_timeout(deadline.saturating_duration_since(Instant::now()))
        .ok()
}

/// Kill the child's process tree, then reap the direct child. The direct
/// `kill` is the fallback for a Windows run whose Job Object could not be
/// attached (`kill_tree` is then a no-op); on a dead process it is harmless.
fn terminate(supervisor: &ProcessSupervisor, child: &mut Child) {
    supervisor.kill_tree();
    let _ = child.kill();
    let _ = child.wait(); // reap; nothing useful to do on failure
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capped_drain_keeps_the_head_and_raises_the_flag() {
        let flag = Arc::new(AtomicBool::new(false));
        let rx = spawn_drain(
            std::io::Cursor::new(vec![b'a'; 100]),
            10,
            Some(Arc::clone(&flag)),
        )
        .expect("thread");
        let got = rx.recv().expect("result").expect("read");
        assert!(flag.load(Ordering::Relaxed));
        assert!(got.len() <= 10, "{}", got.len());
    }

    #[test]
    fn capped_drain_accepts_exactly_the_cap() {
        let flag = Arc::new(AtomicBool::new(false));
        let rx = spawn_drain(
            std::io::Cursor::new(vec![b'a'; 10]),
            10,
            Some(Arc::clone(&flag)),
        )
        .expect("thread");
        assert_eq!(rx.recv().expect("result").expect("read").len(), 10);
        assert!(!flag.load(Ordering::Relaxed));
    }

    #[test]
    fn rolling_drain_keeps_the_tail() {
        let mut input = vec![b'a'; 20_000];
        input.extend_from_slice(b"END");
        let rx = spawn_drain(std::io::Cursor::new(input), 5, None).expect("thread");
        assert_eq!(rx.recv().expect("result").expect("read"), b"aaEND");
    }

    #[test]
    fn a_feed_hands_every_byte_to_the_sink_and_keeps_none() {
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = Arc::clone(&seen);
        let mut input = vec![b'a'; 20_000];
        input.extend_from_slice(b"END");
        let rx = spawn_feed(std::io::Cursor::new(input), move |chunk| {
            sink.lock().expect("lock").extend_from_slice(chunk);
        })
        .expect("thread");
        assert_eq!(rx.recv().expect("result").expect("read"), Vec::<u8>::new());
        let seen = std::mem::take(&mut *seen.lock().expect("lock"));
        assert_eq!(seen.len(), 20_003);
        assert!(seen.ends_with(b"END"));
    }
}
