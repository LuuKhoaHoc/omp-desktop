//! Per-session linked worktrees, created detached (like Codex) under the
//! configured worktree root (`worktree_ops::Settings::root`, default
//! `<app data>/worktrees`). Handoff, branches and cleanup: `worktree_ops`.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::child_path::{child_path_dirs, locate_program};
use crate::child_run::{collect, WaitError};
use crate::supervisor::ProcessSupervisor;

const GIT_TIMEOUT: Duration = Duration::from_secs(30);
const OUTPUT_LIMIT: usize = 16 * 1024;
const ERROR_LIMIT: usize = 16 * 1024;
static NEXT_NONCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedWorktree {
    pub path: String,
    pub source_repo: String,
    /// Always `None` at creation: the worktree starts on a detached HEAD.
    pub branch: Option<String>,
    pub base_commit: String,
    /// Uncommitted changes of the source checkout were carried over (the
    /// selected base was the branch the source checkout is on).
    pub carried: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BaseBranch {
    /// Fully qualified ref used as the selector identity.
    pub reference: String,
    /// Short name shown to users (`main` or `origin/main`).
    pub name: String,
    pub remote: bool,
    pub tip_commit: String,
    /// The branch the source checkout is on (the picker's default).
    pub current: bool,
}

/// List every local and remote-tracking branch with a commit tip.
pub fn list_base_branches(source: &Path) -> Result<Vec<BaseBranch>, String> {
    let source = source
        .canonicalize()
        .map_err(|e| format!("could not resolve project folder: {e}"))?;
    let (_gate, repo, _) = crate::workspace::discover(&source)?;
    list_base_branches_in_repo(&repo)
}

/// The full ref the checkout's HEAD points at (`refs/heads/main`), `None`
/// when detached.
fn head_ref(repo: &gix::Repository) -> Option<String> {
    repo.head_name()
        .ok()
        .flatten()
        .map(|name| name.as_bstr().to_string())
}

fn list_base_branches_in_repo(repo: &gix::Repository) -> Result<Vec<BaseBranch>, String> {
    let references = repo
        .references()
        .map_err(|e| format!("could not read repository refs: {e}"))?;
    let mut branches = Vec::new();
    for reference in references
        .local_branches()
        .map_err(|e| format!("could not read local branches: {e}"))?
        .flatten()
    {
        append_base_branch(&mut branches, reference, "refs/heads/", false);
    }
    for reference in references
        .remote_branches()
        .map_err(|e| format!("could not read remote branches: {e}"))?
        .flatten()
    {
        append_base_branch(&mut branches, reference, "refs/remotes/", true);
    }
    branches.sort_by(|a, b| a.name.cmp(&b.name).then(a.remote.cmp(&b.remote)));
    if let Some(head) = head_ref(repo) {
        for branch in &mut branches {
            branch.current = branch.reference == head;
        }
    }
    Ok(branches)
}

fn append_base_branch(
    branches: &mut Vec<BaseBranch>,
    mut reference: gix::Reference<'_>,
    prefix: &str,
    remote: bool,
) {
    if reference.target().try_name().is_some() {
        return;
    }
    let Ok(commit) = reference.peel_to_commit() else {
        return;
    };
    let name = reference.name().shorten().to_string();
    branches.push(BaseBranch {
        reference: format!("{prefix}{name}"),
        name,
        remote,
        tip_commit: commit.id().to_string(),
        current: false,
    });
}

/// The folder for one repository's worktrees under `root`, made on first
/// use: `<repo name>-<8 hex of the root path's hash>`, readable in a file
/// manager and unique per repository.
fn container_for(root: &Path, repo_root: &Path) -> Result<PathBuf, String> {
    crate::private_fs::private_dirs(true)
        .create(root)
        .map_err(|e| format!("could not create worktree root {}: {e}", root.display()))?;
    let hash = crate::json_store::hex_sha256(repo_root.as_os_str().to_string_lossy().as_bytes());
    let name = repo_root
        .file_name()
        .map(|n| slug(&n.to_string_lossy()))
        .unwrap_or_else(|| "repo".into());
    let container = root.join(format!("{name}-{}", &hash[..8]));
    match std::fs::symlink_metadata(&container) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err("worktree container is not a real directory".into());
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            crate::private_fs::private_dirs(false)
                .create(&container)
                .map_err(|e| format!("could not create worktree directory: {e}"))?;
        }
        Err(error) => return Err(format!("could not inspect worktree directory: {error}")),
    }
    Ok(container)
}

