/* Swarm visibility belongs to each chat tab. The stored tweak is only the
   initial preference; toolbar and inspect actions never change other tabs. */

function useSubagentManager({ bridge, defaultOpen, layout, setTweak, activeSessionId, sessionIds, subagents, messages, setHoveredMsgIdx }) {
  const [panes, setPanes] = React.useState({});
  const seenIds = React.useRef(new Set());
  const { entryOf, updateEntry, pruneEntries, seedEntries } = window.OMP_SESSION_UI;
  const paneOpen = Boolean(activeSessionId && entryOf(panes, activeSessionId, defaultOpen));
  React.useEffect(() => {
    const fresh = sessionIds.filter(id => !seenIds.current.has(id));
    seenIds.current = new Set(sessionIds);
    setPanes(m => seedEntries(pruneEntries(m, sessionIds), fresh, undefined, defaultOpen));
  }, [sessionIds, defaultOpen]);
  const setPaneOpen = React.useCallback(on => {
    setPanes(m => updateEntry(m, activeSessionId, undefined, () => on));
  }, [activeSessionId]);
  React.useEffect(() => {
    if (layout === "split") { setTweak("layout", "rail"); setPaneOpen(true); }
  }, [layout, setTweak, setPaneOpen]);
  const [selectedId, setSelectedId] = React.useState(null);

  // The selection is only meaningful while the manager holds that agent: a
  // tab switch, `/new` or a profile respawn (same tab id, fresh process)
  // all drop it. Everything downstream keys off `selected`, never the id.
  const selected = selectedId != null ? window.OMP_SUBAGENTS.getAgent(subagents, selectedId) ?? null : null;
  React.useEffect(() => { setSelectedId(null); }, [activeSessionId]);
  React.useEffect(() => { if (selectedId != null && !selected) setSelectedId(null); }, [selectedId, selected]);

  // The full event stream ("events") is only worth paying for while an
  // agent is actually on screen in the inspector.
  const inspecting = paneOpen && selected != null;
  React.useEffect(() => { bridge?.setSubagentInspecting(inspecting); }, [bridge, inspecting]);

  // Stable (handed to memoised tool cards as their "inspect" action), so it
  // reads the latest agent map through a ref. A task card also lists agents
  // omp has not started yet (queued on the concurrency limit, or aborted
  // before running) — those open the manager's list, not an empty inspector.
  const subagentsRef = React.useRef(subagents);
  subagentsRef.current = subagents;
  const open = React.useCallback(id => {
    setPaneOpen(true);
    setSelectedId(id != null && window.OMP_SUBAGENTS.getAgent(subagentsRef.current, id) ? id : null);
  }, [setPaneOpen]);
  const togglePane = () => {
    setPaneOpen(!paneOpen);
    if (paneOpen) setSelectedId(null);
  };

  // Scroll the chat to the task call that spawned an agent and flash it via
  // the same highlight the minimap hover uses. A call already trimmed out of
  // the live window (live.js MINIMAP_MAX) has nothing to scroll to.
  const flashRef = React.useRef(null);
  React.useEffect(() => () => clearTimeout(flashRef.current), []);
  const jumpToCall = callId => {
    const idx = messages.findIndex(m => m.kind === "tool" && m._toolCallId === callId);
    if (idx < 0) return;
    // Widen the chat view's window to the row first (app/chat-window.js).
    window.dispatchEvent(new CustomEvent("omp:reveal-msg", { detail: { idx } }));
    requestAnimationFrame(() => document.querySelector(`[data-msg-idx="${idx}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
    setHoveredMsgIdx(idx);
    clearTimeout(flashRef.current);
    flashRef.current = setTimeout(() => setHoveredMsgIdx(h => (h === idx ? null : h)), 1600);
  };

  return {
    paneOpen, selected, select: setSelectedId,
    level: window.OMP_SUBAGENTS.subscriptionLevelFor({ inspecting }),
    open, togglePane, jumpToCall,
  };
}

Object.assign(window, { useSubagentManager });
