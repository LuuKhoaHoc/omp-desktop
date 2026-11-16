//! Git worktree management for the repository of a tab's folder: list every
//! worktree, add one for an existing branch, remove one.
//!
//! Distinct from [`crate::worktree`], which creates the app's own isolated
//! session worktrees under the app data directory. Listing reads through
//! gix (`Repository::worktrees`); add and remove shell out to `git`, as
//! [`crate::workspace`] does for index and work-tree mutation.
//!
//! The webview sends a folder, a branch name and a target folder for `add`,
//! and a worktree path for `remove`. A `remove` target is checked against
//! gix's own worktree list before git runs on it, so a request can't name a
//! folder git doesn't already manage.

use crate::workspace::{discover, git_run};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    /// Absolute path of the worktree's work dir.
    pub path: String,
    /// Short branch name; `None` when the worktree is on a detached HEAD.
    pub branch: Option<String>,
    /// Full id of its HEAD; `None` when it is unborn or unreadable.
    pub head: Option<String>,
    /// The repository's primary checkout (the one `.git` lives in).
    pub main: bool,
    /// The folder is locked (`git worktree lock`).
    pub locked: bool,
    /// Changed files in its work tree; `None` when it can't be read.
    pub changed: Option<u32>,
}

/// One worktree as gix reads it: its folder, its HEAD and its lock.
struct Entry {
    path: PathBuf,
    branch: Option<String>,
    head: Option<String>,
    main: bool,
    locked: bool,
}

/// Every worktree of the repository `repo` belongs to, the primary checkout
/// first, read through gix. `repo` may itself be a linked worktree: gix lists
/// only the linked ones from the main repository, so the list is read from
/// there. A linked worktree whose folder has gone (or whose HEAD is unreadable)
/// is listed with no branch and no head, so the user can still remove it.
fn entries(repo: &gix::Repository) -> Result<Vec<Entry>, String> {
    let main = repo
        .main_repo()
        .map_err(|e| format!("could not open the main repository: {e}"))?;
    let main_path = main
        .workdir()
        .map(Path::to_path_buf)
        .ok_or_else(|| "repository has no working tree".to_string())?;
    let mut out = vec![head_of(&main, main_path, true, false)];
    let proxies = main
        .worktrees()
        .map_err(|e| format!("could not list worktrees: {e}"))?;
    for proxy in proxies {
        let path = proxy
            .base()
            .map_err(|e| format!("could not read worktree folder: {e}"))?;
        let locked = proxy.is_locked();
        let entry = match proxy.into_repo_with_possibly_inaccessible_worktree() {
            Ok(linked) => head_of(&linked, path, false, locked),
            Err(_) => Entry {
                path,
                branch: None,
                head: None,
                main: false,
                locked,
            },
        };
        out.push(entry);
    }
    Ok(out)
}

/// The HEAD of one repository (the main one or a linked worktree's).
fn head_of(repo: &gix::Repository, path: PathBuf, main: bool, locked: bool) -> Entry {
    let branch = repo
        .head_name()
        .ok()
        .flatten()
        .map(|name| name.shorten().to_string());
    let head = repo.head_id().ok().map(|id| id.to_string());
    Entry {
        path,
        branch,
        head,
        main,
        locked,
    }
}

/// `git_worktrees_list(path)`: every worktree of the repository `path` is in,
/// the primary checkout first, each with its changed-file count.
pub fn list(path: &Path) -> Result<Vec<Worktree>, String> {
    let (_gate, repo, _work_dir) = discover(path)?;
    let entries = entries(&repo)?;
    Ok(entries
        .into_iter()
        .map(|entry| {
            let changed = crate::git_browser::status(&entry.path)
                .ok()
                .map(|view| view.changed);
            Worktree {
                path: entry.path.to_string_lossy().into_owned(),
                branch: entry.branch,
                head: entry.head,
                main: entry.main,
                locked: entry.locked,
                changed,
            }
        })
        .collect())
}

fn canonical(path: &Path) -> Result<PathBuf, String> {
    path.canonicalize()
        .map_err(|e| format!("could not resolve worktree folder: {e}"))
}

/// Refuse a branch name git would read as an option, or one that is empty.
fn check_branch(name: &str) -> Result<(), String> {
    if name.is_empty() || name.starts_with('-') || name.chars().any(char::is_control) {
        return Err(format!("{name} is not a valid branch name"));
    }
    Ok(())
}

