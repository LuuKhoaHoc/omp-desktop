/* ═════════════════════════════════════════════════════════════════════
   design/work-review.jsx — merge request and pipeline views of the Work
   panel (fork). Rows plus a drawer each; the logic is app/work-review.js.

   The MR drawer comments, approves / revokes, and merges after an inline
   confirmation. Merge sends the HEAD sha the drawer shows, never an
   auto-merge. The pipeline drawer lists jobs by stage and retries a failed
   pipeline; cancelling stays in the browser.
   ═════════════════════════════════════════════════════════════════════ */

const { Icon: _WPR_Icon, MarkdownContent: _WPR_Markdown } = window;

const _wprOpen = url => window.OMP_BRIDGE?.openExternalUrl?.(url) ?? window.__TAURI__?.core?.invoke("open_url_external", { url });
const _wprErr = e => String(e?.message ?? e);

function _WPR_Tone({ tone, children }) {
  return <span className={`wp-tone ${tone}`}>{children}</span>;
}

function _WPR_Head({ k, tone, label, url, onClose }) {
  const Key = window._WP_Key;
  return (
    <div className="wp-drawer-head">
      <Key k={k} />
      <_WPR_Tone tone={tone}>{label}</_WPR_Tone>
      <span style={{ flex: 1 }} />
      {url && <button type="button" className="btn icon ghost" title={OMP_TR("open in browser")} aria-label={OMP_TR("open in browser")} onClick={() => _wprOpen(url)}><_WPR_Icon name="external" size={13} /></button>}
      <button type="button" className="btn icon ghost" title={OMP_TR("close (Esc)")} aria-label={OMP_TR("close")} onClick={onClose}><_WPR_Icon name="close" size={13} /></button>
    </div>
  );
}

// ── Comment threads (issues and MRs) ──────────────────────────────────────
// `threads`: OMP_WORK.parseDiscussions output, null while loading. Resolved
// threads fold to one line; a click opens them.
function _WPR_Notes({ threads, error }) {
  const [openIds, setOpenIds] = React.useState(() => new Set());
  if (error) return <div className="wp-note err"><_WPR_Icon name="warn" size={12} /> {OMP_TR("Comments: {err}", { err: error })}</div>;
  if (!threads) return <div className="wp-notes-head">{OMP_TR("Comments")} <span className="wp-dim">{OMP_TR("loading…")}</span></div>;
  const open = id => setOpenIds(s => new Set(s).add(id));
  const unresolved = threads.filter(t => t.resolvable && !t.resolved).length;
  return (
    <section className="wp-notes" aria-label={OMP_TR("comments")}>
      <div className="wp-notes-head">{OMP_TR("Comments")} <span className="wp-dim">{threads.length}{unresolved ? ` · ${OMP_I18N.plural(unresolved, "{n} open thread", "{n} open threads")}` : ""}</span></div>
      {threads.length === 0 && <span className="wp-empty-line">{OMP_TR("No comments yet.")}</span>}
      {threads.map(t => {
        const openThread = t.resolvable && !t.resolved;
        const folded = t.resolved && t.resolvable && !openIds.has(t.id);
        const first = t.notes[0];
        return (
          <article key={t.id} className={`wp-thread${openThread ? " open" : ""}${t.resolved && t.resolvable ? " resolved" : ""}`}>
            {(t.file || openThread) && (
              <div className="wp-thread-head">
                {openThread && (
                  <span className="wp-thread-state">
                    <span className="wp-dot tone warn" aria-hidden="true" />
                    {OMP_TR("Open thread")}
                  </span>
                )}
                {t.file && <div className="wp-thread-file mono">{t.file}</div>}
              </div>
            )}
            {folded
              ? <button type="button" className="wp-thread-fold" onClick={() => open(t.id)}>
                  <_WPR_Icon name="check" size={11} /> {OMP_TR("Resolved")} · <b>{first.author}</b>: {first.body.replace(/\s+/g, " ").slice(0, 90)}{t.notes.length > 1 ? ` · ${OMP_I18N.plural(t.notes.length - 1, "{n} reply", "{n} replies")}` : ""}
                </button>
              : t.notes.map(n => (
                  <div key={n.id} className="wp-note-item">
                    <div className="wp-note-meta"><b title={n.name}>{n.author}</b> <span className="wp-dim mono">{OMP_TR("{ago} ago", { ago: window._wpAgo(n.createdAt) })}{n.edited ? ` · ${OMP_TR("edited")}` : ""}</span></div>
                    <div className="wp-note-body"><_WPR_Markdown text={n.body} /></div>
                  </div>
                ))}
          </article>
        );
      })}
    </section>
  );
}

