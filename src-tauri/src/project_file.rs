//! One project file for the in-app preview (issue #39): a tool card's or an
//! agent link's target, read from the tab's project folder — and saved back
//! there by the files panel's editor ([`write`]).
//!
//! The webview sends a tab id and a path; the folder comes from the tab
//! registry, so a preview can never reach outside the project the tab was
//! opened on. The path goes through [`crate::git_browser::project_relative`]
//! (traversal, `.git`, symlinked-directory guards; an absolute path inside the
//! folder is accepted, as a tool card carries whatever omp's tool was given),
//! and the file itself is resolved too: a symlink in the project pointing out
//! of it is refused, not followed. Plain file reads and writes — no git, no
//! filters.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::Serialize;

/// Largest text file shown (highlighting more freezes the webview).
pub const MAX_TEXT_BYTES: u64 = 1024 * 1024;
/// Largest image shown (base64 over IPC grows it by a third).
pub const MAX_IMAGE_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum PreviewKind {
    Text,
    Image,
    Binary,
    TooLarge,
    Missing,
    /// The file resolves out of the project, or into its `.git`.
    Outside,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePreview {
    /// Project-relative, `/`-separated.
    pub path: String,
    /// Bytes on disk (`0` when missing).
    pub size: u64,
    pub kind: PreviewKind,
    /// `Text` only.
    pub text: Option<String>,
    /// `Text` that is valid UTF-8: saving it back loses nothing. A file
    /// shown with replacement characters is not editable.
    pub editable: bool,
    /// `Image` only: base64 of the file.
    pub data: Option<String>,
    /// `Image` only.
    pub mime_type: Option<&'static str>,
}

impl FilePreview {
    const fn empty(path: String, size: u64, kind: PreviewKind) -> Self {
        Self {
            path,
            size,
            kind,
            text: None,
            editable: false,
            data: None,
            mime_type: None,
        }
    }
}

/// The image MIME type for a file name, by extension; `None` for anything
/// else. SVG is included: an `<img>` never runs its scripts.
fn image_mime(name: &str) -> Option<&'static str> {
    let ext = name.rsplit_once('.')?.1.to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        _ => return None,
    })
}

/// Where a path of the webview leads.
enum Resolved {
    Missing(String),
    /// Out of the project, or into its `.git`.
    Outside(String),
    /// The project-relative path and the file it resolves to.
    Inside(String, PathBuf),
}

fn resolve(root: &Path, path: &str) -> Result<Resolved, String> {
    let rel = crate::git_browser::project_relative(root, path)?;
    let canonical_root =
        std::fs::canonicalize(root).map_err(|e| format!("failed to resolve project: {e}"))?;
    // The final component too: a symlink to a file outside the project, or
    // into `.git` (a symlinked directory, a Windows 8.3 alias such as
    // `GIT~1`), must not be reached through the preview — `project_relative`
    // checks only the path as written.
    let file = match std::fs::canonicalize(canonical_root.join(&rel)) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Resolved::Missing(rel)),
        Err(e) => return Err(format!("failed to resolve {rel}: {e}")),
    };
    let outside = file.strip_prefix(&canonical_root).map_or(true, |inside| {
        inside
            .components()
            .any(|c| c.as_os_str().eq_ignore_ascii_case(".git"))
    });
    Ok(if outside {
        Resolved::Outside(rel)
    } else {
        Resolved::Inside(rel, file)
    })
}

/// At most `cap + 1` bytes of `file`: a file that grew since its metadata
/// was read still can't overrun the cap.
fn read_capped(file: &Path, size: u64, cap: u64) -> std::io::Result<Vec<u8>> {
    let mut bytes = Vec::with_capacity(usize::try_from(size.min(cap)).unwrap_or(0));
    std::fs::File::open(file)?
        .take(cap + 1)
        .read_to_end(&mut bytes)?;
    Ok(bytes)
}

