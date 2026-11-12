/* exit-motion.js — the leaving half of motion.css. React removes a closed
   surface at once, so nothing can animate out of the tree; this module puts
   a non-interactive copy (`.motion-ghost`) back where the surface stood and
   lets motion.css play its exit, then drops the copy. Mount sites stay as
   they are: a surface is covered by being listed in EXIT_SELECTOR here and
   given a `.motion-ghost` rule in motion.css (tests/test-exit-motion.mjs
   keeps the two in step).

   - A copy needs the surface's last box, and a removed node has none, so
     every listed surface is measured while mounted (ResizeObserver, plus
     after each of its own animations, whose translate/scale would skew the
     first measure). The copy is `position: fixed` on that box: it never
     takes a grid track or shifts a sibling.
   - Only the outermost listed surface of a removed subtree is copied (a
     scrim carries its dialog).
   - `hidden` toggled on a listed surface (the terminal panel stays mounted)
     counts as a removal.
   - Copies are `inert` and `aria-hidden`, lose their ids, keep canvas
     pixels; one is dropped at its animation's end or after 600ms.
   - Reduced motion or a hidden document: nothing is copied.
   - A tab switch swaps whole surfaces (the other tab's side pane, its
     transcript) and is not something opening or closing: `quietSwitch` puts
     `tab-switching` on <html> for SWITCH_QUIET_MS, during which nothing is
     copied and motion.css runs the entrances with no duration. */
(function () {
  const EXIT_SELECTOR = [
    ".bridge-scrim", ".kanban-scrim", ".gitb-scrim", ".fp-scrim", ".wp-drawer-scrim",
    ".ask-dialog", ".close-confirm-panel",
    ".profile-pop", ".thinking-pop", ".tab-group-pop", ".branch-pop", ".st-menu", ".font-pick-pop",
    ".ip-new-menu", ".pr-changes-menu", ".mention-pop", ".slash-pop", ".browser-popover", ".quote-pop", ".wp-view-pop", ".wp-filter-pop",
    ".rail", ".split", ".wp-panel", ".tree-drawer", ".browser-dock", ".wp-drawer", ".project-sidebar",
    ".term-panel", ".tb-sub", ".tab",
  ].join(", ");
  const MAX_LIFE_MS = 600;
  const SWITCH_CLASS = "tab-switching";
  // Longer than any entrance (the transcript rows' 320ms), so a surface
  // that arrived with the switch has finished when the class goes.
  const SWITCH_QUIET_MS = 400;

  const switching = doc => doc.documentElement.classList.contains(SWITCH_CLASS);

  /** Marks `doc` as switching tabs for `ms`. Returns a cancel for the
   *  timer only: the class stays for the switch that follows (which calls
   *  this again), so a run of quick switches is quiet throughout. */
  function quietSwitch(doc, ms = SWITCH_QUIET_MS) {
    const win = doc.defaultView;
    doc.documentElement.classList.add(SWITCH_CLASS);
    const timer = win.setTimeout(() => doc.documentElement.classList.remove(SWITCH_CLASS), ms);
    return () => win.clearTimeout(timer);
  }

  /** The listed surfaces in a removed subtree, outermost only. Pure over
   *  the Element API (`matches`, `querySelectorAll`, `parentElement`). */
  function outermost(root, selector = EXIT_SELECTOR) {
    if (root.matches(selector)) return [root];
    return Array.from(root.querySelectorAll(selector)).filter(el => {
      for (let p = el.parentElement; p && p !== root; p = p.parentElement) if (p.matches(selector)) return false;
      return true;
    });
  }

  /** Inline style for a copy standing on `rect`; null when there is no box. */
  function ghostStyle(rect) {
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
    return {
      position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`,
      margin: "0", zIndex: "2147483000", pointerEvents: "none",
    };
  }

  function install(doc) {
    const win = doc.defaultView;
    const rects = new WeakMap();
    const measure = el => { if (el.isConnected && !el.hidden) rects.set(el, el.getBoundingClientRect()); };
    const sizes = new win.ResizeObserver(entries => { for (const e of entries) measure(e.target); });
    const quiet = () => doc.hidden || switching(doc) || win.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const track = node => {
      if (node.nodeType !== 1) return;
      if (node.matches(EXIT_SELECTOR)) sizes.observe(node);
      for (const el of node.querySelectorAll(EXIT_SELECTOR)) sizes.observe(el);
    };

    function ghost(el, parent, before) {
      const style = ghostStyle(rects.get(el));
      if (!style || !parent.isConnected) return;
      const copy = el.cloneNode(true);
      copy.hidden = false;
      copy.removeAttribute("id");
      for (const n of copy.querySelectorAll("[id]")) n.removeAttribute("id");
      copy.classList.add("motion-ghost");
      copy.setAttribute("aria-hidden", "true");
      copy.inert = true;
      Object.assign(copy.style, style);
      const from = el.querySelectorAll("canvas");
      copy.querySelectorAll("canvas").forEach((c, i) => {
        try { if (from[i].width && from[i].height) c.getContext("2d")?.drawImage(from[i], 0, 0); } catch { /* webgl or tainted: blank */ }
      });
      parent.insertBefore(copy, before && before.parentNode === parent ? before : null);
      // An ancestor with a transform or containment (a size container) is the containing block of a fixed box: shift by the miss.
      const at = copy.getBoundingClientRect(), want = rects.get(el);
      if (at.left !== want.left || at.top !== want.top) {
        copy.style.left = `${2 * want.left - at.left}px`;
        copy.style.top = `${2 * want.top - at.top}px`;
      }
      const drop = () => copy.remove();
      copy.addEventListener("animationend", e => { if (e.target === copy) drop(); });
      win.setTimeout(drop, MAX_LIFE_MS);
    }

    new win.MutationObserver(records => {
      for (const r of records) {
        if (r.type === "attributes") {
          const el = r.target;
          if (el.hidden && r.oldValue === null && el.matches(EXIT_SELECTOR) && !quiet()) ghost(el, el.parentNode, el.nextSibling);
          else if (!el.hidden) win.requestAnimationFrame(() => measure(el));
          continue;
        }
        for (const node of r.removedNodes) {
          if (node.nodeType !== 1 || node.isConnected || node.classList.contains("motion-ghost") || quiet()) continue;
          for (const el of outermost(node)) ghost(el, r.target, r.nextSibling);
        }
        r.addedNodes.forEach(track);
      }
    }).observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"], attributeOldValue: true });

    doc.addEventListener("animationend", e => { if (rects.has(e.target)) measure(e.target); }, true);
    track(doc.body);
  }

  window.OMP_EXIT_MOTION = { EXIT_SELECTOR, SWITCH_QUIET_MS, outermost, ghostStyle, switching, quietSwitch, install };
  if (typeof document !== "undefined" && document.body && typeof ResizeObserver !== "undefined") install(document);
})();