// ── Lists ─────────────────────────────────────────────────────────────────
function _WP_MrList({ items, activeId, onOpen }) {
  const Key = window._WP_Key;
  return (
    <div className="wp-list" role="list">
      {items.map(m => (
        <button type="button" key={m.id} role="listitem" className={`wp-row${m.id === activeId ? " on" : ""}`} onClick={() => onOpen(m)}>
          <span className={`wp-dot tone ${m.tone}`} aria-hidden="true" />
          <Key k={m.key} full={m.raw?.references?.full} />
          <span className="wp-row-title">{m.draft ? <em className="wp-draft">{OMP_TR("Draft")}</em> : null}{m.title}</span>
          <span className="wp-row-col" title={`${m.author} · ${m.statusLabel}`}>{m.author} · {m.statusLabel}</span>
          <span className="wp-row-ago mono">{window._wpAgo(m.updatedAt)}</span>
        </button>
      ))}
    </div>
  );
}

function _WP_PipeList({ items, activeId, onOpen }) {
  const Key = window._WP_Key;
  return (
    <div className="wp-list" role="list">
      {items.map(p => (
        <button type="button" key={p.id} role="listitem" className={`wp-row${p.id === activeId ? " on" : ""}`} onClick={() => onOpen(p)}>
          <span className={`wp-dot tone ${p.tone}`} aria-hidden="true" />
          <Key k={p.key} />
          <span className="wp-row-title"><span className="mono">{p.ref}</span> <span className="wp-dim mono">{p.sha}</span></span>
          <span className="wp-row-col">{p.status}</span>
          <span className="wp-row-ago mono">{window._wpAgo(p.updatedAt)}</span>
        </button>
      ))}
    </div>
  );
}

