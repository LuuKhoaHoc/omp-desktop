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
  return (
    <div className="wp-drawer-head">
      <span className="wp-key mono">{k}</span>
      <_WPR_Tone tone={tone}>{label}</_WPR_Tone>
      <span style={{ flex: 1 }} />
      {url && <button className="btn icon ghost" title="open in browser" aria-label="open in browser" onClick={() => _wprOpen(url)}><_WPR_Icon name="external" size={13} /></button>}
      <button className="btn icon ghost" title="close (Esc)" aria-label="close" onClick={onClose}><_WPR_Icon name="close" size={13} /></button>
    </div>
  );
}

// ── Comment threads (issues and MRs) ──────────────────────────────────────
// `threads`: OMP_WORK.parseDiscussions output, null while loading. Resolved
// threads fold to one line; a click opens them.
function _WPR_Notes({ threads, error }) {
  const [openIds, setOpenIds] = React.useState(() => new Set());
  if (error) return <div className="wp-note err"><_WPR_Icon name="warn" size={12} /> Comments: {error}</div>;
  if (!threads) return <div className="wp-notes-head">Comments <span className="wp-dim">loading…</span></div>;
  const open = id => setOpenIds(s => new Set(s).add(id));
  const unresolved = threads.filter(t => t.resolvable && !t.resolved).length;
  return (
    <section className="wp-notes" aria-label="comments">
      <div className="wp-notes-head">Comments <span className="wp-dim">{threads.length}{unresolved ? ` · ${unresolved} open thread${unresolved > 1 ? "s" : ""}` : ""}</span></div>
      {threads.length === 0 && <span className="wp-empty-line">No comments yet.</span>}
      {threads.map(t => {
        const folded = t.resolved && t.resolvable && !openIds.has(t.id);
        const first = t.notes[0];
        return (
          <article key={t.id} className={`wp-thread${t.resolvable && !t.resolved ? " open" : ""}${t.resolved && t.resolvable ? " resolved" : ""}`}>
            {t.file && <div className="wp-thread-file mono">{t.file}</div>}
            {folded
              ? <button className="wp-thread-fold" onClick={() => open(t.id)}>
                  <_WPR_Icon name="check" size={11} /> Resolved · <b>{first.author}</b>: {first.body.replace(/\s+/g, " ").slice(0, 90)}{t.notes.length > 1 ? ` · ${t.notes.length - 1} repl${t.notes.length > 2 ? "ies" : "y"}` : ""}
                </button>
              : t.notes.map(n => (
                  <div key={n.id} className="wp-note-item">
                    <div className="wp-note-meta"><b title={n.name}>{n.author}</b> <span className="wp-dim mono">{window._wpAgo(n.createdAt)} ago{n.edited ? " · edited" : ""}</span></div>
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
  return (
    <div className="wp-list" role="list">
      {items.map(m => (
        <button key={m.id} role="listitem" className={`wp-row${m.id === activeId ? " on" : ""}`} onClick={() => onOpen(m)}>
          <span className={`wp-dot tone ${m.tone}`} aria-hidden="true" />
          <span className="wp-key mono" title={m.raw?.references?.full ?? m.key}>{m.key}</span>
          <span className="wp-row-title">{m.draft ? <em className="wp-draft">Draft</em> : null}{m.title}</span>
          <span className="wp-row-col" title={`${m.author} · ${m.statusLabel}`}>{m.author} · {m.statusLabel}</span>
          <span className="wp-row-ago mono">{window._wpAgo(m.updatedAt)}</span>
        </button>
      ))}
    </div>
  );
}

function _WP_PipeList({ items, activeId, onOpen }) {
  return (
    <div className="wp-list" role="list">
      {items.map(p => (
        <button key={p.id} role="listitem" className={`wp-row${p.id === activeId ? " on" : ""}`} onClick={() => onOpen(p)}>
          <span className={`wp-dot tone ${p.tone}`} aria-hidden="true" />
          <span className="wp-key mono">{p.key}</span>
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
  const open = mr.state === "opened";
  const mergeable = open && mr.status === "mergeable";
  return (
    <aside className="wp-drawer" aria-label={`merge request ${mr.key}`} onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <_WPR_Head k={mr.key} tone={mr.tone} label={mr.statusLabel} url={mr.url} onClose={onClose} />
      <div className="wp-drawer-body">
        <div className="wp-mr-title">{mr.draft && <em className="wp-draft">Draft</em>}{mr.title}</div>
        <div className="wp-meta">
          <span><_WPR_Icon name="agent" size={11} /> {mr.author}</span>
          <span className="mono">{mr.source} → {mr.target}</span>
          {mr.updatedAt && <span><_WPR_Icon name="clock" size={11} /> {window._wpAgo(mr.updatedAt)} ago</span>}
        </div>
        <div className="wp-facts">
          <span>Reviewers</span><span>{mr.reviewers.join(", ") || "none"}</span>
          <span>Approvals</span><span>{ap ? `${ap.by.join(", ") || "none"}${ap.left ? ` · ${ap.left} more needed` : ""}` : "…"}</span>
          <span>Pipeline</span>
          <span>{mr.pipeline
            ? <><_WPR_Tone tone={mr.pipeline.tone}>{mr.pipeline.status}</_WPR_Tone>
                {mr.pipeline.status === "failed" && <button className="btn ghost small" disabled={busy} onClick={() => act(() => client.retry(mr.pipeline.id), "Pipeline restarted.")}>Retry</button>}
                <button className="btn ghost small" onClick={() => _wprOpen(mr.pipeline.url)}>Open</button></>
            : "none"}</span>
          {mr.labels.length > 0 && <><span>Labels</span><span>{mr.labels.join(", ")}</span></>}
        </div>
        <div className="wp-body-preview">{mr.body.trim() ? <_WPR_Markdown text={mr.body} /> : <span className="wp-empty-line">No description.</span>}</div>
        <_WPR_Notes threads={threads} error={notesErr} />
        {err && <div className="wp-note err"><_WPR_Icon name="warn" size={12} /> {err}</div>}
        <div className="wp-comment">
          <textarea value={comment} rows={2} placeholder="Write a comment (markdown)…" onChange={e => setComment(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && comment.trim()) { e.preventDefault(); act(() => client.comment(mr, comment.trim()), "Comment posted.").then(ok => ok && setComment("")); } }} />
          <button className="btn outlined" disabled={!comment.trim() || busy} title="post comment (Ctrl+Enter)"
            onClick={() => act(() => client.comment(mr, comment.trim()), "Comment posted.").then(ok => ok && setComment(""))}>Comment</button>
        </div>
      </div>
      <div className="wp-drawer-foot">
        {confirm ? (
          <>
            <span className="wp-confirm">Merge <b className="mono">{mr.source}</b> into <b className="mono">{mr.target}</b>?</span>
            <span style={{ flex: 1 }} />
            <button className="btn ghost" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button>
            <button className="btn primary" disabled={busy} autoFocus
              onClick={() => act(async () => { onChanged(await client.merge(mr)); setConfirm(false); }, "Merged.")}>{busy ? "Merging…" : "Merge"}</button>
          </>
        ) : (
          <>
            {note && <span className="wp-ok">{note}</span>}
            <span style={{ flex: 1 }} />
            {open && ap?.mine && <button className="btn ghost" disabled={busy} onClick={() => act(() => client.unapprove(mr), "Approval revoked.")}>Revoke approval</button>}
            {open && ap && !ap.mine && ap.can && <button className="btn outlined" disabled={busy} onClick={() => act(() => client.approve(mr), "Approved.")}>Approve</button>}
            {open && <button className="btn primary" disabled={busy || !mergeable} title={mergeable ? "merge (asks first)" : `not mergeable: ${mr.statusLabel}`}
              onClick={() => setConfirm(true)}>Merge…</button>}
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
  const retry = async () => {
    setBusy(true); setErr(null);
    try { onChanged(await client.retry(pipe.id)); await load(); } catch (e) { setErr(_wprErr(e)); } finally { setBusy(false); }
  };
  return (
    <aside className="wp-drawer" aria-label={`pipeline ${pipe.key}`} onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <_WPR_Head k={pipe.key} tone={pipe.tone} label={pipe.status} url={pipe.url} onClose={onClose} />
      <div className="wp-drawer-body">
        <div className="wp-meta">
          <span className="mono">{pipe.ref}</span><span className="mono">{pipe.sha}</span><span>{pipe.source.replace(/_/g, " ")}</span>
          {pipe.updatedAt && <span><_WPR_Icon name="clock" size={11} /> {window._wpAgo(pipe.updatedAt)} ago</span>}
        </div>
        {err && <div className="wp-note err"><_WPR_Icon name="warn" size={12} /> {err}</div>}
        {!jobs && !err && <span className="wp-loading">loading jobs…</span>}
        {jobs && R.stages(jobs).map(s => (
          <section key={s.name} className="wp-stage">
            <header>{s.name}</header>
            {s.jobs.map(j => (
              <button key={j.id} className="wp-job" onClick={() => _wprOpen(j.url)} title="open job log in browser">
                <span className={`wp-dot tone ${j.tone}`} aria-hidden="true" />
                <span className="wp-job-name">{j.name}</span>
                <span className="wp-dim">{j.status}</span>
                <span className="wp-dim mono">{j.duration ? `${Math.round(j.duration)}s` : ""}</span>
              </button>
            ))}
          </section>
        ))}
        {jobs && jobs.length === 0 && <span className="wp-empty-line">No jobs.</span>}
      </div>
      <div className="wp-drawer-foot">
        <span className="wp-dim">Cancel from the browser.</span>
        <span style={{ flex: 1 }} />
        {(pipe.status === "failed" || pipe.status === "canceled") && <button className="btn primary" disabled={busy} onClick={retry}>{busy ? "Retrying…" : "Retry failed jobs"}</button>}
      </div>
    </aside>
  );
}

Object.assign(window, { _WP_MrList, _WP_PipeList, _WP_MrDrawer, _WP_PipeDrawer });