/// Read `path` (project-relative, or absolute inside `root`) for preview.
pub fn read(root: &Path, path: &str) -> Result<FilePreview, String> {
    let (rel, file) = match resolve(root, path)? {
        Resolved::Missing(rel) => return Ok(FilePreview::empty(rel, 0, PreviewKind::Missing)),
        Resolved::Outside(rel) => return Ok(FilePreview::empty(rel, 0, PreviewKind::Outside)),
        Resolved::Inside(rel, file) => (rel, file),
    };
    let meta = std::fs::metadata(&file).map_err(|e| format!("failed to read {rel}: {e}"))?;
    if !meta.is_file() {
        return Err(format!("{rel} is not a file"));
    }
    let size = meta.len();
    let mime = image_mime(&rel);
    let cap = if mime.is_some() {
        MAX_IMAGE_BYTES
    } else {
        MAX_TEXT_BYTES
    };
    if size > cap {
        return Ok(FilePreview::empty(rel, size, PreviewKind::TooLarge));
    }
    let bytes = read_capped(&file, size, cap).map_err(|e| format!("failed to read {rel}: {e}"))?;
    if bytes.len() as u64 > cap {
        return Ok(FilePreview::empty(
            rel,
            bytes.len() as u64,
            PreviewKind::TooLarge,
        ));
    }
    if let Some(mime) = mime {
        return Ok(FilePreview {
            data: Some(STANDARD.encode(&bytes)),
            mime_type: Some(mime),
            ..FilePreview::empty(rel, size, PreviewKind::Image)
        });
    }
    if crate::git_browser::is_binary(&bytes) {
        return Ok(FilePreview::empty(rel, size, PreviewKind::Binary));
    }
    let (text, editable) = match String::from_utf8(bytes) {
        Ok(text) => (text, true),
        // Latin-1 and friends: shown with replacement characters rather
        // than refused.
        Err(e) => (String::from_utf8_lossy(e.as_bytes()).into_owned(), false),
    };
    Ok(FilePreview {
        text: Some(text),
        editable,
        ..FilePreview::empty(rel, size, PreviewKind::Text)
    })
}

/// What a save did.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum Saved {
    /// Written; `size` is the file's new length in bytes.
    Saved { size: u64 },
    /// Nothing written: the file no longer holds `base`.
    Changed,
}

