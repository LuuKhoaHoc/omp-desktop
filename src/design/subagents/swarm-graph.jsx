/* subagents/swarm-graph.jsx — the swarm pane's Graph tab: who messaged whom.
   Each member is a pill with its status dot, an arrow is one direction of a
   pair, its width and label the post count (OMP_SUBAGENTS `boardEdges`).
   Members that have not posted yet are dimmed. The replay bar shows the
   board as it was after the first N posts: start, step, play, or Live.
   Geometry and the time span live in app/swarm-view.js. */

const { Icon: _SAG_Icon, OMP_SUBAGENTS: _SAG, OMP_SWARM_VIEW: _SAG_View } = window;

const SAG_SPEEDS = [0.5, 1, 2, 4];
const SAG_TRAVEL = 700; // ms for the dot to cross an arrow
const SAG_RING = 320;   // ms for the ring that opens on the receiver

/** One pulse: a dot rides the arrow's curve, then a ring opens where it lands.
 *  Positions are written straight to the SVG nodes, so the loop never renders. */
function SwarmPulse({ curve, onDone }) {
  const dot = React.useRef(null);
  const ring = React.useRef(null);
  React.useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const end = curve.at(1);
    const frame = now => {
      const el = now - t0;
      if (el >= SAG_TRAVEL + SAG_RING) { onDone(); return; }
      if (el < SAG_TRAVEL) {
        const k = el / SAG_TRAVEL;
        const p = curve.at(k * k * (3 - 2 * k));
        dot.current.setAttribute("cx", p.x);
        dot.current.setAttribute("cy", p.y);
        dot.current.setAttribute("opacity", 1);
      } else {
        const k = (el - SAG_TRAVEL) / SAG_RING;
        dot.current.setAttribute("opacity", 0);
        ring.current.setAttribute("cx", end.x);
        ring.current.setAttribute("cy", end.y);
        ring.current.setAttribute("r", 4 + 12 * k);
        ring.current.setAttribute("opacity", 1 - k);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <g aria-hidden="true">
      <circle ref={ring} className="sw-pulse-ring" r="4" opacity="0" />
      <circle ref={dot} className="sw-pulse" r="3.5" opacity="0" />
    </g>
  );
}

function SwarmGraph({ state }) {
  const posts = _SAG.boardPosts(state);
  const [step, setStep] = React.useState(null); // null = live (all posts)
  const [playing, setPlaying] = React.useState(false);
  const [hideInactive, setHideInactive] = React.useState(false);
  const [pacing, setPacing] = React.useState("even");
  const [speed, setSpeed] = React.useState(1);
  const total = posts.length;
  const at = step === null ? total : Math.min(step, total);

  React.useEffect(() => {
    if (!playing) return undefined;
    const id = setTimeout(() => {
      if (at + 1 >= total) { setPlaying(false); setStep(null); } else setStep(at + 1);
    }, _SAG_View.playDelay(posts, at, pacing, speed));
    return () => clearTimeout(id);
  }, [playing, at, total, pacing, speed, posts]);

  // A new post (replay step, or a live arrival) sends one pulse along its arrow.
  const [pulse, setPulse] = React.useState(null);
  const prevAt = React.useRef(at);
  React.useEffect(() => {
    const p = posts[at - 1];
    if (at === prevAt.current + 1 && p && p.from !== p.to && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setPulse({ id: p.key, from: p.from, to: p.to });
    } else if (at !== prevAt.current + 1) setPulse(null);
    prevAt.current = at;
  }, [at]);

  if (total === 0) {
    return <div className="sa-empty">{OMP_TR("No messages yet. Agents that message each other show up here.")}</div>;
  }
  const upTo = posts.slice(0, at);
  const talked = new Set(upTo.flatMap(p => [p.from, p.to]));
  const everyone = [...new Set([..._SAG.listAgents(state).map(a => a.id), ...posts.flatMap(p => [p.from, p.to])])].sort();
  const names = hideInactive ? everyone.filter(n => talked.has(n)) : everyone;
  const pos = _SAG_View.layout(names);
  const edges = _SAG.boardEdges(upTo);
  const max = Math.max(1, ...edges.map(e => e.count));
  const seek = n => { setPlaying(false); setStep(n >= total ? null : Math.max(0, n)); };
  const play = () => { if (playing) { setPlaying(false); return; } if (at >= total) setStep(0); setPlaying(true); };

  return (
    <div className="sw-graph">
      <div className="sw-replay">
        <button type="button" className="sw-icon" onClick={() => seek(0)} aria-label={OMP_TR("Back to the first message")}><_SAG_Icon name="back" size={14} /></button>
        <button type="button" className="sw-icon sw-prev" onClick={() => seek(at - 1)} aria-label={OMP_TR("step back")}><_SAG_Icon name="chev" size={14} /></button>
        <button type="button" className="sw-icon sw-play" onClick={play} aria-label={playing ? OMP_TR("pause") : OMP_TR("play")}><_SAG_Icon name={playing ? "pause" : "play"} size={14} /></button>
        <button type="button" className="sw-icon sw-next" onClick={() => seek(at + 1)} aria-label={OMP_TR("step forward")}><_SAG_Icon name="chev" size={14} /></button>
        <input type="range" className="sw-scrub" min="0" max={total} value={at} onChange={e => seek(Number(e.target.value))} aria-label={OMP_TR("replay")} />
        <button type="button" className="sw-livebtn" aria-pressed={step === null} onClick={() => seek(total)}>
          <span className="sw-live-dot" aria-hidden="true" />{OMP_TR("Live")}
        </button>
      </div>
      <div className="sw-graph-info">
        <span>
          {_SAG_View.span(posts)
            ? OMP_TR("{at}/{total} posts over {time}", { at, total, time: _SAG_View.span(posts) })
            : OMP_TR("{at}/{total} posts", { at, total })}
        </span>
        <label className="sw-switch">
          <input type="checkbox" role="switch" checked={hideInactive} onChange={e => setHideInactive(e.target.checked)} />
          <span className="sw-switch-track" aria-hidden="true" />
          {OMP_TR("Hide silent members")}
        </label>
        <span className="sw-sel">
          <select value={pacing} aria-label={OMP_TR("Replay pacing")} onChange={e => setPacing(e.target.value)}>
            <option value="even">{OMP_TR("Even pacing")}</option>
            <option value="real">{OMP_TR("Real-time pacing")}</option>
          </select>
          <_SAG_Icon name="chev" size={12} aria-hidden="true" />
        </span>
        <span className="sw-sel">
          <select value={speed} aria-label={OMP_TR("Replay speed")} onChange={e => setSpeed(Number(e.target.value))}>
            {SAG_SPEEDS.map(v => <option key={v} value={v}>{v}x</option>)}
          </select>
          <_SAG_Icon name="chev" size={12} aria-hidden="true" />
        </span>
      </div>
      <svg viewBox={`0 0 ${_SAG_View.W} ${_SAG_View.H}`} className="sw-graph-svg" role="img" aria-label={OMP_TR("Graph")}>
        <defs>
          <marker id="sw-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" className="sw-graph-arrow" />
          </marker>
        </defs>
        {edges.map(e => {
          const { d, lx, ly } = _SAG_View.curve(pos[e.from], pos[e.to]);
          return (
            <g key={`${e.from}>${e.to}`} className="sw-graph-edge">
              <path d={d} strokeWidth={1 + (2.5 * e.count) / max} markerEnd="url(#sw-arrow)" />
              {e.count > 1 && <text x={lx} y={ly} className="sw-graph-count" textAnchor="middle" dominantBaseline="central">{e.count}</text>}
            </g>
          );
        })}
        {pulse && pos[pulse.from] && pos[pulse.to] && (
          <SwarmPulse key={pulse.id} curve={_SAG_View.curve(pos[pulse.from], pos[pulse.to])}
            onDone={() => setPulse(p => (p?.id === pulse.id ? null : p))} />
        )}
        {names.map(n => {
          const a = _SAG.getAgent(state, n);
          const w = _SAG_View.pillWidth(n);
          // A dot is a real state: filled while the agent runs (or a non-agent has posted), a ring while it has said nothing yet.
          const live = a ? a.status === "running" || a.status === "pending" : talked.has(n);
          return (
            <g key={n} className={`sw-graph-node${talked.has(n) ? " talked" : ""}${live ? " live" : ""}${a ? ` ${a.status}` : ""}`}
              transform={`translate(${pos[n].x - w / 2},${pos[n].y - _SAG_View.PILL_H / 2})`}>
              <rect width={w} height={_SAG_View.PILL_H} rx={_SAG_View.PILL_H / 2} />
              <circle cx="17" cy={_SAG_View.PILL_H / 2} r="4.5" />
              <text x="30" y={_SAG_View.PILL_H / 2} dominantBaseline="central">{n}</text>
            </g>
          );
        })}
      </svg>
      <div className="sw-legend">
        <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden="true"><path d="M0,4 H15" className="sw-legend-line" /><path d="M14,0.5 L21,4 L14,7.5 z" className="sw-graph-arrow" /></svg>
        <span>{OMP_TR("@mention, width = count")}</span>
        <span>{OMP_TR("A number on an arrow is its post count; no number means one.")}</span>
      </div>
    </div>
  );
}

Object.assign(window, { SwarmGraph });
