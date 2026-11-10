/* chat/user-bubble.jsx — user-side bubble, right-aligned. */
const { ImageThumbs: _UB_ImageThumbs, Icon: _UB_Icon } = window;

// `onEdit(msg)` (fork): go back to just before this prompt and put its
// text in the composer. Off while the tab streams and for a bubble omp has
// not echoed yet (no `ts`).
function UserBubble({ msg, idx, highlighted, onEdit }) {
  const can = !!onEdit && msg.ts != null;
  return (
    <div className={`row user fade-up${highlighted ? " mm-hot" : ""}`} data-msg-idx={idx}>
      <div className="user-bubble selectable">
        <div className="user-meta">
          <span className="mono" style={{ color: "var(--fg-4)" }}>{msg.time}</span>
          <span className="chip muted">you</span>
          {can && (
            <span className="user-actions">
              <button className="user-act" title="Edit: go back to before this message and put it in the prompt box (the later turns stay in the conversation tree)"
                onClick={() => onEdit(msg)}><_UB_Icon name="edit" size={11} /><span>Edit</span></button>
            </span>
          )}
        </div>
        <_UB_ImageThumbs images={msg.images} className="user-images" alt="attached image" />
        {msg.text && <div className="user-text">{msg.text}</div>}
      </div>
    </div>
  );
}

Object.assign(window, { UserBubble });
