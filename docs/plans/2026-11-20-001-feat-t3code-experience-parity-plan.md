---
title: 'feat: T3 Code experience parity — ship loop, dock, worktree, settings'
type: feat
status: active
date: 2026-11-20
---

# feat: T3 Code experience parity

## Summary

The gap with T3 Code is not features. omp-desktop already has worktrees, a diff viewer, a dock, settings and remote access. What it lacks is **reachability, feedback and the last mile**: three shipped dock tabs cannot be opened, a staged file can never become a commit, a worktree is created detached while the UI promises a branch, and every failure surfaces as a raw Rust string.

This plan fixes the entry points first (Phase 0), then closes the one genuine feature gap — commit → push → pull request (Phase 1) — then brings the four experience surfaces up to the T3 bar (Phases 2–5) and adds the performance discipline that keeps them there (Phase 6). Multi-harness is scoped as a decision gate (Phase 7), not as work in this plan.

Phase 0 is implemented and verified. The user chose a named branch by default for new worktrees; U3.1 is no longer an open question. The user approved continuing automatically through Phases 1–6 after each phase gate. Multi-harness remains separate.

Reference implementation read: `pingdotgg/t3code` @ `8edefc88`, MIT. Every T3 claim below carries a path in that repo; every omp-desktop claim carries a path here.

## Verdict — what is actually wrong

Three defect classes, in the order they hurt:

1. **Dead entry points.** A feature's model exists, its UI exists, and nothing calls it.
   - `src/app/use-dock.jsx:34` defines `openTool`; no live callsite exists (`grep "openTool(" src/` returns only the definition and `browser-start.js:94`, which calls through an unset handler).
   - `src/design/browser-panel.jsx:130` renders `<_BP_Start ui={ui} />` without `onOpenTool`; `src/design/browser-start.jsx:40` falls back to `ui.openTool`, which `src/app/use-browser.jsx:307-316` never returns and `src/app-live.jsx:546-552` never assigns.
   - Consequence: the Terminal / Changes / Files tiles on the browser start page do nothing, no dock tool tab can ever open, and the embedded `GitBrowser` branch (`browser-panel.jsx:121-123`) is dead code. `CHANGELOG.md:19-23` advertises all of it. `tests/test-dock-tabs.mjs` only covers the pure model, so the suite stays green.

2. **Dead ends.** Flows that stop one action short of their purpose.
   - Stage exists (`src-tauri/src/workspace.rs:274`), discard exists (`:379`), commit does not. Push is a text prompt copied into the composer (`src/design/pr-automation-card.jsx:161-171`). `src-tauri/src/pr_automation/` is read-only by construction (`tests.rs:649` `live_read_only_snapshot`).
   - A worktree is created detached (`src-tauri/src/worktree.rs:155-165`) while `src/design/empty-workspace.jsx:121` says "Creates a new branch from the selected base. Uncommitted changes stay in the original folder." Both halves are false: no branch is created, and uncommitted changes are **copied** into the new worktree (`worktree.rs:156-158`, field `carried`).
   - The result is the PR card telling the user "Detached HEAD · check out a branch to see its pull request." (`src/design/pr-automation-card.jsx:55`) with no checkout button on it.

3. **No feedback.** Work that takes seconds looks like nothing, and failure looks like a stack trace.
   - Worktree creation is one blocking call with a copy-on-write clone (`worktree.rs:148-153`); the only UI is the word "Opening…" (`empty-workspace.jsx:124`), with no stage, no progress, no cancel.
   - Changing worktree retention saves immediately (`src/design/settings/rows-worktree.jsx:79-80`) but pruning only runs at the next open or handoff (`src/live.js:2128`, `:5433`, `:5881` → `:2177`): the setting appears to do nothing.
   - Errors are Rust `String`s rendered verbatim at eight sites — `empty-workspace.jsx:84,122`, `worktree-menu.jsx:158,206`, `git/worktree-panel.jsx:94,130`, `settings/rows-worktree.jsx:67,82,97`, `git/git-browser.jsx:110`.

A fourth, quieter class: **one concept, three surfaces.** Terminal is a bottom panel (`app-live.jsx:1316`) *and* a full-stage tab (`terminal-panel.jsx:87`) *and* a dead dock tool; Files is a right column (`app-live.jsx:1416`) *and* a dead dock tool; Changes is a full-window modal (`app-live.jsx:1530-1537`) *and* a dead dock tool. Each has its own toggle (`toolbar.jsx:96,119,121`).

