//! Reading replies aloud (Settings → Voice → Read aloud).
//!
//! omp speaks its replies only in its terminal UI; nothing in `omp --mode
//! rpc-ui` reads `speech.enabled`. So the app does it: the webview sends the
//! text of a finished reply, one sentence group at a time, [`synthesize`]
//! turns it into one audio file with an engine installed on this machine,
//! and the webview plays the bytes.
//!
//! The webview names an [`Engine`] by id, never a program, an argument or a
//! path:
//! - `edge`: Microsoft Edge's online neural voices through the `edge-tts`
//!   command (Vietnamese: `vi-VN-HoaiMyNeural`, `vi-VN-NamMinhNeural`),
//!   installed with `uv tool install edge-tts`. Needs the network; the
//!   service is the one Edge's own Read aloud uses, not a published API.
//! - `kokoro`: omp's on-device model through `omp say` (English voices),
//!   installed by `omp setup speech`.
//!
//! Every run is bounded (`child_run::collect`): a deadline, a capped
//! output, the tree killed on the way out.

use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use base64::Engine as _;
use serde::Serialize;

use crate::child_path::{child_path_dirs, locate_program};
use crate::child_run::{collect, collect_streamed, Finished, WaitError};
use crate::progress_lines::{Progress, ProgressLines};
use crate::supervisor::ProcessSupervisor;

/// Longest text of one request. The webview sends a reply in pieces of a
/// few sentences, far below this.
const TEXT_MAX_BYTES: usize = 8 * 1024;
const VOICE_MAX_BYTES: usize = 64;
/// Largest audio file handed to the webview (an 8 KiB text is minutes of
/// speech: a few MiB of 24 kHz WAV).
const AUDIO_MAX_BYTES: u64 = 32 * 1024 * 1024;
const SPEED_MIN: f32 = 0.5;
const SPEED_MAX: f32 = 2.5;

/// One piece of speech. Kokoro's first run after a start loads the model.
const SYNTH_TIMEOUT: Duration = Duration::from_secs(120);
const EDGE_INSTALL_TIMEOUT: Duration = Duration::from_secs(300);
/// `omp setup speech` downloads several hundred MiB of models, and reports
/// its progress as it goes: the deadline only ends a run that hangs.
const KOKORO_INSTALL_TIMEOUT: Duration = Duration::from_mins(120);

/// How much of a failed run's stderr (the tail) goes into the error.
const ERROR_LIMIT: usize = 16 * 1024;
/// Engines print little on stdout; anything beyond this is a runaway.
const STDOUT_LIMIT: usize = 256 * 1024;

const EDGE_PROGRAM: &str = "edge-tts";
const UV_MISSING: &str =
    "Edge TTS installs with uv, which was not found. Install uv (https://docs.astral.sh/uv/), then try again.";

/// Numbers the request files of this process, so two requests never share
/// one.
static NEXT_FILE: AtomicU64 = AtomicU64::new(0);

/// A speech engine the app can run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Engine {
    Edge,
    Kokoro,
}

impl Engine {
    const ALL: [Self; 2] = [Self::Edge, Self::Kokoro];

    pub fn parse(id: &str) -> Result<Self, String> {
        Self::ALL
            .into_iter()
            .find(|engine| engine.id() == id)
            .ok_or_else(|| {
                format!(
                    "unknown speech engine: {:?}",
                    crate::text::prefix_within(id, 32)
                )
            })
    }

    pub const fn id(self) -> &'static str {
        match self {
            Self::Edge => "edge",
            Self::Kokoro => "kokoro",
        }
    }

    /// The audio file an engine writes: its extension and MIME type.
    const fn format(self) -> (&'static str, &'static str) {
        match self {
            Self::Edge => ("mp3", "audio/mpeg"),
            Self::Kokoro => ("wav", "audio/wav"),
        }
    }
}

/// Whether an engine can speak now.
#[derive(Debug, Serialize)]
pub struct EngineStatus {
    id: &'static str,
    installed: bool,
    /// Where it was found, or why it cannot run.
    detail: String,
}

/// One synthesized piece of speech.
#[derive(Debug, Serialize)]
pub struct Audio {
    mime: &'static str,
    /// The audio file, base64.
    data: String,
}

/// Every engine's state. Spawns `omp` once (Kokoro's model check): callers
/// MUST run this off the main thread.
pub fn status(profile: Option<&str>) -> Vec<EngineStatus> {
    Engine::ALL
        .into_iter()
        .map(|engine| {
            let (installed, detail) = match engine {
                Engine::Edge => match locate_program(&child_path_dirs(), EDGE_PROGRAM) {
                    Ok(found) => (true, found.binary.display().to_string()),
                    Err(_) => (false, format!("{EDGE_PROGRAM} is not installed")),
                },
                Engine::Kokoro => match crate::speech_config::tts_model(profile) {
                    Ok(model) => (model.ready, model.status),
                    Err(error) => (false, error),
                },
            };
            EngineStatus {
                id: engine.id(),
                installed,
                detail,
            }
        })
        .collect()
}