/// How a new worktree's files are laid down.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Checkout {
    /// `git worktree add --detach` (tests; the app always tries the clone).
    #[cfg_attr(not(test), allow(dead_code))]
    Git,
    /// `omp worktree add --detach`: a copy-on-write clone of the source
    /// checkout when the filesystem can reflink, so ignored build output
    /// (`node_modules`, `target`) comes along; omp falls back to a plain
    /// checkout itself. A failing omp falls back to [`Checkout::Git`].
    OmpClone,
}

/// Create a detached worktree for the session under `root`, at the tip of
/// `base_branch`. When that branch is the one the source checkout is on, its
/// uncommitted changes (tracked and untracked) are copied over too; the
/// source checkout itself is never touched.
pub fn create(
    root: &Path,
    source: &Path,
    base_branch: &str,
    label: &str,
    checkout: Checkout,
) -> Result<CreatedWorktree, String> {
    if label.is_empty() || label.len() > 120 || label.chars().any(char::is_control) {
        return Err("invalid worktree label".into());
    }
    let source = source
        .canonicalize()
        .map_err(|e| format!("could not resolve project folder: {e}"))?;
    let (base_commit, repo_root, carry) = {
        let (_gate, repo, root) = crate::workspace::discover(&source)?;
        let branches = list_base_branches_in_repo(&repo)?;
        let selected = if let Some(branch) = branches
            .iter()
            .find(|branch| branch.reference == base_branch)
        {
            branch
        } else {
            let mut matching = branches.iter().filter(|branch| branch.name == base_branch);
            let branch = matching
                .next()
                .ok_or_else(|| "base branch does not exist".to_string())?;
            if matching.next().is_some() {
                return Err("base branch selector is ambiguous".into());
            }
            branch
        };
        let root = root
            .canonicalize()
            .map_err(|e| format!("could not resolve repository root: {e}"))?;
        (selected.tip_commit.clone(), root, selected.current)
    };
    let path = create_at(root, &repo_root, &base_commit, label, checkout)?;
    let carried = if carry {
        match crate::worktree_ops::carry(&source, &path) {
            Ok(c) => c.any(),
            Err(e) => {
                eprintln!(
                    "[omp-desktop] worktree: created, but carrying local changes failed: {e}"
                );
                false
            }
        }
    } else {
        false
    };
    let path = path.to_string_lossy().into_owned();
    let source_repo = repo_root.to_string_lossy().into_owned();
    crate::worktree_ops::register(&path, &source_repo);
    Ok(CreatedWorktree {
        path,
        source_repo,
        branch: None,
        base_commit,
        carried,
    })
}

/// Add a detached worktree of `repo_root` at `commit` in a fresh folder
/// under `root`; returns its path.
pub fn create_at(
    root: &Path,
    repo_root: &Path,
    commit: &str,
    label: &str,
    checkout: Checkout,
) -> Result<PathBuf, String> {
    let container = container_for(root, repo_root)?;
    let slug = slug(label);
    for _ in 0..8 {
        let path = container.join(format!("{slug}-{}", nonce()));
        if path.exists() {
            continue;
        }
        if checkout == Checkout::OmpClone {
            let args: Vec<String> = vec![
                "worktree".into(),
                "add".into(),
                "--detach".into(),
                "--quiet".into(),
                format!("--cwd={}", repo_root.display()),
                path.to_string_lossy().into_owned(),
                commit.to_string(),
            ];
            match crate::omp_cli::run(&args, "omp worktree add") {
                Ok(_) if path.is_dir() => return Ok(path),
                Ok(_) => {
                    eprintln!("[omp-desktop] worktree: omp worktree add left no folder; using git")
                }
                Err(e) => {
                    eprintln!("[omp-desktop] worktree: omp worktree add failed ({e}); using git")
                }
            }
            if path.exists() {
                return Err(format!(
                    "omp worktree add failed and left {} behind",
                    path.display()
                ));
            }
        }
        git_worktree_add(repo_root, &path, commit)?;
        return Ok(path);
    }
    Err("could not allocate a unique worktree path".into())
}

