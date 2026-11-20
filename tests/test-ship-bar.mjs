#!/usr/bin/env node
// Regression script for src/app/ship-bar.js.
// Zero dependencies beyond node:assert/strict.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src/app/ship-bar.js"), "utf8");
const win = {};
// eslint-disable-next-line no-new-func
new Function("window", src)(win);
const Ship = win.OMP_SHIP_BAR;

let passed = 0;
function check(label, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`FAILED: ${label}`);
    throw err;
  }
  passed++;
}

const remotes = [
  { name: "github", provider: "github" },
  { name: "gitlab", provider: "gitlab" },
  { name: "other", provider: "other" },
];
const ready = {
  staged: ["src/a.js"], message: "fix: thing", remotes, remote: "github",
  branch: "main", pushed: true, busy: false,
};
const action = (input, name) => Ship.state({ ...ready, ...input })[name];
const reason = (input, name) => Ship.state({ ...ready, ...input }).reasons[name];

check("commit enabled with staged paths and a nonblank message", () => {
  assert.equal(action({}, "commit"), true);
  assert.equal(reason({}, "commit"), null);
});
check("commit disabled with no staged paths", () => {
  assert.equal(action({ staged: [] }, "commit"), false);
  assert.equal(reason({ staged: [] }, "commit"), "nothing-staged");
});
check("commit disabled with empty or whitespace-only message", () => {
  for (const message of ["", " \t\n "]) {
    assert.equal(action({ message }, "commit"), false);
    assert.equal(reason({ message }, "commit"), "message-required");
  }
});
check("commit disabled while busy", () => {
  assert.equal(action({ busy: true }, "commit"), false);
  assert.equal(reason({ busy: true }, "commit"), "busy");
});
check("commit disabled on detached HEAD", () => {
  assert.equal(action({ branch: null }, "commit"), false);
  assert.equal(reason({ branch: null }, "commit"), "detached");
});
check("push requires at least one remote", () => {
  assert.equal(action({ remotes: [], remote: null }, "push"), false);
  assert.equal(reason({ remotes: [], remote: null }, "push"), "no-remote");
});
check("push requires a configured selected remote", () => {
  assert.equal(action({ remote: "missing" }, "push"), false);
  assert.equal(reason({ remote: "missing" }, "push"), "remote-required");
});
check("push enabled for a selected configured remote", () => {
  assert.equal(action({}, "push"), true);
  assert.equal(reason({}, "push"), null);
});
check("pull request enabled for GitHub", () => {
  assert.equal(action({}, "pullRequest"), true);
  assert.equal(reason({}, "pullRequest"), null);
});
check("pull request enabled for GitLab", () => {
  assert.equal(action({ remote: "gitlab" }, "pullRequest"), true);
});
check("pull request disabled for unsupported provider", () => {
  assert.equal(action({ remote: "other" }, "pullRequest"), false);
  assert.equal(reason({ remote: "other" }, "pullRequest"), "unsupported-host");
});
check("pull request requires the branch to be pushed", () => {
  assert.equal(action({ pushed: false }, "pullRequest"), false);
  assert.equal(reason({ pushed: false }, "pullRequest"), "not-pushed");
});
check("pull request disabled on detached HEAD", () => {
  assert.equal(action({ branch: null }, "pullRequest"), false);
  assert.equal(reason({ branch: null }, "pullRequest"), "detached");
});
check("providerOf returns provider for a configured remote and null otherwise", () => {
  assert.equal(Ship.providerOf(remotes, "gitlab"), "gitlab");
  assert.equal(Ship.providerOf(remotes, "missing"), null);
  assert.equal(Ship.providerOf(undefined, "github"), null);
});
check("missing inputs are defensive and never throw", () => {
  assert.doesNotThrow(() => Ship.state());
  assert.doesNotThrow(() => Ship.state({ staged: undefined, message: undefined, remotes: undefined }));
  assert.deepEqual(Ship.state(), {
    commit: false, push: false, pullRequest: false,
    reasons: {
      commit: "detached", push: "detached", pullRequest: "detached",
    },
  });
});

console.log(`ship-bar: ${passed} checks passed`);
