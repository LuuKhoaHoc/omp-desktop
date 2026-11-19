//! Worktree lifecycle after creation (`worktree.rs`), modelled on the Codex
//! app's worktrees:
//!
//! - **Settings** `<app config>/worktrees.json`: `root` (where new worktrees
//!   go, empty = `<app data>/worktrees`), `keep` (managed worktrees kept by
//!   cleanup, 0 = never delete) and `branchPrefix` ("Create branch here").
//! - **Registry** `<app data>/worktree-registry.json`: every worktree the app
//!   created, its source repository, last use and, once cleaned up, the
//!   snapshot commit it can be restored from.
//! - **Handoff**: move a chat's uncommitted work between the local checkout
//!   and its worktree. Changes travel as a `git stash create` commit plus
//!   copies of untracked files; the side they leave is reset only after the
//!   other side has them, and the stash commit is kept under
//!   `refs/omp-desktop/handoff/*` so nothing is lost if a step fails.
//! - **Cleanup**: beyond `keep`, the least recently used worktrees not open
//!   in a tab are snapshotted (`refs/omp-desktop/snapshots/*`, a commit of
//!   the whole work tree on top of HEAD) and removed. Opening a session in a
//!   removed worktree restores it from that snapshot.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock, PoisonError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::child_path::{child_path_dirs, locate_program};
use crate::child_run::{collect, WaitError};
use crate::supervisor::ProcessSupervisor;

const GIT_TIMEOUT: Duration = Duration::from_secs(60);
const OUTPUT_LIMIT: usize = 16 * 1024 * 1024;
const ERROR_LIMIT: usize = 16 * 1024;
pub const DEFAULT_KEEP: u32 = 15;
pub const MAX_KEEP: u32 = 500;
pub const DEFAULT_PREFIX: &str = "omp/";

/// User settings (`worktrees.json`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub root: String,
    pub keep: u32,
    pub branch_prefix: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            root: String::new(),
            keep: DEFAULT_KEEP,
            branch_prefix: DEFAULT_PREFIX.into(),
        }
    }
}

/// One app-managed worktree.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Entry {
    pub path: String,
    pub source_repo: String,
    pub used_ms: u64,
    /// Snapshot commit; set once cleanup removed the folder.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default)]
struct Registry {
    worktrees: Vec<Entry>,
}

struct Paths {
    settings: PathBuf,
    registry: PathBuf,
    default_root: PathBuf,
}

static PATHS: OnceLock<Paths> = OnceLock::new();

/// Called once at startup with the app's config and data folders.
pub fn init(config_dir: &Path, data_dir: &Path) {
    let _ = PATHS.set(Paths {
        settings: config_dir.join("worktrees.json"),
        registry: data_dir.join("worktree-registry.json"),
        default_root: data_dir.join("worktrees"),
    });
}

fn paths() -> Result<&'static Paths, String> {
    PATHS
        .get()
        .ok_or_else(|| "worktree settings are not initialised".into())
}

