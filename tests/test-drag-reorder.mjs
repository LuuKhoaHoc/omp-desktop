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

check("edgeScroll holds still in the middle and speeds up towards an edge", () => {
  // A scroller spanning 100..500: 48px zones at both ends.
  assert.equal(D.edgeScroll(300, 100, 500), 0);
  assert.equal(D.edgeScroll(148, 100, 500), 0);
  assert.equal(D.edgeScroll(452, 100, 500), 0);
  assert.ok(D.edgeScroll(140, 100, 500) < 0 && D.edgeScroll(460, 100, 500) > 0);
  assert.ok(D.edgeScroll(110, 100, 500) < D.edgeScroll(140, 100, 500), "nearer the start edge scrolls back faster");
  assert.equal(D.edgeScroll(460, 100, 500), -D.edgeScroll(140, 100, 500));
});

check("edgeScroll is capped at and past the edge", () => {
  assert.equal(D.edgeScroll(100, 100, 500), -D.EDGE_SCROLL_MAX_PX);
  assert.equal(D.edgeScroll(-40, 100, 500), -D.EDGE_SCROLL_MAX_PX);
  assert.equal(D.edgeScroll(900, 100, 500), D.EDGE_SCROLL_MAX_PX);
});

check("edgeScroll leaves the middle of a small scroller alone", () => {
  // 60px tall: the zones shrink to a third each instead of meeting.
  assert.equal(D.edgeScroll(30, 0, 60), 0);
  assert.ok(D.edgeScroll(5, 0, 60) < 0 && D.edgeScroll(55, 0, 60) > 0);
  assert.equal(D.edgeScroll(10, 20, 20), 0);
});

check("reorderList moves items before/after target and rejects unknown ids", () => {
  assert.deepEqual(D.reorderList(["a", "b", "c", "d"], "a", "c", true), ["b", "c", "a", "d"]);
  assert.deepEqual(D.reorderList(["a", "b", "c", "d"], "d", "b", false), ["a", "d", "b", "c"]);
  assert.equal(D.reorderList(["a", "b"], "missing", "a", false), null);
  assert.equal(D.reorderList(["a", "b"], "a", "missing", false), null);
});

check("shiftList moves an item one place and refuses to leave the list", () => {
  assert.deepEqual(D.shiftList(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.deepEqual(D.shiftList(["a", "b", "c"], "b", 1), ["a", "c", "b"]);
  assert.equal(D.shiftList(["a", "b", "c"], "a", -1), null);
  assert.equal(D.shiftList(["a", "b", "c"], "c", 1), null);
  assert.equal(D.shiftList(["a", "b"], "missing", 1), null);
  const values = ["a", "b"];
  D.shiftList(values, "a", 1);
  assert.deepEqual(values, ["a", "b"], "the input list is not changed");
});

console.log(`drag-reorder: ${passed} checks passed`);
