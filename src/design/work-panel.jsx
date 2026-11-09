/* ═════════════════════════════════════════════════════════════════════
   design/work-panel.jsx — the Work panel (fork): tickets from GitLab
   (gitlab.com or self-hosted), GitHub and Linear beside the chat, toggled
   from the toolbar like the browser and the conversation tree.

   Connections live in localStorage (`omp.work.connections`): platform,
   transport, project/team, and for a token transport the NAME of the
   environment variable holding it. No secret is stored or shown; Rust
   reads the variable (src-tauri/src/work.rs). The platform logic is
   app/work-adapters.js (window.OMP_WORK).

   Views: list (dense rows) and board (columns = open / label columns /
   closed, or Linear's workflow states). A card moves by drag and drop or
   from the keyboard (focus a card, Alt+←/→). The drawer edits title, body
   (markdown with preview), labels and state, and comments; a save checks
   the ticket did not change on the server first.
   ═════════════════════════════════════════════════════════════════════ */

const { Icon: _WP_Icon, MarkdownContent: _WP_Markdown } = window;
const _WP_KEY = "omp.work.connections";
const _WP_ACTIVE = "omp.work.active";
const _WP_VIEW = "omp.work.view";

function _wpLoad() {
  try { const v = JSON.parse(localStorage.getItem(_WP_KEY) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function _wpSaveAll(list) { try { localStorage.setItem(_WP_KEY, JSON.stringify(list)); } catch {} }

/** Transport into Rust. Outside Tauri (browser preview) every call fails
 *  with a clear message instead of pretending. */
async function _wpRun(req) {
  const inv = window.__TAURI__?.core?.invoke;
  if (!inv) throw new Error("Work needs the desktop app (no Tauri bridge here).");
  if (req.kind === "cli") return inv("work_cli", { tool: req.tool, args: req.args, stdin: null });
  return inv("work_http", { url: req.url, method: req.method, auth: req.auth, tokenEnv: req.tokenEnv, body: req.body ?? null });
}

function _wpAgo(iso) {
  const t = Date.parse(iso ?? "");
  if (!t) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

// ── Connection form ───────────────────────────────────────────────────────
function _WP_ConnectionForm({ initial, onSave, onCancel, onDelete }) {
  const W = window.OMP_WORK;
  const [c, setC] = React.useState(initial ?? { id: `c${Date.now().toString(36)}`, name: "", platform: "gitlab", via: "cli", host: "", project: "", team: "", tokenEnv: "", columns: "" });
  const [test, setTest] = React.useState(null);
  const set = (k, v) => { setC(o => ({ ...o, [k]: v })); setTest(null); };
  const p = W.PLATFORMS[c.platform];
  const problems = W.validate(c);
  const ways = W.transports(c.platform);
  React.useEffect(() => { if (!ways.find(w => w.id === c.via && !w.disabled)) set("via", ways.find(w => !w.disabled).id); }, [c.platform]); // eslint-disable-line
  const runTest = async () => {
    setTest({ busy: true });
    try { const n = (await W.client(c, _wpRun).list()).length; setTest({ ok: `Connected: ${n} ticket${n === 1 ? "" : "s"} visible.` }); }
    catch (e) { setTest({ err: String(e?.message ?? e) }); }
  };
  return (
    <form className="wp-form" onSubmit={e => { e.preventDefault(); if (!problems.length) onSave(c); }}>
      <div className="wp-form-title">{initial ? "Edit connection" : "New connection"}</div>
      <label className="wp-field"><span>Name</span>
        <input value={c.name} placeholder="Team tracker" onChange={e => set("name", e.target.value)} autoFocus /></label>
      <div className="wp-field"><span>Platform</span>
        <div className="wp-seg" role="radiogroup" aria-label="platform">
          {Object.entries(W.PLATFORMS).map(([id, x]) => (
            <button type="button" key={id} role="radio" aria-checked={c.platform === id} className={c.platform === id ? "on" : ""} onClick={() => set("platform", id)}>{x.label}</button>
          ))}
        </div>
        <small>{p.hint}</small>
      </div>
      <div className="wp-field"><span>Connect with</span>
        <div className="wp-seg" role="radiogroup" aria-label="transport">
          {ways.map(w => (
            <button type="button" key={w.id} role="radio" aria-checked={c.via === w.id} disabled={w.disabled}
              className={c.via === w.id ? "on" : ""} onClick={() => set("via", w.id)}>{w.label}</button>
          ))}
        </div>
      </div>
      {c.platform !== "linear" && (
        <label className="wp-field"><span>Host <em>optional</em></span>
          <input value={c.host} placeholder={c.platform === "github" ? "api.github.com" : "gitlab.com"} onChange={e => set("host", e.target.value.trim())} /></label>
      )}
      {p.fields.includes("project") && (
        <label className="wp-field"><span>{c.platform === "github" ? "Repository" : "Project"}</span>
          <input value={c.project} placeholder={c.platform === "github" ? "owner/name" : "group/project or id"} onChange={e => set("project", e.target.value.trim())} /></label>
      )}
      {p.fields.includes("team") && (
        <label className="wp-field"><span>Team key</span>
          <input value={c.team} placeholder="ENG" onChange={e => set("team", e.target.value.trim())} /></label>
      )}
      {c.via === "token" && (
        <label className="wp-field"><span>Token variable</span>
          <input className="mono" value={c.tokenEnv} placeholder={c.platform === "linear" ? "LINEAR_API_KEY" : c.platform === "github" ? "GITHUB_TOKEN" : "GITLAB_TOKEN"}
            onChange={e => set("tokenEnv", e.target.value.trim().toUpperCase())} />
          <small>The name of an environment variable the app starts with. The token itself is never saved here.</small></label>
      )}
      {c.platform !== "linear" && (
        <label className="wp-field"><span>Board columns <em>optional</em></span>
          <input value={c.columns} placeholder="labels, comma-separated: To do, Doing, Review" onChange={e => set("columns", e.target.value)} />
          <small>Labels that act as columns between Open and Closed.</small></label>
      )}
      {problems.length > 0 && <ul className="wp-problems">{problems.map(m => <li key={m}>{m}</li>)}</ul>}
      {test?.ok && <div className="wp-note ok"><_WP_Icon name="check" size={12} /> {test.ok}</div>}
      {test?.err && <div className="wp-note err"><_WP_Icon name="warn" size={12} /> {test.err}</div>}
      <div className="wp-form-actions">
        {onDelete && <button type="button" className="btn ghost danger-text" onClick={onDelete}>Remove</button>}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn outlined" disabled={!!problems.length || test?.busy} onClick={runTest}>{test?.busy ? "Testing…" : "Test"}</button>
        <button type="submit" className="btn primary" disabled={!!problems.length}>Save</button>
      </div>
    </form>
  );
}

// ── Ticket drawer ─────────────────────────────────────────────────────────
function _WP_Drawer({ ticket, client, columns, onClose, onSaved }) {
  const [title, setTitle] = React.useState(ticket.title);
  const [body, setBody] = React.useState(ticket.body);
  const [labels, setLabels] = React.useState(ticket.labels.join(", "));
  const [tab, setTab] = React.useState("preview");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const [comment, setComment] = React.useState("");
  const [note, setNote] = React.useState(null);
  React.useEffect(() => { setTitle(ticket.title); setBody(ticket.body); setLabels(ticket.labels.join(", ")); setErr(null); }, [ticket.id, ticket.updatedAt]);
  const labelList = labels.split(",").map(s => s.trim()).filter(Boolean);
  const dirtyLabels = labelList.join(",") !== ticket.labels.join(",");
  const dirty = title !== ticket.title || body !== ticket.body || dirtyLabels;
  const isLinear = !!ticket.raw?.identifier;
  const save = async (extra = {}) => {
    setBusy(true); setErr(null);
    try {
      const edit = { title, body, ...extra };
      if (dirtyLabels && !isLinear) edit.labels = labelList;
      const t = await client.save(ticket, edit);
      onSaved(t); setNote("Saved.");
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const send = async () => {
    if (!comment.trim()) return;
    setBusy(true); setErr(null);
    try { await client.comment(ticket, comment.trim()); setComment(""); setNote("Comment posted."); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  React.useEffect(() => { if (!note) return; const id = setTimeout(() => setNote(null), 2400); return () => clearTimeout(id); }, [note]);
  return (
    <aside className="wp-drawer" aria-label={`ticket ${ticket.key}`}
      onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); if (dirty) save(); } }}>
      <div className="wp-drawer-head">
        <span className="wp-key mono">{ticket.key}</span>
        <span className={`wp-state ${ticket.state}`}>{ticket.stateName || ticket.state}</span>
        <span style={{ flex: 1 }} />
        {ticket.url && <button className="btn icon ghost" title="open in browser" aria-label="open in browser" onClick={() => window.OMP_BRIDGE?.openExternalUrl?.(ticket.url) ?? window.__TAURI__?.core?.invoke("open_url_external", { url: ticket.url })}><_WP_Icon name="external" size={13} /></button>}
        <button className="btn icon ghost" title="close (Esc)" aria-label="close" onClick={onClose}><_WP_Icon name="close" size={13} /></button>
      </div>
      <div className="wp-drawer-body">
        <textarea className="wp-title-input" rows={1} value={title} aria-label="title" onChange={e => setTitle(e.target.value.replace(/\n/g, " "))} />
        <div className="wp-meta">
          {ticket.assignees.length > 0 && <span><_WP_Icon name="agent" size={11} /> {ticket.assignees.join(", ")}</span>}
          {ticket.updatedAt && <span><_WP_Icon name="clock" size={11} /> updated {_wpAgo(ticket.updatedAt)} ago</span>}
        </div>
        {!isLinear && (
          <label className="wp-field compact"><span>Labels</span>
            <input value={labels} onChange={e => setLabels(e.target.value)} placeholder="comma-separated" /></label>
        )}
        <div className="wp-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "preview"} className={tab === "preview" ? "on" : ""} onClick={() => setTab("preview")}>Preview</button>
          <button role="tab" aria-selected={tab === "edit"} className={tab === "edit" ? "on" : ""} onClick={() => setTab("edit")}>Edit</button>
          {body !== ticket.body && <span className="wp-dirty">edited</span>}
        </div>
        {tab === "edit"
          ? <textarea className="wp-body-input mono" value={body} onChange={e => setBody(e.target.value)} aria-label="description (markdown)" />
          : <div className="wp-body-preview">{body.trim() ? <_WP_Markdown text={body} /> : <span className="wp-empty-line">No description.</span>}</div>}
        {err && (
          <div className="wp-note err"><_WP_Icon name="warn" size={12} /> {String(err.message ?? err)}
            {err.conflict && <button className="btn ghost" onClick={() => onSaved(err.conflict)}>Load latest</button>}
          </div>
        )}
        <div className="wp-comment">
          <textarea value={comment} rows={2} placeholder="Write a comment (markdown)…" onChange={e => setComment(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }} />
          <button className="btn outlined" disabled={!comment.trim() || busy} onClick={send} title="post comment (Ctrl+Enter)">Comment</button>
        </div>
      </div>
      <div className="wp-drawer-foot">
        {note && <span className="wp-ok">{note}</span>}
        <span style={{ flex: 1 }} />
        {!isLinear && (ticket.state === "open"
          ? <button className="btn ghost" disabled={busy} onClick={() => save({ state: "closed" })}>Close ticket</button>
          : <button className="btn ghost" disabled={busy} onClick={() => save({ state: "open" })}>Reopen</button>)}
        {isLinear && columns.length > 0 && (
          <select className="wp-select" value={ticket.column} disabled={busy} aria-label="state"
            onChange={async e => { setBusy(true); try { onSaved(await client.move(ticket, e.target.value)); } catch (x) { setErr(x); } finally { setBusy(false); } }}>
            {columns.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <button className="btn ghost" disabled={!dirty || busy} onClick={() => { setTitle(ticket.title); setBody(ticket.body); setLabels(ticket.labels.join(", ")); }}>Discard</button>
        <button className="btn primary" disabled={!dirty || busy} onClick={() => save()} title="save (Ctrl+S)">{busy ? "Saving…" : "Save"}</button>
      </div>
    </aside>
  );
}

// ── Board + list ──────────────────────────────────────────────────────────
function _WP_Card({ t, active, onOpen, onMove, columns }) {
  return (
    <div className={`wp-card${active ? " on" : ""}`} draggable tabIndex={0} role="button" aria-label={`${t.key} ${t.title}`}
      onDragStart={e => { e.dataTransfer.setData("text/omp-ticket", t.id); e.dataTransfer.effectAllowed = "move"; }}
      onClick={() => onOpen(t)}
      onKeyDown={e => {
        if (e.key === "Enter") onOpen(t);
        if (e.altKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
          e.preventDefault();
          const i = columns.indexOf(t.column) + (e.key === "ArrowRight" ? 1 : -1);
          if (i >= 0 && i < columns.length) onMove(t, columns[i]);
        }
      }}>
      <div className="wp-card-title">{t.title}</div>
      <div className="wp-card-meta">
        <span className="mono">{t.key}</span>
        {t.labels.filter(l => !columns.includes(l)).slice(0, 2).map(l => <span className="wp-label" key={l}>{l}</span>)}
        <span style={{ flex: 1 }} />
        {t.assignees[0] && <span className="wp-who">{t.assignees[0]}</span>}
      </div>
    </div>
  );
}

function _WP_Board({ tickets, columns, activeId, onOpen, onMove }) {
  const [over, setOver] = React.useState(null);
  return (
    <div className="wp-board">
      {columns.map(col => {
        const items = tickets.filter(t => t.column === col);
        return (
          <section key={col} className={`wp-col${over === col ? " over" : ""}`} aria-label={col}
            onDragOver={e => { e.preventDefault(); setOver(col); }} onDragLeave={() => setOver(o => (o === col ? null : o))}
            onDrop={e => { e.preventDefault(); setOver(null); const t = tickets.find(x => x.id === e.dataTransfer.getData("text/omp-ticket")); if (t && t.column !== col) onMove(t, col); }}>
            <header className="wp-col-head"><span>{col}</span><span className="wp-count">{items.length}</span></header>
            <div className="wp-col-body">
              {items.map(t => <_WP_Card key={t.id} t={t} active={t.id === activeId} onOpen={onOpen} onMove={onMove} columns={columns} />)}
              {items.length === 0 && <div className="wp-col-empty">Drop here</div>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function _WP_List({ tickets, activeId, onOpen }) {
  return (
    <div className="wp-list" role="list">
      {tickets.map(t => (
        <button key={t.id} role="listitem" className={`wp-row${t.id === activeId ? " on" : ""}`} onClick={() => onOpen(t)}>
          <span className={`wp-dot ${t.state}`} aria-label={t.state} />
          <span className="wp-key mono">{t.key}</span>
          <span className="wp-row-title">{t.title}</span>
          <span className="wp-row-col">{t.column}</span>
          <span className="wp-row-ago mono">{_wpAgo(t.updatedAt)}</span>
        </button>
      ))}
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────
function WorkPanel() {
  const W = window.OMP_WORK;
  const [conns, setConns] = React.useState(_wpLoad);
  const [activeId, setActiveId] = React.useState(() => localStorage.getItem(_WP_ACTIVE) ?? "");
  const [view, setView] = React.useState(() => localStorage.getItem(_WP_VIEW) ?? "board");
  const [editing, setEditing] = React.useState(null); // null | "new" | conn
  const [tickets, setTickets] = React.useState([]);
  const [columns, setColumns] = React.useState([]);
  const [state, setState] = React.useState({ loading: false, error: null });
  const [open, setOpen] = React.useState(null);
  const [q, setQ] = React.useState("");
  const [showClosed, setShowClosed] = React.useState(false);
  const conn = conns.find(c => c.id === activeId) ?? conns[0] ?? null;
  const client = React.useMemo(() => (conn ? W.client(conn, _wpRun) : null), [conn]); // eslint-disable-line

  const refresh = React.useCallback(async () => {
    if (!client) return;
    setState({ loading: true, error: null });
    try { const list = await client.list(); setTickets(list); setColumns(client.columns()); setState({ loading: false, error: null }); }
    catch (e) { setState({ loading: false, error: String(e?.message ?? e) }); }
  }, [client]);
  React.useEffect(() => { setTickets([]); setOpen(null); refresh(); }, [refresh]);
  React.useEffect(() => { localStorage.setItem(_WP_VIEW, view); }, [view]);

  const persist = list => { setConns(list); _wpSaveAll(list); };
  const saveConn = c => {
    const list = conns.some(x => x.id === c.id) ? conns.map(x => (x.id === c.id ? c : x)) : [...conns, c];
    persist(list); setActiveId(c.id); localStorage.setItem(_WP_ACTIVE, c.id); setEditing(null);
  };
  const replace = t => { setTickets(list => list.map(x => (x.id === t.id ? t : x))); setOpen(o => (o && o.id === t.id ? t : o)); };
  const move = async (t, col) => {
    const prev = t;
    setTickets(list => list.map(x => (x.id === t.id ? { ...x, column: col } : x))); // optimistic
    try { replace(await client.move(t, col)); }
    catch (e) { replace(prev); setState(s => ({ ...s, error: `Move failed: ${String(e?.message ?? e)}` })); }
  };

  const needle = q.trim().toLowerCase();
  const shown = tickets.filter(t => (!needle || `${t.key} ${t.title} ${t.labels.join(" ")}`.toLowerCase().includes(needle))
    && (view === "board" || showClosed || t.state === "open"));
  const boardCols = conn?.platform === "linear" ? columns : columns.filter(c => showClosed || c !== W.CLOSED);

  if (editing || !conn) {
    return (
      <div className="wp-panel">
        <div className="wp-head"><span className="wp-head-title">Work</span></div>
        <div className="wp-scroll">
          {!conn && !editing && (
            <div className="wp-empty">
              <div className="wp-empty-title">Connect a tracker</div>
              <p>GitLab (cloud or self-hosted), GitHub or Linear. Use the CLI you are already signed in to, or an API token kept in an environment variable.</p>
              <button className="btn primary" onClick={() => setEditing("new")}><_WP_Icon name="plus" size={12} /> Add connection</button>
            </div>
          )}
          {editing && <_WP_ConnectionForm initial={editing === "new" ? null : editing} onSave={saveConn}
            onCancel={() => setEditing(null)}
            onDelete={editing !== "new" ? () => { persist(conns.filter(x => x.id !== editing.id)); setEditing(null); } : null} />}
        </div>
      </div>
    );
  }

  return (
    <div className={`wp-panel${open ? " has-drawer" : ""}`}>
      <div className="wp-head">
        <select className="wp-select wp-conn" value={conn.id} aria-label="connection"
          onChange={e => { if (e.target.value === "+") { setEditing("new"); return; } setActiveId(e.target.value); localStorage.setItem(_WP_ACTIVE, e.target.value); }}>
          {conns.map(c => <option key={c.id} value={c.id}>{c.name} · {W.PLATFORMS[c.platform]?.label}</option>)}
          <option value="+">+ Add connection…</option>
        </select>
        <div className="wp-seg small" role="radiogroup" aria-label="view">
          <button role="radio" aria-checked={view === "board"} className={view === "board" ? "on" : ""} title="board" aria-label="board" onClick={() => setView("board")}><_WP_Icon name="grid" size={13} /></button>
          <button role="radio" aria-checked={view === "list"} className={view === "list" ? "on" : ""} title="list" aria-label="list" onClick={() => setView("list")}><_WP_Icon name="layers" size={13} /></button>
        </div>
        <span style={{ flex: 1 }} />
        <button className={`btn icon ghost${showClosed ? " on" : ""}`} title={showClosed ? "hide closed" : "show closed"} aria-pressed={showClosed} aria-label="show closed" onClick={() => setShowClosed(v => !v)}><_WP_Icon name="check" size={13} /></button>
        <button className="btn icon ghost" title="refresh" aria-label="refresh" disabled={state.loading} onClick={refresh}><_WP_Icon name="refresh" size={13} /></button>
        <button className="btn icon ghost" title="edit connection" aria-label="edit connection" onClick={() => setEditing(conn)}><_WP_Icon name="cog" size={13} /></button>
      </div>
      <div className="wp-search">
        <_WP_Icon name="search" size={12} />
        <input value={q} placeholder={`Filter ${tickets.length} tickets`} onChange={e => setQ(e.target.value)} aria-label="filter tickets" />
        {state.loading && <span className="wp-loading">loading…</span>}
      </div>
      {state.error && <div className="wp-note err wp-banner"><_WP_Icon name="warn" size={12} /> {state.error}</div>}
      <div className="wp-scroll">
        {view === "board"
          ? <_WP_Board tickets={shown} columns={boardCols} activeId={open?.id} onOpen={setOpen} onMove={move} />
          : <_WP_List tickets={shown} activeId={open?.id} onOpen={setOpen} />}
        {!state.loading && !state.error && tickets.length === 0 && <div className="wp-empty-line pad">No tickets here yet.</div>}
      </div>
      {open && <_WP_Drawer ticket={open} client={client} columns={columns} onClose={() => setOpen(null)} onSaved={replace} />}
    </div>
  );
}

Object.assign(window, { WorkPanel });