/// `git_worktree_add(path, branch, target)`: check the existing local
/// `branch` out in a new worktree at `target`. Git refuses a branch another
/// worktree already has checked out, changing nothing.
pub fn add(path: &Path, branch: &str, target: &str) -> Result<(), String> {
    check_branch(branch)?;
    let (_gate, repo, work_dir) = discover(path)?;
    let listed = repo
        .references()
        .map_err(|e| format!("could not read branches: {e}"))?
        .local_branches()
        .map_err(|e| format!("could not read branches: {e}"))?
        .flatten()
        .any(|reference| reference.name().shorten() == branch);
    if !listed {
        return Err(format!("{branch} is not a local branch of this repository"));
    }
    let target_path = PathBuf::from(target);
    if !target_path.is_absolute() {
        return Err("worktree folder must be an absolute path".into());
    }
    if target_path.exists() {
        return Err("worktree folder already exists".into());
    }
    let target_text = target_path.to_string_lossy().into_owned();
    git_run(
        &work_dir,
        &["worktree", "add", "--", &target_text, branch],
        "worktree add",
    )?;
    Ok(())
}

/// `git_worktree_remove(path, target, force)`: remove the linked worktree at
/// `target`. The primary checkout is never removed. Without `force`, git
/// refuses a worktree with changes; the caller shows that first.
pub fn remove(path: &Path, target: &str, force: bool) -> Result<(), String> {
    let (_gate, repo, work_dir) = discover(path)?;
    let wanted = canonical(Path::new(target))?;
    let found = entries(&repo)?
        .into_iter()
        .find(|entry| canonical(&entry.path).is_ok_and(|p| p == wanted))
        .ok_or_else(|| "that folder is not a worktree of this repository".to_string())?;
    if found.main {
        return Err("the primary checkout cannot be removed".into());
    }
    let found_text = found.path.to_string_lossy().into_owned();
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push("--");
    args.push(found_text.as_str());
    git_run(&work_dir, &args, "worktree remove")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{check_branch, list};
    use crate::git_browser::fixture;

    #[test]
    fn refuses_option_like_or_empty_branch_names() {
        assert!(check_branch("--force").is_err());
        assert!(check_branch("").is_err());
        assert!(check_branch("feat/ok").is_ok());
    }

    #[test]
    fn lists_the_primary_checkout_first_then_a_linked_worktree() {
        let Some(repo) = fixture::init("worktree-list") else {
            return;
        };
        repo.commit("first", 1_700_000_000);
        repo.git(&["branch", "feat/x"]);
        let temp = crate::test_support::TempDir::new("worktree-manage", "linked");
        let linked = temp.path().join("linked-feat");
        repo.git(&["worktree", "add", linked.to_str().unwrap(), "feat/x"]);

        let entries = list(repo.path()).expect("list worktrees");

        assert_eq!(entries.len(), 2);
        assert!(entries[0].main);
        assert_eq!(entries[0].branch.as_deref(), Some("main"));
        assert!(!entries[1].main);
        assert_eq!(entries[1].branch.as_deref(), Some("feat/x"));
        assert_eq!(entries[1].changed, Some(0));
    }

    #[test]
    fn add_refuses_a_tag_or_unknown_ref() {
        let Some(repo) = fixture::init("worktree-add-refuse") else {
            return;
        };
        repo.commit("first", 1_700_000_000);
        repo.git(&["tag", "v1"]);
        let temp = crate::test_support::TempDir::new("worktree-manage", "tag");
        let target = temp.path().join("tag-wt");
        let err = super::add(repo.path(), "v1", target.to_str().unwrap()).unwrap_err();
        assert!(err.contains("not a local branch"), "{err}");
        assert!(!target.exists());
    }

    #[test]
    fn lists_the_primary_checkout_when_opened_from_a_linked_worktree() {
        let Some(repo) = fixture::init("worktree-from-linked") else {
            return;
        };
        repo.commit("first", 1_700_000_000);
        repo.git(&["branch", "feat/y"]);
        let temp = crate::test_support::TempDir::new("worktree-manage", "from-linked");
        let linked = temp.path().join("linked-y");
        repo.git(&["worktree", "add", linked.to_str().unwrap(), "feat/y"]);

        let entries = list(&linked).expect("list from the linked worktree");

        assert_eq!(entries.len(), 2);
        assert!(entries[0].main);
        assert_eq!(entries[0].branch.as_deref(), Some("main"));
        assert!(!entries[1].main);
        assert_eq!(entries[1].branch.as_deref(), Some("feat/y"));
    }
}