fn lock_of(path: &Path) -> PathBuf {
    path.with_extension("lock")
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

// ── settings ────────────────────────────────────────────────────────────

pub fn settings() -> Settings {
    paths().map_or_else(
        |_| Settings::default(),
        |p| crate::json_store::read_or_default(&p.settings),
    )
}

/// Expand `~/` and require an absolute path; empty stays empty (default).
fn normalize_root(root: &str) -> Result<String, String> {
    let root = root.trim();
    if root.is_empty() {
        return Ok(String::new());
    }
    let expanded = if let Some(rest) = root.strip_prefix("~/") {
        let home = std::env::var_os("HOME").ok_or("HOME is not set")?;
        PathBuf::from(home).join(rest)
    } else if root == "~" {
        PathBuf::from(std::env::var_os("HOME").ok_or("HOME is not set")?)
    } else {
        PathBuf::from(root)
    };
    if !expanded.is_absolute() {
        return Err("worktree root must be an absolute path (or start with ~/)".into());
    }
    Ok(expanded.to_string_lossy().into_owned())
}

fn valid_prefix(prefix: &str) -> bool {
    prefix.len() <= 40
        && prefix
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.'))
        && !prefix.starts_with('/')
        && !prefix.contains("//")
        && !prefix.contains("..")
}

pub fn set_settings(next: Settings) -> Result<Settings, String> {
    let next = Settings {
        root: normalize_root(&next.root)?,
        keep: next.keep.min(MAX_KEEP),
        branch_prefix: next.branch_prefix.trim().to_string(),
    };
    if !valid_prefix(&next.branch_prefix) {
        return Err("branch prefix may only use letters, digits, / - _ .".into());
    }
    let p = paths()?;
    crate::json_store::update_strict(
        &p.settings,
        &lock_of(&p.settings),
        |s: &mut Settings| {
            let changed = *s != next;
            *s = next.clone();
            changed
        },
        |s| s,
    )
}

/// Where new worktrees go.
pub fn root() -> Result<PathBuf, String> {
    let root = settings().root;
    if root.is_empty() {
        Ok(paths()?.default_root.clone())
    } else {
        Ok(PathBuf::from(root))
    }
}

// ── registry ────────────────────────────────────────────────────────────

/// Serialises this process's registry writes: the file lock
/// (`json_store::with_lock`) fails fast on contention instead of waiting.
static REGISTRY_WRITE: Mutex<()> = Mutex::new(());

fn update_registry<R>(modify: impl FnOnce(&mut Registry) -> (bool, R)) -> Result<R, String> {
    let _serial = REGISTRY_WRITE
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    let p = paths()?;
    let mut out = None;
    crate::json_store::update_strict(
        &p.registry,
        &lock_of(&p.registry),
        |r: &mut Registry| {
            let (changed, value) = modify(r);
            out = Some(value);
            changed
        },
        |_| (),
    )?;
    out.ok_or_else(|| "registry update did not run".into())
}

fn registry() -> Vec<Entry> {
    paths().map_or_else(
        |_| Vec::new(),
        |p| crate::json_store::read_or_default::<Registry>(&p.registry).worktrees,
    )
}

/// Record a worktree the app created. Best effort: a registry failure only
/// costs cleanup and restore for this worktree.
pub fn register(path: &str, source_repo: &str) {
    let entry = Entry {
        path: path.into(),
        source_repo: source_repo.into(),
        used_ms: now_ms(),
        snapshot: None,
    };
    if let Err(e) = update_registry(|r| {
        r.worktrees.retain(|w| w.path != entry.path);
        r.worktrees.push(entry);
        (true, ())
    }) {
        eprintln!("[omp-desktop] worktree registry: {e}");
    }
}

/// Mark a managed worktree as used now (a session started in it).
pub fn touch(path: &str) {
    if !registry().iter().any(|w| w.path == path) {
        return;
    }
    let _ = update_registry(|r| {
        let mut changed = false;
        for w in r.worktrees.iter_mut().filter(|w| w.path == path) {
            w.used_ms = now_ms();
            changed = true;
        }
        (changed, ())
    });
}

/// The managed worktree at `path`, if any.
pub fn entry(path: &str) -> Option<Entry> {
    registry().into_iter().find(|w| w.path == path)
}

/// A removed managed worktree that [`restore`] can bring back.
pub fn is_restorable(path: &str) -> bool {
    entry(path).is_some_and(|w| w.snapshot.is_some() && !Path::new(path).exists())
}

// ── git ─────────────────────────────────────────────────────────────────

struct Out {
    ok: bool,
    stdout: String,
    stderr: String,
}

fn git_raw(dir: &Path, args: &[&str], env: &[(&str, &Path)]) -> Result<Out, String> {
    let program = locate_program(&child_path_dirs(), "git")
        .map_err(|_| "git not found on PATH".to_string())?;
    let mut cmd = Command::new(&program.binary);
    cmd.env("PATH", &program.path)
        .current_dir(dir)
        .args(["-c", "core.hooksPath=/dev/null", "--no-optional-locks"])
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (k, v) in env {
        cmd.env(k, v);
    }
    ProcessSupervisor::prepare(&mut cmd);
    let mut child = crate::spawn_gate::spawn(&mut cmd)
        .map_err(|e| format!("could not start git {}: {e}", args.join(" ")))?;
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
        WaitError::Overflow => format!("git {} output exceeded its size limit", args[0]),
        WaitError::TimedOut => format!("git {} timed out", args[0]),
        WaitError::Failed(error) => format!("git {} failed: {error}", args[0]),
    })?;
    Ok(Out {
        ok: done.status.success(),
        stdout: String::from_utf8_lossy(&done.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&done.stderr).into_owned(),
    })
}