## What T3 Code does differently

Only the parts that explain the felt quality gap.

**The ship loop is one action with an LLM in the middle.** One RPC, `git.runStackedAction` (`packages/contracts/src/rpc.ts:497`), takes `commit | push | create_pr | commit_push | commit_push_pr` (`packages/contracts/src/git.ts:18-23`) and runs the phases in order (`apps/server/src/git/GitManager.ts:3599-3827`). The commit message is generated from the staged summary and patch (`GitManager.ts:2294-2304`); the PR title and body are generated from `base..head` commits, the diff, the host's PR template **and the thread's conversation** (`GitManager.ts:2619-2642`). That last input is why the generated PR reads like the work that was just done rather than like a diff.

**Diff review is scoped, docked and instant.** `review.getDiffPreview` runs `git diff` server-side (`apps/server/src/review/ReviewService.ts:113-131`); the client renders it with `@pierre/diffs` on a worker pool (`apps/web/src/lib/diffRendering.ts:1-3`, `components/DiffWorkerPoolProvider.tsx:1-4`). Scopes are `tool-call | branch | unstaged | commit | turn` (`apps/web/src/diffPanelStore.ts:16-20`). It lives in a **right panel with tabs**, not a modal (`components/RightPanelTabs.tsx`), opened by `mod+d` (`packages/shared/src/keybindings.ts:76`). There is no per-hunk accept; commit takes selected **file paths** (`git.ts:139`).

**Progress is a first-class card.** Worktree setup streams stage snapshots (`apps/web/src/components/chat/WorktreeSetupCard.tsx:64-120`) with per-stage icons, elapsed time, Cancel, "Work locally" and "Open terminal" — the opposite of a spinner.

**Optimism with a documented failure surface.** New threads mint their id client-side (`hooks/useHandleNewThread.ts:397-401`); drag reorder merges optimistically with a grace window (`components/Sidebar.tsx:742-783`); settings writes overlay pending patches on the read path (`packages/client-runtime/.../scopedSettings.ts:66-111`).

**Worktree is NOT the default** — despite the marketing line "Every agent thread writes to its own branch" (`apps/marketing/src/i18n/en.ts:62`). `defaultThreadEnvMode` resolves to `local` (`packages/contracts/src/t3ProjectFile.ts:130`), and a brand-new project folder stays local even when configured otherwise (`packages/shared/src/projectSettings.ts:183-211`). Isolation is opt-in per environment/project/thread.

**Two marketing claims have no code**: generated changelogs and PR amend. Do not copy them.

**Performance is enforced, not vibes.** React Compiler is mandatory and `useMemo`/`useCallback` are lint-banned (`t3code/no-manual-memo`), coverage tests fail on any compiler skip, snapshot budgets are 1 MiB, list virtualization kicks in at 250 rows (`components/ChangedFilesTree.tsx:24`). There is no in-app FPS HUD; the "dropped frame is a bug" line is backed by benches and CI budgets (`docs/internals/performance-regressions.md`).

## Requirements

- R1. No feature ships without a reachable entry point. A UI handler that nothing passes, or a tile that calls an undefined handler, is a defect with a test.
- R2. No flow ends one action short. Stage leads to commit; a worktree leads to a branch; a PR card's advice leads to a button that does it.
- R3. Anything over ~200 ms shows stages and can be cancelled. "Opening…" is not a progress indicator.
- R4. User-facing failures are sentences, not Rust literals. The raw text stays available behind a disclosure.
- R5. One concept, one surface. A second surface is allowed only as a view of the same state, not as a second toggle.
- R6. The ship loop never runs without an explicit click. No auto-commit, no auto-push, no auto-PR. Commit consumes only the already-staged index; it never silently changes staging.
- R7. Every git mutation stays in Rust, through the trusted `git` binary, `spawn_gate` and `child_run::collect`. The webview sends a session id plus a message and a remote id returned by Rust; Rust resolves the tab's project folder and remote. Never accept a frontend filesystem path, raw Git arguments or a token.
- R8. Every phase lands with its tests, a `CHANGELOG.md` line under `## [Unreleased]`, and the `docs/architecture/` file it invalidates updated in the same commit.

