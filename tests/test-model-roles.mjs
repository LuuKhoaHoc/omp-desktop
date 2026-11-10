#!/usr/bin/env node
// Regression script for src/app/model-roles.js — Settings → Agent → Models:
// selector split/join, the subagent list, and the model/thinking menu rows.
// Run: node tests/test-model-roles.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const win = {};
// eslint-disable-next-line no-new-func
new Function("window", readFileSync(join(root, "src/app/model-roles.js"), "utf8"))(win);
const R = win.OMP_MODEL_ROLES;

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

check("split takes only a known thinking level as suffix", () => {
  assert.deepEqual(R.split("9router/cx/gpt-6-luna:xhigh"), { model: "9router/cx/gpt-6-luna", thinking: "xhigh" });
  assert.deepEqual(R.split("anthropic/claude-sonnet-5-5"), { model: "anthropic/claude-sonnet-5-5", thinking: "" });
  assert.deepEqual(R.split("openrouter/x:free"), { model: "openrouter/x:free", thinking: "" });
  assert.deepEqual(R.split(undefined), { model: "", thinking: "" });
});

check("join round-trips split", () => {
  for (const s of ["a/b:auto", "a/b", "openrouter/x:free:high"]) {
    const { model, thinking } = R.split(s);
    assert.equal(R.join(model, thinking), s);
  }
});

check("agentNames merges bundled, files and overrides once, sorted", () => {
  const names = R.agentNames({ customAgents: ["hilo-reviewer", "scout"], agents: { "my-bot": "a/b", task: "a/c" } });
  assert.deepEqual(names, [...new Set(names)].sort());
  for (const n of ["hilo-reviewer", "my-bot", "scout", "task", "reviewer"]) assert.ok(names.includes(n), n);
  assert.deepEqual(R.agentNames(null), [...R.BUNDLED_AGENTS].sort());
});

check("modelRows checks the set model and keeps an unlisted one first", () => {
  const models = [{ id: "m1", name: "M One", provider: "p" }, { id: "m2", name: "", provider: "q" }];
  const rows = R.modelRows(models, "q/m2");
  assert.deepEqual(rows.map(r => [r.value, r.checked]), [["p/m1", false], ["q/m2", true]]);
  assert.equal(rows[1].name, "m2");
  const orphan = R.modelRows(models, "gone/x");
  assert.deepEqual([orphan[0].value, orphan[0].checked, orphan.length], ["gone/x", true, 3]);
  assert.ok(R.modelRows(models, "").every(r => !r.checked));
});

check("modelLabel names a listed model, else the selector", () => {
  const models = [{ id: "m1", name: "M One", provider: "p" }];
  assert.equal(R.modelLabel(models, "p/m1"), "M One · p");
  assert.equal(R.modelLabel(models, "z/y"), "z/y");
  assert.equal(R.modelLabel(models, ""), "");
});

check("thinkingRows: default plus every level, one checked", () => {
  const rows = R.thinkingRows("high");
  assert.equal(rows.length, R.THINKING.length + 1);
  assert.deepEqual(rows.filter(r => r.checked).map(r => r.value), ["high"]);
  assert.deepEqual(R.thinkingRows("").filter(r => r.checked).map(r => r.value), [""]);
});

console.log(`test-model-roles: ${passed} checks passed`);
