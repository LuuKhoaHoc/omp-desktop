function _WP_Gantt({ tickets = [], columns = [], activeId, onOpen, showClosed }) {
  const G = window.OMP_WORK_GANTT, V = window.OMP_WORK_VIEWS;
  const zoomAnchorRef = React.useRef(null);
  const [zoom, setZoom] = React.useState("week");
  const sidebarRef = React.useRef(null), timelineRef = React.useRef(null);
  const groups = React.useMemo(() => G.groupBy(tickets, "column", columns), [tickets, columns]);
  const dated = React.useMemo(() => tickets.map(ticket => ({ ticket, dates: G.parseDates(ticket) })), [tickets]);
  const bounds = React.useMemo(() => G.timeBounds(tickets), [tickets]);
  const widthPerDay = zoom === "day" ? 44 : zoom === "month" ? 5 : 18;
  const totalWidth = Math.max(560, Math.ceil((bounds.maxDate - bounds.minDate) / 86400000) * widthPerDay);
  const ticks = React.useMemo(() => G.generateTicks(bounds.minDate, bounds.maxDate, zoom === "month" ? "week" : zoom), [bounds, zoom]);
  const primaryHeaders = React.useMemo(() => G.primaryHeaders(bounds.minDate, bounds.maxDate, zoom), [bounds, zoom]);
  const todayOffset = G.ticketPosition({ start: new Date(), end: new Date() }, bounds.minDate, bounds.maxDate, totalWidth).left;
  const dateById = React.useMemo(() => new Map(dated.map(item => [item.ticket.id, item.dates])), [dated]);
  const dateRange = `${bounds.minDate.toLocaleDateString(undefined, { month: "short", year: "numeric" })} – ${bounds.maxDate.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;

  const syncScroll = source => {
    const from = source === "sidebar" ? sidebarRef.current : timelineRef.current;
    const to = source === "sidebar" ? timelineRef.current : sidebarRef.current;
    if (from && to && to.scrollTop !== from.scrollTop) to.scrollTop = from.scrollTop;
  };
  React.useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const el = timelineRef.current;
    if (!anchor || !el) return;
    zoomAnchorRef.current = null;
    const offset = position(anchor);
    el.scrollLeft = Math.max(0, offset - el.clientWidth / 2);
  }, [zoom]);

  const changeZoom = value => {
    if (value === zoom) return;
    const el = timelineRef.current;
    if (el) {
      const center = el.scrollLeft + el.clientWidth / 2;
      zoomAnchorRef.current = new Date(bounds.minDate.getTime() + center / totalWidth * (bounds.maxDate - bounds.minDate));
    }
    setZoom(value);
  };
  const goToday = () => {
    const el = timelineRef.current;
    if (el) el.scrollTo({ left: Math.max(0, todayOffset - el.clientWidth / 2), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };
  const position = date => G.ticketPosition({ start: date, end: date }, bounds.minDate, bounds.maxDate, totalWidth).left;
  const formatDate = date => date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  if (!tickets.length) return <div className="wp-gantt-empty">{OMP_TR("No tickets to schedule")}</div>;

  return (
    <section className="wp-gantt" aria-label={OMP_TR("Ticket timeline")}>
      <div className="wp-gantt-head">
        <div className="wp-seg small wp-gantt-zoom" role="radiogroup" aria-label={OMP_TR("Timeline zoom")}>
          {[["day", "Day"], ["week", "Week"], ["month", "Month"]].map(([value, label]) => (
            <button type="button" role="radio" key={value} tabIndex={zoom === value ? 0 : -1} className={zoom === value ? "on" : ""} aria-checked={zoom === value}
              onKeyDown={event => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const next = ( ["day", "week", "month"].indexOf(value) + (event.key === "ArrowRight" ? 1 : 2) ) % 3;
                changeZoom(["day", "week", "month"][next]);
                event.currentTarget.parentElement.querySelectorAll('[role="radio"]')[next]?.focus();
              }}
              onClick={() => changeZoom(value)}>{OMP_TR(label)}</button>
          ))}
        </div>
        <span className="wp-gantt-range" aria-live="polite">{dateRange}</span>
        <button type="button" className="btn ghost small wp-gantt-today-btn" onClick={goToday}>{OMP_TR("Today")}</button>
      </div>
      <div className="wp-gantt-body">
        <div className="wp-gantt-sidebar" ref={sidebarRef} onScroll={() => syncScroll("sidebar")}>
          <div className="wp-gantt-side-head">{OMP_TR("Ticket")}</div>
          {groups.map(group => {
            const meta = V.columnMeta(group.key);
            return <React.Fragment key={group.key}>
              <div className="wp-gantt-group" title={meta.label}>
                <span className={`wp-col-dot ${meta.tone}`} aria-hidden="true" />
                <span className="wp-gantt-group-label">{meta.label}</span>
                <span className="wp-gantt-group-count">({group.tickets.length})</span>
              </div>
              {group.tickets.map(ticket => {
                const isClosed = /closed|done|resolved|complete/i.test(`${ticket.state || ""} ${ticket.column || ""}`);
                const assignee = ticket.assignees?.[0];
                return <button type="button" key={ticket.id} className={`wp-gantt-side-row${ticket.id === activeId ? " on" : ""}`} title={ticket.title} onClick={() => onOpen?.(ticket)}>
                  <span className={`wp-gantt-status ${isClosed ? "closed" : "open"}`} aria-hidden="true" />
                  <span className="wp-gantt-key">{ticket.key}</span>
                  <span className="wp-gantt-side-title">{ticket.title}</span>
                  {assignee && <span className="wp-gantt-assignee" title={assignee}>{assignee}</span>}
                </button>;
              })}
            </React.Fragment>;
          })}
        </div>
        <div className="wp-gantt-timeline" ref={timelineRef} onScroll={() => syncScroll("timeline")}>
          <div className="wp-gantt-track" style={{ width: totalWidth }}>
            <div className="wp-gantt-tick-head">
              <div className="wp-gantt-month-row" aria-hidden="true">
                {primaryHeaders.map((header, i) => {
                  const left = position(header.start);
                  const right = i + 1 < primaryHeaders.length ? position(primaryHeaders[i + 1].start) : totalWidth;
                  return <div key={header.date.toISOString()} className="wp-gantt-month-tick" style={{ left, width: Math.max(0, right - left) }}>
                    {header.label}
                  </div>;
                })}
              </div>
              <div className="wp-gantt-secondary-row">
                {ticks.map((tick, i) => {
                  const left = position(tick.date);
                  const right = i + 1 < ticks.length ? position(ticks[i + 1].date) : totalWidth;
                  return <div key={`${tick.date.toISOString()}-${i}`} className={`wp-gantt-tick${tick.isMajor ? " major" : ""}`} style={{ left, width: Math.max(0, right - left) }}>
                    <span>{tick.label}</span>
                  </div>;
                })}
              </div>
            </div>
            {groups.map(group => <React.Fragment key={group.key}>
              <div className="wp-gantt-grid-group" aria-hidden="true" />
              {group.tickets.map(ticket => {
                const dates = dateById.get(ticket.id), pos = G.ticketPosition(dates, bounds.minDate, bounds.maxDate, totalWidth);
                const meta = V.columnMeta(ticket.column), tone = meta.tone || "accent";
                const assignee = ticket.assignees?.[0] || OMP_TR("Unassigned");
                const duration = Math.max(1, Math.ceil((dates.end - dates.start) / 86400000));
                const isClosed = /closed|done|resolved|complete/i.test(`${ticket.state || ""} ${ticket.column || ""}`);
                const tooltip = `${ticket.key}: ${ticket.title}\n${meta.label}\n${formatDate(dates.start)} – ${formatDate(dates.end)} · ${duration}d\n${OMP_TR("Assignee")}: ${assignee}`;
                return <div className="wp-gantt-lane" key={ticket.id}>
                  <div className="wp-gantt-grid" aria-hidden="true">
                    {ticks.map((tick, i) => <i key={`${tick.date.toISOString()}-${i}`} className={tick.isMajor ? "major" : ""} style={{ left: position(tick.date) }} />)}
                  </div>
                  <button type="button" className={`wp-gantt-bar tone-${tone}${isClosed ? " closed" : ""}${ticket.id === activeId ? " on" : ""}`}
                    style={{ left: pos.left, width: Math.max(18, pos.width) }}
                    title={tooltip} aria-label={tooltip} onClick={() => onOpen?.(ticket)}>
                    {isClosed && <span className="wp-gantt-bar-check" aria-hidden="true">✓</span>}
                    <span><b>{ticket.key}</b> · {ticket.title}</span>
                  </button>
                </div>;
              })}
            </React.Fragment>)}
            <div className="wp-gantt-today" style={{ left: todayOffset }} aria-label={OMP_TR("Today")}>
              <span className="wp-gantt-today-badge">{OMP_TR("Today")}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
window._WP_Gantt = _WP_Gantt;
