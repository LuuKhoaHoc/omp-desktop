#!/usr/bin/env node
// Regression script for src/app/drag-reorder.js — where a dragged tab-bar
// item or sidebar row lands (issue #40).
// Run: node tests/test-drag-reorder.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src  = readFileSync(join(root, "src/app/drag-reorder.js"), "utf8");
const win  = {};
// eslint-disable-next-line no-new-func
new Function("window", src)(win);
const D = win.OMP_DRAG_REORDER;

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

// Three 100px-wide items side by side: a [0,100) b [100,200) c [200,300).
const items = ["a", "b", "c"].map((id, i) => ({ id, start: i * 100, end: i * 100 + 100 }));

check("a press only becomes a drag once the pointer has travelled the threshold", () => {
  assert.equal(D.pastThreshold(3, 3), false);
  assert.equal(D.pastThreshold(D.DRAG_THRESHOLD_PX, 0), true);
  assert.equal(D.pastThreshold(0, -D.DRAG_THRESHOLD_PX), true);
});

check("the slot flips at the target's middle", () => {
  assert.deepEqual(D.dropSlot(items, "a", 249), { targetId: "c", after: false });
  assert.deepEqual(D.dropSlot(items, "a", 251), { targetId: "c", after: true });
  assert.deepEqual(D.dropSlot(items, "c", 49), { targetId: "a", after: false });
});

check("a pointer beyond either end of the list still lands at that end", () => {
  assert.deepEqual(D.dropSlot(items, "a", 5000), { targetId: "c", after: true });
  assert.deepEqual(D.dropSlot(items, "c", -5000), { targetId: "a", after: false });
});

check("a slot right before or after the dragged item is no move", () => {
  // b over its own halves, or the far half of either neighbour.
  for (const pos of [60, 120, 180, 240]) assert.equal(D.dropSlot(items, "b", pos), null, `pos ${pos}`);
  assert.deepEqual(D.dropSlot(items, "b", 40), { targetId: "a", after: false });
  assert.deepEqual(D.dropSlot(items, "b", 260), { targetId: "c", after: true });
});

check("an item missing from the list never gets a slot", () => {
  assert.equal(D.dropSlot(items, "gone", 10), null);
  assert.equal(D.dropSlot([], "a", 10), null);
});

// Two wrapped rows of two chips each:
// row 0 (y 0..24):   a [0,100)   b [110,210)
// row 1 (y 30..54):  c [0,100)   d [110,210)
const wrapped = [
  { id: "a", left: 0, right: 100, top: 0, bottom: 24 },
  { id: "b", left: 110, right: 210, top: 0, bottom: 24 },
  { id: "c", left: 0, right: 100, top: 30, bottom: 54 },
  { id: "d", left: 110, right: 210, top: 30, bottom: 54 },
];

check("dropSlotWrap picks the row under y, not row 0's x overlap", () => {
  assert.deepEqual(D.dropSlotWrap(wrapped, "a", 20, 42), { targetId: "c", after: false });
  assert.deepEqual(D.dropSlotWrap(wrapped, "a", 180, 42), { targetId: "d", after: true });
  assert.deepEqual(D.dropSlotWrap(wrapped, "d", 20, 12), { targetId: "a", after: false });
});

check("dropSlotWrap stays on the pointer's row at row end vs next row start", () => {
  assert.deepEqual(D.dropSlotWrap(wrapped, "a", 190, 12), { targetId: "b", after: true });
  assert.deepEqual(D.dropSlotWrap(wrapped, "a", 20, 42), { targetId: "c", after: false });
});

check("dropSlotWrap skips adjacent no-ops across row boundaries and handles outside y", () => {
  assert.equal(D.dropSlotWrap(wrapped, "b", 20, 42), null);
  assert.equal(D.dropSlotWrap(wrapped, "c", 190, 12), null);
  assert.deepEqual(D.dropSlotWrap(wrapped, "d", 20, -20), { targetId: "a", after: false });
  assert.deepEqual(D.dropSlotWrap(wrapped, "a", 190, 100), { targetId: "d", after: true });
});

check("reorderList moves items before/after target and rejects unknown ids", () => {
  assert.deepEqual(D.reorderList(["a", "b", "c", "d"], "a", "c", true), ["b", "c", "a", "d"]);
  assert.deepEqual(D.reorderList(["a", "b", "c", "d"], "d", "b", false), ["a", "d", "b", "c"]);
  assert.equal(D.reorderList(["a", "b"], "missing", "a", false), null);
  assert.equal(D.reorderList(["a", "b"], "a", "missing", false), null);
});

console.log(`drag-reorder: ${passed} checks passed`);