fn git_env(dir: &Path, args: &[&str], env: &[(&str, &Path)]) -> Result<String, String> {
    let out = git_raw(dir, args, env)?;
    if out.ok {
        Ok(out.stdout)
    } else {
        let msg = crate::text::prefix_within(out.stderr.trim(), 1024);
        Err(format!("git {} failed: {msg}", args.join(" ")))
    }
}

fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    git_env(dir, args, &[])
}

fn head_commit(dir: &Path) -> Result<String, String> {
    Ok(git(dir, &["rev-parse", "--verify", "HEAD"])?
        .trim()
        .to_string())
}

/// The checked-out branch's short name; `None` when HEAD is detached.
pub fn head_branch(dir: &Path) -> Result<Option<String>, String> {
    let out = git_raw(dir, &["symbolic-ref", "-q", "--short", "HEAD"], &[])?;
    let name = out.stdout.trim();
    Ok((out.ok && !name.is_empty()).then(|| name.to_string()))
}

fn tracked_dirty(dir: &Path) -> Result<bool, String> {
    Ok(!git(
        dir,
        &["status", "--porcelain=v1", "-z", "--untracked-files=no"],
    )?
    .is_empty())
}

fn untracked(dir: &Path) -> Result<Vec<String>, String> {
    Ok(
        git(dir, &["ls-files", "-z", "--others", "--exclude-standard"])?
            .split('\0')
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect(),
    )
}

fn repo_root(dir: &Path) -> Result<PathBuf, String> {
    let top = git(dir, &["rev-parse", "--show-toplevel"])?;
    PathBuf::from(top.trim())
        .canonicalize()
        .map_err(|e| format!("could not resolve repository root: {e}"))
}

/// Uncommitted work moved by a handoff.
#[derive(Debug, Default)]
pub struct Carried {
    /// `git stash create` commit of the tracked changes, if any.
    pub stash: Option<String>,
    /// Untracked (not ignored) files copied, relative to the work tree.
    pub untracked: Vec<String>,
}

impl Carried {
    pub const fn any(&self) -> bool {
        self.stash.is_some() || !self.untracked.is_empty()
    }
}

fn copy_entry(from: &Path, to: &Path) -> Result<(), String> {
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    let meta = std::fs::symlink_metadata(from).map_err(|e| format!("{}: {e}", from.display()))?;
    #[cfg(unix)]
    if meta.file_type().is_symlink() {
        let target = std::fs::read_link(from).map_err(|e| e.to_string())?;
        return std::os::unix::fs::symlink(target, to)
            .map_err(|e| format!("{}: {e}", to.display()));
    }
    let _ = meta;
    std::fs::copy(from, to)
        .map(|_| ())
        .map_err(|e| format!("{}: {e}", to.display()))
}

/// Copy `from`'s uncommitted work into `to` (both work trees of the same
/// repository, `to` with no conflicting untracked files). `from` is left as
/// it was.
pub fn carry(from: &Path, to: &Path) -> Result<Carried, String> {
    let files = untracked(from)?;
    if let Some(clash) = files.iter().find(|f| to.join(f).exists()) {
        return Err(format!("{clash} already exists in {}", to.display()));
    }
    let stash = Some(git(from, &["stash", "create"])?.trim().to_string()).filter(|s| !s.is_empty());
    if let Some(sha) = &stash {
        git(to, &["stash", "apply", "--quiet", sha])?;
    }
    for f in &files {
        copy_entry(&from.join(f), &to.join(f))?;
    }
    Ok(Carried {
        stash,
        untracked: files,
    })
}