## Scope boundaries

- No multi-harness implementation. Phase 7 is a decision gate and gets its own plan.
- No new omp RPC command; `ALLOWED_COMMAND_TYPES` does not change.
- No change to the browser's CDP path, the terminal's spawn contract, or the remote-access protocol.
- No per-hunk staging. T3 does not have it either; per-file is the target.
- No token, key or credential is ever sent to the webview or written to a log.

## Phase 0 — Unbreak the entry points (S, complete)

Cheap, high-signal, unblocks Phase 1.

### U0.1 Dock tool tabs open

**Files:** `src/design/browser-panel.jsx:130`, `src/design/browser-start.jsx:40`, optionally `src/app/use-dock.jsx`.

**Approach:** pass the handler explicitly — `<_BP_Start ui={ui} onOpenTool={ui.dock?.openTool} />` — and drop the `ui.openTool` fallback, which no longer has a producer. Keep `openTool` calling `openSide("browser")` so a tile opens the dock.

**Tests:** extend `tests/test-dock-tabs.mjs` with a source-scan assertion that `browser-panel.jsx` passes `onOpenTool` to `BrowserStart` and that `openTool` has at least one live callsite outside its definition. This is the same shape as the Rust test that scans `live.js` for `{ type: "…"` — a reachability guard, not a rendering test.

### U0.2 Worktree copy tells the truth

**Files:** `src/design/empty-workspace.jsx:121`, `src/app/i18n-zh.js`.

**Approach:** either the behaviour changes (U3.1, branch per worktree) or the sentence does. If U3.1 is not taken this phase, the copy becomes: "Creates an isolated checkout at the selected base. Uncommitted changes are copied into it." Add the i18n entry; `tests/test-i18n.mjs` fails otherwise.

### U0.3 Errors become sentences

**Files:** `src/app/git-error.js`, the error call sites, `src/index.html` (load slot before JSX consumers), `src/app/i18n-zh.js`.

**Approach:** the pure module `OMP_GIT_ERROR.present(raw)` maps common Git/worktree errors to `OMP_TR` sentences and returns `{ message, detail }`. Render the summary and keep the raw string behind a `<details>` disclosure. Unknown errors remain visible as technical detail.

**Tests:** `tests/test-git-error.mjs` checks known mappings and unknown-detail retention; it is part of the `npm test` chain.

### U0.4 Sidebar fold survives a switch

**Files:** `src/design/project-sidebar.jsx:20-23`, `src/app/project-nav.js`.

**Approach:** persist folded project keys the way the tab strip already does (`project-nav.js:308`, `omp-desktop:folded-tab-groups`), with a second key and the same read-on-mount/write-on-change shape. Do not merge the two stores: one is per-tab-group, one per-project.

**Tests:** extend `tests/test-project-nav.mjs` — round-trip, unknown key dropped, corrupt JSON ignored.

### Phase 0 verification

Implemented: dock start tiles pass `ui.dock.openTool`; the worktree hint describes the detached/copy behavior; Git/worktree errors have localized summaries with expandable raw details; project group folds persist under their own localStorage key. Verified with `npm test` (includes the frontend build) and `git diff --check`.

## Phase 1 — The ship loop (M)

The one real feature gap, and the highest visible delta. Built on the dock surface that Phase 0 unblocks.

### U1.1 Rust: commit

**Files:** new `src-tauri/src/ship/` (`mod.rs`, `commit.rs`, `push.rs`, `pr.rs`), `src-tauri/src/lib.rs` (command registration), `src/live.js` (session-bound bridge), tests beside each.

**Approach:** `ship_commit(session_id, message) -> CommitInfo { sha, branch, files }`. Rust resolves the folder from the owned tab/session registry; no caller-supplied path.
- Commit **only the existing index**. `git add` is out of this command: the Git Browser presents merged HEAD/worktree status, and staging selected files here could overwrite different content already in the index. The UI shows the exact staged paths from `git diff --cached --name-only -z`; an empty index disables Commit.
- Refuse an empty message and detached HEAD. Return the new HEAD sha via gix, not parsed from `git` stdout.
- Use the trusted executable, `spawn_gate::spawn` and bounded `child_run::collect` via the established `workspace.rs` patterns.
- `git commit` invokes project/user hooks and may execute arbitrary local commands. The explicit Commit action must disclose this before first use; it never runs on its own.

