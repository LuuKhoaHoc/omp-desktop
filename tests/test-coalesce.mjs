#!/usr/bin/env node
// Regression script for src/app/coalesce.js — the trailing coalescer behind
// live.js's streaming notify: a burst of delta frames in one window runs the
// snapshot once, a cancel drops the queued run, and a later burst runs again.
// Run: node tests/test-coalesce.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const win = {};
// eslint-disable-next-line no-new-func
new Function("window", readFileSync(join(root, "src/app/coalesce.js"), "utf8"))(win);
const { createCoalescer } = win.OMP_COALESCE;

// A timer double: `set` records callbacks, `run` fires the pending ones.
function fakeTimers() {
  let next = 1;
  const pending = new Map();
  return {
    set(fn, ms) {
      const id = next++;
      pending.set(id, { fn, ms });
      return id;
    },
    clear(id) {
      pending.delete(id);
    },
    run() {
      const due = [...pending.values()];
      pending.clear();
      for (const { fn } of due) fn();
    },
    get size() {
      return pending.size;
    },
  };
}

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

check("a burst of schedules in one window runs the callback once", () => {
  const t = fakeTimers();
  let runs = 0;
  const c = createCoalescer(() => { runs++; }, 16, t);
  for (let i = 0; i < 50; i++) c.schedule();
  assert.equal(t.size, 1, "one timer queued for the whole burst");
  t.run();
  assert.equal(runs, 1);
});

check("the window uses the given delay", () => {
  const seen = [];
  const t = { set(fn, ms) { seen.push(ms); return 7; }, clear() {} };
  createCoalescer(() => {}, 16, t).schedule();
  assert.deepEqual(seen, [16]);
});

check("cancel drops the queued run", () => {
  const t = fakeTimers();
  let runs = 0;
  const c = createCoalescer(() => { runs++; }, 16, t);
  c.schedule();
  c.cancel();
  c.cancel(); // idempotent
  t.run();
  assert.equal(runs, 0);
});

check("a schedule after the run starts a new window", () => {
  const t = fakeTimers();
  let runs = 0;
  const c = createCoalescer(() => { runs++; }, 16, t);
  c.schedule();
  t.run();
  c.schedule();
  c.schedule();
  t.run();
  assert.equal(runs, 2);
});

check("cancel after the run started is harmless and a new window still runs", () => {
  const t = fakeTimers();
  let runs = 0;
  const c = createCoalescer(() => { runs++; }, 16, t);
  c.schedule();
  t.run();
  c.cancel();
  c.schedule();
  t.run();
  assert.equal(runs, 2);
});

check("default timers do not call setTimeout with the timers object as this", () => {
  const calls = [];
  const strict = (name) => function (...a) {
    if (this !== undefined && this !== globalThis) throw new TypeError(`Illegal invocation: ${name}`);
    calls.push(name);
    return 1;
  };
  const w = {};
  new Function("window", "setTimeout", "clearTimeout", readFileSync(join(root, "src/app/coalesce.js"), "utf8"))(w, strict("set"), strict("clear"));
  const c = w.OMP_COALESCE.createCoalescer(() => {}, 1);
  c.schedule();
  c.cancel();
  assert.deepEqual(calls, ["set", "clear"]);
});

console.log(`test-coalesce: ${passed} checks passed`);