/// Keep a carried stash reachable (`git stash create` commits are not), then
/// reset `dir`'s tracked changes and delete the untracked files that moved.
fn clean_after_move(dir: &Path, carried: &Carried) -> Result<(), String> {
    if let Some(sha) = &carried.stash {
        let name = format!("refs/omp-desktop/handoff/{}", now_ms());
        git(dir, &["update-ref", &name, sha])?;
        git(dir, &["reset", "--hard", "--quiet"])?;
    }
    for f in &carried.untracked {
        let p = dir.join(f);
        let _ = std::fs::remove_file(&p);
        // Drop now-empty parent folders up to the work tree.
        let mut parent = p.parent();
        while let Some(d) = parent {
            if d == dir || std::fs::remove_dir(d).is_err() {
                break;
            }
            parent = d.parent();
        }
    }
    Ok(())
}

// ── branch ──────────────────────────────────────────────────────────────

fn check_branch_name(dir: &Path, name: &str) -> Result<(), String> {
    if name.is_empty() || name.starts_with('-') {
        return Err("invalid branch name".into());
    }
    let out = git_raw(dir, &["check-ref-format", "--branch", name], &[])?;
    if out.ok {
        Ok(())
    } else {
        Err(format!("invalid branch name: {name}"))
    }
}

/// "Create branch here": put the worktree's detached HEAD on a new branch.
pub fn create_branch(path: &Path, name: &str) -> Result<String, String> {
    let name = name.trim();
    check_branch_name(path, name)?;
    git(path, &["switch", "--quiet", "-c", name])?;
    Ok(name.to_string())
}

// ── handoff ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Handoff {
    /// Folder the chat moves to.
    pub path: String,
    /// The source repository (main checkout side).
    pub source_repo: String,
    /// The worktree that belongs to this chat (target or origin).
    pub worktree: String,
    pub branch: Option<String>,
    pub moved_changes: bool,
}

/// Local → Worktree. `local` is the chat's current checkout. `home` is the
/// chat's own worktree from an earlier handoff: reused when it is still a
/// clean linked worktree of the same repository (moved to `local`'s HEAD),
/// otherwise a new detached worktree is made at `local`'s HEAD. `local`'s
/// uncommitted work moves along and `local` ends up clean.
pub fn handoff_to_worktree(
    root: &Path,
    local: &Path,
    home: Option<&str>,
    label: &str,
    checkout: crate::worktree::Checkout,
) -> Result<Handoff, String> {
    let local = local
        .canonicalize()
        .map_err(|e| format!("could not resolve project folder: {e}"))?;
    let source_repo = repo_root(&local)?;
    let source_str = source_repo.to_string_lossy().into_owned();
    let head = head_commit(&local)?;
    let files = untracked(&local)?;

    let reusable = home.filter(|h| {
        crate::worktree::validate_created(h, &source_str).is_ok()
            && Path::new(h) != local
            && tracked_dirty(Path::new(h)) == Ok(false)
    });
    let target = match reusable {
        Some(h) => {
            let h = PathBuf::from(h);
            if let Some(clash) = files.iter().find(|f| h.join(f).exists()) {
                return Err(format!("{clash} already exists in {}", h.display()));
            }
            git(&h, &["switch", "--quiet", "--detach", &head])?;
            h
        }
        None => crate::worktree::create_at(root, &source_repo, &head, label, checkout)?,
    };
    let carried = carry(&local, &target)?;
    clean_after_move(&local, &carried)?;
    let target_str = target.to_string_lossy().into_owned();
    if entry(&target_str).is_some() {
        touch(&target_str);
    } else {
        register(&target_str, &source_str);
    }
    Ok(Handoff {
        path: target_str.clone(),
        source_repo: source_str,
        worktree: target_str,
        branch: None,
        moved_changes: carried.any(),
    })
}

/// Why a Worktree → Local handoff needs input first.
pub const NEEDS_BRANCH: &str = "needs-branch";