**Tests:** fixture repo (`git_browser::fixture`) — only pre-staged content is committed; unstaged content is unchanged; empty index/message refused; detached HEAD refused; failing hook returns a bounded failure and leaves the index intact.

### U1.2 Rust: push

**Files:** `ship/push.rs`.

**Approach:** backend lists validated remotes for the current session; `ship_push(session_id, remote_id) -> PushInfo { branch, remote, ahead }`. Rust resolves the selected id to the configured remote URL and current branch. No implicit `origin` choice when multiple remotes exist; no caller-provided remote names, refs or flags. Never force, and never push a detached HEAD.

**Tests:** local bare-remote fixture — push creates the intended remote ref; several remotes require an explicit choice; rejected non-fast-forward changes nothing locally; detached returns `detached`.

### U1.3 Rust: pull request

**Files:** `ship/pr.rs`, a narrow provider adapter that reuses trusted executable discovery and bounded child execution but does not assume `pr_automation::gh`'s GitHub.com-only API fits every host.

**Approach:** `ship_create_pr(path, title, body, draft: bool) -> PrInfo { number, url }`.
- Bind the request to the tab's session id; derive repo identity and host from the configured remote in Rust, not environment variables or UI input. Do not let ambient `GH_REPO`/host overrides redirect the operation.
- Route only to a recognized GitHub or GitLab provider/host. Unsupported providers return a clear unsupported-host state. Keep credentials inside the native provider CLI; never pass tokens through IPC or logs.
- Title/body are text values, never argument strings or raw flags. Use stdin or a private bounded temp file for the body. Draft is a typed boolean.
- Look up the current branch's existing PR/MR by repository + head before create; return its validated URL instead of parsing a create error as proof.

**Tests:** injectable executable runner, not global PATH mutation — host/repository/head identity, stdin/body, draft flag, signed-out, existing PR/MR, unsupported host, timeout kills the tree.

### U1.4 Message and PR text

**Files:** new `src/app/ship-text.js`, `src/design/git/commit-bar.jsx`.

**Approach:** offline heuristic default, based on staged paths and diff summary; always editable before commit. Do not consume an agent turn in v1. PR title/body use the same editable heuristic until an explicit, separately scoped agent-assisted flow is designed.

**Tests:** `tests/test-ship-text.mjs` — subject from staged paths/counts, truncation, no trailing whitespace, non-ASCII paths survive.

### U1.5 UI: the Changes tab becomes the ship surface

**Files:** `src/design/git/git-browser.jsx` (embedded mode), new `src/design/git/commit-bar.jsx`, `src/design/layout/git.css`, `src/app/use-git-browser.jsx`.

**Approach:** when embedded in the dock, `GitBrowser` gains a footer bar: staged-file summary, editable message, `Commit` (disabled without staged changes/message), `Push` (after explicit remote choice), `Create pull request` (only for a supported provider), and PR/MR state. Every mutation is an explicit click with inline result feedback. The full-window modal remains a secondary surface.

**Tests:** `tests/test-git-browser.mjs` — button enable matrix over `{stagedFiles, message, remotes, supportedProvider, detached}`; component wiring must pass session identity to the native bridge.

### U1.6 Guards

- Never change the index as part of Commit; commit only what was already staged.
- Never choose a remote implicitly when more than one is configured; never force-push.
- A failed action leaves the message intact and refreshes actual staged/branch state.
- Every command resolves `session_id` to a registered tab folder in Rust; no arbitrary path reaches a mutation command.
- Show the user that Git hooks may run before the first commit; never bypass hooks or run them silently.
- `docs/architecture/git-browser.md` gains a "Ship" section; `CHANGELOG.md` gets one line.

### Phase 1 verification

