#!/usr/bin/env node
// Regression script for src/app/swarm-mascot.js: the pixel bee's wing poses
// and sprite, that a frame is drawn with the colours the caller passes on
// whole device pixels, and the shared animation loop.
// Run: node tests/test-swarm-mascot.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src/app/swarm-mascot.js"), "utf8");
const win = {};
// eslint-disable-next-line no-new-func
new Function("window", src)(win);
const M = win.OMP_SWARM_MASCOT;

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
}

/** A 2-D context that only records the squares the bee fills. */
function rec(dpr = 1) {
  const log = { rects: [], clears: 0 };
  const g = new Proxy({}, {
    get: (target, name) => {
      if (name in target) return target[name];
      if (name === "getTransform") return () => ({ a: dpr });
      if (name === "clearRect") return () => { log.clears += 1; };
      if (name === "fillRect") return (x, y, w, h) => log.rects.push({ x, y, w, h, colour: target.fillStyle, alpha: target.globalAlpha });
      return () => {};
    },
    set: (target, name, value) => { target[name] = value; return true; },
  });
  return { g, log };
}

const COLORS = { body: "#body", dark: "#dark", wing: "#wing", crown: "#crown" };
const colours = log => new Set(log.rects.map(r => r.colour));

check("a quiet bee holds one wing pose; a busy one swaps between two", () => {
  assert.equal(M.wingFrame(0, false), M.wingFrame(99999, false));
  const seen = new Set();
  for (let t = 0; t < 1000; t += 10) seen.add(M.wingFrame(t, true));
  assert.deepEqual([...seen].sort(), [0, 1]);
});

check("the two poses differ and the sprite stays inside the grid", () => {
  const key = cells => cells.map(c => c.join(",")).join(";");
  assert.notEqual(key(M.sprite(0, false)), key(M.sprite(1, false)));
  for (const frame of [0, 1]) {
    for (const [col, row] of M.sprite(frame, true)) {
      assert.ok(col >= 0 && col < M.GRID && row >= 0 && row < M.GRID, `${col},${row}`);
    }
  }
});

check("a frame clears the tile and fills with the supplied colours", () => {
  const { g, log } = rec();
  M.draw(g, 40, 100, COLORS, true);
  assert.equal(log.clears, 1);
  for (const colour of ["#wing", "#body", "#dark"]) assert.ok(colours(log).has(colour), colour);
});

check("only the coordinator gets a crown", () => {
  const plain = rec();
  const crowned = rec();
  M.draw(plain.g, 40, 0, COLORS, false, false);
  M.draw(crowned.g, 40, 0, COLORS, false, true);
  assert.ok(!colours(plain.log).has("#crown"));
  assert.ok(colours(crowned.log).has("#crown"));
});

check("squares are whole device pixels at any scale, so the edges stay sharp", () => {
  for (const [size, dpr] of [[40, 1], [52, 1.25], [52, 2], [36, 1.5], [240, 1]]) {
    const { g, log } = rec(dpr);
    M.draw(g, size, 0, COLORS, true, true);
    for (const r of log.rects) {
      for (const v of [r.x, r.y, r.w, r.h]) {
        assert.ok(Math.abs(v * dpr - Math.round(v * dpr)) < 1e-9, `${size}@${dpr}: ${v}`);
      }
    }
    assert.ok(Math.max(...log.rects.map(r => r.x + r.w)) <= size + 1e-9, "inside the tile");
  }
});

/** A manual frame clock: `tick()` runs the one callback the loop asked for. */
function clock() {
  const queue = [];
  return { raf: cb => queue.push(cb), tick: now => { const cbs = queue.splice(0); cbs.forEach(cb => cb(now)); }, pending: () => queue.length };
}

check("many bees share one loop: one frame request however many join", () => {
  const c = clock();
  const beat = M.createBeat(c.raf, () => false);
  const seen = [0, 0, 0];
  const leaves = seen.map((_, i) => beat.join(() => { seen[i] += 1; }));
  assert.equal(c.pending(), 1);
  c.tick(1);
  assert.deepEqual(seen, [1, 1, 1]);
  assert.equal(c.pending(), 1, "still looping while bees remain");
  leaves.forEach(leave => leave());
  c.tick(2);
  assert.equal(c.pending(), 0, "the last bee leaving ends the loop");
  assert.deepEqual(seen, [1, 1, 1], "a bee that left is not drawn again");
});

check("a hidden page puts the loop to sleep: nothing drawn, no timer or frame left, resume wakes it", () => {
  const c = clock();
  const timers = [];
  let hidden = true;
  const beat = M.createBeat(c.raf, () => hidden, 50, (fn, ms) => timers.push({ fn, ms }));
  let n = 0;
  const leave = beat.join(() => { n += 1; });
  c.tick(1);
  assert.equal(n, 0);
  assert.equal(c.pending(), 0, "no frame request while hidden");
  assert.equal(timers.length, 0, "no timer while hidden");
  assert.equal(beat.size(), 1, "the bee is still registered");
  hidden = false;
  beat.resume();
  assert.equal(c.pending(), 1);
  c.tick(2);
  assert.equal(n, 1);
  assert.equal(timers.length, 1, "visible again: the 50 ms wait is armed");
  leave();
  timers.pop().fn();
  c.tick(3);
  assert.equal(c.pending(), 0);
  beat.resume();
  assert.equal(c.pending(), 0, "resume with no bee does nothing");
  beat.join(() => { n += 1; });
  assert.equal(c.pending(), 1, "joining again restarts the loop");
});

check("a throttled loop sleeps on a timer between draws and asks raf only when it is due", () => {
  const c = clock();
  const timers = [];
  const beat = M.createBeat(c.raf, () => false, 50, (fn, ms) => timers.push({ fn, ms }));
  let n = 0;
  const leave = beat.join(() => { n += 1; });
  c.tick(0);
  assert.equal(n, 1);
  assert.equal(c.pending(), 0, "no frame requested while waiting");
  assert.deepEqual(timers.map(t => t.ms), [50]);
  timers.pop().fn();
  assert.equal(c.pending(), 1);
  leave();
  c.tick(50);
  assert.equal(n, 1);
  assert.equal(timers.length, 0, "no wait is armed once the last bee left");
  beat.join(() => { n += 1; });
  assert.equal(c.pending(), 1, "joining again restarts the loop");
});

console.log(`test-swarm-mascot: ${passed} checks passed`);
