#!/usr/bin/env node
// Regression script for src/app/exit-motion.js — the leaving half of
// layout/motion.css: which removed surfaces get a copy, where the copy
// stands, and that every listed surface has an exit rule to play.
// Run: node tests/test-exit-motion.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const win = {};
// eslint-disable-next-line no-new-func
new Function("window", readFileSync(join(root, "src/app/exit-motion.js"), "utf8"))(win);
const M = win.OMP_EXIT_MOTION;
const motionCss = readFileSync(join(root, "src/design/layout/motion.css"), "utf8");

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

// A minimal element: classes only, enough for matches / querySelectorAll
// over a class-list selector.
function el(cls, ...children) {
  const clsSet = new Set(cls.split(" ").filter(Boolean));
  const node = { cls: clsSet, classList: { contains: c => clsSet.has(c) }, children, parentElement: null };
  for (const c of children) c.parentElement = node;
  const hit = sel => sel.split(",").some(s => node.cls.has(s.trim().slice(1)));
  node.matches = hit;
  node.querySelectorAll = sel => {
    const out = [];
    const walk = n => { for (const c of n.children) { if (c.matches(sel)) out.push(c); walk(c); } };
    walk(node);
    return out;
  };
  return node;
}

check("every listed surface has a .motion-ghost exit rule in motion.css", () => {
  const exitRules = motionCss.split("}").filter(r => r.includes(".motion-ghost") && /animation:\s*motion-[a-z-]+-out|motion-sink|motion-shrink/.test(r));
  const covered = exitRules.join(" ");
  for (const sel of M.EXIT_SELECTOR.split(",").map(s => s.trim())) {
    assert.ok(new RegExp(`\\${sel}(?![\\w-])`).test(covered), `${sel} has no exit rule`);
  }
});

check("every listed surface is turned off under reduced motion", () => {
  const reduced = motionCss.slice(motionCss.indexOf("prefers-reduced-motion"));
  assert.ok(reduced.includes(".motion-ghost"), "copies are not turned off");
});

check("outermost: a removed surface itself is the only copy (scrim carries its dialog)", () => {
  const dialog = el("ask-dialog");
  const scrim = el("bridge-scrim", el("x", dialog));
  assert.deepEqual(M.outermost(scrim), [scrim]);
});

check("outermost: listed surfaces inside a removed wrapper, nested ones skipped", () => {
  const pop = el("profile-pop");
  const inner = el("slash-pop");
  const rail = el("rail", el("y", inner));
  const wrapper = el("stage", el("a", pop), rail);
  assert.deepEqual(M.outermost(wrapper), [pop, rail]);
});

check("outermost: nothing listed, nothing copied", () => {
  assert.deepEqual(M.outermost(el("chat-scroll", el("row tool"))), []);
});

check("ghostStyle: a fixed, inert box on the last measured rect", () => {
  assert.deepEqual(M.ghostStyle({ left: 10, top: 20, width: 300, height: 40 }), {
    position: "fixed", left: "10px", top: "20px", width: "300px", height: "40px",
    margin: "0", zIndex: "2147483000", pointerEvents: "none",
  });
});

check("ghostStyle: no box, no copy", () => {
  assert.equal(M.ghostStyle(undefined), null);
  assert.equal(M.ghostStyle({ left: 0, top: 0, width: 0, height: 30 }), null);
  assert.equal(M.ghostStyle({ left: 0, top: 0, width: 30, height: 0 }), null);
});

// A document with a class list on its root and timers run by hand.
function fakeDoc() {
  const cls = new Set();
  const timers = new Map();
  let next = 0;
  return {
    documentElement: { classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c) } },
    defaultView: {
      setTimeout: (fn, ms) => { timers.set(++next, { fn, ms }); return next; },
      clearTimeout: id => timers.delete(id),
    },
    timers,
    runTimers() { for (const [id, t] of [...timers]) { timers.delete(id); t.fn(); } },
  };
}

check("quietSwitch: the document is switching until its timer runs", () => {
  const doc = fakeDoc();
  assert.equal(M.switching(doc), false);
  M.quietSwitch(doc);
  assert.equal(M.switching(doc), true);
  assert.deepEqual([...doc.timers.values()].map(t => t.ms), [M.SWITCH_QUIET_MS]);
  doc.runTimers();
  assert.equal(M.switching(doc), false);
});

check("quietSwitch: a second switch before the first ended keeps it quiet for its own time", () => {
  const doc = fakeDoc();
  const cancel = M.quietSwitch(doc);
  // The effect's cleanup, then the next switch (app-live.jsx).
  cancel();
  assert.equal(M.switching(doc), true, "the cancel drops the timer, not the class");
  assert.equal(doc.timers.size, 0);
  M.quietSwitch(doc);
  assert.equal(doc.timers.size, 1, "one timer: the first cannot end the second's quiet early");
  doc.runTimers();
  assert.equal(M.switching(doc), false);
});

check("skipFoldedRemoval skips .tab ghosts only when removed from a folded cluster", () => {
  assert.equal(M.skipFoldedRemoval(el("tab-cluster is-folded"), el("tab")), true);
  assert.equal(M.skipFoldedRemoval(el("tab-cluster"), el("tab")), false);
  assert.equal(M.skipFoldedRemoval(el("tab-cluster is-folded"), el("tab-cluster-new")), false);
  assert.equal(M.skipFoldedRemoval(null, el("tab")), false);
});

console.log(`exit-motion: ${passed} checks passed`);
