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
   from the keyboard (focus a card, Alt+←/→); a label column moves the same
   two ways from its header, and the view keeps the new order. The drawer
   edits title, body (markdown with preview), labels and state, and
   comments; a save checks the ticket did not change on the server first.
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
  if (!inv) throw new Error(OMP_TR("Work needs the desktop app (no Tauri bridge here)."));
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
function _WP_Drawer({ ticket, client, columns, onAddToChat, onClose, onSaved }) {
  const [title, setTitle] = React.useState(ticket.title);
  const [body, setBody] = React.useState(ticket.body);
  const [labels, setLabels] = React.useState(ticket.labels.join(", "));
  const [tab, setTab] = React.useState("preview");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const [comment, setComment] = React.useState("");
  const [note, setNote] = React.useState(null);
  const [threads, setThreads] = React.useState(null);
  const [notesErr, setNotesErr] = React.useState(null);
  const [copied, setCopied] = React.useState(null);
  React.useEffect(() => { setTitle(ticket.title); setBody(ticket.body); setLabels(ticket.labels.join(", ")); setErr(null); setCopied(null); }, [ticket.id, ticket.updatedAt]);
  const loadNotes = React.useCallback(() => {
    if (!client.hasNotes) return;
    client.notes(ticket).then(t => { setThreads(t); setNotesErr(null); }, e => setNotesErr(String(e?.message ?? e)));
  }, [client, ticket.id]); // eslint-disable-line
  React.useEffect(() => { setThreads(null); setNotesErr(null); loadNotes(); }, [loadNotes]);
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
      onSaved(t); setNote("saved");
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const send = async () => {
    if (!comment.trim()) return;
    setBusy(true); setErr(null);
    try { await client.comment(ticket, comment.trim()); setComment(""); setNote("commented"); loadNotes(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const panelRef = React.useRef(null);
  const titleRef = React.useRef(null);
  const Key = window._WP_Key;
  window._wpUseDialog(panelRef, true, onClose);
  React.useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el || typeof CSS === "undefined" || CSS.supports?.("field-sizing", "content")) return undefined;
    const fit = () => { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; };
    fit();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [title, ticket.id]);
  React.useEffect(() => { if (!note) return; const id = setTimeout(() => setNote(null), 2400); return () => clearTimeout(id); }, [note]);
  React.useEffect(() => { if (!copied) return; const id = setTimeout(() => setCopied(null), 1800); return () => clearTimeout(id); }, [copied]);
  const issueRef = window.OMP_WORK?.formatIssueRef?.(ticket) || ticket.key;
  const copyText = (kind, text) => {
    if (!text) return;
    const p = navigator.clipboard?.writeText?.(text);
    if (p && typeof p.then === "function") {
      p.then(() => setCopied(kind), () => {});
    }
  };
  const addToChat = () => {
    const draft = window.OMP_WORK?.formatIssueChatDraft?.(ticket) || issueRef;
    if (onAddToChat) { onAddToChat(draft); setCopied("chat"); }
    else copyText("chat", draft);
  };
  return (
    <aside ref={panelRef} tabIndex={-1} role="dialog" className="wp-drawer" aria-label={OMP_TR("ticket {key}", { key: ticket.key })}
      onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); if (dirty) save(); } }}>
      <div className="wp-drawer-head">
        <Key k={ticket.key} full={ticket.raw?.references?.full} />
        <span className={`wp-state ${ticket.state}`}>{ticket.stateName || ticket.state}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn icon ghost"
          title={copied === "ref" ? OMP_TR("Copied") : OMP_TR("Copy issue: {ref}", { ref: issueRef })}
          aria-label={OMP_TR("Copy issue")}
          onClick={() => copyText("ref", issueRef)}>
          <_WP_Icon name={copied === "ref" ? "check" : "copy"} size={13} color={copied === "ref" ? "var(--accent)" : undefined} />
        </button>
        {ticket.url && (
          <button type="button" className="btn icon ghost"
            title={copied === "link" ? OMP_TR("Copied") : OMP_TR("Copy link")}
            aria-label={OMP_TR("Copy link")}
            onClick={() => copyText("link", ticket.url)}>
            <_WP_Icon name={copied === "link" ? "check" : "link"} size={13} color={copied === "link" ? "var(--accent)" : undefined} />
          </button>
        )}
        {onAddToChat && (
          <button type="button" className="btn ghost small wp-add-chat"
            title={OMP_TR("Add issue to chat composer")}
            onClick={addToChat}>
            <_WP_Icon name={copied === "chat" ? "check" : "conversation"} size={12} color={copied === "chat" ? "var(--accent)" : undefined} />
            <span>{copied === "chat" ? OMP_TR("Added") : OMP_TR("Add to chat")}</span>
          </button>
        )}
        {ticket.url && <button type="button" className="btn icon ghost" title={OMP_TR("open in browser")} aria-label={OMP_TR("open in browser")} onClick={() => window.OMP_BRIDGE?.openExternalUrl?.(ticket.url) ?? window.__TAURI__?.core?.invoke("open_url_external", { url: ticket.url })}><_WP_Icon name="external" size={13} /></button>}
        <button type="button" className="btn icon ghost" title={OMP_TR("close (Esc)")} aria-label={OMP_TR("close")} onClick={onClose}><_WP_Icon name="close" size={13} /></button>
      </div>
      <div className="wp-drawer-body">
        <textarea ref={titleRef} className="wp-title-input" rows={1} value={title} aria-label={OMP_TR("title")} onChange={e => setTitle(e.target.value.replace(/\n/g, " "))} />
        <div className="wp-meta">
          {ticket.assignees.length > 0 && <span><_WP_Icon name="agent" size={11} /> {ticket.assignees.join(", ")}</span>}
          {ticket.updatedAt && <span><_WP_Icon name="clock" size={11} /> {OMP_TR("updated {ago} ago", { ago: _wpAgo(ticket.updatedAt) })}</span>}
        </div>
        {!isLinear && (
          <label className="wp-field compact"><span>{OMP_TR("Labels")}</span>
            <input value={labels} onChange={e => setLabels(e.target.value)} placeholder={OMP_TR("comma-separated")} /></label>
        )}
        <div className="wp-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "preview"} className={tab === "preview" ? "on" : ""} onClick={() => setTab("preview")}>{OMP_TR("Preview")}</button>
          <button role="tab" aria-selected={tab === "edit"} className={tab === "edit" ? "on" : ""} onClick={() => setTab("edit")}>{OMP_TR("Edit")}</button>
          {body !== ticket.body && <span className="wp-dirty">{OMP_TR("edited")}</span>}
        </div>
        {tab === "edit"
          ? <textarea className="wp-body-input mono" value={body} onChange={e => setBody(e.target.value)} aria-label={OMP_TR("description (markdown)")} />
          : <div className="wp-body-preview">{body.trim() ? <_WP_Markdown text={body} /> : <span className="wp-empty-line">{OMP_TR("No description.")}</span>}</div>}
        {client.hasNotes && <window._WPR_Notes threads={threads} error={notesErr} />}
        {err && (
          <div className="wp-note err"><_WP_Icon name="warn" size={12} /> {String(err.message ?? err)}
            {err.conflict && <button className="btn ghost" onClick={() => onSaved(err.conflict)}>{OMP_TR("Load latest")}</button>}
          </div>
        )}
        <div className="wp-comment">
          <textarea value={comment} rows={2} placeholder={OMP_TR("Write a comment (markdown)…")} onChange={e => setComment(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }} />
          <button className="btn outlined" disabled={!comment.trim() || busy} onClick={send} title={OMP_TR("post comment (Ctrl+Enter)")}>{OMP_TR("Comment")}</button>
        </div>
      </div>
      <div className="wp-drawer-foot">
        {note && <span className="wp-ok">{note === "saved" ? OMP_TR("Saved.") : OMP_TR("Comment posted.")}</span>}
        <span style={{ flex: 1 }} />
        {!isLinear && (ticket.state === "open"
          ? <button className="btn ghost" disabled={busy} onClick={() => save({ state: "closed" })}>{OMP_TR("Close ticket")}</button>
          : <button className="btn ghost" disabled={busy} onClick={() => save({ state: "open" })}>{OMP_TR("Reopen")}</button>)}
        {isLinear && columns.length > 0 && (
          <select className="wp-select" value={ticket.column} disabled={busy} aria-label={OMP_TR("state")}
            onChange={async e => { setBusy(true); try { onSaved(await client.move(ticket, e.target.value)); } catch (x) { setErr(x); } finally { setBusy(false); } }}>
            {columns.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <button className="btn ghost" disabled={!dirty || busy} onClick={() => { setTitle(ticket.title); setBody(ticket.body); setLabels(ticket.labels.join(", ")); }}>{OMP_TR("Discard")}</button>
        <button className="btn primary" disabled={!dirty || busy} onClick={() => save()} title={OMP_TR("save (Ctrl+S)")}>{busy ? OMP_TR("Saving…") : OMP_TR("Save")}</button>
      </div>
    </aside>
  );
}
// ── Board + list ──────────────────────────────────────────────────────────
const _WP_PRI_RE = /^(?:p[0-3]|priority(?:\s*(?:::|:|-|\/)\s*\S+)?|critical|urgent|blocker|high|medium|low)$/i;
function _wpPriorityTone(label) {
  const l = String(label).toLowerCase();
  if (/p0|p1|critical|urgent|blocker|high/.test(l)) return "high";
  if (/p2|medium/.test(l)) return "med";
  return "";
}
function _wpPriorityLabel(label) {
  const s = String(label ?? "").replace(/^priority\s*(?:::|:|-|\/)\s*/i, "").trim() || String(label ?? "");
  return s === s.toUpperCase() && s.length > 3 ? s[0] + s.slice(1).toLowerCase() : s;
}
function _wpSplitLabels(labels, columns) {
  const visible = labels.filter(l => !columns.includes(l));
  const pri = visible.find(l => _WP_PRI_RE.test(l.trim())) ?? null;
  const rest = pri ? visible.filter(l => l !== pri) : visible;
  return { pri, rest };
}

function _WP_Card({ t, active, onOpen, onMove, columns }) {
  const [dragging, setDragging] = React.useState(false);
  const Key = window._WP_Key, Assignee = window._WP_Assignee;
  const { pri, rest } = _wpSplitLabels(t.labels, columns);
  return (
    <button type="button" className={`wp-card${active ? " on" : ""}${dragging ? " dragging" : ""}`}
      draggable aria-label={`${t.key} ${t.title}`}
      onDragStart={e => { setDragging(true); e.dataTransfer.setData("text/omp-ticket", t.id); e.dataTransfer.effectAllowed = "move"; }}
      onDragEnd={() => setDragging(false)}
      onClick={() => onOpen(t)}
      onKeyDown={e => {
        if (e.altKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
          e.preventDefault();
          const i = columns.indexOf(t.column) + (e.key === "ArrowRight" ? 1 : -1);
          if (i >= 0 && i < columns.length) onMove(t, columns[i]);
        }
      }}>
      <span className="wp-card-top">
        <Key k={t.key} full={t.raw?.references?.full} />
        {pri && <span className={`wp-pri ${_wpPriorityTone(pri)}`} title={pri}>{_wpPriorityLabel(pri)}</span>}
      </span>
      <span className="wp-card-title">{t.title}</span>
      {(rest.length > 0 || t.assignees[0]) && (
        <span className="wp-card-foot">
          <span className="wp-card-labels">
            {rest.slice(0, 2).map(l => <span className="wp-label" key={l} title={l}>{l}</span>)}
          </span>
          {t.assignees[0] && <Assignee name={t.assignees[0]} />}
        </span>
      )}
    </button>
  );
}

function _WP_Board({ tickets, columns, activeId, onOpen, onMove, onReorder }) {
  const W = window.OMP_WORK, D = window.OMP_DRAG_REORDER, colMeta = window.OMP_WORK_VIEWS.columnMeta;
  const [over, setOver] = React.useState(null);
  // Label columns trade places among themselves; Open and Closed keep the ends.
  const labelCols = onReorder ? columns.filter(c => c !== W.OPEN && c !== W.CLOSED) : [];
  const canMove = labelCols.length > 1;
  const reorder = window.useDragReorder((_list, src, target, after) => {
    const next = D.reorderList(labelCols, src, target, after);
    if (next) onReorder(next);
  });
  const boardRef = React.useRef(null);
  // The column a key press moved: its header takes the focus back once the
  // board is drawn in the new order.
  const refocus = React.useRef(null);
  React.useLayoutEffect(() => {
    const col = refocus.current;
    if (col === null) return;
    refocus.current = null;
    [...boardRef.current.querySelectorAll(".wp-col")].find(el => el.dataset.reorderId === col)?.querySelector(".wp-col-head")?.focus();
  });
  const nudge = (e, col) => {
    if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    const next = D.shiftList(labelCols, col, e.key === "ArrowLeft" ? -1 : 1);
    if (!next) return;
    refocus.current = col;
    onReorder(next);
  };
  return (
    <div className="wp-board" ref={boardRef} data-reorder-scroll="" onPointerDown={canMove ? reorder.onPointerDown : undefined}>
      {columns.map(col => {
        const items = tickets.filter(t => t.column === col);
        const meta = colMeta(col);
        const movable = canMove && labelCols.includes(col);
        return (
          <section key={col} className={`wp-col${over === col ? " over" : ""}${movable ? reorder.dropClass("cols", col) : ""}`} aria-label={col}
            {...(movable ? reorder.itemProps("cols", col, "x") : {})}
            onDragOver={e => { e.preventDefault(); if (over !== col) setOver(col); }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(o => (o === col ? null : o)); }}
            onDrop={e => { e.preventDefault(); setOver(null); const t = tickets.find(x => x.id === e.dataTransfer.getData("text/omp-ticket")); if (t && t.column !== col) onMove(t, col); }}>
            <header className={`wp-col-head${movable ? " movable" : ""}`}
              {...(movable ? {
                tabIndex: 0, "aria-keyshortcuts": "Alt+ArrowLeft Alt+ArrowRight", onKeyDown: e => nudge(e, col),
                title: OMP_TR("{name}: drag, or press Alt+← / Alt+→, to move the column", { name: col }),
              } : { title: col })}>
              <span className={`wp-col-dot ${meta.tone}`} aria-hidden="true" />
              <span className="wp-col-name">{meta.label}</span>
              <span className="wp-col-count">{items.length}</span>
            </header>
            <div className="wp-col-body" data-no-reorder="">
              {items.map(t => <_WP_Card key={t.id} t={t} active={t.id === activeId} onOpen={onOpen} onMove={onMove} columns={columns} />)}
              {items.length === 0 && <div className="wp-col-empty">{over === col ? OMP_TR("Release to move here") : OMP_TR("No tickets")}</div>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function _WP_List({ tickets, activeId, onOpen }) {
  const Key = window._WP_Key;
  return (
    <div className="wp-list" role="list">
      {tickets.map(t => (
        <button key={t.id} role="listitem" className={`wp-row${t.id === activeId ? " on" : ""}`} onClick={() => onOpen(t)}>
          <span className={`wp-dot ${t.state}`} aria-label={t.state} />
          <Key k={t.key} full={t.raw?.references?.full} />
          <span className="wp-row-title">{t.title}</span>
          <span className="wp-row-col" title={t.column}>{window.OMP_WORK_VIEWS.columnMeta(t.column).label}</span>
          <span className="wp-row-ago mono">{_wpAgo(t.updatedAt)}</span>
        </button>
      ))}
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────
const _wpNewView = connId => ({ id: `v${Date.now().toString(36)}`, connId, name: "", kind: "issues", project: "", scope: "project",
  who: "all", members: "", columns: "", team: "", branch: "" });

function WorkPanel({ onAddToChat } = {}) {
  const W = window.OMP_WORK, V = window.OMP_WORK_VIEWS, R = window.OMP_WORK_REVIEW;
  const { _WP_ConnectionForm: ConnForm, _WP_ViewForm: ViewForm, _WP_ViewMenu: ViewMenu,
    _WP_AssigneeFilter: AssigneeFilter, _WP_LabelFilter: LabelFilter,
    _WP_MrList: MrList, _WP_PipeList: PipeList, _WP_MrDrawer: MrDrawer, _WP_PipeDrawer: PipeDrawer } = window;
  const [{ conns, views }, setStore] = React.useState(_wpLoad);
  const [activeId, setActiveId] = React.useState(() => localStorage.getItem(_WP_ACTIVE) ?? "");
  const [layout, setLayout] = React.useState(() => localStorage.getItem(_WP_LAYOUT) ?? "board");
  const [editing, setEditing] = React.useState(null); // null | { conn, back? } | { view }
  const [items, setItems] = React.useState([]);
  const [columns, setColumns] = React.useState([]);
  const [state, setState] = React.useState({ loading: false, error: null });
  const [open, setOpen] = React.useState(null);
  const [q, setQ] = React.useState("");
  const [whoFilter, setWhoFilter] = React.useState("");
  const [labelFilter, setLabelFilter] = React.useState("");
  const [showClosed, setShowClosed] = React.useState(false);
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
  // `view.columns` as a column drag on the board just wrote it: the tickets
  // are already here, so that one change of view is not a reason to refetch.
  const reseated = React.useRef(null);
  React.useEffect(() => {
    const columnsOnly = reseated.current !== null && reseated.current === view?.columns;
    reseated.current = null;
    if (columnsOnly) return;
    setItems([]); setOpen(null); setWhoFilter(""); setLabelFilter(""); refresh();
  }, [refresh]); // eslint-disable-line
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
    catch (e) { replace(prev); setState(s => ({ ...s, error: OMP_TR("Move failed: {err}", { err: String(e?.message ?? e) }) })); }
  };
  // The view keeps the board's new column order, and each ticket takes its
  // seat again: one carrying two column labels sits in the first of them.
  const reorderColumns = labels => {
    const next = { ...view, columns: labels.join(", ") };
    const t = V.resolve(next, conns);
    const seat = x => ({ ...x, column: W.columnFor(t, x.state, x.labels) });
    reseated.current = next.columns;
    persist({ conns, views: upsert(views, next) });
    setColumns(W.boardColumns(t));
    setItems(list => list.map(seat));
    setOpen(o => o && seat(o));
  };
  if (editing || !target) {
    const ev = editing?.view, ec = editing?.conn;
    return (
      <div className="wp-panel">
        <div className="wp-head"><span className="wp-head-title">{OMP_TR("Work")}</span></div>
        <div className="wp-scroll">
          {!editing && (
            <div className="wp-empty">
              <div className="wp-empty-title">{conns.length ? OMP_TR("Add a view") : OMP_TR("Connect a tracker")}</div>
              <p>{conns.length
                ? OMP_TR("A view shows issues, merge requests or pipelines from a project or a whole group: yours, your team's or everyone's.")
                : OMP_TR("GitLab (cloud or self-hosted), GitHub or Linear. Use the CLI you are already signed in to, or an API token kept in an environment variable.")}</p>
              <button className="btn primary" onClick={() => setEditing(conns.length ? { view: _wpNewView(conns[0].id) } : { conn: null })}>
                <_WP_Icon name="plus" size={12} /> {conns.length ? OMP_TR("Add view") : OMP_TR("Add connection")}</button>
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
  const matchesWho = t => !whoFilter
    || (whoFilter === "__none__" ? kind === "issues" && !(t.assignees?.length)
    : kind === "mrs" ? t.author === whoFilter : (t.assignees ?? []).includes(whoFilter));
  const shown = items.filter(t => matchesWho(t)
    && (!labelFilter || (t.labels ?? []).includes(labelFilter))
    && (!needle || text(t).toLowerCase().includes(needle))
    && (kind !== "issues" || layout === "board" || showClosed || t.state === "open"));
  const boardCols = target.platform === "linear" ? columns : columns.filter(c => showClosed || c !== W.CLOSED);
  const filteredOut = items.length > 0 && shown.length === 0 && (needle || whoFilter || labelFilter);
  const onlyClosedHidden = kind === "issues" && (layout === "list" || layout === "gantt") && !showClosed && items.length > 0 && shown.length === 0 && !filteredOut;
  return (
    <div className={`wp-panel${open ? " has-drawer" : ""}`}>
      <div className="wp-head">
        <ViewMenu view={view} views={views} conns={conns} onSelect={activate}
          onEditView={() => setEditing({ view })}
          onNewView={() => setEditing({ view: _wpNewView(target.connId) })}
          onAddConn={() => setEditing({ conn: null })} />
        {kind === "issues" && (
          <div className="wp-seg small" role="radiogroup" aria-label={OMP_TR("layout")}>
            <button role="radio" aria-checked={layout === "board"} className={layout === "board" ? "on" : ""} title={OMP_TR("Board view")} aria-label={OMP_TR("board")} onClick={() => setLayout("board")}>
              <_WP_Icon name="grid" size={12} /><span className="wp-seg-lbl">{OMP_TR("Board")}</span>
            </button>
            <button role="radio" aria-checked={layout === "list"} className={layout === "list" ? "on" : ""} title={OMP_TR("List view")} aria-label={OMP_TR("list")} onClick={() => setLayout("list")}>
              <_WP_Icon name="layers" size={12} /><span className="wp-seg-lbl">{OMP_TR("List")}</span>
            </button>
            <button role="radio" aria-checked={layout === "gantt"} className={layout === "gantt" ? "on" : ""} title={OMP_TR("Gantt view")} aria-label={OMP_TR("gantt")} onClick={() => setLayout("gantt")}>
              <_WP_Icon name="clock" size={12} /><span className="wp-seg-lbl">{OMP_TR("Gantt")}</span>
            </button>
          </div>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn icon ghost" title={OMP_TR("Refresh")} aria-label={OMP_TR("refresh")} disabled={state.loading} onClick={refresh}>
          <span className={state.loading ? "wp-spin" : ""} style={{ display: "inline-flex" }}><_WP_Icon name="refresh" size={13} /></span>
        </button>
        <button className="btn ghost wp-edit" title={OMP_TR("Edit this view: what it shows, from where, whose")} onClick={() => setEditing({ view })}>
          <_WP_Icon name="edit" size={12} /><span className="wp-edit-lbl">{OMP_TR("Edit view")}</span>
        </button>
      </div>
      <div className="wp-filterbar">
        <div className="wp-search">
          <_WP_Icon name="search" size={12} />
          <input value={q}
            placeholder={kind === "mrs" ? OMP_TR("Filter {n} merge requests…", { n: items.length }) : kind === "pipelines" ? OMP_TR("Filter {n} pipelines…", { n: items.length }) : OMP_TR("Filter {n} tickets…", { n: items.length })}
            onChange={e => setQ(e.target.value)}
            aria-label={kind === "mrs" ? OMP_TR("filter merge requests") : kind === "pipelines" ? OMP_TR("filter pipelines") : OMP_TR("filter tickets")} />
          {q && <button type="button" className="wp-search-clear" aria-label={OMP_TR("clear filter")} onClick={() => setQ("")}><_WP_Icon name="close" size={11} /></button>}
          {state.loading && <span className="wp-loading">{OMP_TR("syncing…")}</span>}
        </div>
        <AssigneeFilter items={items} kind={kind} value={whoFilter} onChange={setWhoFilter} />
        <LabelFilter items={items} columns={columns} kind={kind} value={labelFilter} onChange={setLabelFilter} />
        {kind === "issues" && (
          <button type="button" className={`wp-filter-btn${showClosed ? " on" : ""}`}
            aria-pressed={showClosed} title={showClosed ? OMP_TR("Hide closed tickets") : OMP_TR("Show closed tickets")}
            onClick={() => setShowClosed(v => !v)}>
            <_WP_Icon name="check" size={11} />
            <span>{OMP_TR("Closed")}</span>
          </button>
        )}
      </div>
      {state.error && <div className="wp-note err wp-banner"><_WP_Icon name="warn" size={12} /> {state.error}</div>}
      <div className="wp-scroll">
        {kind === "mrs" ? <MrList items={shown} activeId={open?.id} onOpen={setOpen} />
          : kind === "pipelines" ? <PipeList items={shown} activeId={open?.id} onOpen={setOpen} />
          : layout === "gantt" ? <_WP_Gantt tickets={shown} columns={boardCols} activeId={open?.id} onOpen={setOpen} showClosed={showClosed} />
          : layout === "board" ? <_WP_Board tickets={shown} columns={boardCols} activeId={open?.id} onOpen={setOpen} onMove={move}
            onReorder={target.platform !== "linear" && !state.loading ? reorderColumns : null} />
          : <_WP_List tickets={shown} activeId={open?.id} onOpen={setOpen} />
        }
        {!state.loading && !state.error && items.length === 0 && (
          <div className="wp-empty-line pad">
            {kind === "mrs" ? OMP_TR("No merge requests in this view yet.") : kind === "pipelines" ? OMP_TR("No pipelines in this view yet.") : OMP_TR("No tickets in this view yet.")}
          </div>
        )}
        {!state.loading && filteredOut && (
          <div className="wp-empty-line pad">
            {kind === "mrs" ? OMP_TR("No merge requests match the active filter.") : kind === "pipelines" ? OMP_TR("No pipelines match the active filter.") : OMP_TR("No tickets match the active filter.")}{" "}
            <button type="button" className="btn ghost small" onClick={() => { setQ(""); setWhoFilter(""); setLabelFilter(""); }}>{OMP_TR("Clear filters")}</button>
          </div>
        )}
        {!state.loading && onlyClosedHidden && (
          <div className="wp-empty-line pad">
            {OMP_TR("All {n} tickets are closed.", { n: items.length })}{" "}
            <button type="button" className="btn ghost small" onClick={() => setShowClosed(true)}>{OMP_TR("Show closed tickets")}</button>
          </div>
        )}
      </div>
      {open && <div className="wp-drawer-scrim" onClick={() => setOpen(null)} aria-hidden="true" />}
      {open && kind === "issues" && <_WP_Drawer ticket={open} client={client} columns={columns} onAddToChat={onAddToChat} onClose={() => setOpen(null)} onSaved={replace} />}
      {open && kind === "mrs" && <MrDrawer mr={open} client={client} onClose={() => setOpen(null)} onChanged={replace} />}
      {open && kind === "pipelines" && <PipeDrawer pipe={open} client={client} onClose={() => setOpen(null)} onChanged={replace} />}
    </div>
  );
}

Object.assign(window, { WorkPanel, _wpRun, _wpAgo });