// ── Merge request drawer ──────────────────────────────────────────────────
function _WP_MrDrawer({ mr: initial, client, onClose, onChanged }) {
  const [mr, setMr] = React.useState(initial);
  const [ap, setAp] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const [note, setNote] = React.useState(null);
  const [comment, setComment] = React.useState("");
  const [confirm, setConfirm] = React.useState(false);
  const [threads, setThreads] = React.useState(null);
  const [notesErr, setNotesErr] = React.useState(null);
  const load = React.useCallback(async () => {
    // Comments load on their own: a failure there leaves the MR usable.
    client.notes(initial.id).then(t => { setThreads(t); setNotesErr(null); }, e => setNotesErr(_wprErr(e)));
    try { const [m, a] = await Promise.all([client.getMr(initial.id), client.approvals(initial.id)]); setMr(m); setAp(a); onChanged(m); }
    catch (e) { setErr(_wprErr(e)); }
  }, [initial.id, client]); // eslint-disable-line
  React.useEffect(() => { setMr(initial); setAp(null); setThreads(null); setNotesErr(null); setErr(null); setConfirm(false); load(); }, [initial.id]); // eslint-disable-line
  React.useEffect(() => { if (!note) return; const id = setTimeout(() => setNote(null), 2400); return () => clearTimeout(id); }, [note]);
  const act = async (fn, done) => {
    setBusy(true); setErr(null);
    try { await fn(); setNote(done); await load(); return true; } catch (e) { setErr(_wprErr(e)); return false; } finally { setBusy(false); }
  };
  const panelRef = React.useRef(null);
  window._wpUseDialog(panelRef, true, onClose);
  const open = mr.state === "opened";
  const mergeable = open && mr.status === "mergeable";
  return (
    <aside ref={panelRef} tabIndex={-1} role="dialog" className="wp-drawer" aria-label={OMP_TR("merge request {key}", { key: mr.key })}>
      <_WPR_Head k={mr.key} tone={mr.tone} label={mr.statusLabel} url={mr.url} onClose={onClose} />
      <div className="wp-drawer-body">
        <div className="wp-mr-title">{mr.draft && <em className="wp-draft">{OMP_TR("Draft")}</em>}{mr.title}</div>
        <div className="wp-meta">
          <span><_WPR_Icon name="agent" size={11} /> {mr.author}</span>
          <span className="mono">{mr.source} → {mr.target}</span>
          {mr.updatedAt && <span><_WPR_Icon name="clock" size={11} /> {OMP_TR("{ago} ago", { ago: window._wpAgo(mr.updatedAt) })}</span>}
        </div>
        <div className="wp-facts">
          <span>{OMP_TR("Reviewers")}</span><span>{mr.reviewers.join(", ") || OMP_TR("none")}</span>
          <span>{OMP_TR("Approvals")}</span><span>{ap ? `${ap.by.join(", ") || OMP_TR("none")}${ap.left ? ` · ${OMP_TR("{n} more needed", { n: ap.left })}` : ""}` : "…"}</span>
          <span>{OMP_TR("Pipeline")}</span>
          <span>{mr.pipeline
            ? <><_WPR_Tone tone={mr.pipeline.tone}>{mr.pipeline.status}</_WPR_Tone>
                {mr.pipeline.status === "failed" && <button type="button" className="btn ghost small" disabled={busy} onClick={() => act(() => client.retry(mr.pipeline.id), OMP_TR("Pipeline restarted."))}>{OMP_TR("Retry")}</button>}
                <button type="button" className="btn ghost small" onClick={() => _wprOpen(mr.pipeline.url)}>{OMP_TR("Open")}</button></>
            : OMP_TR("none")}</span>
          {mr.labels.length > 0 && <><span>{OMP_TR("Labels")}</span><span>{mr.labels.join(", ")}</span></>}
        </div>
        <div className="wp-body-preview">{mr.body.trim() ? <_WPR_Markdown text={mr.body} /> : <span className="wp-empty-line">{OMP_TR("No description.")}</span>}</div>
        <_WPR_Notes threads={threads} error={notesErr} />
        {err && <div className="wp-note err"><_WPR_Icon name="warn" size={12} /> {err}</div>}
        <div className="wp-comment">
          <textarea value={comment} rows={2} placeholder={OMP_TR("Write a comment (markdown)…")} onChange={e => setComment(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && comment.trim()) { e.preventDefault(); act(() => client.comment(mr, comment.trim()), OMP_TR("Comment posted.")).then(ok => ok && setComment("")); } }} />
          <button type="button" className="btn outlined" disabled={!comment.trim() || busy} title={OMP_TR("post comment (Ctrl+Enter)")}
            onClick={() => act(() => client.comment(mr, comment.trim()), OMP_TR("Comment posted.")).then(ok => ok && setComment(""))}>{OMP_TR("Comment")}</button>
        </div>
      </div>
      <div className="wp-drawer-foot">
        {confirm ? (
          <>
            <span className="wp-confirm">
              {OMP_TR("Merge {source} into {target}?", { source: "\u0000", target: "\u0001" }).split(/(\u0000|\u0001)/).map((part, i) => (
                part === "\u0000" ? <b key={i} className="mono">{mr.source}</b> : part === "\u0001" ? <b key={i} className="mono">{mr.target}</b> : <React.Fragment key={i}>{part}</React.Fragment>
              ))}
            </span>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setConfirm(false)}>{OMP_TR("Cancel")}</button>
            <button type="button" className="btn primary" disabled={busy} autoFocus
              onClick={() => act(async () => { onChanged(await client.merge(mr)); setConfirm(false); }, OMP_TR("Merged."))}>{busy ? OMP_TR("Merging…") : OMP_TR("Merge")}</button>
          </>
        ) : (
          <>
            {note && <span className="wp-ok">{note}</span>}
            <span style={{ flex: 1 }} />
            {open && ap?.mine && <button type="button" className="btn ghost" disabled={busy} onClick={() => act(() => client.unapprove(mr), OMP_TR("Approval revoked."))}>{OMP_TR("Revoke approval")}</button>}
            {open && ap && !ap.mine && ap.can && <button type="button" className="btn outlined" disabled={busy} onClick={() => act(() => client.approve(mr), OMP_TR("Approved."))}>{OMP_TR("Approve")}</button>}
            {open && <button type="button" className="btn primary" disabled={busy || !mergeable} title={mergeable ? OMP_TR("merge (asks first)") : OMP_TR("not mergeable: {status}", { status: mr.statusLabel })}
              onClick={() => setConfirm(true)}>{OMP_TR("Merge…")}</button>}
          </>
        )}
      </div>
    </aside>
  );
}

