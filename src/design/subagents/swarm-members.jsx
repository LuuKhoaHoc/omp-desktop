/* subagents/swarm-members.jsx — the swarm pane's Members tab: the main agent
   as Coordinator (always, once there is a swarm) and its advisor as Monitor
   (once it gave a note), then every agent the manager holds, grouped Active /
   Finished / Stopped (OMP_SUBAGENTS `membersByGroup`). A row is the member's
   tile, its name, what it is doing or was asked, the newest post it sent or
   received, and its model. Search narrows by name or task; an agent's row
   opens its inspector. */

const { OMP_SUBAGENTS: _SAM, SaToolChip: _SAM_ToolChip, SaElapsed: _SAM_Elapsed,
  saLeafName: _SAM_leaf, saModelName: _SAM_model, SwarmAvatar: _SAM_Av, Icon: _SAM_Icon } = window;

const SAM_GROUPS = [["active", "Active"], ["finished", "Finished"], ["stopped", "Stopped"]];

function samFailureLine(a) {
  const err = [...a.stream].reverse().find(l => l.kind === "error");
  if (err) return `${err.tool} failed`;
  return a.progress?.recentOutput?.[0] ?? ""; // omp sends recentOutput newest-first
}

const samMatches = (a, q) => !q || `${_SAM_leaf(a.id)} ${a.agent ?? ""} ${a.description ?? ""} ${a.task ?? ""}`.toLowerCase().includes(q);

function samState(a) {
  if (a.unknownOutcome) return OMP_TR("ended");
  return { pending: OMP_TR("queued"), running: OMP_TR("running"), completed: OMP_TR("done"), failed: OMP_TR("failed"), aborted: OMP_TR("aborted") }[a.status] ?? a.status;
}

function SwarmMemberRow({ agent: a, last, now, onSelect }) {
  const p = a.progress;
  const failure = a.status === "failed" ? samFailureLine(a) : "";
  const doing = a.status === "running" && p?.currentTool;
  return (
    <button type="button" className={`sw-member ${a.status}`} onClick={() => onSelect(a.id)}>
      <_SAM_Av name={a.id} size={52} status={a.status} busy={a.status === "running"} />
      <div className="sw-member-main">
        <div className="sw-member-top">
          <span className="sw-member-name">@{_SAM_leaf(a.id)}</span>
          <span className={`sw-state ${a.status}`}>{samState(a)}</span>
          {p?.resolvedModel && <span className="sw-model" title={p.resolvedModel}>{_SAM_model(p.resolvedModel)}</span>}
        </div>
        {(a.description || a.task) && <div className="sw-member-line sw-ellipsis">{a.description ?? a.task}</div>}
        {doing ? (
          <div className="sw-member-doing">
            <_SAM_ToolChip tool={p.currentTool} running />
            <span className="sw-ellipsis">{p.lastIntent || p.currentToolArgs}</span>
          </div>
        ) : (
          last && (
            <div className="sw-member-last sw-ellipsis" title={last.body}>
              <span className="sw-meta">#{last.n}</span> @{last.from}
              <span className="sw-arrow"><_SAM_Icon name="arrow" size={9} aria-hidden="true" /></span> @{last.to} {last.body}
            </div>
          )
        )}
        {failure && <div className="sw-member-err sw-ellipsis" title={failure}>{failure}</div>}
        <div className="sw-member-foot">
          {a.agent && a.agent !== "task" && <span>{a.agent}</span>}
          <_SAM_Elapsed agent={a} now={now} />
          <span>{window.formatTokens(p?.tokens ?? 0)} tok</span>
          <span>{_SAM.fmtCost(p?.cost ?? 0)}</span>
          <span>{p?.toolCount ?? 0} {OMP_TR("tools")}</span>
        </div>
      </div>
    </button>
  );
}

function SwarmMembers({ state, now, onSelect }) {
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();
  const groups = _SAM.membersByGroup(state);
  const posts = _SAM.boardPosts(state);
  const t = _SAM.totals(_SAM.listAgents(state));
  // The main agent that runs the swarm, and its advisor once it has given a note.
  const coord = _SAM.coordinatorOf(state);
  const monitor = coord && _SAM.monitorOf(state);
  const showCoord = coord && coord.name.toLowerCase().includes(q);
  const showMonitor = monitor && monitor.name.toLowerCase().includes(q);
  const coordLast = coord && _SAM.lastPostOf(posts, coord.name);
  if (t.total === 0 && !coord) {
    return (
      <div className="sa-empty" style={{ padding: "24px 8px", textAlign: "center" }}>
        {OMP_TR("No subagents in this session yet.")}<br />{OMP_TR("They appear here the moment a")} <span className="mono">{OMP_TR("task")}</span> {OMP_TR("call spawns them.")}
      </div>
    );
  }
  return (
    <div className="sw-members">
      <label className="sw-searchbox">
        <_SAM_Icon name="search" size={14} color="var(--fg-3)" aria-hidden="true" />
        <input type="search" className="sw-search" value={query} placeholder={OMP_TR("Search members")}
          aria-label={OMP_TR("Search members")} onChange={e => setQuery(e.target.value)} />
      </label>
      <div className="sw-sum">
        {window.formatTokens(t.tokens)} tok · {_SAM.fmtCost(t.cost)} · {t.tools} {OMP_TR("tools")} · {t.requests} {OMP_TR("requests")}
      </div>
      {(showCoord || showMonitor) && (
        <section className="sw-group sw-coord">
          {showCoord && (
            <div className="sw-member static">
              <_SAM_Av name={coord.name} size={52} coord busy={groups.active.length > 0} />
              <div className="sw-member-main">
                <div className="sw-member-top">
                  <span className="sw-member-name">@{coord.name}</span>
                  <span className="sw-state">{OMP_TR("Coordinator")}</span>
                </div>
                {coordLast && (
                  <div className="sw-member-last sw-ellipsis" title={coordLast.body}>
                    <span className="sw-meta">#{coordLast.n}</span> @{coordLast.from}
                    <span className="sw-arrow"><_SAM_Icon name="arrow" size={9} aria-hidden="true" /></span> @{coordLast.to} {coordLast.body}
                  </div>
                )}
                <div className="sw-member-foot"><span>{OMP_TR("{sent} sent, {received} received", { sent: coord.sent, received: coord.received })}</span></div>
              </div>
            </div>
          )}
          {showMonitor && (
            <div className="sw-member static">
              <_SAM_Av name={monitor.name} size={52} />
              <div className="sw-member-main">
                <div className="sw-member-top">
                  <span className="sw-member-name">@{monitor.name}</span>
                  <span className="sw-state">{OMP_TR("Monitor")}</span>
                </div>
                <div className="sw-member-last sw-ellipsis" title={monitor.last.note}>
                  {monitor.last.severity && <span className="sw-meta">{monitor.last.severity}</span>} {monitor.last.note}
                </div>
                <div className="sw-member-foot"><span>{window.OMP_I18N.plural(monitor.count, "{n} note", "{n} notes", { n: monitor.count })}</span></div>
              </div>
            </div>
          )}
        </section>
      )}
      {SAM_GROUPS.map(([key, label]) => {
        const rows = groups[key].filter(a => samMatches(a, q));
        return rows.length > 0 && (
          <section key={key} className="sw-group">
            <h3 className="sw-group-title">{OMP_TR(label)} <span className="sw-count">{rows.length}</span></h3>
            {rows.map(a => (
              <SwarmMemberRow key={a.id} agent={a} now={now} onSelect={onSelect} last={_SAM.lastPostOf(posts, a.id)} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

Object.assign(window, { SwarmMembers });
