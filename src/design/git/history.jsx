/* git/history.jsx — the git browser's right pane: Rust's commit graph of
   every ref (git_browser_log: rows with their lane and the edges to the
   next row) with branch, remote and tag decorations. Its first row ("@")
   stands for the working tree. A click browses that commit; the active row
   is the browsed commit, or the working tree. The find field marks the rows
   whose subject, author, sha or refs match (the graph keeps its rows, so
   nothing is filtered out): the others dim, ↑↓ / Enter step through the
   hits and scroll them into view. */

const { Icon: _GH_Icon } = window;
const { relativeTime: _GH_relativeTime, historyMatches: _GH_matches, stepMatch: _GH_stepMatch } = window.OMP_GIT_BROWSER;

const _GH_ROW = 40;
const _GH_LANE = 14;
const _GH_R = 3.5;
const _GH_COLORS = ["var(--accent)", "var(--cyan)", "var(--lilac)", "var(--amber)", "var(--magenta)", "var(--lime)"];
const _GH_laneColor = lane => _GH_COLORS[lane % _GH_COLORS.length];
const _GH_x = lane => 10 + lane * _GH_LANE;
const _GH_WORKTREE = "@";

function _GH_Graph({ rows, w }) {
  const h = rows.length * _GH_ROW;
  return (
    <svg className="gitb-graph" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {rows.map((r, i) => {
        const y = i * _GH_ROW + _GH_ROW / 2;
        return r.edges.map((e, j) => {
          const x1 = _GH_x(e.from), x2 = _GH_x(e.to), y2 = y + _GH_ROW;
          const color = _GH_laneColor(Math.max(e.from, e.to));
          const d = x1 === x2
            ? `M${x1} ${y}V${y2}`
            : `M${x1} ${y}C${x1} ${y + _GH_ROW * 0.55} ${x2} ${y + _GH_ROW * 0.45} ${x2} ${y2}`;
          return <path key={`${i}-${j}`} d={d} stroke={color} strokeWidth="1.5" fill="none" strokeDasharray={r.id === _GH_WORKTREE ? "2 3" : undefined} />;
        });
      })}
      {rows.map((r, i) => {
        const y = i * _GH_ROW + _GH_ROW / 2;
        const color = _GH_laneColor(r.lane);
        return r.id === _GH_WORKTREE
          ? <circle key={r.id} cx={_GH_x(r.lane)} cy={y} r={_GH_R} fill="var(--bg-window)" stroke={color} strokeWidth="1.5" strokeDasharray="2 2" />
          : <circle key={r.id} cx={_GH_x(r.lane)} cy={y} r={_GH_R} fill={color} />;
      })}
    </svg>
  );
}

function _GH_Ref({ r }) {
  const icon = r.kind === "tag" ? "tag" : r.kind === "remote" ? "web" : "branch";
  return (
    <span className={`gitb-ref ${r.kind}`} title={r.kind === "head" ? `${r.name} (HEAD)` : r.name}>
      <_GH_Icon name={icon} size={9} />{r.name}
    </span>
  );
}

function GitHistory({ log, changedCount, selected, onSelect }) {
  const rows = log?.rows ?? [];
  const width = Math.max(1, log?.width ?? 1);
  const graphW = _GH_x(width - 1) + 12;
  const commits = rows.length - (rows[0]?.id === _GH_WORKTREE ? 1 : 0);
  const now = Date.now() / 1000;
  const [query, setQuery] = React.useState("");
  const [cursor, setCursor] = React.useState(-1);
  const logRef = React.useRef(null);
  const hits = React.useMemo(() => _GH_matches(rows, query), [rows, query]);
  const hitSet = React.useMemo(() => new Set(hits), [hits]);
  const searching = query.trim() !== "";
  const cursorRow = cursor >= 0 && cursor < hits.length ? hits[cursor] : -1;

  // Bring a row into the log's viewport, leaving it where it is when it
  // already shows (the pane scrolls itself, rows are absolutely placed).
  const reveal = React.useCallback(i => {
    const el = logRef.current;
    if (!el) return;
    const top = i * _GH_ROW;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + _GH_ROW > el.scrollTop + el.clientHeight) el.scrollTop = top + _GH_ROW - el.clientHeight;
  }, []);
  // A new query starts at its first hit.
  React.useEffect(() => {
    setCursor(hits.length ? 0 : -1);
    if (hits.length) reveal(hits[0]);
  }, [hits, reveal]);
  const step = delta => {
    const next = _GH_stepMatch(hits.length, cursor, delta);
    setCursor(next);
    if (next >= 0) reveal(hits[next]);
  };
  const onFindKey = e => {
    if (e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      step(e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey) ? -1 : 1);
    } else if (e.key === "Escape") {
      // Clear first; an empty field hands Escape on (close the browser).
      if (query) { e.preventDefault(); setQuery(""); }
    }
  };
  const worktreeLabel = changedCount
    ? window.OMP_I18N.plural(changedCount, "{n} uncommitted change", "{n} uncommitted changes", { n: changedCount })
    : OMP_TR("working tree clean");

  return (
    <div className="gitb-pane gitb-history">
      <div className="gitb-pane-head">
        <span className="gitb-pane-title">{OMP_TR("history")}</span>
        {log && <span className="gitb-pane-sub" title={log.truncated ? "only the newest commits are listed" : undefined}>
          {OMP_TR("all branches ·")} {commits}{log.truncated ? "+" : ""}
        </span>}
      </div>
      <div className="gitb-filter">
        <_GH_Icon name="search" size={11} color="var(--fg-4)" />
        <input className="gitb-filter-input mono" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onFindKey}
          placeholder={OMP_TR("find commits")} spellCheck={false} aria-label={OMP_TR("find commits")} />
        {searching && (
          <span className="gitb-find-count mono" role="status">{hits.length ? `${cursor + 1}/${hits.length}` : OMP_TR("no match")}</span>
        )}
        {searching && <button type="button" className="btn ghost icon" onClick={() => setQuery("")} aria-label={OMP_TR("clear find")}><_GH_Icon name="close" size={10} /></button>}
      </div>
      <div className="gitb-log" ref={logRef}>
        {!log && <div className="gitb-empty">{OMP_TR("loading…")}</div>}
        {log && rows.length === 0 && <div className="gitb-empty">{OMP_TR("no commits yet")}</div>}
        <div className="gitb-log-inner" style={{ height: rows.length * _GH_ROW }}>
          {rows.length > 0 && <_GH_Graph rows={rows} w={graphW} />}
          {rows.map((c, i) => {
            const wt = c.id === _GH_WORKTREE;
            return (
              <div key={c.id} className={`gitb-commit ${c.id === selected ? "active" : ""} ${wt ? "worktree" : ""}${searching ? (hitSet.has(i) ? " hit" : " dim") : ""}${i === cursorRow ? " cursor" : ""}`}
                style={{ top: i * _GH_ROW, height: _GH_ROW, paddingLeft: graphW + 4 }}
                onClick={() => onSelect(c.id)}
                title={wt ? undefined : `${c.id}\n${c.author} · ${new Date(c.at * 1000).toLocaleString()}`}>
                <div className="gitb-commit-top">
                  {c.refs.map(r => <_GH_Ref key={r.kind + r.name} r={r} />)}
                  <span className="gitb-commit-subject">{wt ? worktreeLabel : c.subject}</span>
                </div>
                {!wt && (
                  <div className="gitb-commit-meta mono">
                    <span>{c.short}</span><span>{c.author}</span><span>{_GH_relativeTime(c.at, now)}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

window.GitHistory = GitHistory;
