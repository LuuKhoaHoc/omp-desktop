/* ═════════════════════════════════════════════════════════════════════
   design/work-panel.jsx — the Work panel (fork): tickets from GitLab
   (gitlab.com or self-hosted), GitHub and Linear beside the chat, toggled
   from the toolbar like the browser and the conversation tree.

   Connections live in localStorage (`omp.work.connections`): platform,
   transport, host, and for a token transport the NAME of the environment
   variable holding it. No secret is stored or shown; Rust reads the
   variable (src-tauri/src/work.rs). Saved views (`omp.work.views`,
   app/work-views.js) pick what to show from a connection: issues, merge
   requests or pipelines (design/work-review.jsx), of a project or a group,
   mine / my team's / all. Forms: design/work-forms.jsx. The platform
   logic is app/work-adapters.js (window.OMP_WORK).

   Issue layouts: list (dense rows) and board (columns = open / label columns /
   closed, or Linear's workflow states). A card moves by drag and drop or
   from the keyboard (focus a card, Alt+←/→). The drawer edits title, body
   (markdown with preview), labels and state, and comments; a save checks
   the ticket did not change on the server first.
   ═════════════════════════════════════════════════════════════════════ */

const { Icon: _WP_Icon, MarkdownContent: _WP_Markdown } = window;
const _WP_KEY = "omp.work.connections";
const _WP_VIEWS = "omp.work.views";
const _WP_ACTIVE = "omp.work.active"; // the active view's id
const _WP_LAYOUT = "omp.work.view"; // board | list (key predates views)

function _wpRead(key) {
  try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; }
}
/** { conns, views }; connections saved before views get theirs here. */
function _wpLoad() {
  const conns = _wpRead(_WP_KEY);
  return window.OMP_WORK_VIEWS.migrate(Array.isArray(conns) ? conns : [], _wpRead(_WP_VIEWS));
}
function _wpSaveAll({ conns, views }) {
  try { localStorage.setItem(_WP_KEY, JSON.stringify(conns)); localStorage.setItem(_WP_VIEWS, JSON.stringify(views)); } catch {}
}

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
          <span className="wp-key mono" title={t.raw?.references?.full ?? t.key}>{t.key}</span>
          <span className="wp-row-title">{t.title}</span>
          <span className="wp-row-col">{t.column}</span>
          <span className="wp-row-ago mono">{_wpAgo(t.updatedAt)}</span>
        </button>
      ))}
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────
const _wpNewView = connId => ({ id: `v${Date.now().toString(36)}`, connId, name: "", kind: "issues", project: "", scope: "project",
  who: "all", members: "", columns: "", team: "", branch: "" });