/// Whether `omp setup speech` is running. A second run beside it would
/// download the same files again.
static KOKORO_INSTALLING: AtomicBool = AtomicBool::new(false);

/// Holds [`KOKORO_INSTALLING`] for one run.
struct KokoroInstall;

impl KokoroInstall {
    fn begin() -> Result<Self, String> {
        if KOKORO_INSTALLING.swap(true, Ordering::SeqCst) {
            return Err("omp setup speech is already running".to_string());
        }
        Ok(Self)
    }
}

impl Drop for KokoroInstall {
    fn drop(&mut self) {
        KOKORO_INSTALLING.store(false, Ordering::SeqCst);
    }
}

/// Install `engine` on this machine: `uv tool install edge-tts`, or `omp
/// setup speech` (which also fetches omp's voice to text model), whose
/// progress lines go to `progress` as it prints them. Blocking, for minutes.
pub fn install(
    engine: Engine,
    profile: Option<&str>,
    progress: impl FnMut(Progress) + Send + 'static,
) -> Result<(), String> {
    match engine {
        Engine::Edge => {
            let uv =
                locate_program(&child_path_dirs(), "uv").map_err(|_| UV_MISSING.to_string())?;
            let mut cmd = Command::new(&uv.binary);
            cmd.env("PATH", &uv.path)
                .args(["tool", "install", EDGE_PROGRAM]);
            run(&mut cmd, EDGE_INSTALL_TIMEOUT, "uv tool install edge-tts")
        }
        Engine::Kokoro => {
            let _running = KokoroInstall::begin()?;
            let mut cmd = crate::agent::spawn::omp_command()?;
            cmd.args(crate::agent::spawn::profile_flag(profile))
                .args(["setup", "speech"]);
            run_reporting(
                &mut cmd,
                KOKORO_INSTALL_TIMEOUT,
                "omp setup speech",
                progress,
            )
        }
    }
}

/// What the webview asks to hear.
pub struct Request<'a> {
    pub engine: Engine,
    pub voice: &'a str,
    pub speed: f32,
    pub text: &'a str,
    pub profile: Option<&'a str>,
}

/// Speak `request.text` into an audio file under `dir` (created on first
/// use, private) and return its bytes; the files are removed again.
/// Blocking.
pub fn synthesize(request: &Request, dir: &Path) -> Result<Audio, String> {
    check_voice(request.voice)?;
    check_text(request.text)?;
    crate::private_fs::private_dirs(true)
        .create(dir)
        .map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let (extension, mime) = request.engine.format();
    let stem = format!(
        "{}-{}",
        std::process::id(),
        NEXT_FILE.fetch_add(1, Ordering::Relaxed)
    );
    let text_file = dir.join(format!("{stem}.txt"));
    let audio_file = dir.join(format!("{stem}.{extension}"));
    crate::private_fs::create_private_file(&text_file, request.text.as_bytes())
        .map_err(|e| format!("could not write the text to speak: {e}"))?;
    let spoken = command(request, &text_file, &audio_file)
        .and_then(|(mut cmd, label)| run(&mut cmd, SYNTH_TIMEOUT, label))
        .and_then(|()| read_audio(&audio_file));
    // Best effort: a leftover is a small file in the app's own cache.
    let _ = std::fs::remove_file(&text_file);
    let _ = std::fs::remove_file(&audio_file);
    Ok(Audio {
        mime,
        data: base64::engine::general_purpose::STANDARD.encode(spoken?),
    })
}

/// The engine's command for one request, and its name for an error.
fn command(
    request: &Request,
    text_file: &Path,
    audio_file: &Path,
) -> Result<(Command, &'static str), String> {
    let (mut cmd, label) = match request.engine {
        Engine::Edge => {
            let program = locate_program(&child_path_dirs(), EDGE_PROGRAM)?;
            let mut cmd = Command::new(&program.binary);
            cmd.env("PATH", &program.path);
            (cmd, EDGE_PROGRAM)
        }
        Engine::Kokoro => (crate::agent::spawn::omp_command()?, "omp say"),
    };
    add_args(&mut cmd, request, text_file, audio_file);
    Ok((cmd, label))
}