fn git_worktree_add(repo_root: &Path, path: &Path, commit: &str) -> Result<(), String> {
    let program = locate_program(&child_path_dirs(), "git")
        .map_err(|_| "git not found on PATH".to_string())?;
    let mut cmd = Command::new(&program.binary);
    cmd.env("PATH", &program.path)
        .current_dir(repo_root)
        .args([
            "--literal-pathspecs",
            "--no-optional-locks",
            "worktree",
            "add",
            "--detach",
        ])
        .arg(path)
        .arg(commit)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    ProcessSupervisor::prepare(&mut cmd);
    let mut child = crate::spawn_gate::spawn(&mut cmd)
        .map_err(|e| format!("could not start git worktree add: {e}"))?;
    let supervisor = ProcessSupervisor::attach(&child);
    let done = collect(
        &mut child,
        &supervisor,
        OUTPUT_LIMIT,
        ERROR_LIMIT,
        Instant::now() + GIT_TIMEOUT,
        |_| Ok(()),
    )
    .map_err(|e| match e {
        WaitError::Overflow => "git worktree add output exceeded its size limit".to_string(),
        WaitError::TimedOut => "git worktree add timed out".to_string(),
        WaitError::Failed(error) => format!("git worktree add failed: {error}"),
    })?;
    if done.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&done.stderr);
    let message = crate::text::prefix_within(stderr.trim(), 1024);
    // Git can leave administrative state on an interrupted add. Never remove
    // a target here unless its ownership has been proven.
    Err(if message.is_empty() {
        "git worktree add failed".into()
    } else {
        format!("git worktree add failed: {message}")
    })
}

fn slug(label: &str) -> String {
    let mut out = String::with_capacity(label.len().min(48));
    let mut separator = false;
    for byte in label.bytes() {
        if byte.is_ascii_alphanumeric() {
            if separator && !out.is_empty() {
                out.push('-');
            }
            out.push(byte.to_ascii_lowercase() as char);
            separator = false;
            if out.len() == 40 {
                break;
            }
        } else {
            separator = true;
        }
    }
    if out.is_empty() {
        "project".into()
    } else {
        out
    }
}

fn nonce() -> String {
    let time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let counter = NEXT_NONCE.fetch_add(1, Ordering::Relaxed);
    format!("{time:x}{counter:x}")
}