function WorkPanel() {
  const W = window.OMP_WORK, V = window.OMP_WORK_VIEWS, R = window.OMP_WORK_REVIEW;
  const { _WP_ConnectionForm: ConnForm, _WP_ViewForm: ViewForm, _WP_MrList: MrList, _WP_PipeList: PipeList,
    _WP_MrDrawer: MrDrawer, _WP_PipeDrawer: PipeDrawer } = window;
  const [{ conns, views }, setStore] = React.useState(_wpLoad);
  const [activeId, setActiveId] = React.useState(() => localStorage.getItem(_WP_ACTIVE) ?? "");
  const [layout, setLayout] = React.useState(() => localStorage.getItem(_WP_LAYOUT) ?? "board");
  const [editing, setEditing] = React.useState(null); // null | { conn, back? } | { view }
  const [items, setItems] = React.useState([]);
  const [columns, setColumns] = React.useState([]);
  const [state, setState] = React.useState({ loading: false, error: null });
  const [open, setOpen] = React.useState(null);
  const [q, setQ] = React.useState("");
  const [showClosed, setShowClosed] = React.useState(false);
  // A pre-views active id is a connection's: its migrated view has that connId.
  const view = views.find(v => v.id === activeId) ?? views.find(v => v.connId === activeId) ?? views[0] ?? null;
  const target = React.useMemo(() => (view ? V.resolve(view, conns) : null), [view, conns]); // eslint-disable-line
  const kind = target?.kind ?? "issues";
  const client = React.useMemo(() => (!target ? null : kind === "issues" ? W.client(target, _wpRun) : R.client(target, _wpRun)), [target]); // eslint-disable-line

  const refresh = React.useCallback(async () => {
    if (!client) return;
    setState({ loading: true, error: null });
    try { const list = await client.list(); setItems(list); setColumns(kind === "issues" ? client.columns() : []); setState({ loading: false, error: null }); }
    catch (e) { setState({ loading: false, error: String(e?.message ?? e) }); }
  }, [client]); // eslint-disable-line
  React.useEffect(() => { setItems([]); setOpen(null); refresh(); }, [refresh]);
  React.useEffect(() => { localStorage.setItem(_WP_LAYOUT, layout); }, [layout]);

  const persist = next => { setStore(next); _wpSaveAll(next); };
  const activate = id => { setActiveId(id); localStorage.setItem(_WP_ACTIVE, id); };
  const upsert = (list, x) => (list.some(y => y.id === x.id) ? list.map(y => (y.id === x.id ? x : y)) : [...list, x]);
  const saveConn = c => {
    const isNew = !conns.some(x => x.id === c.id);
    persist({ conns: upsert(conns, c), views });
    setEditing(isNew ? { view: _wpNewView(c.id) } : editing?.back ?? null);
  };
  const saveView = v => { persist({ conns, views: upsert(views, v) }); activate(v.id); setEditing(null); };
  const replace = t => { setItems(list => list.map(x => (x.id === t.id ? t : x))); setOpen(o => (o && o.id === t.id ? t : o)); };
  const move = async (t, col) => {
    const prev = t;
    setItems(list => list.map(x => (x.id === t.id ? { ...x, column: col } : x))); // optimistic
    try { replace(await client.move(t, col)); }
    catch (e) { replace(prev); setState(s => ({ ...s, error: `Move failed: ${String(e?.message ?? e)}` })); }
  };

  if (editing || !target) {
    const ev = editing?.view, ec = editing?.conn;
    return (
      <div className="wp-panel">
        <div className="wp-head"><span className="wp-head-title">Work</span></div>
        <div className="wp-scroll">
          {!editing && (
            <div className="wp-empty">
              <div className="wp-empty-title">{conns.length ? "Add a view" : "Connect a tracker"}</div>
              <p>{conns.length
                ? "A view shows issues, merge requests or pipelines from a project or a whole group: yours, your team's or everyone's."
                : "GitLab (cloud or self-hosted), GitHub or Linear. Use the CLI you are already signed in to, or an API token kept in an environment variable."}</p>
              <button className="btn primary" onClick={() => setEditing(conns.length ? { view: _wpNewView(conns[0].id) } : { conn: null })}>
                <_WP_Icon name="plus" size={12} /> {conns.length ? "Add view" : "Add connection"}</button>
            </div>
          )}
          {editing && "conn" in editing && <ConnForm key={ec?.id ?? "new"} initial={ec} onSave={saveConn} onCancel={() => setEditing(editing.back ?? null)}
            onDelete={ec ? () => { persist({ conns: conns.filter(x => x.id !== ec.id), views: views.filter(v => v.connId !== ec.id) }); setEditing(null); } : null} />}
          {ev && <ViewForm key={ev.id} initial={ev} conns={conns} onSave={saveView} onCancel={() => setEditing(null)}
            onEditConn={c => setEditing({ conn: c, back: editing })}
            onDelete={views.some(v => v.id === ev.id) ? () => { persist({ conns, views: views.filter(v => v.id !== ev.id) }); setEditing(null); } : null} />}
        </div>
      </div>
    );
  }

  const needle = q.trim().toLowerCase();
  const text = t => (kind === "issues" ? `${t.key} ${t.title} ${t.labels.join(" ")} ${t.assignees.join(" ")}`
    : kind === "mrs" ? `${t.key} ${t.title} ${t.author} ${t.source} ${t.statusLabel}` : `${t.key} ${t.ref} ${t.status} ${t.sha}`);
  const shown = items.filter(t => (!needle || text(t).toLowerCase().includes(needle))
    && (kind !== "issues" || layout === "board" || showClosed || t.state === "open"));
  const boardCols = target.platform === "linear" ? columns : columns.filter(c => showClosed || c !== W.CLOSED);
  const noun = { issues: "tickets", mrs: "merge requests", pipelines: "pipelines" }[kind];

  return (
    <div className={`wp-panel${open ? " has-drawer" : ""}`}>
      <div className="wp-head">
        <select className="wp-select wp-conn" value={view.id} aria-label="view"
          onChange={e => {
            const v = e.target.value;
            if (v === "+view") setEditing({ view: _wpNewView(target.connId) });
            else if (v === "+edit") setEditing({ view });
            else if (v === "+conn") setEditing({ conn: null });
            else activate(v);
          }}>
          {conns.map(c => (
            <optgroup key={c.id} label={c.name}>
              {views.filter(v => v.connId === c.id).map(v => <option key={v.id} value={v.id}>{v.name} · {V.KINDS[v.kind]}</option>)}
            </optgroup>
          ))}
          <option value="+edit">✎ Edit this view…</option>
          <option value="+view">+ New view…</option>
          <option value="+conn">+ Add connection…</option>
        </select>
        {kind === "issues" && (
          <div className="wp-seg small" role="radiogroup" aria-label="layout">
            <button role="radio" aria-checked={layout === "board"} className={layout === "board" ? "on" : ""} title="board" aria-label="board" onClick={() => setLayout("board")}><_WP_Icon name="grid" size={13} /></button>
            <button role="radio" aria-checked={layout === "list"} className={layout === "list" ? "on" : ""} title="list" aria-label="list" onClick={() => setLayout("list")}><_WP_Icon name="layers" size={13} /></button>
          </div>
        )}
        <span style={{ flex: 1 }} />
        {kind === "issues" && <button className={`btn icon ghost${showClosed ? " on" : ""}`} title={showClosed ? "hide closed" : "show closed"} aria-pressed={showClosed} aria-label="show closed" onClick={() => setShowClosed(v => !v)}><_WP_Icon name="check" size={13} /></button>}
        <button className="btn icon ghost" title="refresh" aria-label="refresh" disabled={state.loading} onClick={refresh}><_WP_Icon name="refresh" size={13} /></button>
        <button className="btn ghost wp-edit" title="edit this view: what it shows, from where, whose" onClick={() => setEditing({ view })}><_WP_Icon name="edit" size={12} /> Edit view</button>
      </div>
      <div className="wp-search">
        <_WP_Icon name="search" size={12} />
        <input value={q} placeholder={`Filter ${items.length} ${noun}`} onChange={e => setQ(e.target.value)} aria-label={`filter ${noun}`} />
        {state.loading && <span className="wp-loading">loading…</span>}
      </div>
      {state.error && <div className="wp-note err wp-banner"><_WP_Icon name="warn" size={12} /> {state.error}</div>}
      <div className="wp-scroll">
        {kind === "mrs" ? <MrList items={shown} activeId={open?.id} onOpen={setOpen} />
          : kind === "pipelines" ? <PipeList items={shown} activeId={open?.id} onOpen={setOpen} />
          : layout === "board" ? <_WP_Board tickets={shown} columns={boardCols} activeId={open?.id} onOpen={setOpen} onMove={move} />
          : <_WP_List tickets={shown} activeId={open?.id} onOpen={setOpen} />}
        {!state.loading && !state.error && items.length === 0 && <div className="wp-empty-line pad">No {noun} here yet.</div>}
      </div>
      {open && kind === "issues" && <_WP_Drawer ticket={open} client={client} columns={columns} onClose={() => setOpen(null)} onSaved={replace} />}
      {open && kind === "mrs" && <MrDrawer mr={open} client={client} onClose={() => setOpen(null)} onChanged={replace} />}
      {open && kind === "pipelines" && <PipeDrawer pipe={open} client={client} onClose={() => setOpen(null)} onChanged={replace} />}
    </div>
  );
}

Object.assign(window, { WorkPanel, _wpRun, _wpAgo });