/// The arguments that make the engine's program speak `text_file` into
/// `audio_file`.
fn add_args(cmd: &mut Command, request: &Request, text_file: &Path, audio_file: &Path) {
    let speed = request.speed.clamp(SPEED_MIN, SPEED_MAX);
    match request.engine {
        Engine::Edge => cmd
            .args(["--voice", request.voice])
            .arg(edge_rate(speed))
            .arg("--file")
            .arg(text_file)
            .arg("--write-media")
            .arg(audio_file),
        Engine::Kokoro => cmd
            .args(crate::agent::spawn::profile_flag(request.profile))
            .args(["say", "--voice", request.voice, "--speed"])
            .arg(format!("{speed:.2}"))
            .arg("--file")
            .arg(text_file)
            .arg("--out")
            .arg(audio_file),
    };
}

/// edge-tts takes the rate as a signed percentage of normal speed, in one
/// argument (`--rate=-20%`): as two, a leading `-` reads as a flag.
fn edge_rate(speed: f32) -> String {
    // The clamp keeps the value far inside i32.
    #[allow(clippy::cast_possible_truncation)]
    let percent = ((speed - 1.0) * 100.0).round() as i32;
    format!("--rate={percent:+}%")
}

/// A voice id from the webview: what both engines' ids look like (ASCII
/// letters, digits, `-`, `_`), so it can never be an option or a path.
fn check_voice(voice: &str) -> Result<(), String> {
    let plain = voice
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if voice.is_empty() || voice.len() > VOICE_MAX_BYTES || voice.starts_with('-') || !plain {
        return Err(format!(
            "invalid voice: {:?}",
            crate::text::prefix_within(voice, 64)
        ));
    }
    Ok(())
}

fn check_text(text: &str) -> Result<(), String> {
    if text.trim().is_empty() {
        return Err("nothing to speak".to_string());
    }
    if text.len() > TEXT_MAX_BYTES {
        return Err(format!(
            "text to speak is longer than {TEXT_MAX_BYTES} bytes"
        ));
    }
    Ok(())
}

fn read_audio(path: &Path) -> Result<Vec<u8>, String> {
    let size = std::fs::metadata(path)
        .map_err(|_| "the speech engine wrote no audio".to_string())?
        .len();
    if size == 0 {
        return Err("the speech engine wrote no audio".to_string());
    }
    if size > AUDIO_MAX_BYTES {
        return Err("the speech engine's audio is too large".to_string());
    }
    std::fs::read(path).map_err(|e| format!("could not read the audio: {e}"))
}

/// Run `cmd` to a successful exit by `timeout`; `label` names it in the
/// error, which carries the end of its stderr.
fn run(cmd: &mut Command, timeout: Duration, label: &str) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    run_with(cmd, label, |child, supervisor| {
        collect(
            child,
            supervisor,
            STDOUT_LIMIT,
            ERROR_LIMIT,
            deadline,
            |_| Ok(()),
        )
    })
}

/// [`run`] for a command that rewrites a status line on stdout for as long
/// as it works (`omp setup speech`): megabytes, which a stdout cap would
/// take for a runaway. Each change of that line goes to `progress`.
fn run_reporting(
    cmd: &mut Command,
    timeout: Duration,
    label: &str,
    mut progress: impl FnMut(Progress) + Send + 'static,
) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    let mut lines = ProgressLines::default();
    run_with(cmd, label, move |child, supervisor| {
        collect_streamed(child, supervisor, ERROR_LIMIT, deadline, move |chunk| {
            lines.feed(chunk, &mut progress);
        })
    })
}

fn run_with(
    cmd: &mut Command,
    label: &str,
    wait: impl FnOnce(&mut Child, &ProcessSupervisor) -> Result<Finished, WaitError>,
) -> Result<(), String> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    ProcessSupervisor::prepare(cmd);
    let mut child =
        crate::spawn_gate::spawn(cmd).map_err(|e| format!("could not start {label}: {e}"))?;
    let supervisor = ProcessSupervisor::attach(&child);
    let done = wait(&mut child, &supervisor).map_err(|e| match e {
        WaitError::Overflow => format!("{label} printed too much"),
        WaitError::TimedOut => format!("{label} timed out"),
        WaitError::Failed(e) => format!("{label}: {e}"),
    })?;
    if done.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&done.stderr);
    Err(failure(label, &done.status.to_string(), &stderr))
}

