---
title: 'feat: Per-session Git worktrees'
type: feat
status: active
date: 2026-11-15
---

# feat: Per-session Git worktrees

## Summary

Add an explicit, opt-in way to open a project as an isolated Git worktree for a new chat session. Today each tab has a separate omp process but opening the same project reuses the same filesystem and branch, so parallel sessions can modify the same checkout (including `develop`). A worktree gives each new isolated session its own checkout and generated branch. Persist the worktree path and branch association so restored tabs reopen in the same workspace. Closing the tab keeps the worktree and branch; no working files or branch are deleted automatically.

## Requirements

- R1. Opening a project offers normal open and explicit "Open in isolated worktree" actions; normal open remains the default and keeps current behavior.
- R2. Isolated worktree creation is available only for a valid Git working repository with a commit/HEAD. Report clear errors without creating a ghost tab or leaving partial directories/branches.
- R3. Create a unique local branch and linked worktree from the source repository's current `HEAD` commit. Never checkout or modify the source worktree's branch, index, or uncommitted files. If branch/path creation fails, do not silently fall back to the source checkout.
- R3a. Each isolated session gets a newly created, distinct worktree; the feature does not offer attaching an existing worktree to another session, preventing two tabs from silently sharing one working directory.
- R4. Show the isolation state and branch in the session UI so users can distinguish the worktree tab from the original checkout. Preserve existing Git Browser, branch picker, terminal cwd, browser, widgets, approval-mode, and agent cwd contracts by making the worktree directory the tab's project path.
- R5. Persist the worktree directory directly as the tab's `OpenTab.path`, plus optional source-repo/branch metadata for display. Restart restore opens that same path and never creates another worktree. Older layouts without metadata keep restoring unchanged.
- R6. Closing a tab, changing profile, or restarting omp does not remove a worktree or branch. No automatic cleanup, branch deletion, reset, merge, or checkout of the original worktree.
- R7. Run Git only through the trusted absolute executable/PATH and `spawn_gate::spawn`; attach the process tree to `ProcessSupervisor` and use `child_run::collect` with a fixed deadline and stdout/stderr caps. The webview sends only a source project path and display label, never Git arguments or a destination path.
- R8. Add deterministic tests for branch naming/collision, path validation, create failure rollback, persistence/restore compatibility, and worktree isolation. Document recovery/retention behavior and add an Unreleased changelog entry.

## Scope Boundaries

- No automatic conversion of already-open tabs into worktrees; the action applies when creating a new project session.
- No automatic worktree or branch deletion, even after tab close; explicit worktree management UI and cleanup are a later feature.
- No merge, cherry-pick, rebase, push, PR creation, or worktree synchronization workflow.
- No change to normal project opening, existing tab folder ownership, Git Browser semantics, branch switching semantics, profile behavior, or omp version floor.
- No commit, push, app installation, or unrelated Git workflow redesign in this implementation.

## Context & Research

### Relevant Code and Patterns

- `src/app-live.jsx` (`handleNewProject`, `handleNewInProject`, `handleOpenRecent`): project/session launch actions and the natural opt-in UI entry point.
- `src/design/project-sidebar.jsx`: existing project sidebar open-folder control and per-project actions.
- `src/live.js` (`_startProjectSession`, `_spawnSession`, `openSession`, `openProject`, `resumeSession`): per-tab registry and `start_session` path; failed spawns roll back through `_closeTab`.
- `src-tauri/src/lib.rs` (`StartSessionArgs`, `start_session`, `open_tabs_load/save`, `close_tab`): native IPC boundary, process launch and persisted tab layout commands.
- `src-tauri/src/open_tabs.rs`: backward-compatible `OpenTab` persistence/restore contract; add optional serde-defaulted worktree metadata.
- `src-tauri/src/workspace.rs`: trusted Git executable discovery, spawn gate, path canonicalization and repo-safe mutation patterns. Existing mutation APIs are stage/discard/branch-switch; worktree creation needs its own typed API or module rather than frontend Git arguments.
- `src-tauri/src/git.rs`, `src-tauri/src/git_browser/`: repo discovery and worktree-root semantics; Git Browser already resolves from the tab's project path.
- `docs/architecture/session-model.md`, `reopening-tabs.md`, `git-browser.md`, `project-navigation.md`: tab lifecycle, restore and visible Git behavior contracts.
- `tests/test-project-nav.mjs`, `src-tauri/src/open_tabs.rs` tests, `src-tauri/src/workspace.rs` tests, `CHANGELOG.md`: existing regression and user-facing change conventions.

### Research

