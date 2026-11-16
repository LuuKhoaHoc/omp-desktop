#!/usr/bin/env node
// Regression script for the empty-workspace project's worktree picker state.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const window = {};
runInNewContext(readFileSync(new URL("../src/app/empty-worktree-start.js", import.meta.url), "utf8"), { window });
const { resetForProject, beginBranchLoad, finishBranchLoad, canOpen } = window.OMP_EMPTY_WORKTREE_START;

const selected = {
  project: "/repo-a",
  branches: [{ reference: "refs/heads/main" }],
  branchesProject: "/repo-a",
  baseBranch: "refs/heads/main",
  branchesLoading: false,
  error: "old error",
};

const switched = resetForProject(selected, "/repo-b");
assert.equal(switched.project, "/repo-b");
assert.equal(switched.branches, null);
assert.equal(switched.branchesProject, "");
assert.equal(switched.baseBranch, "");
assert.equal(switched.error, "");
assert.equal(canOpen(switched, true, false), false, "switching projects invalidates the old branch selection immediately");
assert.equal(resetForProject(selected, "/repo-a"), selected, "reselecting the current project leaves state alone");

const loading = beginBranchLoad(switched);
assert.equal(loading.branchesLoading, true);
assert.equal(loading.baseBranch, "", "loading never implicitly chooses a branch");
assert.equal(canOpen(loading, true, false), false);
const loaded = finishBranchLoad(loading, "/repo-b", { ok: true, value: [{ reference: "refs/heads/dev" }] });
assert.equal(loaded.branchesProject, "/repo-b");
assert.equal(loaded.baseBranch, "", "available branches still require an explicit user selection");
assert.equal(canOpen(loaded, true, false), false);
assert.equal(canOpen({ ...loaded, baseBranch: "refs/heads/dev" }, true, false), true);
assert.equal(canOpen({ ...loaded, baseBranch: "refs/heads/dev" }, true, true), false);
assert.equal(canOpen({ ...loaded, branchesProject: "/repo-a", baseBranch: "refs/heads/main" }, true, false), false);
assert.equal(finishBranchLoad(loading, "/repo-a", { ok: true, value: [] }), loading, "late results for a previous project are ignored");
const failed = finishBranchLoad(loading, "/repo-b", { ok: false, error: "not a repository" });
assert.equal(failed.error, "not a repository");
assert.equal(canOpen(failed, true, false), false);
assert.equal(canOpen({ ...selected, branchesLoading: false }, false, false), true, "normal project sessions remain available");
assert.equal(canOpen({ ...selected, branchesLoading: false }, false, true), false, "normal sessions cannot open twice while pending");
console.log("test-empty-worktree-start: 19 assertions passed");
