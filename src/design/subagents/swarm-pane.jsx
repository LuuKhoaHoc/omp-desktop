/* subagents/swarm-pane.jsx — the swarm pane. Occupies the `.split` column
   (stage.css `.window.is-split`). Three tabs over the subagent state:
   Board (agent-to-agent messages), Members (agents by state) and Graph (who
   messaged whom, with replay). The header's Full view button (or Escape to
   leave) lets it cover the whole stage. Selecting an agent drills into
   SubagentInspector in the same column. Opens on Board once agents have
   talked, else on Members. */

const { Icon: _SWP_Icon, OMP_SUBAGENTS: _SWP, useSaNow: _SWP_useNow, SubagentInspector: _SWP_Inspector,
  SubagentBoard: _SWP_Board, SwarmMembers: _SWP_Members, SwarmGraph: _SWP_Graph } = window;

function SwarmPane({
  state, selected, onSelect, level,
  transcript, onLoadTranscript, onJumpToCall, onSteer, onStop, submitKey = "enter",
}) {
  const all = _SWP.listAgents(state);
  const t = _SWP.totals(all);
  const posts = _SWP.boardPosts(state).length;
  // Live agents need a fast clock; finished ones still show relative times.
  const now = _SWP_useNow(true, t.live > 0 ? 250 : 10_000);
  // Opens on Board when agents have already talked, else Members; it stays
  // there until picked, so a first message never flips the tab under the reader.
  const [tab, setChosen] = React.useState(() => (posts > 0 ? "board" : "members"));
  // Posts the Board has shown: the "New" divider marks what came after.
  const [seen, setSeen] = React.useState(0);
  // Full view: the pane covers the whole stage; Escape (or the button) leaves it.
  const [full, setFull] = React.useState(false);
  React.useEffect(() => {
    if (!full) return undefined;
    const onKey = e => { if (e.key === "Escape" && !e.defaultPrevented) setFull(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);
  const pick = next => {
    if (tab === "board" && next !== "board") setSeen(posts);
    setChosen(next);
  };
  const tabs = [["board", OMP_TR("Board"), posts], ["members", OMP_TR("Members"), t.total], ["graph", OMP_TR("Graph"), null]];
  // Arrow keys, Home and End move between the tabs (the focused one is the only tab stop).
  const onTabKey = e => {
    const i = tabs.findIndex(([key]) => key === tab);
    const next = { ArrowRight: (i + 1) % tabs.length, ArrowLeft: (i + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    pick(tabs[next][0]);
    e.currentTarget.children[next].focus();
  };

  return (
    <aside className={`split sa-pane${full ? " sa-full" : ""}`}>
      <div className="split-head">
        <_SWP_Icon name="agent" size={12} color="var(--fg-3)" />
        <span className="sw-title">{OMP_TR("Swarm")}</span>
        <div style={{ flex: 1 }} />
        <span className={`sw-level ${level}`} title={OMP_TR("RPC subagent subscription level")}>{level}</span>
        <button type="button" className="sw-toggle" aria-pressed={full} onClick={() => setFull(f => !f)}>
          {full ? OMP_TR("Exit full view") : OMP_TR("Full view")}
        </button>
        {t.live > 0 && <span className="sw-live"><span className="sw-live-dot" aria-hidden="true" />{OMP_TR("Live")}</span>}
      </div>

      {selected ? (
        <_SWP_Inspector key={selected.id}
          agent={selected} callId={_SWP.rootCallIdOf(state, selected)} now={now} level={level} transcript={transcript}
          onBack={() => onSelect(null)} onLoadTranscript={onLoadTranscript}
          onJumpToCall={onJumpToCall} onSteer={onSteer} onStop={onStop} submitKey={submitKey} />
      ) : (
        <>
          <div className="sw-tabs" role="tablist" onKeyDown={onTabKey}>
            {tabs.map(([key, label, n]) => (
              <button key={key} type="button" role="tab" id={`sw-tab-${key}`} aria-controls="sw-panel" aria-selected={tab === key}
                tabIndex={tab === key ? 0 : -1} className="sw-tab" onClick={() => pick(key)}>
                {label}{n != null && <span className="sw-count">{n}</span>}
              </button>
            ))}
          </div>
          {tab === "board" ? (
            <div className="sw-panel" id="sw-panel" role="tabpanel" aria-labelledby="sw-tab-board"><_SWP_Board state={state} seen={seen} onSelect={onSelect} /></div>
          ) : (
            <div className="sw-panel sw-panel-scroll" id="sw-panel" role="tabpanel" aria-labelledby={`sw-tab-${tab}`}>
              {tab === "members"
                ? <_SWP_Members state={state} now={now} onSelect={onSelect} />
                : <_SWP_Graph state={state} />}
            </div>
          )}
        </>
      )}
    </aside>
  );
}

Object.assign(window, { SwarmPane });