/// Worktree → Local. The local checkout (the source repository's main work
/// tree) must have no uncommitted tracked changes. Afterwards it is at the
/// worktree's commit:
/// - worktree on branch `B` (or `branch` given for a detached one): the
///   worktree detaches and the local checkout switches to `B`;
/// - detached at the local HEAD: nothing to switch;
/// - detached ahead of the local branch: the local branch fast-forwards;
/// - otherwise: `Err(NEEDS_BRANCH)`, the UI asks for a branch name.
///
/// The worktree's uncommitted work moves to the local checkout and the
/// worktree is left clean and detached, so a later handoff returns to it.
pub fn handoff_to_local(
    worktree: &Path,
    source_repo: &str,
    branch: Option<&str>,
) -> Result<Handoff, String> {
    let wt_str = worktree.to_string_lossy().into_owned();
    crate::worktree::validate_created(&wt_str, source_repo)?;
    let local = PathBuf::from(source_repo);
    if tracked_dirty(&local)? {
        return Err(
            "the local checkout has uncommitted changes; commit or stash them first".into(),
        );
    }
    let files = untracked(worktree)?;
    if let Some(clash) = files.iter().find(|f| local.join(f).exists()) {
        return Err(format!("{clash} already exists in the local checkout"));
    }
    let wt_head = head_commit(worktree)?;
    let local_head = head_commit(&local)?;
    let local_branch = head_branch(&local)?;
    let mut wt_branch = head_branch(worktree)?;
    if wt_branch.is_none() {
        if let Some(name) = branch.map(str::trim).filter(|b| !b.is_empty()) {
            check_branch_name(worktree, name)?;
            // Stash first: `switch -c` keeps the work tree as it is.
            git(worktree, &["switch", "--quiet", "-c", name])?;
            wt_branch = Some(name.to_string());
        }
    }
    let carried_stash =
        Some(git(worktree, &["stash", "create"])?.trim().to_string()).filter(|s| !s.is_empty());

    let final_branch = match wt_branch {
        Some(b) => {
            git(worktree, &["switch", "--quiet", "--detach"])?;
            if let Err(e) = git(&local, &["switch", "--quiet", &b]) {
                // Put the worktree back on its branch before reporting.
                let _ = git(worktree, &["switch", "--quiet", &b]);
                return Err(e);
            }
            Some(b)
        }
        None if wt_head == local_head => local_branch,
        None => {
            let ancestor = git_raw(
                &local,
                &["merge-base", "--is-ancestor", &local_head, &wt_head],
                &[],
            )?
            .ok;
            match (ancestor, &local_branch) {
                (true, Some(_)) => {
                    git(&local, &["merge", "--quiet", "--ff-only", &wt_head])?;
                    local_branch
                }
                _ => return Err(NEEDS_BRANCH.into()),
            }
        }
    };
    if let Some(sha) = &carried_stash {
        git(&local, &["stash", "apply", "--quiet", sha])?;
    }
    for f in &files {
        copy_entry(&worktree.join(f), &local.join(f))?;
    }
    let carried = Carried {
        stash: carried_stash,
        untracked: files,
    };
    clean_after_move(worktree, &carried)?;
    touch(&wt_str);
    Ok(Handoff {
        path: source_repo.to_string(),
        source_repo: source_repo.to_string(),
        worktree: wt_str,
        branch: final_branch,
        moved_changes: carried.any(),
    })
}

// ── cleanup & restore ───────────────────────────────────────────────────