/// A failed run's message: the last non-blank lines of its stderr, which
/// is where a Python traceback or omp's `error:` line ends.
fn failure(label: &str, status: &str, stderr: &str) -> String {
    let mut tail: Vec<&str> = stderr
        .lines()
        .rev()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(3)
        .collect();
    tail.reverse();
    if tail.is_empty() {
        format!("{label} failed ({status})")
    } else {
        format!("{label} failed ({status}): {}", tail.join(" · "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(engine: Engine, voice: &str, speed: f32, profile: Option<&str>) -> Vec<String> {
        let mut cmd = Command::new("engine");
        let request = Request {
            engine,
            voice,
            speed,
            text: "hello",
            profile,
        };
        add_args(&mut cmd, &request, Path::new("t.txt"), Path::new("t.out"));
        cmd.get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn engines_are_named_by_id_only() {
        assert_eq!(Engine::parse("edge"), Ok(Engine::Edge));
        assert_eq!(Engine::parse("kokoro"), Ok(Engine::Kokoro));
        for unknown in ["", "Edge", "piper", "/usr/bin/edge-tts", "edge "] {
            assert!(Engine::parse(unknown).is_err(), "{unknown:?}");
        }
    }

    #[test]
    fn edge_rate_is_one_signed_percent_argument() {
        assert_eq!(edge_rate(1.0), "--rate=+0%");
        assert_eq!(edge_rate(1.25), "--rate=+25%");
        assert_eq!(edge_rate(0.8), "--rate=-20%");
        assert_eq!(edge_rate(2.5), "--rate=+150%");
    }

    #[test]
    fn a_voice_is_an_id_never_an_option_or_a_path() {
        for good in [
            "vi-VN-HoaiMyNeural",
            "af_heart",
            "en-US-AvaMultilingualNeural",
        ] {
            assert_eq!(check_voice(good), Ok(()));
        }
        let long = "v".repeat(65);
        for bad in [
            "", "--file", "-x", "a b", "../x", "a/b", "voice;rm", "giọng", &long,
        ] {
            assert!(check_voice(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn text_must_say_something_and_stay_bounded() {
        assert_eq!(check_text("Xin chào."), Ok(()));
        assert!(check_text("  \n ").is_err());
        assert!(check_text(&"x".repeat(TEXT_MAX_BYTES + 1)).is_err());
        assert_eq!(check_text(&"x".repeat(TEXT_MAX_BYTES)), Ok(()));
    }

    #[test]
    fn each_engine_gets_its_own_arguments_and_a_clamped_speed() {
        assert_eq!(
            args(Engine::Kokoro, "af_heart", 9.0, Some("work")),
            [
                "--profile=work",
                "say",
                "--voice",
                "af_heart",
                "--speed",
                "2.50",
                "--file",
                "t.txt",
                "--out",
                "t.out"
            ]
        );
        assert_eq!(
            args(Engine::Edge, "vi-VN-HoaiMyNeural", 0.1, Some("work")),
            [
                "--voice",
                "vi-VN-HoaiMyNeural",
                "--rate=-50%",
                "--file",
                "t.txt",
                "--write-media",
                "t.out"
            ]
        );
    }

    #[test]
    fn a_failure_quotes_the_end_of_stderr() {
        let stderr = "Traceback (most recent call last):\n  File \"x\"\n\nedge_tts.exceptions.NoAudioReceived: No audio was received.\n";
        assert_eq!(
            failure("edge-tts", "exit status: 1", stderr),
            "edge-tts failed (exit status: 1): Traceback (most recent call last): · File \"x\" · edge_tts.exceptions.NoAudioReceived: No audio was received."
        );
        assert_eq!(
            failure("omp say", "exit status: 2", " \n"),
            "omp say failed (exit status: 2)"
        );
    }

    #[test]
    fn one_kokoro_install_runs_at_a_time() {
        let first = KokoroInstall::begin().expect("nothing is running");
        assert!(KokoroInstall::begin().is_err());
        drop(first);
        assert!(KokoroInstall::begin().is_ok());
    }

    /// `omp setup speech` rewrites its status line far past any stdout cap:
    /// the run must reach its end, and the caller see the lines.
    #[cfg(unix)]
    #[test]
    fn a_reporting_run_outlives_megabytes_of_status_lines() {
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = std::sync::Arc::clone(&seen);
        let mut cmd = Command::new("sh");
        cmd.args([
            "-c",
            r"i=0; while [ $i -lt 40000 ]; do printf '\rDownloading model (%d%%)\033[K' $((i / 400)); i=$((i + 1)); done; printf '\ndone\n'",
        ]);
        let result = run_reporting(
            &mut cmd,
            Duration::from_secs(60),
            "status lines",
            move |p| {
                sink.lock().expect("lock").push(p);
            },
        );
        assert_eq!(result, Ok(()));
        let seen = seen.lock().expect("lock");
        assert_eq!(
            seen.len(),
            101,
            "one report per percent, then the last line"
        );
        assert_eq!(seen[99].percent, Some(99));
        assert_eq!(seen[100].message, "done");
    }

    #[test]
    fn missing_or_empty_audio_is_an_error() {
        let dir = std::env::temp_dir().join(format!("omp-tts-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a.wav");
        assert!(read_audio(&file).is_err());
        std::fs::write(&file, b"").unwrap();
        assert!(read_audio(&file).is_err());
        std::fs::write(&file, b"RIFF").unwrap();
        assert_eq!(read_audio(&file).unwrap(), b"RIFF");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
