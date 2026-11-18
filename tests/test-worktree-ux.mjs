#!/usr/bin/env node
// Regression script for src/app/worktree-ux.js: the composer's Local /
// Worktree pill state, base-branch default, branch-name suggestion and the
// registry fields a handoff leaves.
// Run: node tests/test-worktree-ux.mjs  (or: npm run test:worktree-ux)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const window = {};
runInNewContext(readFileSync(new URL("../src/app/worktree-ux.js", import.meta.url), "utf8"), { window });
const WT = window.OMP_WORKTREE_UX;

const fresh = { id: "t", path: "/repo", repoRoot: "/repo", name: "new session" };

assert.equal(WT.tabState(null, 0), null);
assert.equal(WT.tabState({ path: "" }, 0), null, "no folder, no pill");
assert.equal(WT.tabState({ path: "/notes" }, 0), null, "not a git project, no pill");
assert.equal(WT.tabState(fresh, 0), "fresh");
assert.equal(WT.tabState(fresh, 3), "local", "a chat with turns hands off instead");
assert.equal(WT.tabState({ ...fresh, sourceRepo: "/repo" }, 0), "worktree");

assert.equal(WT.wantsWorktree(fresh, 0), false, "Local is the default");
assert.equal(WT.wantsWorktree({ ...fresh, worktreeDraft: { mode: "worktree" } }, 0), true);
assert.equal(WT.wantsWorktree({ ...fresh, worktreeDraft: { mode: "worktree" } }, 1), false, "only the first send");

const branches = [
  { reference: "refs/heads/dev", name: "dev", current: false },
  { reference: "refs/heads/main", name: "main", current: true },
  { reference: "refs/remotes/origin/main", name: "origin/main", remote: true, current: false },
];
assert.equal(WT.baseFor(null, []), null);
assert.equal(WT.baseFor(null, branches).name, "main", "defaults to the checkout's branch");
assert.equal(WT.baseFor({ base: "refs/remotes/origin/main" }, branches).name, "origin/main");
assert.equal(WT.baseFor({ base: "refs/heads/gone" }, branches).name, "main", "a vanished pick falls back");
assert.equal(WT.baseFor(null, [branches[0]]).name, "dev", "detached checkout: first branch");

assert.equal(WT.pillLabel("fresh", fresh), "local");
assert.equal(WT.pillLabel("fresh", { ...fresh, worktreeDraft: { mode: "worktree" } }), "worktree");
assert.equal(WT.pillLabel("worktree", { branch: null }), "worktree · detached");
assert.equal(WT.pillLabel("worktree", { branch: "omp/x" }), "worktree · omp/x");

assert.equal(WT.suggestBranch("omp/", "Sửa lỗi Login redirect!"), "omp/sua-loi-login-redirect");
assert.equal(WT.suggestBranch("", "  "), "worktree");
assert.ok(WT.suggestBranch("feat/", "x".repeat(80)).length <= "feat/".length + 40);

const local = { id: "t", path: "/repo", sourceRepo: null, worktreeDraft: { mode: "local" } };
const toWt = WT.afterHandoff(local, { path: "/wt/a", sourceRepo: "/repo", worktree: "/wt/a" }, true);
assert.deepEqual([toWt.path, toWt.sourceRepo, toWt.worktreeHome, toWt.worktreeDraft], ["/wt/a", "/repo", "/wt/a", null]);
const back = WT.afterHandoff(toWt, { path: "/repo", sourceRepo: "/repo", worktree: "/wt/a" }, false);
assert.deepEqual([back.path, back.sourceRepo, back.worktreeHome], ["/repo", null, "/wt/a"], "local tab remembers its worktree");

assert.equal(WT.moveCommand("/wt/a b"), "/move /wt/a b");

console.log("test-worktree-ux: ok");
