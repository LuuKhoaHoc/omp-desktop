// Runs in the annotate overlay's isolated world of every document the panel
// shows. Reports what the page puts on its clipboard to the app, which is
// the only way out: headless Chromium has a clipboard of its own.
//
// - a `copy` / `cut` event (Ctrl+C, `document.execCommand("copy")`): the text
//   a handler set, or the selection when none took the event over;
// - `page.js`'s event for `navigator.clipboard.writeText` / `write`, which
//   fire no copy event, and for the text a copy handler sets (readable here
//   only if the event still reaches the window). A page can forge that one; it may write the
//   clipboard anyway, and Rust only listens right after a gesture the panel
//   sent.
(() => {
  if (window.__ompCopyBridge) return;
  window.__ompCopyBridge = true;
  const MAX = 1 << 20; // UTF-16 units; Rust bounds the bytes again
  const report = (text) => {
    if (typeof text !== "string" || !text || text.length > MAX) return;
    try { window.__ompClipboard(text); } catch {}
  };

  // What a copy takes when no handler sets the data: the document
  // selection, which reads empty while it is inside a field; then the
  // focused field's selected text (never a password's).
  const selected = () => {
    const text = String(window.getSelection() || "");
    if (text) return text;
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    if (a && (a.tagName === "TEXTAREA" || a.tagName === "INPUT")) {
      if (a.type === "password") return "";
      try {
        if (typeof a.selectionStart === "number") return a.value.slice(a.selectionStart, a.selectionEnd);
      } catch {}
    }
    return "";
  };

  // Capture on window runs before the page's handlers, bubble on window
  // after them: the data a handler set is readable only while the event is
  // dispatched. A handler that stops propagation leaves the timer, with
  // the selection or what `page.js` saw the handler set.
  let open = null;
  const begin = (e) => {
    const mine = { e, text: selected(), set: "" };
    open = mine;
    setTimeout(() => {
      if (open !== mine) return;
      open = null;
      report(e.defaultPrevented ? mine.set : mine.text);
    }, 0);
  };
  const end = (e) => {
    if (!open || open.e !== e) return;
    const { text } = open;
    open = null;
    let set = "";
    try { set = e.clipboardData.getData("text/plain"); } catch {}
    report(e.defaultPrevented ? set : text);
  };
  for (const type of ["copy", "cut"]) {
    window.addEventListener(type, begin, true);
    window.addEventListener(type, end, false);
  }
  window.addEventListener("__omp-clipboard-write", (e) => {
    if (open && typeof e.detail === "string") open.set = e.detail;
    else report(e.detail);
  }, true);
})();