/// Commit the whole work tree (tracked + untracked, not ignored) on top of
/// HEAD without touching the real index, and pin it under
/// `refs/omp-desktop/snapshots/<folder name>`.
fn snapshot(path: &Path) -> Result<String, String> {
    let index = git(
        path,
        &["rev-parse", "--git-path", "omp-desktop-snapshot.index"],
    )?;
    let index = path.join(index.trim());
    let _ = std::fs::remove_file(&index);
    let env = [("GIT_INDEX_FILE", index.as_path())];
    let result = (|| {
        git_env(path, &["read-tree", "HEAD"], &env)?;
        git_env(path, &["add", "-A"], &env)?;
        let tree = git_env(path, &["write-tree"], &env)?;
        let commit = git_env(
            path,
            &[
                "-c",
                "user.name=omp-desktop",
                "-c",
                "user.email=omp-desktop@localhost",
                "commit-tree",
                tree.trim(),
                "-p",
                "HEAD",
                "-m",
                "omp-desktop worktree snapshot",
            ],
            &env,
        )?;
        let commit = commit.trim().to_string();
        let name = path
            .file_name()
            .map_or_else(|| "worktree".into(), |n| n.to_string_lossy().into_owned());
        git(
            path,
            &[
                "update-ref",
                &format!("refs/omp-desktop/snapshots/{name}"),
                &commit,
            ],
        )?;
        Ok(commit)
    })();
    let _ = std::fs::remove_file(&index);
    result
}

/// Snapshot and remove managed worktrees beyond `keep` (by last use),
/// sparing `protect` (folders open in a tab). Returns the removed paths.
pub fn prune(protect: &[String]) -> Result<Vec<String>, String> {
    let keep = settings().keep as usize;
    if keep == 0 {
        return Ok(Vec::new());
    }
    let mut live: Vec<Entry> = registry()
        .into_iter()
        .filter(|w| w.snapshot.is_none())
        .collect();
    live.sort_by_key(|w| std::cmp::Reverse(w.used_ms));
    let mut removed = Vec::new();
    let mut gone = Vec::new();
    let mut snapshots = Vec::new();
    for w in live.into_iter().skip(keep) {
        if protect.iter().any(|p| p == &w.path) {
            continue;
        }
        let path = Path::new(&w.path);
        if !path.is_dir() {
            gone.push(w.path.clone());
            continue;
        }
        let source = Path::new(&w.source_repo);
        if !source.is_dir() {
            continue;
        }
        let commit = match snapshot(path) {
            Ok(c) => c,
            Err(e) => {
                eprintln!(
                    "[omp-desktop] worktree cleanup: snapshot of {} failed: {e}",
                    w.path
                );
                continue;
            }
        };
        if let Err(e) = git(source, &["worktree", "remove", "--force", &w.path]) {
            eprintln!("[omp-desktop] worktree cleanup: {e}");
            continue;
        }
        snapshots.push((w.path.clone(), commit));
        removed.push(w.path);
    }
    if !gone.is_empty() || !snapshots.is_empty() {
        update_registry(|r| {
            r.worktrees.retain(|w| !gone.contains(&w.path));
            for (path, commit) in &snapshots {
                for w in r.worktrees.iter_mut().filter(|w| &w.path == path) {
                    w.snapshot = Some(commit.clone());
                }
            }
            (true, ())
        })?;
    }
    Ok(removed)
}

