// Worktree UX (Codex-style): the pure decisions behind the composer's
// Local / Worktree pill, the first-send worktree start and the handoff
// between a chat's local checkout and its worktree. Rust does the git work
// (src-tauri/src/worktree.rs, worktree_ops.rs); live.js wires it.
//
// A tab is in one of three worktree states:
//   "fresh"    no turn yet, git project, not a worktree: the pill picks
//              Local or Worktree (+ base branch) for the first send;
//   "local"    turns in the local checkout: can hand off to a worktree;
//   "worktree" an app-managed worktree (`sourceRepo` set): branch, open
//              folder, hand off back to local.
//
// Exposes `window.OMP_WORKTREE_UX`; IIFE per the AGENTS.md rule for plain
// <script> files.
(function () {
  /** The worktree state of a `_sessionsView` tab; `null` when the tab has
   *  no git project (no pill). `messageCount`: the tab's transcript rows. */
  function tabState(tab, messageCount) {
    if (!tab || !tab.path) return null;
    if (tab.sourceRepo) return "worktree";
    if (!tab.repoRoot) return null;
    return messageCount > 0 ? "local" : "fresh";
  }

  /** Whether the next send must first move a fresh tab into a worktree. */
  function wantsWorktree(tab, messageCount) {
    return tabState(tab, messageCount) === "fresh" && tab.worktreeDraft?.mode === "worktree";
  }

  /** The base branch a fresh tab starts from: the picked one while it is
   *  still listed, else the branch the checkout is on, else the first. */
  function baseFor(draft, branches) {
    if (!branches?.length) return null;
    const picked = draft?.base && branches.find(b => b.reference === draft.base);
    return picked || branches.find(b => b.current) || branches[0];
  }

  /** The pill's label. */
  function pillLabel(state, tab) {
    if (state === "worktree") return tab.branch ? `worktree · ${tab.branch}` : "worktree · detached";
    if (state === "fresh" && tab.worktreeDraft?.mode === "worktree") return "worktree";
    return "local";
  }

  /** A branch name for "Create branch here": prefix + a slug of the tab
   *  title, e.g. `omp/fix-login-redirect`. */
  function suggestBranch(prefix, title) {
    const slug = String(title || "")
      .toLowerCase()
      .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "");
    return `${prefix || ""}${slug || "worktree"}`;
  }

  /** Registry fields after a handoff (Rust `Handoff`): the tab follows the
   *  chat to `path`; a worktree tab keeps `sourceRepo`, a local one keeps
   *  its worktree as `worktreeHome` so the next handoff reuses it. */
  function afterHandoff(entry, handoff, toWorktree) {
    return toWorktree
      ? { ...entry, path: handoff.path, sourceRepo: handoff.sourceRepo, worktreeHome: handoff.worktree, worktreeDraft: null }
      : { ...entry, path: handoff.path, sourceRepo: null, worktreeHome: handoff.worktree, worktreeDraft: null };
  }

  /** `/move` command text for omp; quotes are not needed (omp takes the
   *  rest of the line as the path). */
  function moveCommand(path) {
    return `/move ${path}`;
  }

  window.OMP_WORKTREE_UX = { tabState, wantsWorktree, baseFor, pillLabel, suggestBranch, afterHandoff, moveCommand };
})();
