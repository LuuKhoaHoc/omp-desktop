/* subagents/subagent-board.jsx — the swarm pane's Board tab, read as a
   conversation between the workers. Every post (omp's IRC, relayed as
   `irc_message` frames and kept by OMP_SUBAGENTS `board`) is the sender's
   tile, `@sender → @recipient`, its number and time, and the text clamped
   to a few lines (click to open the rest). `#n` in a text jumps to that post.
   Search and a member filter narrow the feed; a "New" divider marks what
   came after the tab was last open; Follow keeps the newest post in view
   and switches itself off when the feed is scrolled up. Read-only. */

const { Icon: _SAB_Icon, OMP_SUBAGENTS: _SAB, SwarmAvatar: _SAB_Av, SwarmBody: _SAB_Body, swarmClock: _SAB_clock, swarmHue: _SAB_hue } = window;

const _SAB_BOTTOM_SLACK = 24;
const _SAB_LONG = 220;
const _SAB_FLASH_MS = 1400;

function _SAB_isLong(body) { return body.length > _SAB_LONG || body.split("\n").length > 3; }

function SubagentBoard({ state, seen, onSelect }) {
  const [member, setMember] = React.useState(null);
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [follow, setFollow] = React.useState(true);
  const [open, setOpen] = React.useState(() => new Set());
  const [flash, setFlash] = React.useState(null);
  const feedRef = React.useRef(null);
  const posts = _SAB.boardPosts(state);
  const born = React.useRef(posts.length); // posts past this count arrived while the tab was open
  const members = _SAB.boardMembers(state);
  const numOf = React.useMemo(() => new Map(posts.map((p, i) => [p.key, i + 1])), [posts]);
  const shown = _SAB.searchBoard(_SAB.filterBoard(posts, member), query);
  const openAgent = name => { if (_SAB.getAgent(state, name)) onSelect(name); };
  // The divider sits before the first post that arrived after the last visit.
  const newFrom = seen > 0 && seen < posts.length ? posts[seen]?.key : null;

  React.useEffect(() => {
    const el = feedRef.current;
    if (follow && el) el.scrollTop = el.scrollHeight;
  }, [follow, shown.length]);
  React.useEffect(() => {
    if (flash === null) return undefined;
    const id = setTimeout(() => setFlash(null), _SAB_FLASH_MS);
    return () => clearTimeout(id);
  }, [flash]);

  const onScroll = e => {
    const el = e.currentTarget;
    if (follow && el.scrollHeight - el.scrollTop - el.clientHeight > _SAB_BOTTOM_SLACK) setFollow(false);
  };
  const jumpTo = n => {
    // A filter may hide the target: clear it first so the post exists to scroll to.
    if (member !== null || query !== "") { setMember(null); setQuery(""); }
    setFollow(false);
    setFlash(n);
    requestAnimationFrame(() => feedRef.current?.querySelector(`[data-n="${n}"]`)?.scrollIntoView({ block: "center" }));
  };
  const toggle = key => setOpen(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  // Filter shows and hides the member chips; hiding them also drops the
  // picked member, so the button's state always says whether a filter is on.
  const toggleFilters = () => { if (filtersOpen) setMember(null); setFiltersOpen(o => !o); };

  return (
    <div className="sw-board">
      <div className="sw-tools">
        <label className="sw-searchbox">
          <_SAB_Icon name="search" size={12} color="var(--fg-3)" aria-hidden="true" />
          <input type="search" className="sw-search" value={query} placeholder={OMP_TR("Search")}
            aria-label={OMP_TR("Search messages")} onChange={e => setQuery(e.target.value)} />
        </label>
        <button type="button" className="sw-toggle" aria-pressed={filtersOpen} aria-expanded={filtersOpen}
          onClick={toggleFilters}>{OMP_TR("Filter")}</button>
        <button type="button" className="sw-toggle" aria-pressed={follow} onClick={() => setFollow(f => !f)}>{OMP_TR("Follow")}</button>
      </div>
      {filtersOpen && (
        <div className="sw-filters" role="group" aria-label={OMP_TR("Filter by member")}>
          <button type="button" className="sw-filter" aria-pressed={member === null} onClick={() => setMember(null)}>
            {OMP_TR("all")} <span className="sw-count">{posts.length}</span>
          </button>
          {members.map(m => (
            <button key={m.name} type="button" className="sw-filter" aria-pressed={member === m.name}
              title={OMP_TR("{sent} sent, {received} received", { sent: m.sent, received: m.received })}
              onClick={() => setMember(member === m.name ? null : m.name)}>
              {m.name} <span className="sw-count">{m.sent + m.received}</span>
            </button>
          ))}
        </div>
      )}
      <div className="sw-feed" ref={feedRef} onScroll={onScroll}>
        {shown.length === 0 && (
          <div className="sa-empty">
            {posts.length === 0 ? OMP_TR("No messages yet. Agents that message each other show up here.") : OMP_TR("No messages match.")}
          </div>
        )}
        {shown.map(p => {
          const n = numOf.get(p.key);
          const long = _SAB_isLong(p.body);
          const expanded = open.has(p.key);
          return (
            <React.Fragment key={p.key}>
              {p.key === newFrom && <div className="sw-new"><span>{OMP_TR("New")}</span></div>}
              <article className={`sw-post${n > born.current ? " fresh" : ""}${flash === n ? " flash" : ""}`} data-n={n}>
                <_SAB_Av name={p.from} coord={!_SAB.getAgent(state, p.from)} />
                <div className="sw-post-main">
                  <header className="sw-post-head">
                    <button type="button" className="sw-from" onClick={() => openAgent(p.from)}>@{p.from}</button>
                    <span className="sw-arrow"><_SAB_Icon name="arrow" size={10} aria-hidden="true" /></span>
                    <button type="button" className="sw-to" onClick={() => openAgent(p.to)}>@{p.to}</button>
                    <span className="sw-meta">#{n} · {_SAB_clock(p.t)}</span>
                  </header>
                  <div className={`sw-body${long && !expanded ? " clamp" : ""}`}>
                    <_SAB_Body text={p.body} total={posts.length} onRef={jumpTo} />
                  </div>
                  {long && (
                    <button type="button" className="sw-more" aria-expanded={expanded} onClick={() => toggle(p.key)}>
                      {expanded ? OMP_TR("Show less") : OMP_TR("Show more")}
                    </button>
                  )}
                </div>
              </article>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window, { SubagentBoard });