Implemented. Rust `src-tauri/src/ship/` (`commit.rs`, `push.rs`, `pr/{pr,cli,provider}.rs`) exposes four session-bound mutation commands (`ship_remotes`, `ship_commit_staged`, `ship_push`, `ship_create_pr`) and has 11 focused tests. The staged path list comes from `git_browser_status`'s gix status pass, reused by `useGitBrowser` rather than a separate process/IPC call; commit emptiness and detached-HEAD checks also use gix. Frontend: `live.js` bridge methods, `useGitBrowser` ship state, `app/ship-bar.js` (enable matrix) and `app/ship-text.js` (default text) with `test-ship-bar.mjs` / `test-ship-text.mjs`, and `design/git/commit-bar.jsx` in the docked Changes tab. Commit message and PR text stay heuristic in v1 (U1.4); an agent-assisted flow is not part of this phase. `docs/architecture/git-browser.md` has the "Ship" section, `CHANGELOG.md` the user-facing line.

## Phase 2 — Left sidebar (S)

**Files:** `src/design/project-sidebar.jsx`, `src/design/tab-group-chip.jsx`, `src/app-live.jsx` (memo), `src/design/layout/sidebar.css`.

- Project header gains project-level actions: new chat, new chat in worktree, reveal in git browser. Today these live in three different menus (`app-live.jsx:1217,1231`, `git/git-browser.jsx:105`).
- The worktree badge (`tab-group-chip.jsx:49`) moves to the project head as well, so isolation is visible without expanding a tab.
- Memoize `ProjectSidebar`, `PanelRail`, `AmbientRail` and the status bar, or lift them off the streaming snapshot. Today none is memoized (only `branch-menu`, `profile-menu`, tree rows and insights diagrams are), so every delta frame recomputes sidebar rows and run dots.
- The empty state ("no open tabs", `project-sidebar.jsx:60`) gains the one action that resolves it.

## Phase 3 — Worktree experience (M)

### U3.1 Branch per worktree

`worktree.rs::create` is detached by design ("like Codex"). T3 creates a named branch per thread. The PR card, the branch picker and the handoff flow all assume a branch exists.

**Decision:** create on `<branchPrefix><slug>` at the base tip by default (`worktree_ops::DEFAULT_PREFIX` already exists), keeping detached as an explicit option only if a later product decision needs it. This removes the detached dead end at its source instead of patching the UI around it.

### U3.2 Detached HEAD gets a button

Wherever a detached worktree is shown (`worktree-menu.jsx:178-182` today), render the branch action inline — "Create branch here" with the suggested name pre-filled (`worktree-ux.js:47-56`), one click, no menu. The PR card's advice links to it.

### U3.3 Setup progress card

**Files:** `src-tauri/src/worktree.rs` (stage callbacks), new `worktree://progress` event, `src/app/worktree-ux.js`, new `src/design/worktree-setup-card.jsx`, `src/index.html`.

**Approach:** `create` reports `{ stage, status, elapsedMs }` per step (`fetch`, `worktree-add`, `copy-changes`, `register`), emitted like `terminal://data` (seq-numbered, coalesced). The card mounts only while running and offers Cancel, which kills the tree through `ProcessSupervisor` (already attached) and removes the partial directory. T3's `WorktreeSetupCard` is the model.

**Tests:** Rust — stage sequence is monotonic and `running` wins over a late `done`; cancel terminates the tree and leaves no directory. JS — `tests/test-worktree-ux.mjs` covers stage merge and the terminal state.

### U3.4 Manager and prune

- Move the worktree list out of the git modal header (`git-browser.jsx:105`) into the dock's Changes tab as a secondary view, and into Settings (Phase 4).
- Add `prune now` with a preview list ("3 worktrees will be removed, 1 kept because it is open"), calling the existing `worktree_prune` path.
- Show when a worktree is a prune candidate in the list.

## Phase 4 — Settings (S)

**Files:** `src/app/settings-schema.js`, `src/design/settings/rows-worktree.jsx`, new `src/design/settings/rows-git.jsx`, `src/index.html`.

- New section **Git & Worktrees** between Session and Remote access. Move the three worktree rows out of Session (`settings-schema.js:194,200-204`) and add: worktree manager, prune now, commit-message source (heuristic / agent), PR draft default.
- Stop hardcoding defaults: `rows-worktree.jsx:78,93` compare against `15` and `"omp/"`. Expose `DEFAULT_KEEP` / `DEFAULT_PREFIX` from Rust in the settings payload so the reset button and the comparison cannot drift.
- Optimistic write with a visible failure: the switch flips immediately, and a failed save shows a row error rather than leaving a value that is not on disk. This is the one place T3 is weak too (`useSettings.ts:241-246` logs only) — do better, not worse.