/// Bring back a worktree removed by [`prune`]: a detached worktree at the
/// snapshot's parent with the snapshot's files as uncommitted changes.
pub fn restore(path: &str) -> Result<(), String> {
    let w = entry(path).ok_or("not an app-managed worktree")?;
    let commit = w.snapshot.clone().ok_or("this worktree has no snapshot")?;
    if Path::new(path).exists() {
        return Err(format!("{path} already exists"));
    }
    let source = Path::new(&w.source_repo);
    git(source, &["worktree", "prune"])?;
    if let Some(parent) = Path::new(path).parent() {
        crate::private_fs::private_dirs(true)
            .create(parent)
            .map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    git(
        source,
        &["worktree", "add", "--quiet", "--detach", path, &commit],
    )?;
    git(Path::new(path), &["reset", "--quiet", "HEAD~1"])?;
    update_registry(|r| {
        for e in r.worktrees.iter_mut().filter(|e| e.path == path) {
            e.snapshot = None;
            e.used_ms = now_ms();
        }
        (true, ())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git_browser::fixture;
    use crate::test_support::TempDir;

    fn sh(repo: &Path, args: &[&str]) -> String {
        let out = std::process::Command::new("git")
            .current_dir(repo)
            .args(args)
            .output()
            .expect("run git");
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).trim().to_owned()
    }

    fn repo(temp: &TempDir) -> PathBuf {
        let repo = temp.path().join("source");
        std::fs::create_dir(&repo).unwrap();
        sh(&repo, &["init", "-q", "-b", "main"]);
        sh(&repo, &["config", "user.email", "t@e"]);
        sh(&repo, &["config", "user.name", "t"]);
        std::fs::write(repo.join("tracked.txt"), "committed\n").unwrap();
        sh(&repo, &["add", "."]);
        sh(&repo, &["commit", "-qm", "init"]);
        repo.canonicalize().unwrap()
    }

    /// PATHS is process-global, so every test shares one settings/registry
    /// folder that outlives each test's `TempDir` (tests only rely on entries
    /// they register themselves); worktrees go under the test's own root.
    fn setup(temp: &TempDir) -> PathBuf {
        static SHARED: OnceLock<PathBuf> = OnceLock::new();
        let shared = SHARED.get_or_init(|| {
            let dir =
                std::env::temp_dir().join(format!("omp-desktop-wt-ops-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            dir
        });
        init(shared, shared);
        temp.path().join("wt-root")
    }

    fn read(p: &Path) -> String {
        std::fs::read_to_string(p).unwrap()
    }

    #[test]
    fn handoff_round_trip_moves_uncommitted_work_both_ways() {
        if !fixture::git_available() {
            return;
        }
        let temp = TempDir::new("worktree-ops", "handoff");
        let root = setup(&temp);
        let local = repo(&temp);
        std::fs::write(local.join("tracked.txt"), "local edit\n").unwrap();
        std::fs::create_dir(local.join("new")).unwrap();
        std::fs::write(local.join("new/u.txt"), "untracked\n").unwrap();

        let to_wt =
            handoff_to_worktree(&root, &local, None, "chat", crate::worktree::Checkout::Git)
                .expect("local → worktree");
        let wt = PathBuf::from(&to_wt.path);
        assert!(to_wt.moved_changes);
        assert_eq!(read(&wt.join("tracked.txt")), "local edit\n");
        assert_eq!(read(&wt.join("new/u.txt")), "untracked\n");
        assert_eq!(sh(&local, &["status", "--porcelain"]), "", "local is clean");
        assert!(!local.join("new").exists());
        assert_eq!(head_branch(&wt).unwrap(), None, "worktree is detached");
        assert_ne!(
            sh(&local, &["for-each-ref", "refs/omp-desktop/handoff"]),
            ""
        );

        // The agent commits in the worktree, then the chat comes back local.
        sh(&wt, &["add", "-A"]);
        sh(
            &wt,
            &[
                "-c",
                "user.email=t@e",
                "-c",
                "user.name=t",
                "commit",
                "-qm",
                "work",
            ],
        );
        std::fs::write(wt.join("tracked.txt"), "after commit\n").unwrap();
        let src = local.to_string_lossy().into_owned();
        let back = handoff_to_local(&wt, &src, None).expect("ff to local");
        assert_eq!(back.branch.as_deref(), Some("main"));
        assert_eq!(
            sh(&local, &["rev-parse", "HEAD"]),
            sh(&wt, &["rev-parse", "HEAD"])
        );
        assert_eq!(read(&local.join("tracked.txt")), "after commit\n");
        assert_eq!(sh(&wt, &["status", "--porcelain"]), "", "worktree is clean");

        // Handing off again reuses the same worktree.
        std::fs::write(local.join("tracked.txt"), "round two\n").unwrap();
        let again = handoff_to_worktree(
            &root,
            &local,
            Some(&to_wt.path),
            "chat",
            crate::worktree::Checkout::Git,
        )
        .expect("reuse home");
        assert_eq!(again.path, to_wt.path);
        assert_eq!(read(&wt.join("tracked.txt")), "round two\n");
    }

    #[test]
    fn diverged_detached_worktree_needs_a_branch_then_checks_it_out_locally() {
        if !fixture::git_available() {
            return;
        }
        let temp = TempDir::new("worktree-ops", "branch");
        let root = setup(&temp);
        let local = repo(&temp);
        let src = local.to_string_lossy().into_owned();
        let wt = handoff_to_worktree(&root, &local, None, "chat", crate::worktree::Checkout::Git)
            .unwrap();
        let wt = PathBuf::from(wt.path);
        std::fs::write(wt.join("a.txt"), "wt\n").unwrap();
        sh(&wt, &["add", "-A"]);
        sh(
            &wt,
            &[
                "-c",
                "user.email=t@e",
                "-c",
                "user.name=t",
                "commit",
                "-qm",
                "wt",
            ],
        );
        std::fs::write(local.join("b.txt"), "local\n").unwrap();
        sh(&local, &["add", "-A"]);
        sh(&local, &["commit", "-qm", "local"]);

        assert_eq!(handoff_to_local(&wt, &src, None).unwrap_err(), NEEDS_BRANCH);
        // Dirty local refuses.
        std::fs::write(local.join("b.txt"), "dirty\n").unwrap();
        assert!(handoff_to_local(&wt, &src, Some("feat/x")).is_err());
        sh(&local, &["checkout", "--", "b.txt"]);

        let back = handoff_to_local(&wt, &src, Some("feat/x")).expect("branch handoff");
        assert_eq!(back.branch.as_deref(), Some("feat/x"));
        assert_eq!(head_branch(&local).unwrap().as_deref(), Some("feat/x"));
        assert_eq!(head_branch(&wt).unwrap(), None);
    }

    #[test]
    fn create_branch_here_names_the_detached_head() {
        if !fixture::git_available() {
            return;
        }
        let temp = TempDir::new("worktree-ops", "create-branch");
        let root = setup(&temp);
        let local = repo(&temp);
        let wt = handoff_to_worktree(&root, &local, None, "chat", crate::worktree::Checkout::Git)
            .unwrap();
        let wt = PathBuf::from(wt.path);
        assert!(create_branch(&wt, "bad name").is_err());
        assert_eq!(create_branch(&wt, "omp/fix-1").unwrap(), "omp/fix-1");
        assert_eq!(head_branch(&wt).unwrap().as_deref(), Some("omp/fix-1"));
    }

    #[test]
    fn snapshot_restores_uncommitted_and_untracked_files() {
        if !fixture::git_available() {
            return;
        }
        let temp = TempDir::new("worktree-ops", "snapshot");
        let root = setup(&temp);
        let local = repo(&temp);
        let wt = handoff_to_worktree(&root, &local, None, "chat", crate::worktree::Checkout::Git)
            .unwrap();
        let path = wt.path;
        let wt = PathBuf::from(&path);
        std::fs::write(wt.join("tracked.txt"), "wip\n").unwrap();
        std::fs::write(wt.join("note.md"), "untracked wip\n").unwrap();
        let head = sh(&wt, &["rev-parse", "HEAD"]);

        let commit = snapshot(&wt).expect("snapshot");
        sh(&local, &["worktree", "remove", "--force", &path]);
        update_registry(|r| {
            for e in r.worktrees.iter_mut().filter(|e| e.path == path) {
                e.snapshot = Some(commit.clone());
            }
            (true, ())
        })
        .unwrap();
        assert!(is_restorable(&path));

        restore(&path).expect("restore");
        assert_eq!(sh(&wt, &["rev-parse", "HEAD"]), head);
        assert_eq!(read(&wt.join("tracked.txt")), "wip\n");
        assert_eq!(read(&wt.join("note.md")), "untracked wip\n");
        assert!(!is_restorable(&path));
    }

    #[test]
    fn settings_validate_root_and_prefix() {
        assert!(normalize_root("relative/dir").is_err());
        assert_eq!(normalize_root("").unwrap(), "");
        assert!(normalize_root("~/wt").unwrap().ends_with("/wt"));
        assert!(valid_prefix("omp/"));
        assert!(valid_prefix(""));
        assert!(!valid_prefix("a b"));
        assert!(!valid_prefix("../x"));
    }
}
