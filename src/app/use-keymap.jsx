/* app/use-keymap.jsx — load keybindings from the backend, drive the
   resolver, and install the global dispatch listener.

   useKeymap(bridge, profileId)
     → { payload, conflicts, error, overlayPath, reload, setBinding, resetBinding }

   useKeymapDispatch(handlersRef)
     — installs one window keydown listener; reads handlers through a ref
       so the effect never re-subscribes when handlers change.

   useTabNumberHint()
     — shows the tab lists' "go to tab N" numbers while the chord's
       modifier is held. */

function useKeymap(bridge, profileId) {
  const [payload,   setPayload]   = React.useState(null);
  const [conflicts, setConflicts] = React.useState([]);
  const [error,     setError]     = React.useState(null);
  // Cache the last-known overlay path so the error banner can print it even
  // if the most recent load failed (corrupt file → null payload).
  const overlayPathRef = React.useRef(null);
  // Whether a payload has ever loaded successfully — gates the null-payload
  // branch below between "nothing to fall back on yet" (seed registry
  // defaults) and "a later reload failed" (keep the last-good resolution).
  const hasResolvedRef = React.useRef(false);
  // Reload/setBinding/resetBinding generation counter — guards against an
  // in-flight request applying a stale result after a newer one started
  // (tab/profile switch mid-await, or a mutation racing a reload). See the
  // comments at each call site below.
  const genRef = React.useRef(0);

  const applyPayload = React.useCallback((p) => {
    if (!p) {
      if (!hasResolvedRef.current) {
        // First-ever load failed: no prior resolution exists to fall back
        // on, so seed dispatch with registry defaults rather than leaving
        // it with nothing bound at all.
        const r = window.OMP_KEYMAP.resolve(window.OMP_KEYMAP.KEYMAP_ACTIONS, {});
        window.OMP_KEYMAP.setResolved(r);
        setConflicts(r.conflicts);
        setPayload(null);
      }
      // Else: keep the last-good resolution, `payload`, and `conflicts`
      // live — only surface the error banner. The Shortcuts editor reloads
      // each time it is shown, so a transient IPC failure must not revert dispatch
      // to registry defaults or blank the footer's omp/overlay path info
      // until the next successful reload.
      setError("Keybinding configuration could not be loaded.");
      return;
    }
    hasResolvedRef.current = true;
    overlayPathRef.current = p.overlayPath;
    const config = { ...p.omp, ...p.overlay };
    const r = window.OMP_KEYMAP.resolve(window.OMP_KEYMAP.KEYMAP_ACTIONS, config);
    window.OMP_KEYMAP.setResolved(r);
    setPayload(p);
    setConflicts(r.conflicts);
    // A malformed/unreadable overlay doesn't fail the whole payload (the omp
    // layer above is still valid, per mod.rs::payload's contract) — it comes
    // back as `overlayError` instead. Surface it as the hook's `error` so the
    // Shortcuts editor's banner + disabled-buttons gate actually fires for it,
    // not just for a total load failure.
    setError(p.overlayError ?? null);
  }, []);

  const reload = React.useCallback(async () => {
    if (!bridge) return;
    const gen = ++genRef.current;
    const result = await bridge.listKeybindings();
    if (gen !== genRef.current) return; // stale — a newer reload started, discard
    applyPayload(result);
  }, [bridge, applyPayload]);

  React.useEffect(() => {
    reload();
  }, [bridge, profileId]); // eslint-disable-line react-hooks/exhaustive-deps

  const setBinding = React.useCallback(async (action, keys) => {
    if (!bridge) return "no bridge";
    // Capture the generation *before* awaiting: if a newer reload (e.g. a
    // tab/profile switch) starts while this write is in flight, applying
    // this call's payload afterward would show tab A's profile on tab B's
    // screen. The write itself already landed on disk regardless — only the
    // local apply is guarded, so re-sync via `reload()` instead of
    // overwriting whatever profile is now active.
    const gen = genRef.current;
    const res = await bridge.setKeybinding(action, keys);
    if (!res.ok) return res.error;
    if (gen === genRef.current) {
      // Bump generation so any in-flight reload() response (started before
      // this call) is discarded — the mutation result is authoritative.
      ++genRef.current;
      applyPayload(res.value);
    } else {
      reload();
    }
    return null;
  }, [bridge, applyPayload, reload]);

  const resetBinding = React.useCallback(async (action) => {
    if (!bridge) return "no bridge";
    const gen = genRef.current;
    const res = await bridge.resetKeybinding(action);
    if (!res.ok) return res.error;
    if (gen === genRef.current) {
      ++genRef.current;
      applyPayload(res.value);
    } else {
      reload();
    }
    return null;
  }, [bridge, applyPayload, reload]);

  return {
    payload,
    conflicts,
    error,
    overlayPath: payload?.overlayPath ?? overlayPathRef.current ?? null,
    reload,
    setBinding,
    resetBinding,
  };
}

function useKeymapDispatch(handlersRef) {
  // Single [] effect: the handler map is read through a ref, so we never
  // re-subscribe when individual handlers change — avoids listener churn on
  // every render.
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented) return;
      const chord = window.OMP_KEYMAP.chordFromEvent(e);
      if (!chord) return;
      const id = window.OMP_KEYMAP.lookup(chord);
      const handler = id ? handlersRef.current?.[id] : null;
      if (!handler) {
        // Undo / redo in a text field, unless an action took the chord
        // (keymap.js editCommand). A guest's field never gets here: xterm
        // and the browser page's sink cancel the keys they forward.
        const edit = window.OMP_KEYMAP.isTypingTarget(e.target)
          ? window.OMP_KEYMAP.editCommand(e) : null;
        if (edit) {
          e.preventDefault();
          document.execCommand(edit);
        }
        return;
      }
      if (window.OMP_KEYMAP.isTypingTarget(e.target) &&
          !window.OMP_KEYMAP.allowedInInput(chord)) return;
      // preventDefault unconditionally once a bound handler is found, even
      // on an auto-repeat keydown: this is what actually suppresses the
      // browser/WebView default action (e.g. Shift+Tab moving focus) while
      // the chord is held. Only the *handler* is repeat-guarded below —
      // firing it on every repeat would storm tab-close/tab-new on a held
      // Ctrl+W/Ctrl+T. Order matters: bailing on `e.repeat` before this
      // point would let the repeats fall through un-prevented.
      e.preventDefault();
      if (e.repeat) return;
      handler(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

// Holding the modifier of "go to tab N" (Ctrl by default) shows each tab's
// number in the sidebar and the tab strip: a class on <html>, so nothing
// re-renders. After a pause, so a quick Ctrl+C never flashes them; gone on
// release, on a key that makes it another shortcut (keymap.js
// tabNumberStep) and when the window loses the keyboard. Capture phase: a
// focused terminal or browser page stops the keys it takes.
const _KM_TAB_NUMBERS_MS = 220;
function useTabNumberHint() {
  React.useEffect(() => {
    const root = document.documentElement;
    let timer = null;
    const hide = () => {
      clearTimeout(timer);
      timer = null;
      root.classList.remove("show-tab-numbers");
    };
    const on = down => e => {
      const step = window.OMP_KEYMAP.tabNumberStep(e, down);
      if (step === "hide") hide();
      else if (step === "arm" && timer === null) {
        timer = setTimeout(() => root.classList.add("show-tab-numbers"), _KM_TAB_NUMBERS_MS);
      }
    };
    const onDown = on(true), onUp = on(false);
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("blur", hide);
    };
  }, []);
}

Object.assign(window, { useKeymap, useKeymapDispatch, useTabNumberHint });