## Phase 5 — Right panel and dock (M)

- Retire the duplicate toggles. After Phase 0, Terminal/Files/Changes each have a dock tool tab; the bottom terminal panel and the right Files column become the same state seen twice. Pick one home per concept: Terminal stays a bottom panel (it is resizable and concurrent with chat), Files and Changes become dock tools.
- Diff-first: opening the git browser from the rail opens the **docked** Changes tab, not the modal. The modal remains for "open in full window".
- Scope the diff the way T3 does: unstaged, staged, branch, last commit, last turn. `git_browser` already computes the first two; branch and turn need a base resolver.
- Auto-open rule (opt-in, off by default, mirroring `ChatView.logic.ts:247-251`): after a turn that changed ≥3 files or ≥50 lines, offer the Changes tab rather than forcing it open. A user action always wins.

## Phase 6 — Performance discipline (S)

- Memoize or detach the chrome from the streaming snapshot (Phase 2 lists the components).
- A dev-only render counter behind a tweak: renders per second per surface, so "the sidebar re-renders on every frame" is observable instead of inferred.
- A `tests/test-render-cost.mjs` guard is not realistic without a DOM harness; instead assert the structural rule — the streaming snapshot is consumed by `ChatView` and the composer only, by scanning `app-live.jsx` for which components receive it.

## Phase 7 — Multi-harness (decision gate, not this plan)

Multi-harness is the largest thing T3 does and the one omp-desktop cannot copy cheaply. "One tab = one omp process" is load-bearing across the whole app: terminal cwd ownership, browser allocation, approval modes, remote access, tab restore, model usage, goal mode, subagents (`AGENTS.md` § Cross-feature invariants).

Three routes, in increasing cost:

- **A. Terminal harnesses (S).** Another agent CLI runs in the existing terminal tab; its output is already visible. No integration: no approvals, no diff card, no model picker. Ships this week, buys little.
- **B. A Rust `Harness` trait (L).** `omp` becomes the only implementation; a second implementation speaks ACP (`docs/user/providers-acp.md` in T3 is the protocol reference). Every invariant above must be re-expressed per harness, and `start_session`'s approval-mode resolution, the browser overlay's `--config` token and the terminal's cwd contract all become harness-specific. This is its own plan with its own migration, not a phase here.
- **C. Outside agents over MCP (M).** T3's `t3_thread_launch` model: another agent can start and wait on a thread without becoming one. This is the cheapest way to get cross-harness value without touching the tab model.

Recommendation: ship Phases 0–6 first, then decide B vs C with the surfaces already in good shape.

## Ordering and effort

| Phase | Content | Size | Why here |
|---|---|---|---|
| 0 | Dead entry points, copy, errors, fold | S | Unblocks Phase 1; the dead tiles are the emblem of the complaint |
| 1 | Commit → push → PR in the docked Changes tab | M | The only genuine feature gap; highest visible delta |
| 2 | Left sidebar actions, badge, memo | S | Cheap, and the sidebar is on screen 100% of the time |
| 3 | Worktree branch, detached button, progress card, manager | M | Removes the flow that currently dead-ends |
| 4 | Git & Worktrees settings section, honest defaults | S | Finishes Phase 3's story |
| 5 | Dock consolidation, diff scopes, auto-open rule | M | Where the remaining duplication lives |
| 6 | Render counter, structural guard | S | Keeps Phases 2–5 from regressing |
| 7 | Multi-harness decision (separate plan) | L | Cannot start before the tab model is stable |

## Verification

Per unit: the unit's own test, then `npm test`; after any Rust unit `cd src-tauri && cargo fmt && cargo test --locked`, then the pedantic clippy command from `AGENTS.md` § Commands (CI runs no clippy, so a local pass is the only gate). A new JS test file must be added to the `npm test` chain in `package.json` with its own `test:<name>` script.

## Open questions

1. **Commit message source** (U1.4): heuristic only for v1, or heuristic plus an "Ask the agent" button that costs a turn?
2. **Files surface** (Phase 5): keep the right Files column and drop its dock tool, or the reverse?
3. **Multi-harness** (Phase 7): B (ACP harness) or C (outside agents over MCP) after Phases 0–6?
