#!/usr/bin/env node
// Regression script for src/app/ship-text.js — the offline default commit
// message and pull-request text of the ship bar.
// Run: node tests/test-ship-text.mjs  (or: npm run test:ship-text)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src/app/ship-text.js"), "utf8");
const win = {};
// eslint-disable-next-line no-new-func
new Function("window", src)(win);
const T = win.OMP_SHIP_TEXT;

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

// ── subject ──────────────────────────────────────────────────────────────────

check("subject: nothing staged has no default text", () =>
  assert.equal(T.subject([]), ""));
check("subject: a missing list is empty, not a crash", () =>
  assert.equal(T.subject(undefined), ""));

check("subject: one file names the path", () =>
  assert.equal(T.subject(["src/app/ship-text.js"]), "Update src/app/ship-text.js"));

check("subject: several files in one folder name the folder and the count", () =>
  assert.equal(T.subject(["src/app/a.js", "src/app/b.js"]), "Update src (2 files)"));

check("subject: files across folders fall back to the count", () =>
  assert.equal(T.subject(["src/app/a.js", "docs/b.md", "Cargo.toml"]), "Update 3 files"));

check("subject: a root file alone is its own sentence", () =>
  assert.equal(T.subject(["Cargo.toml"]), "Update Cargo.toml"));

check("subject: duplicates and blanks are one staged change", () =>
  assert.equal(T.subject(["src/a.js", "src/a.js", "  ", ""]), "Update src/a.js"));

check("subject: control characters and newlines collapse to one space", () =>
  assert.equal(T.subject(["src/we\tird\nname.js"]), "Update src/we ird name.js"));

check("subject: non-ASCII paths survive untouched", () =>
  assert.equal(T.subject(["docs/日本語.md"]), "Update docs/日本語.md"));

check("subject: a long path stays inside the 72-character budget", () => {
  const long = `src/${"deep/".repeat(20)}file.js`;
  const subject = T.subject([long]);
  assert.ok(Array.from(subject).length <= 73, subject);
  assert.ok(subject.endsWith("…"), subject);
  assert.ok(!/[\s,;:.\-]…$/.test(subject), subject);
  assert.ok(subject.startsWith("Update src/deep/"), subject);
});

check("subject: a long single word is clipped without splitting a code point", () => {
  const subject = T.subject([`${"é".repeat(200)}.js`]);
  assert.ok(Array.from(subject).length <= 73, subject);
  assert.ok(subject.endsWith("…"), subject);
});

check("subject: sorted, so the same staged set reads the same way", () =>
  assert.equal(T.subject(["src/b.js", "src/a.js"]), T.subject(["src/a.js", "src/b.js"])));

// ── pull request text ────────────────────────────────────────────────────────

check("prTitle: follows the commit subject", () =>
  assert.equal(T.prTitle(["src/app/a.js", "src/app/b.js"]), T.subject(["src/app/a.js", "src/app/b.js"])));

check("prBody: nothing staged has no default body", () =>
  assert.equal(T.prBody([]), ""));

check("prBody: the staged paths as a bullet list under a heading", () =>
  assert.equal(
    T.prBody(["src/b.js", "src/a.js"]),
    ["## Changes", "", "- src/a.js", "- src/b.js"].join("\n"),
  ));

check("prBody: a long list is capped and says how many it left out", () => {
  const files = Array.from({ length: 25 }, (_, i) => `src/f${String(i).padStart(2, "0")}.js`);
  const body = T.prBody(files);
  const bullets = body.split("\n").filter(line => line.startsWith("- "));
  assert.equal(bullets.length, 21);
  assert.equal(bullets.at(-1), "- …and 5 more");
  assert.ok(!body.includes("src/f24.js"), body);
});

check("prBody: non-ASCII paths survive", () =>
  assert.ok(T.prBody(["docs/日本語.md"]).includes("- docs/日本語.md")));

// ── shared helpers ───────────────────────────────────────────────────────────

check("clean trims and collapses runs of whitespace", () =>
  assert.equal(T.clean("  a \n\t b  "), "a b"));

check("clip leaves a short string alone", () =>
  assert.equal(T.clip("short", 10), "short"));

check("clip never ends on whitespace or punctuation", () => {
  const clipped = T.clip("aaaa bbbb, cccc.", 11);
  assert.ok(!/[\s,;:.\-]…$/.test(clipped), clipped);
});

// ── Done ─────────────────────────────────────────────────────────────────────

console.log(`ship-text: ${passed} checks passed`);
