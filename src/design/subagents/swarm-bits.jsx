/* subagents/swarm-bits.jsx — small pieces shared by the swarm pane's three
   tabs: a member's avatar tile, the post-body renderer (inline code and
   `#n` references to other posts) and the clock. */

const { OMP_SUBAGENTS: _SWB, OMP_SWARM_VIEW: _SWB_View, SwarmMascot: _SWB_Mascot } = window;

const swarmClock = t => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const swarmHue = name => ({ "--sa-hue": _SWB.agentHue(name) });

/** A member's tile: its bee in the member's colour (`agentHue`), on a tint of
 *  that colour; `coord` is the coordinator, the amber crowned one. `status`
 *  adds the corner dot (live agents green, failed red, the rest grey) and
 *  `busy` makes the wings beat. */
function SwarmAvatar({ name, size = 40, status, coord = false, busy = false }) {
  const tone = coord ? null : _SWB.agentHue(name);
  return (
    <span className="sw-av-wrap">
      <span className={`sw-av${coord ? " sw-av-coord" : ""}`} style={{ ...(coord ? {} : swarmHue(name)), "--sw-av": `${size / 16}rem` }} aria-hidden="true">
        <_SWB_Mascot size={size} busy={busy} tone={tone} crown={coord} />
      </span>
      {status && <span className={`sw-dot ${status}`} title={status} />}
    </span>
  );
}

/** A post's text: `code` becomes a chip, `#n` a button that jumps to post n
 *  when that post exists. Everything else stays plain text (never HTML). */
function SwarmBody({ text, total, onRef }) {
  return _SWB_View.bodyTokens(text, total).map((t, i) => {
    if (t.kind === "code") return <code key={i} className="sw-code">{t.text}</code>;
    if (t.kind === "ref") return <button key={i} type="button" className="sw-ref" onClick={() => onRef(t.n)}>{t.text}</button>;
    return t.text;
  });
}

Object.assign(window, { SwarmAvatar, SwarmBody, swarmClock, swarmHue });
