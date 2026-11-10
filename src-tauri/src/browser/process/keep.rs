//! Cookies and local storage carried from one tab's throwaway profile to
//! the next (fork): a tab's browser copies them out of its profile when the
//! tab closes ([`save`]) and the next launch starts with them ([`seed`]).
//! The store is `<root>/storage`, beside the per-process instance
//! directories (pruning only touches pid-named ones). Last close wins: two
//! tabs browsing at once keep the state of the one closed last.
//!
//! The copied files are what Chromium encrypts its cookies with as well as
//! the cookies: `Local State` holds the key on Windows; Linux and macOS use
//! a fixed key under `--password-store=basic` / `--use-mock-keychain`.

use std::io;
use std::path::Path;
use std::sync::Mutex;

use crate::private_fs::private_dirs;

/// Profile-relative files and folders kept, in a profile's layout. The
/// cookie database sits in `Default/` for headless Chromium on Linux
/// (measured) and in `Default/Network/` where the network service runs out
/// of process: both are kept.
const KEPT: [&str; 6] = [
    "Local State",
    "Default/Cookies",
    "Default/Cookies-journal",
    "Default/Network/Cookies",
    "Default/Network/Cookies-journal",
    "Default/Local Storage",
];

/// One copy at a time: a seed never reads a half-written store.
static STORE: Mutex<()> = Mutex::new(());

/// Copy the store into a profile that Chromium has not started in yet.
/// Best effort: a missing or broken store means a fresh profile.
pub fn seed(store: &Path, profile: &Path) {
    let _guard = STORE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if store.is_dir() {
        if let Err(e) = copy_kept(store, profile) {
            eprintln!("[omp-desktop] browser: cookies not restored: {e}");
        }
    }
}

/// Replace the store with what an exited browser's profile holds. The new
/// store is written beside it and swapped in, so a failed copy keeps the
/// old one.
pub fn save(profile: &Path, store: &Path) {
    let _guard = STORE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let next = store.with_extension("next");
    let _ = std::fs::remove_dir_all(&next);
    let swapped = copy_kept(profile, &next).and_then(|()| {
        let _ = std::fs::remove_dir_all(store);
        std::fs::rename(&next, store)
    });
    if let Err(e) = swapped {
        let _ = std::fs::remove_dir_all(&next);
        eprintln!("[omp-desktop] browser: cookies not saved: {e}");
    }
}

fn copy_kept(from: &Path, to: &Path) -> io::Result<()> {
    private_dirs(true).create(to)?;
    for rel in KEPT {
        let src = from.join(rel);
        if src.exists() {
            copy_tree(&src, &to.join(rel))?;
        }
    }
    Ok(())
}

/// Copy a file, or a folder recursively; symlinks are skipped (a profile
/// has none of its own).
fn copy_tree(src: &Path, dst: &Path) -> io::Result<()> {
    let meta = std::fs::symlink_metadata(src)?;
    if let Some(parent) = dst.parent() {
        private_dirs(true).create(parent)?;
    }
    if meta.is_dir() {
        private_dirs(true).create(dst)?;
        for entry in std::fs::read_dir(src)? {
            let entry = entry?;
            copy_tree(&entry.path(), &dst.join(entry.file_name()))?;
        }
    } else if meta.is_file() {
        std::fs::copy(src, dst)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    #[test]
    fn save_then_seed_carries_cookies_and_local_storage_only() {
        let tmp = TempDir::new("keep", "carry");
        let (old, store, new) = (
            tmp.path().join("old"),
            tmp.path().join("storage"),
            tmp.path().join("new"),
        );
        write(&old.join("Local State"), "key");
        write(&old.join("Default/Network/Cookies"), "c1");
        write(&old.join("Default/Local Storage/leveldb/000003.log"), "ls");
        write(&old.join("Default/History"), "not kept");

        save(&old, &store);
        seed(&store, &new);

        let read = |rel: &str| std::fs::read_to_string(new.join(rel)).ok();
        assert_eq!(read("Local State").as_deref(), Some("key"));
        assert_eq!(read("Default/Network/Cookies").as_deref(), Some("c1"));
        assert_eq!(
            read("Default/Local Storage/leveldb/000003.log").as_deref(),
            Some("ls")
        );
        assert_eq!(read("Default/History"), None);
    }

    #[test]
    fn the_last_save_replaces_the_store_and_a_missing_store_seeds_nothing() {
        let tmp = TempDir::new("keep", "replace");
        let (a, b, store, fresh) = (
            tmp.path().join("a"),
            tmp.path().join("b"),
            tmp.path().join("storage"),
            tmp.path().join("fresh"),
        );
        seed(&store, &fresh);
        assert!(!fresh.exists(), "no store: the profile is left to Chromium");

        write(&a.join("Default/Network/Cookies"), "a");
        write(&a.join("Default/Local Storage/x"), "a");
        write(&b.join("Default/Network/Cookies"), "b");
        save(&a, &store);
        save(&b, &store);
        assert_eq!(
            std::fs::read_to_string(store.join("Default/Network/Cookies")).unwrap(),
            "b"
        );
        assert!(
            !store.join("Default/Local Storage").exists(),
            "b had no local storage"
        );
        assert!(!store.with_extension("next").exists());
    }
}