/// Replace the text of the existing file `path` with `text`. With `base`
/// (the text the editor loaded) the file is written only while it still
/// holds exactly that, so an edit the agent made meanwhile is not lost;
/// `None` overwrites. The new text goes to a sibling temp file that is
/// renamed over the file, so a crash leaves the old or the new file whole.
/// A symlink inside the project stays one: its target is replaced.
pub fn write(root: &Path, path: &str, base: Option<&str>, text: &str) -> Result<Saved, String> {
    if text.len() as u64 > MAX_TEXT_BYTES {
        return Err("the text is larger than the editor's limit".into());
    }
    let (rel, file) = match resolve(root, path)? {
        Resolved::Missing(rel) => return Err(format!("{rel} no longer exists")),
        Resolved::Outside(rel) => return Err(format!("{rel} is outside the project")),
        Resolved::Inside(rel, file) => (rel, file),
    };
    let meta = std::fs::metadata(&file).map_err(|e| format!("failed to read {rel}: {e}"))?;
    if !meta.is_file() {
        return Err(format!("{rel} is not a file"));
    }
    if let Some(base) = base {
        let now = read_capped(&file, meta.len(), MAX_TEXT_BYTES)
            .map_err(|e| format!("failed to read {rel}: {e}"))?;
        if now != base.as_bytes() {
            return Ok(Saved::Changed);
        }
    }
    let name = file.file_name().ok_or("the file has no name")?;
    let mut temp_name = std::ffi::OsString::from(".");
    temp_name.push(name);
    temp_name.push(format!(".omp-save-{}", std::process::id()));
    let temp = file.with_file_name(temp_name);
    // A leftover (or planted) entry under the temp name goes first, and
    // `create_new` never opens through a symlink: the text can only land in
    // a file this call created.
    let _ = std::fs::remove_file(&temp);
    let saved = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .and_then(|mut f| {
            f.write_all(text.as_bytes())?;
            f.set_permissions(meta.permissions())?;
            f.sync_all()
        })
        .and_then(|()| std::fs::rename(&temp, &file));
    if let Err(e) = saved {
        let _ = std::fs::remove_file(&temp);
        return Err(format!("failed to save {rel}: {e}"));
    }
    Ok(Saved::Saved {
        size: text.len() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::{read, write, PreviewKind, Saved, MAX_IMAGE_BYTES, MAX_TEXT_BYTES};
    use crate::test_support::TempDir;
    use std::fs;

    fn project(name: &str) -> TempDir {
        let dir = TempDir::new("project-file", name);
        fs::create_dir_all(dir.path().join("src")).unwrap();
        dir
    }

    #[test]
    fn reads_text_by_relative_and_absolute_path() {
        let dir = project("text");
        fs::write(dir.path().join("src/a.rs"), "fn main() {}\n").unwrap();
        let rel = read(dir.path(), "src/a.rs").unwrap();
        assert_eq!(rel.kind, PreviewKind::Text);
        assert_eq!(rel.path, "src/a.rs");
        assert_eq!(rel.text.as_deref(), Some("fn main() {}\n"));
        let abs = dir.path().join("src").join("a.rs");
        let abs = read(dir.path(), abs.to_str().unwrap()).unwrap();
        assert_eq!(abs.path, "src/a.rs");
        assert_eq!(abs.kind, PreviewKind::Text);
    }

    #[test]
    fn a_save_replaces_the_text_only_while_the_file_holds_the_base() {
        let dir = project("save");
        let file = dir.path().join("src/a.rs");
        fs::write(&file, "one\n").unwrap();
        assert_eq!(
            write(dir.path(), "src/a.rs", Some("one\n"), "two\r\n").unwrap(),
            Saved::Saved { size: 5 }
        );
        assert_eq!(fs::read(&file).unwrap(), b"two\r\n");
        // The agent changed it meanwhile: nothing is written.
        fs::write(&file, "agent\n").unwrap();
        assert_eq!(
            write(dir.path(), "src/a.rs", Some("two\r\n"), "mine\n").unwrap(),
            Saved::Changed
        );
        assert_eq!(fs::read(&file).unwrap(), b"agent\n");
        // Without a base the save overwrites.
        assert_eq!(
            write(dir.path(), "src/a.rs", None, "mine\n").unwrap(),
            Saved::Saved { size: 5 }
        );
        assert_eq!(fs::read(&file).unwrap(), b"mine\n");
        let left: Vec<_> = fs::read_dir(dir.path().join("src"))
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(left, ["a.rs"], "no temp file stays behind");
    }

    #[test]
    fn a_save_creates_nothing_and_stays_in_the_project() {
        let dir = project("save-refused");
        assert!(write(dir.path(), "src/new.rs", None, "x").is_err());
        assert!(!dir.path().join("src/new.rs").exists());
        assert!(write(dir.path(), "../out.txt", None, "x").is_err());
        fs::create_dir_all(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join(".git/config"), "[core]\n").unwrap();
        assert!(write(dir.path(), ".git/config", None, "x").is_err());
        assert_eq!(
            fs::read(dir.path().join(".git/config")).unwrap(),
            b"[core]\n"
        );
        fs::write(dir.path().join("a.txt"), "a").unwrap();
        let big = "a".repeat(usize::try_from(MAX_TEXT_BYTES).unwrap() + 1);
        assert!(write(dir.path(), "a.txt", None, &big).is_err());
        assert!(write(dir.path(), "src", None, "x").is_err(), "a directory");
    }

    #[cfg(unix)]
    #[test]
    fn a_save_keeps_the_mode_and_never_follows_a_link_out_of_the_project() {
        use std::os::unix::fs::PermissionsExt;
        let dir = project("save-unix");
        let script = dir.path().join("run.sh");
        fs::write(&script, "#!/bin/sh\n").unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        write(dir.path(), "run.sh", None, "#!/bin/sh\necho hi\n").unwrap();
        assert_eq!(
            fs::metadata(&script).unwrap().permissions().mode() & 0o777,
            0o755
        );
        let outside = TempDir::new("project-file", "save-outside");
        let secret = outside.path().join("secret.txt");
        fs::write(&secret, "keep").unwrap();
        std::os::unix::fs::symlink(&secret, dir.path().join("link.txt")).unwrap();
        assert!(write(dir.path(), "link.txt", None, "gone").is_err());
        assert_eq!(fs::read(&secret).unwrap(), b"keep");
        // A link planted under the temp name is replaced, not written through.
        let planted = dir
            .path()
            .join(format!(".run.sh.omp-save-{}", std::process::id()));
        std::os::unix::fs::symlink(&secret, &planted).unwrap();
        write(dir.path(), "run.sh", None, "#!/bin/sh\n").unwrap();
        assert_eq!(fs::read(&secret).unwrap(), b"keep");
        assert!(fs::symlink_metadata(&planted).is_err());
        // A link that stays inside is kept; its target takes the text.
        std::os::unix::fs::symlink(dir.path().join("src/a.rs"), dir.path().join("alias.rs"))
            .unwrap();
        fs::write(dir.path().join("src/a.rs"), "old").unwrap();
        write(dir.path(), "alias.rs", Some("old"), "new").unwrap();
        assert!(fs::symlink_metadata(dir.path().join("alias.rs"))
            .unwrap()
            .is_symlink());
        assert_eq!(fs::read(dir.path().join("src/a.rs")).unwrap(), b"new");
    }

    #[test]
    fn only_valid_utf8_text_is_editable() {
        let dir = project("editable");
        fs::write(dir.path().join("ok.txt"), "xin chào\n").unwrap();
        fs::write(dir.path().join("latin1.txt"), b"caf\xe9\n").unwrap();
        assert!(read(dir.path(), "ok.txt").unwrap().editable);
        let latin1 = read(dir.path(), "latin1.txt").unwrap();
        assert_eq!(latin1.kind, PreviewKind::Text);
        assert!(!latin1.editable);
    }

    #[test]
    fn images_come_back_as_base64_with_their_mime() {
        let dir = project("image");
        fs::write(dir.path().join("shot.PNG"), [0x89, b'P', b'N', b'G', 0, 1]).unwrap();
        let file = read(dir.path(), "shot.PNG").unwrap();
        assert_eq!(file.kind, PreviewKind::Image);
        assert_eq!(file.mime_type, Some("image/png"));
        assert_eq!(file.data.as_deref(), Some("iVBORwAB"));
        assert_eq!(file.text, None);
    }

    #[test]
    fn binary_missing_and_oversized_files_are_kinds_not_errors() {
        let dir = project("kinds");
        fs::write(dir.path().join("app.bin"), b"MZ\0\0data").unwrap();
        assert_eq!(
            read(dir.path(), "app.bin").unwrap().kind,
            PreviewKind::Binary
        );
        let gone = read(dir.path(), "src/gone.rs").unwrap();
        assert_eq!((gone.kind, gone.size), (PreviewKind::Missing, 0));
        let big = vec![b'a'; usize::try_from(MAX_TEXT_BYTES).unwrap() + 1];
        fs::write(dir.path().join("big.txt"), big).unwrap();
        let big = read(dir.path(), "big.txt").unwrap();
        assert_eq!(
            (big.kind, big.size),
            (PreviewKind::TooLarge, MAX_TEXT_BYTES + 1)
        );
        assert_eq!(big.text, None);
    }

    #[test]
    fn the_caps_are_inclusive_and_per_kind() {
        let dir = project("caps");
        let cap = usize::try_from(MAX_TEXT_BYTES).unwrap();
        fs::write(dir.path().join("exact.txt"), vec![b'a'; cap]).unwrap();
        assert_eq!(
            read(dir.path(), "exact.txt").unwrap().kind,
            PreviewKind::Text
        );
        // Over the text cap, under the image cap: still an image.
        fs::write(dir.path().join("big.png"), vec![1u8; cap + 1]).unwrap();
        assert_eq!(
            read(dir.path(), "big.png").unwrap().kind,
            PreviewKind::Image
        );
        let over = usize::try_from(MAX_IMAGE_BYTES).unwrap() + 1;
        fs::write(dir.path().join("huge.png"), vec![1u8; over]).unwrap();
        assert_eq!(
            read(dir.path(), "huge.png").unwrap().kind,
            PreviewKind::TooLarge
        );
    }

    #[test]
    fn kinds_serialise_under_the_names_the_webview_matches() {
        let names: Vec<_> = [
            PreviewKind::Text,
            PreviewKind::Image,
            PreviewKind::Binary,
            PreviewKind::TooLarge,
            PreviewKind::Missing,
            PreviewKind::Outside,
        ]
        .iter()
        .map(|k| serde_json::to_value(k).unwrap())
        .collect();
        assert_eq!(
            names,
            ["Text", "Image", "Binary", "TooLarge", "Missing", "Outside"]
                .map(serde_json::Value::from)
        );
    }

    #[test]
    fn invalid_utf8_text_is_shown_lossily() {
        let dir = project("latin1");
        fs::write(dir.path().join("l1.txt"), b"caf\xe9\n").unwrap();
        assert_eq!(
            read(dir.path(), "l1.txt").unwrap().text.as_deref(),
            Some("caf\u{fffd}\n")
        );
    }

    #[test]
    fn paths_leaving_the_project_are_refused() {
        let dir = project("escape");
        let outside = TempDir::new("project-file", "escape-outside");
        fs::write(outside.path().join("secret.txt"), "s").unwrap();
        assert!(read(dir.path(), "../escape-outside/secret.txt").is_err());
        assert!(read(
            dir.path(),
            outside.path().join("secret.txt").to_str().unwrap()
        )
        .is_err());
        assert!(read(dir.path(), ".git/config").is_err());
        assert!(
            read(dir.path(), "src").is_err(),
            "a directory is not previewable"
        );
    }

    /// A file symlink; `false` where the OS refuses one (Windows without
    /// developer mode or the privilege).
    fn symlink(target: &std::path::Path, link: &std::path::Path) -> bool {
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(target, link);
        #[cfg(windows)]
        let made = std::os::windows::fs::symlink_file(target, link);
        made.is_ok()
    }

    #[test]
    fn a_symlinked_file_pointing_out_of_the_project_is_refused() {
        let dir = project("symlink");
        let outside = TempDir::new("project-file", "symlink-outside");
        fs::write(outside.path().join("secret.txt"), "s").unwrap();
        if !symlink(&outside.path().join("secret.txt"), &dir.path().join("link")) {
            eprintln!("skipped: symlinks not permitted here");
            return;
        }
        assert_eq!(
            read(dir.path(), "link").unwrap().kind,
            PreviewKind::Outside,
            "an escaping symlink must be refused"
        );
        // One that stays inside is followed.
        fs::write(dir.path().join("src/real.txt"), "r").unwrap();
        assert!(symlink(
            &dir.path().join("src/real.txt"),
            &dir.path().join("inside")
        ));
        assert_eq!(
            read(dir.path(), "inside").unwrap().text.as_deref(),
            Some("r")
        );
        // One into `.git` is refused, though the path as written is not
        // `.git/…`.
        fs::create_dir_all(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join(".git/config"), "[remote]").unwrap();
        assert!(symlink(
            &dir.path().join(".git/config"),
            &dir.path().join("gitcfg")
        ));
        let git = read(dir.path(), "gitcfg").unwrap();
        assert_eq!((git.kind, git.text), (PreviewKind::Outside, None));
    }
}
