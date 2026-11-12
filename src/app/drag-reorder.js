// Drag-to-reorder geometry (issue #40): where a dragged tab-bar item or
// sidebar row would land. Pure; the pointer handling around it is
// `design/ui/use-drag-reorder.js`, the reorder itself `OMP_PROJECT_NAV`'s
// `moveGroup` / `moveMember`.
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

  /** Drop position for item `srcId` inside a wrapped multi-row flex list
   *  (`items` in DOM order, each `{ id, left, right, top, bottom }`). Picks
   *  the visual row closest to `y`, then the horizontal slot on that row so
   *  the indicator stays on the row under the pointer. */
  function dropSlotWrap(items, srcId, x, y) {
    const from = items.findIndex(it => it.id === srcId);
    if (from < 0) return null;
    const rows = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const last = rows[rows.length - 1];
      if (last && it.top < last.bottom && it.bottom > last.top) {
        last.top = Math.min(last.top, it.top);
        last.bottom = Math.max(last.bottom, it.bottom);
        last.items.push({ item: it, index: i });
      } else {
        rows.push({ top: it.top, bottom: it.bottom, items: [{ item: it, index: i }] });
      }
    }
    let row = rows[0];
    let bestDist = Infinity;
    let bestMidDist = Infinity;
    for (const r of rows) {
      const dist = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      const midDist = Math.abs(y - (r.top + r.bottom) / 2);
      if (dist < bestDist || (dist === bestDist && midDist < bestMidDist)) {
        row = r;
        bestDist = dist;
        bestMidDist = midDist;
      }
    }
    const k = row.items.findIndex(({ item }) => x < (item.left + item.right) / 2);
    const slot = k >= 0 ? row.items[k].index : row.items[row.items.length - 1].index + 1;
    if (slot === from || slot === from + 1) return null;
    return k >= 0
      ? { targetId: row.items[k].item.id, after: false }
      : { targetId: row.items[row.items.length - 1].item.id, after: true };
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

  window.OMP_DRAG_REORDER = { DRAG_THRESHOLD_PX, pastThreshold, dropSlot, dropSlotWrap, reorderList };
})();
