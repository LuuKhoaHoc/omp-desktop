//! Per-session linked worktrees created under the application's private data directory.

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
    pub branch: String,
    pub base_commit: String,
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
}

/// List every local and remote-tracking branch with a commit tip.
pub fn list_base_branches(source: &Path) -> Result<Vec<BaseBranch>, String> {
    let source = source
        .canonicalize()
        .map_err(|e| format!("could not resolve project folder: {e}"))?;
    let (_gate, repo, _) = crate::workspace::discover(&source)?;
    list_base_branches_in_repo(&repo)
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
    });
}

/// The app's private folder for one repository's worktrees, made on first use.
fn container_for(app_data: &Path, repo_key: &str) -> Result<PathBuf, String> {
    let worktrees_root = app_data.join("worktrees");
    std::fs::create_dir_all(&worktrees_root)
        .map_err(|e| format!("could not create app worktree directory: {e}"))?;
    let container = worktrees_root.join(repo_key);
    match std::fs::symlink_metadata(&container) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err("app worktree path is not a real directory".into());
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            crate::private_fs::private_dirs(false)
                .create(&container)
                .map_err(|e| format!("could not create private worktree directory: {e}"))?;
        }
        Err(error) => return Err(format!("could not inspect app worktree directory: {error}")),
    }
    Ok(container)
}

/// Create a new unique branch/worktree without copying the source worktree's uncommitted changes.
pub fn create(
    app_data: &Path,
    source: &Path,
    base_branch: &str,
    label: &str,
) -> Result<CreatedWorktree, String> {
    if label.is_empty() || label.len() > 120 || label.chars().any(char::is_control) {
        return Err("invalid worktree label".into());
    }
    let source = source
        .canonicalize()
        .map_err(|e| format!("could not resolve project folder: {e}"))?;
    let (base_commit, root) = {
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
        let base_commit = selected.tip_commit.clone();
        let root = root
            .canonicalize()
            .map_err(|e| format!("could not resolve repository root: {e}"))?;
        (base_commit, root)
    };
    let repo_key = crate::json_store::hex_sha256(root.as_os_str().to_string_lossy().as_bytes());
    let container = container_for(app_data, &repo_key)?;

    let slug = slug(label);
    let program = locate_program(&child_path_dirs(), "git")
        .map_err(|_| "git not found on PATH".to_string())?;
    for _ in 0..8 {
        let nonce = nonce();
        let branch = format!("omp/{slug}-{nonce}");
        let path = container.join(format!("{slug}-{nonce}"));
        if path.exists() {
            continue;
        }
        let mut cmd = Command::new(&program.binary);
        cmd.env("PATH", &program.path)
            .current_dir(&root)
            .args([
                "--literal-pathspecs",
                "--no-optional-locks",
                "worktree",
                "add",
                "-b",
            ])
            .arg(&branch)
            .arg(&path)
            .arg(&base_commit)
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
            return Ok(CreatedWorktree {
                path: path.to_string_lossy().into_owned(),
                source_repo: root.to_string_lossy().into_owned(),
                branch,
                base_commit,
            });
        }
        let stderr = String::from_utf8_lossy(&done.stderr);
        let message = crate::text::prefix_within(stderr.trim(), 1024);
        // Git can leave administrative state on an interrupted add. Never remove
        // a target or branch here unless its ownership has been proven.
        return Err(if message.is_empty() {
            "git worktree add failed".into()
        } else {
            format!("git worktree add failed: {message}")
        });
    }
    Err("could not allocate a unique worktree path".into())
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

pub fn validate_created(path: &str, source_repo: &str, branch: &str) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !path.is_absolute() || !path.is_dir() {
        return Err("worktree folder is missing".into());
    }
    let source = Path::new(source_repo);
    if !source.is_absolute() || !source.is_dir() {
        return Err("source repository folder is missing".into());
    }
    if !branch.starts_with("omp/") || branch.len() > 200 {
        return Err("invalid isolated worktree branch metadata".into());
    }
    let (found_branch, worktree_common_dir, is_linked_worktree) = {
        let (_gate, repo, _) = crate::workspace::discover(&path)?;
        let found_branch = repo
            .head_name()
            .map_err(|e| format!("could not read worktree branch: {e}"))?
            .map(|name| name.shorten().to_string());
        let common_dir = repo
            .common_dir()
            .canonicalize()
            .map_err(|e| format!("could not resolve worktree repository: {e}"))?;
        let git_dir = repo
            .git_dir()
            .canonicalize()
            .map_err(|e| format!("could not resolve worktree Git directory: {e}"))?;
        let is_linked_worktree = git_dir != common_dir;
        (found_branch, common_dir, is_linked_worktree)
    };
    if !is_linked_worktree {
        return Err("saved worktree path is not a linked worktree".into());
    }
    if found_branch.as_deref() != Some(branch) {
        return Err("worktree branch does not match saved session metadata".into());
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

        let created = create(&app_data, &repo, "refs/heads/topic", "Issue 42")
            .expect("create linked worktree from topic");

        assert_eq!(created.base_commit, base_commit);
        assert_eq!(
            git(Path::new(&created.path), &["rev-parse", "HEAD"]),
            base_commit
        );
        assert_eq!(
            git(Path::new(&created.path), &["branch", "--show-current"]),
            created.branch
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
        validate_created(&created.path, &created.source_repo, &created.branch)
            .expect("validate metadata");
        assert!(
            create(&app_data, &repo, "refs/heads/main", "Issue 42").is_ok(),
            "every call creates a distinct worktree"
        );
    }

    #[test]
    fn refuses_non_git_folders_without_creating_a_worktree() {
        let temp = TempDir::new("worktree", "not-a-repo");
        let app_data = app_data(&temp);
        let project = temp.path().join("project");
        std::fs::create_dir(&project).expect("create project");
        assert!(create(&app_data, &project, "main", "Issue 42").is_err());
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
                "bad\nlabel"
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

        let err = create(&app_data, &repo, "origin/main", "Issue 42").unwrap_err();
        assert_eq!(err, "base branch selector is ambiguous");
        assert!(create(&app_data, &repo, "refs/heads/missing", "Issue 42").is_err());
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
        let created = create(&app_data, &source, "refs/heads/main", "Issue 42")
            .expect("create linked worktree");
        assert!(validate_created(&created.path, other.to_str().unwrap(), &created.branch).is_err());
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
        assert!(validate_created(
            repo.to_str().unwrap(),
            repo.to_str().unwrap(),
            "omp/forged-worktree",
        )
        .is_err());
    }

    #[test]
    fn slug_is_safe_bounded_and_not_empty() {
        assert_eq!(slug("Fix / Login Reset"), "fix-login-reset");
        assert_eq!(slug("🔥"), "project");
        assert!(slug(&"A".repeat(80)).len() <= 40);
    }
}