- Official Git worktree docs describe linked worktrees as separate checkouts sharing repository objects while keeping per-worktree state such as `HEAD` and index separate; `git worktree add -b <branch> <path> <commit-ish>` creates a new branch at an explicit commit. A linked worktree can be explicitly removed, but this feature intentionally retains it.
- Source: [Git worktree documentation](https://git-scm.com/docs/git-worktree), latest version shown as 2.56.1 (updated 2026-11-15 lookup).
- Project memory search returned no prior worktree design. CodeGraph reports this checkout is not indexed; source and architecture docs were inspected directly.
- The optional `ck-project-organization` skill requested by research guidance is not installed in this environment; plan uses the repo's existing `docs/plans/` location.

### Institutional Learnings

- One tab owns its project path and one omp process; process respawns preserve the tab path, while only `close_tab` ends a tab's related browser, widgets and terminal.
- Startup restore currently serializes folder/profile/conversation and validates folders before launching; optional metadata must preserve legacy layouts.
- Git operations that mutate a worktree run through the absolute trusted `git` executable and `spawn_gate`; Git Browser reads remain gix-based.
- Repo rule: resolve/canonicalize paths natively, validate all IPC inputs, and do not send Git arguments from the webview.

## Key Technical Decisions

- **Explicit opt-in per new session:** keep normal project opening unchanged; expose an isolated-open action next to the existing project-open flow. Do not add a global default that can surprise existing workflows.
- **Create from current HEAD, not working-copy changes:** the isolated branch starts from the source repository's checked-out commit, avoiding implicit copying/stashing of staged or uncommitted changes. Explain this at the opt-in action.
- **Unique generated branch:** generate a safe branch name from the selected project/session label plus a stable unique session token; refuse collision and retry with a new suffix, never reuse or force an existing branch. Branch naming must be validated with Git's own ref-format rules or equivalent conservative validation.
- **App-managed destination:** choose a deterministic app data subdirectory keyed by canonical repository identity, with a unique worktree leaf. Keep the generated path outside the repository checkout and avoid trusting a destination supplied by the UI. Confirm app data directory behavior and permissions in the native implementation before settling the exact layout.
- **Atomic user-visible creation:** create the worktree before registering/spawning the session; if startup then fails, retain the created worktree (safe, recoverable) and report its location rather than deleting user-visible Git data. If the `git worktree add` command itself fails after creating a partial target, cleanup only the exact app-generated empty/registered target after verifying Git state; otherwise leave it and report recovery instructions.
- **Persist explicit provenance:** keep the actual worktree path as the tab's project path for all existing consumers, and persist optional source repo path/branch metadata in `OpenTab` so the UI can distinguish a linked worktree and restore it predictably.
- **Keep on close:** lifecycle follows Git's explicit retention model; tab close and process respawn never remove worktree data.
- **Exclusive session ownership:** never attach a second tab to an existing linked worktree. Every isolated session gets a new worktree directory and branch, so each tab has its own writable filesystem and index.
- **Navigation identity:** the actual worktree path remains the folder identity used by project grouping and recent projects. Each unique worktree therefore forms its own project group; source-repository metadata is explanatory only and must not merge distinct worktrees into one tab group.

## Implementation Units

### U1. Native worktree creation API

**Goal:** Safely create a linked worktree and unique branch from a canonical source repo.

**Requirements:** R2, R3, R7.

**Dependencies:** Approved plan.

**Files:** Add a focused module under `src-tauri/src/` (candidate `worktree.rs`); modify `src-tauri/src/lib.rs`; reuse `workspace` path/repository validation patterns, `child_path`, `spawn_gate`, `child_run::collect`, and `ProcessSupervisor`.

**Approach:** Accept typed source directory and user-facing label; canonicalize and discover the repo root, verify non-bare repo and commit HEAD, derive app-owned destination from canonical repo identity, and generate a unique branch. Build Git with the absolute binary and trusted PATH (same trusted lookup as `workspace::git`), spawn via `spawn_gate::spawn`, attach `ProcessSupervisor`, then call `child_run::collect` with a 30-second deadline, 16 KiB stdout cap and 16 KiB retained stderr tail. On timeout, output overflow, or runner error, `collect` terminates and reaps the process tree; return a concise typed error, inspect Git worktree registration before deciding whether any app-generated partial destination is safe to clean, and never delete a branch/worktree when state is uncertain. Return `{ path, sourceRepo, branch, baseCommit }`. Do not accept raw args or arbitrary destination path from the frontend.

**Verification:** Rust unit/integration tests use disposable local repos to check base HEAD, distinct index/filesystem, unchanged source branch/index/uncommitted files, branch collision handling, missing HEAD/non-repo/errors, timeout/output overflow termination and bounded error output, plus no orphaned tab registration.


### U2. Session persistence and restore

**Goal:** Make isolated sessions resume in their existing worktree across application restarts.

**Requirements:** R4, R5, R6.

**Dependencies:** U1.

**Files:** Modify `src-tauri/src/open_tabs.rs`, `src-tauri/src/lib.rs`, `src/live.js`, and relevant pure project navigation helpers/tests.

**Approach:** Add optional serde-defaulted source repository and isolation branch metadata to `OpenTab`; pass metadata with tab registry and open-tab save/load. Restore uses the saved worktree path as cwd, verifies it still exists and is a valid Git worktree, and never calls create on restore. Missing/broken worktree follows existing skipped-folder/error reporting without silently opening the source checkout. Respawn and close retain the directory and branch. Keep old JSON layouts compatible.

**Verification:** Rust tests for old/new JSON, valid and missing worktree restore; JS pure tests for tab serialization/restore mapping; verify profile and approval-mode respawns retain the same worktree cwd.

### U3. Opt-in project UI and isolation identity

**Goal:** Let the user choose isolation at project-session creation and make the active worktree obvious.

**Requirements:** R1, R4.

**Dependencies:** U1, U2.

**Files:** Modify `src/design/project-sidebar.jsx`, `src/app-live.jsx`, `src/live.js`, tab/status UI (likely `src/design/chrome.jsx` or project tab components, confirm exact owner before editing), matching `src/design/layout/` CSS, `src/app/i18n-zh.js`, `src/index.html` only if a new script is introduced, `CHANGELOG.md`, and focused frontend tests.

**Approach:** Add a clear secondary "Open isolated worktree…" action that uses the same native folder picker then invokes the typed native creation command and opens a new tab at the returned worktree path. Normal open remains untouched. Show an explicit worktree indicator and branch in tab/status UI, with a tooltip or accessible label identifying the source repo. Use existing design tokens, OMP_TR, keyboard focus and narrow-width behavior; explain that uncommitted changes in the source checkout are not copied.

**Verification:** Pure/UI regressions cover both choices, failed creation leaves no ghost session, localization coverage, keyboard interaction and correct per-tab identity. Inspect actual visible application or headed browser UI when available; check light/dark themes and compact width.

### U4. Documentation and focused verification

**Goal:** Document lifecycle guarantees and validate the end-to-end user flow.

**Requirements:** R1-R8.

**Dependencies:** U1-U3.

**Files:** Update `docs/architecture/session-model.md`, `docs/architecture/reopening-tabs.md`, `docs/architecture/git-browser.md`, `AGENTS.md` feature table/invariants as appropriate, and `CHANGELOG.md` Unreleased.

**Approach:** Document opt-in behavior, branch base, destination, restore and retention semantics; state explicitly that closing a tab keeps worktree/branch and that cleanup is manual Git work until a dedicated manager exists. Run focused tests, Rust format/test/clippy for Rust changes, npm test or the narrow affected suite plus frontend build checks, and one actual UI scenario.

**Verification:** Open one normal tab and one isolated worktree tab for the same repo; confirm different absolute cwd/branch, source worktree branch and dirty files unchanged, Git Browser shows isolated changes, switch tabs without leaking labels, close/restart/restore preserves the worktree. Report any UI/native verification blocked by the environment.

## System-Wide Impact

- **Interaction graph:** project sidebar action → native worktree creation → per-tab path/metadata → `start_session` cwd → git watcher, terminal, browser overlay, widgets and Git Browser all operate on the new worktree → open-tabs persistence restores it later.
- **API surface parity:** add a narrow typed Tauri command and optional open-tab JSON fields; no raw Git CLI arguments or caller-controlled target path cross IPC.
- **Unchanged invariants:** normal project opens use their original folder; one tab still owns one omp process; `close_tab` remains the only path ending a tab's resources; `stop_session` respawns same-tab omp only; closing a worktree tab retains its linked worktree and branch.

## Risks & Dependencies

| Risk | Mitigation |
| :--- | :--- |
| Generated branch name already exists or is checked out | Unique session token; validate through native Git/ref checks; retry only with a fresh safe name; never force/reuse. |
| Repo has uncommitted changes and user expects them copied | State clearly that base is current HEAD and source working-copy changes remain only in source checkout. |
| `git worktree add` fails after making filesystem or metadata changes | Bounded command, verify `git worktree list --porcelain`, cleanup only an exact app-owned empty target when safe; otherwise report path and recovery. |
| Worktree directory is manually moved/deleted before restore | Validate on restore and report the missing worktree; never fall back to the source checkout silently. |
| App data worktree destination crosses filesystem or lacks space/permissions | Use repository/path validation, show actionable errors, and verify data-directory policy and platform constraints before implementation. |
| Shared Git common-dir is manipulated by concurrent sessions | Unique names plus native Git locking; do not mutate shared refs except creation of a fresh uniquely named branch. |
| Worktrees accumulate because close preserves data | Explicitly document retention; no implicit cleanup; future management UI can enumerate/prune only with user-confirmed actions. |

## Next Steps

1. Review and approve this plan.
2. Resolve any plan feedback before implementation.
3. Execute U1-U4; no commit/push/install without an explicit request.
