//! A child's progress, read from the status line it rewrites on stdout.
//!
//! `omp setup speech` reports a download as `\r<stage> (N%)\x1b[K`, once per
//! event of the download: megabytes of output over a large model, and a
//! line with no line end of its own. [`ProgressLines`] cuts the stream at
//! `\r`, `\n` and the erase sequence, drops terminal escapes and repeats,
//! and hands on one [`Progress`] per change.

use serde::Serialize;

/// Longest line kept; the rest of a longer one is dropped.
const LINE_MAX: usize = 240;
/// "Erase to the end of the line": what ends a rewritten status line.
const ERASE: &[u8] = b"\x1b[K";

/// One line of progress, as the child printed it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Progress {
    pub message: String,
    /// The `(N%)` the line ends with, when it has one.
    pub percent: Option<u8>,
}

/// The stream so far: the line being read and the last one reported.
#[derive(Default)]
pub struct ProgressLines {
    pending: Vec<u8>,
    last: String,
}

impl ProgressLines {
    /// Take the next bytes of the stream; `report` gets every line that
    /// differs from the one before it.
    pub fn feed(&mut self, chunk: &[u8], mut report: impl FnMut(Progress)) {
        for &byte in chunk {
            let ended = if byte == b'\r' || byte == b'\n' {
                true
            } else {
                if self.pending.len() < LINE_MAX {
                    self.pending.push(byte);
                }
                self.pending.ends_with(ERASE)
            };
            if ended {
                if let Some(progress) = self.end_line() {
                    report(progress);
                }
            }
        }
    }

    fn end_line(&mut self) -> Option<Progress> {
        let line = strip_escapes(&String::from_utf8_lossy(&self.pending));
        self.pending.clear();
        let line = line.trim();
        if line.is_empty() || line == self.last {
            return None;
        }
        self.last.clear();
        self.last.push_str(line);
        Some(Progress {
            message: line.to_string(),
            percent: percent(line),
        })
    }
}

/// `line` without its terminal control sequences (`ESC [ … letter`).
fn strip_escapes(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut chars = line.chars();
    while let Some(c) = chars.next() {
        if c != '\x1b' {
            out.push(c);
        } else if chars.next() == Some('[') {
            // Parameters, then one final byte in `@`..=`~`.
            for c in chars.by_ref() {
                if ('@'..='~').contains(&c) {
                    break;
                }
            }
        }
    }
    out
}

fn percent(line: &str) -> Option<u8> {
    let (_, number) = line.strip_suffix("%)")?.rsplit_once('(')?;
    number.parse::<u8>().ok().filter(|percent| *percent <= 100)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(stream: &[u8], chunk: usize) -> Vec<(String, Option<u8>)> {
        let mut parser = ProgressLines::default();
        let mut seen = Vec::new();
        for piece in stream.chunks(chunk) {
            parser.feed(piece, |p| seen.push((p.message, p.percent)));
        }
        seen
    }

    /// What `omp setup speech` prints while it downloads one model.
    fn setup_output() -> Vec<u8> {
        let mut out = b"\x1b[2mPreparing Speech-to-Text model...\x1b[22m\n".to_vec();
        for percent in [0, 0, 0, 1, 1, 37, 37, 100] {
            out.extend_from_slice(
                format!("\r\x1b[2mDownloading Whisper model ({percent}%)\x1b[22m\x1b[K").as_bytes(),
            );
        }
        out.extend_from_slice("\n\u{2713} Speech-to-Text model ready\n".as_bytes());
        out
    }

    #[test]
    fn a_rewritten_status_line_is_one_report_per_change() {
        let expected = [
            ("Preparing Speech-to-Text model...", None),
            ("Downloading Whisper model (0%)", Some(0)),
            ("Downloading Whisper model (1%)", Some(1)),
            ("Downloading Whisper model (37%)", Some(37)),
            ("Downloading Whisper model (100%)", Some(100)),
            ("\u{2713} Speech-to-Text model ready", None),
        ]
        .map(|(message, percent)| (message.to_string(), percent));
        // Whatever way the pipe cuts the stream, the lines are the same.
        for chunk in [1, 3, 7, 8192] {
            assert_eq!(lines(&setup_output(), chunk), expected, "chunk {chunk}");
        }
    }

    #[test]
    fn the_last_status_line_is_reported_before_its_line_end() {
        // The download is at 100% and omp is loading the model: nothing
        // follows the erase sequence for a while.
        assert_eq!(
            lines(b"\rDownloading (100%)\x1b[K", 8192),
            [("Downloading (100%)".to_string(), Some(100))]
        );
    }

    #[test]
    fn megabytes_of_the_same_line_report_once() {
        let stream = b"\rDownloading model (5%)\x1b[K".repeat(100_000);
        assert_eq!(lines(&stream, 8192).len(), 1);
    }

    #[test]
    fn a_percent_is_a_trailing_number_up_to_100() {
        assert_eq!(percent("Downloading (v2) model (42%)"), Some(42));
        for none in [
            "Downloading model",
            "(42%) done",
            "x (140%)",
            "x (-1%)",
            "x (%)",
        ] {
            assert_eq!(percent(none), None, "{none}");
        }
    }

    #[test]
    fn an_endless_line_is_cut_not_kept() {
        let mut stream = vec![b'x'; 10_000];
        stream.push(b'\n');
        let seen = lines(&stream, 8192);
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].0.len(), LINE_MAX);
    }
}
