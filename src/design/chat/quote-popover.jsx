/* ═════════════════════════════════════════════════════════════════════
   design/chat/quote-popover.jsx — quote the chat into the next message.
   Selecting text in the transcript (`.chat-scroll`) shows a "Comment"
   button by the selection; it opens a small form (the quote, an optional
   comment; ⌘/Ctrl+Enter adds, Escape cancels) whose result goes to
   `onAdd(text, comment)`: app-live.jsx keeps it as a chip above the
   composer (app/chat-quotes.js) until the tab's next send.
   ═════════════════════════════════════════════════════════════════════ */

const _QP_WIDTH = 340;
const _QP_MARGIN = 8;

/** The selected text when the whole selection sits in the transcript
 *  (never in a field), with its on-screen box; else null. */
function _QP_readSelection() {
  const sel = window.getSelection?.();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const el = n => (n?.nodeType === 1 ? n : n?.parentElement);
  const start = el(range.startContainer), end = el(range.endContainer);
  const root = start?.closest(".chat-scroll");
  if (!root || !root.contains(end) || start.closest("textarea, input, [contenteditable]")) return null;
  const text = sel.toString();
  if (!text.trim()) return null;
  const box = range.getBoundingClientRect();
  return { text, box: { left: box.left, top: box.top, bottom: box.bottom } };
}

/** Viewport position of a box `height` tall under the selection, or
 *  over it when there is no room below. */
function _QP_place(box, height) {
  const left = Math.max(_QP_MARGIN, Math.min(box.left, window.innerWidth - _QP_WIDTH - _QP_MARGIN));
  const below = box.bottom + _QP_MARGIN;
  const top = below + height <= window.innerHeight ? below : Math.max(_QP_MARGIN, box.top - height - _QP_MARGIN);
  return { left, top };
}

function ChatQuotePopover({ onAdd }) {
  const [pick, setPick] = React.useState(null); // { text, box }
  const [form, setForm] = React.useState(false);
  const [comment, setComment] = React.useState("");
  const areaRef = React.useRef(null);
  const formRef = React.useRef(false);
  formRef.current = form;

  React.useEffect(() => {
    const onUp = (e) => {
      if (formRef.current || e.target?.closest?.(".quote-pop")) return;
      // After the click lands, so a click that clears the selection reads it cleared.
      setTimeout(() => setPick(_QP_readSelection()), 0);
    };
    const onSelChange = () => {
      if (!formRef.current && window.getSelection()?.isCollapsed) setPick(null);
    };
    const onScroll = () => { if (!formRef.current) setPick(null); };
    document.addEventListener("mouseup", onUp);
    document.addEventListener("keyup", onUp);
    document.addEventListener("selectionchange", onSelChange);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("keyup", onUp);
      document.removeEventListener("selectionchange", onSelChange);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, []);

  React.useEffect(() => { if (form) areaRef.current?.focus(); }, [form]);

  if (!pick) return null;
  const close = () => { setForm(false); setComment(""); setPick(null); };
  const save = () => { onAdd(pick.text, comment); window.getSelection()?.removeAllRanges(); close(); };

  if (!form) {
    return (
      <button type="button" className="quote-pop quote-pop-btn" style={_QP_place(pick.box, 30)}
        // Keep the selection: a mousedown here would otherwise clear it.
        onMouseDown={e => e.preventDefault()}
        onClick={() => setForm(true)}>
        <window.Icon name="edit" size={11} /> Comment
      </button>
    );
  }
  const flat = pick.text.replace(/\s+/g, " ").trim();
  return (
    <div className="quote-pop quote-pop-form" style={{ ..._QP_place(pick.box, 170), width: _QP_WIDTH }}
      role="dialog" aria-label="Comment on the selection">
      <div className="quote-pop-quote">{flat.length > 160 ? `${flat.slice(0, 160)}…` : flat}</div>
      <textarea ref={areaRef} className="quote-pop-area" rows={3} value={comment}
        placeholder="Your comment (optional)…"
        onChange={e => setComment(e.target.value)}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
          if (e.key === "Escape") { e.preventDefault(); close(); }
        }} />
      <div className="quote-pop-foot">
        <span className="quote-pop-hint">goes with your next message</span>
        <button type="button" className="quote-pop-cancel" onClick={close}>Cancel</button>
        <button type="button" className="quote-pop-add" onClick={save}>Add</button>
      </div>
    </div>
  );
}

/** The composer's quote chips: label, × to remove. */
function QuoteChips({ quotes, onRemove }) {
  if (!quotes.length) return null;
  return (
    <div className="browser-chips">
      {quotes.map(q => (
        <span className="paste-chip browser-chip" key={q.id} title={q.quote}>
          <span className="paste-chip-label browser-chip-label">
            <window.Icon name="edit" size={10} />
            <span className="browser-chip-text">{window.OMP_CHAT_QUOTES.label(q)}</span>
          </span>
          <button type="button" className="browser-chip-remove" title="remove quote" aria-label="remove quote"
            onClick={() => onRemove(q.id)}>
            <window.Icon name="close" size={9} />
          </button>
        </span>
      ))}
    </div>
  );
}

Object.assign(window, { ChatQuotePopover, QuoteChips });
