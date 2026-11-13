/* ui/use-drag-reorder.js — pointer drag-to-reorder (#40), shared by the tab
   bar (projects, and a group chip's member list), the project sidebar and
   the Work panel (board columns, on the board and in the view form).

   const reorder = useDragReorder(onDrop):
   - `reorder.onPointerDown` goes on a container; the items inside it carry
     `reorder.itemProps(list, id, axis)` (`axis` "x" or "y"). A press on an
     item becomes a drag once it travels OMP_DRAG_REORDER's threshold, so a
     click still selects. Only items of the same `list` are drop targets: a
     member row never lands among projects.
   - `reorder.dropClass(list, id)` is " reorder-src" for the dragged item,
     " drop-before" / " drop-after" for the slot's neighbour, else "".
   - Releasing over a slot calls `onDrop(list, id, targetId, after)`, in
     display order. The click that release produces is swallowed, so a drop
     never also selects a tab or closes the dropdown. Escape cancels until
     the button is released.
   - A container with `data-reorder-scroll` scrolls its nearest scrolling
     ancestor while the pointer rests near that ancestor's edge
     (OMP_DRAG_REORDER.edgeScroll), for a list longer than its viewport.

   Pointer events, not HTML5 drag and drop: they give the click-vs-drag
   threshold, Escape and capture without the browser's drag image. The
   pointer is captured on the item, so a release outside the window still
   ends the drag. Wrapped as an IIFE (AGENTS.md "IIFE rule"). */

(function () {
  const { pastThreshold, dropSlot, edgeScroll } = window.OMP_DRAG_REORDER;
  // Controls inside an item that keep their own press. `data-no-reorder`
  // marks a region inside an item (a dropdown, a column's cards) that only
  // its own nested items may drag from.
  const NO_DRAG = "input, textarea, .tab-close, .tab-cluster-new, .psb-act, [data-no-reorder]";

  function span(el, axis) {
    const r = el.getBoundingClientRect();
    return axis === "y"
      ? { id: el.dataset.reorderId, start: r.top, end: r.bottom }
      : { id: el.dataset.reorderId, start: r.left, end: r.right };
  }
  /** The nearest ancestor of `el` that can scroll on `axis` right now. */
  function scrollerOf(el, axis) {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const style = getComputedStyle(n);
      const overflow = axis === "y" ? style.overflowY : style.overflowX;
      const room = axis === "y" ? n.scrollHeight - n.clientHeight : n.scrollWidth - n.clientWidth;
      if (room > 0 && (overflow === "auto" || overflow === "scroll")) return n;
    }
    return null;
  }
  function useDragReorder(onDrop) {
    // `{ list, id, targetId, after }` while a drag is past the threshold.
    const [drag, setDrag] = React.useState(null);
    const onDropRef = React.useRef(onDrop);
    onDropRef.current = onDrop;
    const endRef = React.useRef(null);
    React.useEffect(() => () => endRef.current?.(), []);

    const onPointerDown = React.useCallback(e => {
      if (e.button !== 0 || !e.isPrimary || endRef.current) return;
      const container = e.currentTarget;
      const item = e.target.closest("[data-reorder-id]");
      if (!item || !container.contains(item)) return;
      const stop = e.target.closest(NO_DRAG);
      if (stop && item.contains(stop)) return;
      const { reorderList: list, reorderId: id } = item.dataset;
      const axis = item.dataset.reorderAxis === "y" ? "y" : "x";
      const { pointerId, clientX: x0, clientY: y0 } = e;
      let started = false;
      let cancelled = false;
      let slot = null;
      let at = 0; // the pointer on the drag axis
      let scroller = null;
      let frame = 0;

      const show = next => setDrag(prev => (prev && next && prev.targetId === next.targetId && prev.after === next.after ? prev : next));
      const place = () => {
        const items = [...container.querySelectorAll("[data-reorder-id]")]
          .filter(el => el.dataset.reorderList === list)
          .map(el => span(el, axis));
        slot = dropSlot(items, id, at);
        show({ list, id, targetId: slot ? slot.targetId : null, after: !!slot?.after });
      };
      // The pointer rests near the scroller's edge: the list moves under it
      // a step per frame, and the slot follows, until the scroller is at its
      // end or the pointer leaves the edge.
      const creep = () => {
        frame = 0;
        if (cancelled) return;
        const r = scroller.getBoundingClientRect();
        const step = axis === "y" ? edgeScroll(at, r.top, r.bottom) : edgeScroll(at, r.left, r.right);
        if (!step) return;
        const prop = axis === "y" ? "scrollTop" : "scrollLeft";
        const from = scroller[prop];
        scroller[prop] = from + step;
        if (scroller[prop] === from) return;
        place();
        frame = requestAnimationFrame(creep);
      };
      const move = ev => {
        if (ev.pointerId !== pointerId || cancelled) return;
        if (!started) {
          if (!pastThreshold(ev.clientX - x0, ev.clientY - y0)) return;
          started = true;
          try { item.setPointerCapture(pointerId); } catch (_) { /* pointer already gone */ }
          document.body.classList.add("reordering");
          window.getSelection()?.removeAllRanges();
          if ("reorderScroll" in container.dataset) scroller = scrollerOf(container, axis);
        }
        at = axis === "y" ? ev.clientY : ev.clientX;
        place();
        if (scroller && !frame) frame = requestAnimationFrame(creep);
      };
      const end = () => {
        cancelAnimationFrame(frame);
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        window.removeEventListener("pointercancel", lost, true);
        window.removeEventListener("keydown", key, true);
        item.removeEventListener("lostpointercapture", lost);
        try { if (item.hasPointerCapture(pointerId)) item.releasePointerCapture(pointerId); } catch (_) { /* detached */ }
        document.body.classList.remove("reordering");
        endRef.current = null;
        setDrag(null);
      };
      const up = ev => {
        if (ev.pointerId !== pointerId) return;
        end();
        if (!started) return;
        const swallow = c => { c.stopPropagation(); c.preventDefault(); };
        window.addEventListener("click", swallow, true);
        // The release's click, if any, is dispatched before this runs.
        setTimeout(() => window.removeEventListener("click", swallow, true), 0);
        if (!cancelled && slot) onDropRef.current(list, id, slot.targetId, slot.after);
      };
      // Capture lost (the item unmounted) or the gesture cancelled: no drop.
      const lost = ev => { if (ev.pointerId === pointerId) end(); };
      const key = ev => {
        if (ev.key !== "Escape" || !started) return;
        // Before the window keymap, which would interrupt the turn.
        ev.preventDefault();
        ev.stopPropagation();
        cancelled = true;
        slot = null;
        show(null);
      };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
      window.addEventListener("pointercancel", lost, true);
      window.addEventListener("keydown", key, true);
      item.addEventListener("lostpointercapture", lost);
      endRef.current = end;
    }, []);

    const itemProps = (list, id, axis) => ({
      "data-reorder-list": list, "data-reorder-id": id, "data-reorder-axis": axis,
    });
    const dropClass = (list, id) => {
      if (!drag || drag.list !== list) return "";
      if (drag.id === id) return " reorder-src";
      if (drag.targetId === id) return drag.after ? " drop-after" : " drop-before";
      return "";
    };
    return { onPointerDown, itemProps, dropClass };
  }

  window.useDragReorder = useDragReorder;
})();
