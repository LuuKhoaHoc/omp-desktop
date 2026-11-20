#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const window = {};
runInNewContext(readFileSync(new URL("../src/app/git-error.js", import.meta.url), "utf8"), { window });
const present = window.OMP_GIT_ERROR.present;

assert.deepEqual(JSON.parse(JSON.stringify(present("fatal: not a git repository (or any parent)"))), {
  message: "This folder is not a usable Git repository.",
  detail: "fatal: not a git repository (or any parent)",
});
assert.equal(present(new Error("git was not found")).message, "Git could not be found. Install Git or add it to PATH.");
const unknown = "new backend failure: ref transaction refused";
assert.equal(present(unknown).message, "The Git or worktree operation failed.");
assert.equal(present(unknown).detail, unknown, "unknown raw errors stay available as details");
assert.equal(present("").detail, "No error details were provided.");

console.log("test-git-error: ok");