// ── Pipeline drawer ───────────────────────────────────────────────────────
function _WP_PipeDrawer({ pipe, client, onClose, onChanged }) {
  const R = window.OMP_WORK_REVIEW;
  const [jobs, setJobs] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const load = React.useCallback(async () => {
    try { setJobs(await client.jobs(pipe.id)); } catch (e) { setErr(_wprErr(e)); }
  }, [pipe.id, client]);
  React.useEffect(() => { setJobs(null); setErr(null); load(); }, [load]);
  const panelRef = React.useRef(null);
  window._wpUseDialog(panelRef, true, onClose);
  const retry = async () => {
    setBusy(true); setErr(null);
    try { onChanged(await client.retry(pipe.id)); await load(); } catch (e) { setErr(_wprErr(e)); } finally { setBusy(false); }
  };
  return (
    <aside ref={panelRef} tabIndex={-1} role="dialog" className="wp-drawer" aria-label={OMP_TR("pipeline {key}", { key: pipe.key })}>
      <_WPR_Head k={pipe.key} tone={pipe.tone} label={pipe.status} url={pipe.url} onClose={onClose} />
      <div className="wp-drawer-body">
        <div className="wp-meta">
          <span className="mono">{pipe.ref}</span><span className="mono">{pipe.sha}</span><span>{pipe.source.replace(/_/g, " ")}</span>
          {pipe.updatedAt && <span><_WPR_Icon name="clock" size={11} /> {OMP_TR("{ago} ago", { ago: window._wpAgo(pipe.updatedAt) })}</span>}
        </div>
        {err && <div className="wp-note err"><_WPR_Icon name="warn" size={12} /> {err}</div>}
        {!jobs && !err && <span className="wp-loading">{OMP_TR("loading jobs…")}</span>}
        {jobs && R.stages(jobs).map(s => (
          <section key={s.name} className="wp-stage">
            <header>{s.name}</header>
            {s.jobs.map(j => (
              <button type="button" key={j.id} className="wp-job" onClick={() => _wprOpen(j.url)} title={OMP_TR("open job log in browser")}>
                <span className={`wp-dot tone ${j.tone}`} aria-hidden="true" />
                <span className="wp-job-name">{j.name}</span>
                <span className="wp-dim">{j.status}</span>
                <span className="wp-dim mono">{j.duration ? `${Math.round(j.duration)}s` : ""}</span>
              </button>
            ))}
          </section>
        ))}
        {jobs && jobs.length === 0 && <span className="wp-empty-line">{OMP_TR("No jobs.")}</span>}
      </div>
      <div className="wp-drawer-foot">
        <span className="wp-dim">{OMP_TR("Cancel from the browser.")}</span>
        <span style={{ flex: 1 }} />
        {(pipe.status === "failed" || pipe.status === "canceled") && <button type="button" className="btn primary" disabled={busy} onClick={retry}>{busy ? OMP_TR("Retrying…") : OMP_TR("Retry failed jobs")}</button>}
      </div>
    </aside>
  );
}

Object.assign(window, { _WP_MrList, _WP_PipeList, _WP_MrDrawer, _WP_PipeDrawer });
