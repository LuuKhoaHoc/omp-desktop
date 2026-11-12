/* ═════════════════════════════════════════════════════════════════════
   files/file-editor.jsx — the files panel's editor
   (docs/architecture/file-comments.md, "Editing"): a plain <textarea>
   over the whole file. Uncontrolled: the text lives in the DOM and goes
   to the hook through `onInput`, so typing re-renders nothing.

   Props: { initial, unit, saving, onInput, onSave }
     initial — the text to start from (read once, at mount)
     unit    — one indent step (OMP_FILE_EDIT.indentUnit)
     saving  — a save is running: the text is read-only meanwhile
     onInput — text → void
     onSave  — ⌘/Ctrl+S
   Tab / Shift+Tab indent through `insertText`, so they are undo steps
   (a webview that refuses the command gets `setRangeText`, without undo);
   Esc leaves the field (Tab would otherwise trap the keyboard in it) and
   is prevented, so the app keymap's interrupt never fires from here.
   ═════════════════════════════════════════════════════════════════════ */
const { indent: _FE_indent } = window.OMP_FILE_EDIT;

function FileEditor({ initial, unit, saving, onInput, onSave }) {
  const ref = React.useRef(null);
  const start = React.useRef(initial);
  React.useEffect(() => { ref.current.focus({ preventScroll: true }); }, []);
  const onKeyDown = (e) => {
    if (e.nativeEvent.isComposing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      onSave();
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); e.currentTarget.blur(); return; }
    if (e.key !== "Tab" || mod || e.altKey || saving) return;
    e.preventDefault();
    const el = e.currentTarget;
    const step = _FE_indent(el.value, el.selectionStart, el.selectionEnd, unit, e.shiftKey);
    if (!step) return;
    el.setSelectionRange(step.from, step.to);
    if (!document.execCommand("insertText", false, step.text)) {
      el.setRangeText(step.text, step.from, step.to, "end");
      onInput(el.value);
    }
    el.setSelectionRange(step.start, step.end);
  };
  return (
    <textarea ref={ref} className="fc-editor mono selectable" defaultValue={start.current} readOnly={saving}
      spellCheck={false} wrap="off" autoCapitalize="off" autoCorrect="off" autoComplete="off"
      aria-label={OMP_TR("file text")}
      onInput={e => onInput(e.currentTarget.value)} onKeyDown={onKeyDown} />
  );
}

window.FileEditor = FileEditor;
