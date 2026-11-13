// Drag-to-reorder geometry (issue #40): where a dragged tab-bar item,
// sidebar row or Work panel column would land, and how fast the list
// scrolls while the pointer rests at its edge. Pure; the pointer handling
// around it is `design/ui/use-drag-reorder.js`, the reorder itself
// `OMP_PROJECT_NAV`'s `moveGroup` / `moveMember` or `reorderList` here.
//
// Exposes `window.OMP_DRAG_REORDER`; wrapped as an IIFE per the project
// rule for plain <script> tags (see AGENTS.md "IIFE rule").
(function () {
  /** Pointer travel, in CSS px, before a press becomes a drag. Below it the
   *  press stays a click, so a slightly shaky click still selects. */
  const DRAG_THRESHOLD_PX = 5;

  function pastThreshold(dx, dy) {
    return dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;
  }

  /** Drop position for item `srcId` with the pointer at `pos` on the drag
   *  axis. `items` are the list's items in display order, each with its
   *  `start`/`end` on that axis. The pointer goes before the first item whose
   *  middle it has not passed, else after the last item, so a pointer beyond
   *  either end of the list still has a slot. Returns `{ targetId, after }`,
   *  or `null` when `srcId` is not in the list or would stay where it is. */
  function dropSlot(items, srcId, pos) {
    const from = items.findIndex(it => it.id === srcId);
    if (from < 0) return null;
    let slot = items.findIndex(it => pos < (it.start + it.end) / 2);
    if (slot < 0) slot = items.length;
    if (slot === from || slot === from + 1) return null;
    return slot < items.length
      ? { targetId: items[slot].id, after: false }
      : { targetId: items[items.length - 1].id, after: true };
  }

  /** Pointer distance from a scroller's edge, in CSS px, where a drag
   *  starts scrolling it, and the step per frame at the edge itself. */
  const EDGE_SCROLL_ZONE_PX = 48;
  const EDGE_SCROLL_MAX_PX = 18;

  /** Scroll step per frame for a pointer at `pos` on the drag axis, in a
   *  scroller spanning `start`..`end`: 0 away from the edges, growing to
   *  ±EDGE_SCROLL_MAX_PX as the pointer reaches or passes one (negative
   *  towards `start`). The zones never cover more than a third of a small
   *  scroller each, so its middle always holds still. */
  function edgeScroll(pos, start, end) {
    const zone = Math.min(EDGE_SCROLL_ZONE_PX, (end - start) / 3);
    if (!(zone > 0)) return 0;
    const before = start + zone - pos;
    const after = pos - (end - zone);
    const depth = Math.max(before, after);
    if (depth <= 0) return 0;
    const step = Math.ceil(EDGE_SCROLL_MAX_PX * Math.min(1, depth / zone));
    return before > after ? -step : step;
  }

  /** Move `srcId` before/after `targetId` in `values`, or `null` if missing. */
  function reorderList(values, srcId, targetId, after) {
    const from = values.indexOf(srcId);
    if (from < 0) return null;
    const next = values.filter(x => x !== srcId);
    const at = next.indexOf(targetId);
    if (at < 0) return null;
    next.splice(after ? at + 1 : at, 0, srcId);
    return next;
  }

  /** `id` moved `delta` places in `values`, or `null` when it is missing
   *  or would leave the list. */
  function shiftList(values, id, delta) {
    const from = values.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= values.length) return null;
    const next = [...values];
    next.splice(to, 0, next.splice(from, 1)[0]);
    return next;
  }

  window.OMP_DRAG_REORDER = { DRAG_THRESHOLD_PX, EDGE_SCROLL_MAX_PX, pastThreshold, dropSlot, edgeScroll, reorderList, shiftList };
})();