/// A saved worktree tab still points at a linked worktree of its source
/// repository. The branch is not checked: a worktree starts detached and
/// may get a branch later ("Create branch here").
pub fn validate_created(path: &str, source_repo: &str) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !path.is_absolute() || !path.is_dir() {
        return Err("worktree folder is missing".into());
    }
    let source = Path::new(source_repo);
    if !source.is_absolute() || !source.is_dir() {
        return Err("source repository folder is missing".into());
    }
    let (worktree_common_dir, is_linked_worktree) = {
        let (_gate, repo, _) = crate::workspace::discover(&path)?;
        let common_dir = repo
            .common_dir()
            .canonicalize()
            .map_err(|e| format!("could not resolve worktree repository: {e}"))?;
        let git_dir = repo
            .git_dir()
            .canonicalize()
            .map_err(|e| format!("could not resolve worktree Git directory: {e}"))?;
        let is_linked_worktree = git_dir != common_dir;
        (common_dir, is_linked_worktree)
    };
    if !is_linked_worktree {
        return Err("saved worktree path is not a linked worktree".into());
    }
    let source_common_dir = {
        let (_gate, repo, _) = crate::workspace::discover(source)?;
        repo.common_dir()
            .canonicalize()
            .map_err(|e| format!("could not resolve source repository: {e}"))?
    };
    if worktree_common_dir != source_common_dir {
        return Err("worktree does not belong to the saved source repository".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git_browser::fixture;
    use crate::test_support::TempDir;
    use std::path::{Path, PathBuf};
    use std::process::Command as TestCommand;

    fn git(repo: &Path, args: &[&str]) -> String {
        let output = TestCommand::new("git")
            .current_dir(repo)
            .args(args)
            .output()
            .expect("run git fixture command");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_owned()
    }

    fn git_available() -> bool {
        fixture::git_available()
    }

    fn app_data(temp: &TempDir) -> PathBuf {
        let app_data = temp.path().join("app-data");
        std::fs::create_dir(&app_data).expect("create app data");
        app_data
    }

    fn source_repo(temp: &TempDir) -> PathBuf {
        let repo = temp.path().join("source");
        std::fs::create_dir(&repo).expect("create source repo");
        git(&repo, &["init", "-q", "-b", "main"]);
        git(&repo, &["config", "user.email", "test@example.com"]);
        git(&repo, &["config", "user.name", "OMP Test"]);
        std::fs::write(repo.join("tracked.txt"), "committed\n").expect("write tracked file");
        git(&repo, &["add", "tracked.txt"]);
        git(&repo, &["commit", "-qm", "initial"]);
        repo
    }

    #[test]
    fn creates_separate_worktree_from_head_without_touching_source_changes() {
        if !git_available() {
            return;
        }
        let temp = TempDir::new("worktree", "isolation");
        let app_data = app_data(&temp);
        let repo = source_repo(&temp);
        git(&repo, &["checkout", "-q", "-b", "topic"]);
        std::fs::write(repo.join("topic.txt"), "topic base\n").expect("write topic file");
        git(&repo, &["add", "topic.txt"]);
        git(&repo, &["commit", "-qm", "topic commit"]);
        git(&repo, &["checkout", "-q", "main"]);
        std::fs::write(repo.join("tracked.txt"), "uncommitted source change\n")
            .expect("dirty source");
        std::fs::write(repo.join("untracked.txt"), "source only\n").expect("source untracked");
        let source_branch = git(&repo, &["branch", "--show-current"]);
        let source_status = git(&repo, &["status", "--porcelain"]);
        let base_commit = git(&repo, &["rev-parse", "topic"]);

        let created = create(
            &app_data.join("worktrees"),
            &repo,
            "refs/heads/topic",
            "Issue 42",
            Checkout::Git,
        )
        .expect("create linked worktree from topic");

        assert_eq!(created.base_commit, base_commit);
        assert_eq!(
            git(Path::new(&created.path), &["rev-parse", "HEAD"]),
            base_commit
        );
        assert_eq!(created.branch, None);
        assert!(!created.carried, "another branch's tip carries nothing");
        assert_eq!(
            git(Path::new(&created.path), &["branch", "--show-current"]),
            "",
            "worktree starts detached"
        );
        assert_eq!(git(&repo, &["branch", "--show-current"]), source_branch);
        assert_eq!(git(&repo, &["status", "--porcelain"]), source_status);
        assert_eq!(
            std::fs::read_to_string(Path::new(&created.path).join("tracked.txt")).unwrap(),
            "committed\n"
        );
        assert_eq!(
            std::fs::read_to_string(Path::new(&created.path).join("topic.txt")).unwrap(),
            "topic base\n"
        );
        assert!(!Path::new(&created.path).join("untracked.txt").exists());
        validate_created(&created.path, &created.source_repo).expect("validate metadata");
        assert!(
            create(
                &app_data.join("worktrees"),
                &repo,
                "refs/heads/main",
                "Issue 42",
                Checkout::Git
            )
            .is_ok(),
            "every call creates a distinct worktree"
        );
    }

    #[test]
    fn refuses_non_git_folders_without_creating_a_worktree() {
        let temp = TempDir::new("worktree", "not-a-repo");
        let app_data = app_data(&temp);
        let project = temp.path().join("project");
        std::fs::create_dir(&project).expect("create project");
        assert!(create(
            &app_data.join("worktrees"),
            &project,
            "main",
            "Issue 42",
            Checkout::Git
        )
        .is_err());
        assert!(!app_data.join("worktrees").exists());
    }
    #[test]
    fn refuses_invalid_labels() {
        let temp = TempDir::new("worktree", "invalid-label");
        assert_eq!(
            create(
                temp.path(),
                &temp.path().join("not-a-repo"),
                "main",
                "bad\nlabel",
                Checkout::Git,
            )
            .unwrap_err(),
            "invalid worktree label",
        );
    }

    #[test]
    fn lists_current_local_and_remote_branches_with_full_ref_identity() {
        if !git_available() {
            return;
        }
        let temp = TempDir::new("worktree", "base-branches");
        let repo = source_repo(&temp);
        let main_tip = git(&repo, &["rev-parse", "main"]);
        git(&repo, &["branch", "origin/main"]);
        git(
            &repo,
            &["update-ref", "refs/remotes/origin/main", &main_tip],
        );
        git(
            &repo,
            &["update-ref", "refs/remotes/upstream/main", &main_tip],
        );

        let branches = list_base_branches(&repo).expect("list base branches");
        assert!(branches.iter().any(|b| {
            b.reference == "refs/heads/main"
                && b.name == "main"
                && !b.remote
                && b.tip_commit == main_tip
        }));
        assert!(branches.iter().any(|b| {
            b.reference == "refs/remotes/origin/main" && b.name == "origin/main" && b.remote
        }));
        assert!(branches.iter().any(|b| {
            b.reference == "refs/remotes/upstream/main" && b.name == "upstream/main" && b.remote
        }));
    }

    #[test]
    fn rejects_missing_and_ambiguous_short_base_selectors() {
        if !git_available() {
            return;
        }
        let temp = TempDir::new("worktree", "base-selector");
        let app_data = app_data(&temp);
        let repo = source_repo(&temp);
        let tip = git(&repo, &["rev-parse", "main"]);
        git(&repo, &["branch", "origin/main"]);
        git(&repo, &["update-ref", "refs/remotes/origin/main", &tip]);

        let err = create(
            &app_data.join("worktrees"),
            &repo,
            "origin/main",
            "Issue 42",
            Checkout::Git,
        )
        .unwrap_err();
        assert_eq!(err, "base branch selector is ambiguous");
        assert!(create(
            &app_data.join("worktrees"),
            &repo,
            "refs/heads/missing",
            "Issue 42",
            Checkout::Git
        )
        .is_err());
        assert!(!app_data.join("worktrees").exists());
    }
    #[test]
    fn refuses_worktree_metadata_for_a_different_repository() {
        if !git_available() {
            eprintln!("git not available; skipping repository-identity test");
            return;
        }
        let temp = TempDir::new("worktree", "wrong-source");
        let app_data = temp.path().join("app-data");
        std::fs::create_dir(&app_data).expect("create app data");
        let source = source_repo(&temp);
        let other = temp.path().join("other");
        std::fs::create_dir(&other).expect("create other repo");
        git(&other, &["init", "-q"]);
        git(&other, &["config", "user.email", "test@example.com"]);
        git(&other, &["config", "user.name", "OMP Test"]);
        std::fs::write(other.join("other.txt"), "other\n").expect("write other file");
        git(&other, &["add", "other.txt"]);
        git(&other, &["commit", "-qm", "initial"]);
        let created = create(
            &app_data.join("worktrees"),
            &source,
            "refs/heads/main",
            "Issue 42",
            Checkout::Git,
        )
        .expect("create linked worktree");
        assert!(validate_created(&created.path, other.to_str().unwrap()).is_err());
    }

    #[test]
    fn refuses_primary_checkout_with_forged_worktree_metadata() {
        if !git_available() {
            eprintln!("git not available; skipping primary-checkout identity test");
            return;
        }
        let temp = TempDir::new("worktree", "primary-checkout");
        let repo = source_repo(&temp);
        git(&repo, &["branch", "-m", "omp/forged-worktree"]);
        assert!(validate_created(repo.to_str().unwrap(), repo.to_str().unwrap()).is_err());
    }

    #[test]
    fn current_branch_base_carries_uncommitted_work() {
        if !git_available() {
            return;
        }
        let temp = TempDir::new("worktree", "carry");
        let root = temp.path().join("wt-root");
        let repo = source_repo(&temp);
        std::fs::write(repo.join("tracked.txt"), "dirty\n").unwrap();
        std::fs::write(repo.join("new.txt"), "untracked\n").unwrap();
        let branches = list_base_branches(&repo).unwrap();
        assert!(branches
            .iter()
            .any(|b| b.reference == "refs/heads/main" && b.current));
        let created = create(&root, &repo, "refs/heads/main", "chat", Checkout::Git).unwrap();
        assert!(created.carried);
        let wt = Path::new(&created.path);
        assert!(wt.starts_with(&root), "honours the configured root");
        assert_eq!(
            std::fs::read_to_string(wt.join("tracked.txt")).unwrap(),
            "dirty\n"
        );
        assert_eq!(
            std::fs::read_to_string(wt.join("new.txt")).unwrap(),
            "untracked\n"
        );
        assert_eq!(
            std::fs::read_to_string(repo.join("tracked.txt")).unwrap(),
            "dirty\n",
            "source checkout untouched"
        );
    }

    #[test]
    fn slug_is_safe_bounded_and_not_empty() {
        assert_eq!(slug("Fix / Login Reset"), "fix-login-reset");
        assert_eq!(slug("🔥"), "project");
        assert!(slug(&"A".repeat(80)).len() <= 40);
    }
}
