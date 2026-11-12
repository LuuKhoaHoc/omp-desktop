/* ═════════════════════════════════════════════════════════════════════
   design/insights-panel.jsx — the Insights panel (fork): header tabs,
   actionable empty state, test cases and document analysis beside the
   chat. Diagram rendering lives in design/insights-diagrams.jsx.
   Data: `<project>/.omp/insights/` read by Rust (`insights_read`).
   ═════════════════════════════════════════════════════════════════════ */

const { Icon: _IP_Icon } = window;
const _IP_POLL_MS = 4000;
const _IP_STATUS = ["untested", "pass", "fail", "blocked"];
const _IP_EMPTY_ARR = [];

function _ipStatusLabel(s) {
  if (s === "all") return OMP_TR("all");
  if (s === "untested") return OMP_TR("untested");
  if (s === "pass") return OMP_TR("pass");
  if (s === "fail") return OMP_TR("fail");
  if (s === "blocked") return OMP_TR("blocked");
  return s;
}

// A two-step delete: the first click asks, the second within 4 s deletes.
function _IP_Delete({ label, onDelete }) {
  const [ask, setAsk] = React.useState(false);
  React.useEffect(() => { if (!ask) return; const id = setTimeout(() => setAsk(false), 4000); return () => clearTimeout(id); }, [ask]);
  return (
    <button type="button" className={`btn ghost small${ask ? " danger" : ""}`} title={OMP_TR("Delete {label}", { label })}
      onClick={() => (ask ? (setAsk(false), onDelete()) : setAsk(true))}>
      {ask ? OMP_TR("Delete?") : <_IP_Icon name="trash" size={12} />}
    </button>
  );
}

// The source picker above Test cases and Document: one chip per file, a
// delete button for the selected one, "Add document" at the end.
function _IP_Sources({ items, sel, onSel, all, labelOf, onDelete, onAdd }) {
  const cur = items.find(it => it.file === sel);
  return (
    <div className="ip-filter ip-sources">
      <div className="wp-seg small ip-source-seg">
        {all && <button type="button" className={sel === null ? "on" : ""} onClick={() => onSel(null)}>{OMP_TR("All")}</button>}
        {items.map(it => (
          <button type="button" key={it.file} className={sel === it.file ? "on" : ""} title={it.file} onClick={() => onSel(it.file)}>{labelOf(it)}</button>
        ))}
      </div>
      {cur && onDelete && <_IP_Delete label={cur.file} onDelete={() => onDelete(cur.file)} />}
      <span style={{ flex: 1 }} />
      {onAdd && <button type="button" className="btn ghost small" onClick={onAdd}><_IP_Icon name="plus" size={12} /> {OMP_TR("Add document")}</button>}
    </div>
  );
}

const _ipSlug = file => String(file).replace(/^.*\//, "").replace(/\.json$/i, "");

function _IP_Cases({ sets, onDelete, onAdd }) {
  const [sel, setSel] = React.useState(null);
  const valid = sets.filter(s => Array.isArray(s.data?.cases));
  const pick = valid.some(s => s.file === sel) ? sel : null;
  const cases = valid.filter(s => pick === null || s.file === pick)
    .flatMap(s => s.data.cases.map(c => ({ ...c, _key: `${s.file}#${c.id}` })));
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [openId, setOpenId] = React.useState(null);
  const counts = Object.fromEntries(_IP_STATUS.map(s => [s, cases.filter(c => (c.status ?? "untested") === s).length]));
  const needle = q.trim().toLowerCase();
  const shown = cases.filter(c => (status === "all" || (c.status ?? "untested") === status)
    && (!needle || `${c.id} ${c.title} ${c.requirement ?? ""}`.toLowerCase().includes(needle)));
  const sources = (valid.length > 1 || onAdd) && (
    <_IP_Sources items={valid} sel={pick} onSel={setSel} all={valid.length > 1}
      labelOf={it => `${_ipSlug(it.file)} · ${it.data.cases.length}`}
      onDelete={pick !== null || valid.length === 1 ? f => { onDelete(f); setSel(null); } : null} onAdd={onAdd} />
  );
  const broken = sets.filter(s => !Array.isArray(s.data?.cases)).map(s => (
    <div key={s.file} className="wp-note err ip-broken">{s.data?.error ?? OMP_TR("{file}: no \"cases\" list", { file: s.file })} {onDelete && <_IP_Delete label={s.file} onDelete={() => onDelete(s.file)} />}</div>
  ));
  if (!cases.length) return <div className="ip-cases">{sources}{broken}<div className="wp-empty-line pad">{OMP_TR("No test cases yet.")}</div></div>;
  const pct = s => `${(counts[s] / cases.length) * 100}%`;
  return (
    <div className="ip-cases">
      {sources}
      {broken}
      <div className="ip-progress-wrap">
        <div className="ip-progress-meta">
          {_IP_STATUS.filter(s => counts[s] > 0).map(s => (
            <span key={s} className="ip-progress-stat">
              <span className={`ip-st ${s}`} aria-hidden="true" />
              <span>{counts[s]} {_ipStatusLabel(s)}</span>
            </span>
          ))}
        </div>
        <div className="ip-progress" aria-label={OMP_TR("test status")}>
          {_IP_STATUS.filter(s => counts[s]).map(s => <i key={s} className={s} style={{ width: pct(s) }} title={`${_ipStatusLabel(s)}: ${counts[s]}`} />)}
        </div>
      </div>
      <div className="ip-filter">
        <div className="wp-seg small">
          {["all", ..._IP_STATUS].map(s => (
            <button type="button" key={s} className={status === s ? "on" : ""} onClick={() => setStatus(s)}>
              {s !== "all" && <span className={`ip-st ${s}`} aria-hidden="true" />}
              <span>{_ipStatusLabel(s)}</span>
              <span className="wp-count">{s === "all" ? cases.length : counts[s]}</span>
            </button>
          ))}
        </div>
        <input type="search" value={q} placeholder={OMP_TR("Filter cases…")} onChange={e => setQ(e.target.value)} aria-label={OMP_TR("filter test cases")} />
      </div>
      <div className="ip-case-list">
        {shown.map(c => {
          const st = c.status ?? "untested", isOpen = openId === c._key;
          return (
            <div key={c._key} className={`ip-case${isOpen ? " open" : ""}`}>
              <button type="button" className="ip-case-head" aria-expanded={isOpen} onClick={() => setOpenId(isOpen ? null : c._key)}>
                <span className={`ip-st ${st}`} title={_ipStatusLabel(st)} />
                <span className="mono ip-case-id">{c.id}</span>
                <span className="ip-case-title">{c.title}</span>
                {c.priority && <span className={`ip-pri p-${String(c.priority).toLowerCase()}`}>{c.priority}</span>}
                <_IP_Icon name="chev" size={11} />
              </button>
              {isOpen && (
                <div className="ip-case-body">
                  <div className="ip-case-meta">
                    {c.requirement && <span>{OMP_TR("Requirement")} <b className="mono">{c.requirement}</b></span>}
                    {c.type && <span>{OMP_TR("Type")} <b>{c.type}</b></span>}
                  </div>
                  {c.preconditions && <p className="ip-pre"><b>{OMP_TR("Preconditions")}</b> {Array.isArray(c.preconditions) ? c.preconditions.join("; ") : c.preconditions}</p>}
                  <ol className="ip-steps">
                    {(c.steps ?? []).map((s, i) => (
                      <li key={i}>
                        <span>{typeof s === "string" ? s : s.action}</span>
                        {typeof s === "object" && s.expected && <span className="ip-exp">→ {s.expected}</span>}
                      </li>
                    ))}
                  </ol>
                  {c.expected && <p className="ip-pre"><b>{OMP_TR("Expected")}</b> {c.expected}</p>}
                </div>
              )}
            </div>
          );
        })}
        {shown.length === 0 && (
          <div className="wp-empty-line pad">
            {OMP_TR("No cases match the active filter.")}{" "}
            {(q || status !== "all") && (
              <button type="button" className="btn ghost small" onClick={() => { setQ(""); setStatus("all"); }}>{OMP_TR("Clear filters")}</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function _IP_Docs({ docs, onDelete, onAdd }) {
  const [sel, setSel] = React.useState(null);
  const cur = docs.find(d => d.file === sel) ?? docs[docs.length - 1];
  return (
    <div className="ip-docs">
      <_IP_Sources items={docs} sel={cur?.file} onSel={setSel} labelOf={d => d.data?.title || _ipSlug(d.file)}
        onDelete={f => { onDelete(f); setSel(null); }} onAdd={onAdd} />
      {cur ? <_IP_Doc doc={cur.data} /> : <div className="wp-empty-line pad">{OMP_TR("No document analysis yet.")}</div>}
    </div>
  );
}
function _IP_Doc({ doc }) {
  if (doc.error) return <div className="wp-note err">{doc.error}</div>;
  return (
    <div className="ip-doc">
      <div className="ip-doc-title">{doc.title}</div>
      {doc.source && <div className="ip-doc-src mono">{doc.source}</div>}
      {doc.summary && <p className="ip-doc-summary">{doc.summary}</p>}
      {(doc.sections ?? []).map((s, i) => (
        <section key={i} className="ip-doc-sec">
          <h4>{s.heading}</h4>
          <ul>{(s.points ?? []).map((p, j) => <li key={j}>{p}</li>)}</ul>
        </section>
      ))}
      {(doc.requirements ?? []).length > 0 && (
        <section className="ip-doc-sec">
          <h4>{OMP_TR("Requirements")}</h4>
          <table className="ip-req">
            <tbody>{doc.requirements.map(r => (
              <tr key={r.id}><td className="mono">{r.id}</td><td>{r.text}</td><td>{r.priority && <span className={`ip-pri p-${String(r.priority).toLowerCase()}`}>{r.priority}</span>}</td></tr>
            ))}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function _IP_Empty({ onAsk, prompt }) {
  const [pickSkill, setPickSkill] = React.useState(false);
  const { _IP_SKILLS: skills = [], _ipSkillPrompt: skillPrompt } = window;
  const casesPrompt = "Read the document or feature I attach. Pick a short kebab-case slug (not one already used in .omp/insights/testcases/) and write .omp/insights/testcases/<slug>.json in the format of docs/insights.md in omp-desktop.";
  const docPrompt = "Read the document I attach. Pick a short kebab-case slug (not one already used in .omp/insights/docs/) and write .omp/insights/docs/<slug>.json with summary, sections, and prioritized requirements in the format of docs/insights.md in omp-desktop.";
  return (
    <div className="ip-empty-shell">
      <div className="ip-empty-hero">
        <div className="ip-empty-icon" aria-hidden="true"><_IP_Icon name="test" size={18} /></div>
        <div className="ip-empty-copy">
          <h3>{OMP_TR("Project Insights")}</h3>
          <p>{OMP_TR("Ask the agent to analyze a spec, codebase, or flow. Outputs save into `.omp/insights/` and appear live here.").split("`").map((p, i) => (i % 2 ? <code key={i} className="mono">{p}</code> : <React.Fragment key={i}>{p}</React.Fragment>))}</p>
        </div>
      </div>
      <div className="ip-action-list">
        <div className="ip-action-item">
          <button type="button" className="ip-action-row" disabled={!onAsk} aria-expanded={pickSkill}
            onClick={() => setPickSkill(v => !v)}>
            <span className="ip-action-ico" aria-hidden="true"><_IP_Icon name="layers" size={14} /></span>
            <span className="ip-action-meta">
              <span className="ip-action-name">{OMP_TR("Architecture & Flow Diagrams")}</span>
              <span className="ip-action-desc">{OMP_TR("Generate Mermaid flowcharts, sequence, state, ER, SVG or Excalidraw sketches")}</span>
            </span>
            <span className="ip-action-go" aria-hidden="true"><_IP_Icon name={pickSkill ? "chev" : "chevR"} size={12} /></span>
          </button>
          {pickSkill && onAsk && (
            <div className="ip-skill-drawer">
              {skills.map(s => {
                const meta = window._ipSkillText?.(s) ?? s;
                return (
                  <button key={s.id} type="button" className="ip-skill-chip" onClick={() => onAsk(skillPrompt(s))}>
                    <span className="ip-skill-chip-head">{meta.label} <span className="ip-kind">.{s.ext}</span></span>
                    <span className="ip-skill-chip-hint">{meta.hint}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="ip-action-item">
          <button type="button" className="ip-action-row" disabled={!onAsk} onClick={() => onAsk?.(casesPrompt)}>
            <span className="ip-action-ico" aria-hidden="true"><_IP_Icon name="plan" size={14} /></span>
            <span className="ip-action-meta">
              <span className="ip-action-name">{OMP_TR("Test Case Suite")}</span>
              <span className="ip-action-desc">{OMP_TR("Extract structured test scenarios, preconditions, steps & expected outcomes")}</span>
            </span>
            <span className="ip-action-go" aria-hidden="true"><_IP_Icon name="chevR" size={12} /></span>
          </button>
        </div>
        <div className="ip-action-item">
          <button type="button" className="ip-action-row" disabled={!onAsk} onClick={() => onAsk?.(docPrompt)}>
            <span className="ip-action-ico" aria-hidden="true"><_IP_Icon name="file" size={14} /></span>
            <span className="ip-action-meta">
              <span className="ip-action-name">{OMP_TR("Document Spec Breakdown")}</span>
              <span className="ip-action-desc">{OMP_TR("Summarize PRDs and extract prioritized requirement tables")}</span>
            </span>
            <span className="ip-action-go" aria-hidden="true"><_IP_Icon name="chevR" size={12} /></span>
          </button>
        </div>
      </div>
      {onAsk && (
        <div className="ip-empty-foot">
          <button type="button" className="btn primary" onClick={() => onAsk(prompt)}>
            {OMP_TR("Analyze attached document (all-in-one)")}
          </button>
        </div>
      )}
    </div>
  );
}

function InsightsPanel({ projectPath, onAsk }) {
  const [data, setData] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [tab, setTab] = React.useState("diagrams");
  React.useEffect(() => {
    setData(null); setErr(null);
    if (!projectPath) return;
    const inv = window.__TAURI__?.core?.invoke;
    if (!inv) { setErr("Insights needs the desktop app."); return; }
    let live = true, last = "";
    const load = () => inv("insights_read", { project: projectPath })
      .then(v => { const s = JSON.stringify(v); if (live && s !== last) { last = s; setData(v); } setErr(null); })
      .catch(e => live && setErr(String(e)));
    reload.current = load;
    load();
    const onVis = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVis);
    const id = setInterval(() => { if (!document.hidden) load(); }, _IP_POLL_MS);
    return () => { live = false; clearInterval(id); document.removeEventListener("visibilitychange", onVis); reload.current = null; };
  }, [projectPath]);
  const reload = React.useRef(null);
  const remove = React.useCallback(file => {
    window.__TAURI__.core.invoke("insights_delete", { project: projectPath, file })
      .then(() => reload.current?.(), e => setErr(String(e)));
  }, [projectPath]);

  const diagrams = data?.diagrams ?? _IP_EMPTY_ARR;
  const sets = data?.testcases ?? _IP_EMPTY_ARR;
  const docs = data?.docs ?? _IP_EMPTY_ARR;
  const nCases = sets.reduce((n, s) => n + (Array.isArray(s.data?.cases) ? s.data.cases.length : 0), 0);
  const tabs = [
    { id: "diagrams", label: OMP_TR("Diagrams"), n: diagrams.length },
    { id: "cases", label: OMP_TR("Test cases"), n: nCases },
    { id: "doc", label: OMP_TR("Documents"), n: docs.length },
  ];
  const prompt = "Read the document I attach. Pick a short kebab-case slug for it (not one already used in .omp/insights/docs/). Draw its flows as Mermaid diagrams in .omp/insights/diagrams/<slug>-*.mmd (one diagram per file: flowchart for business flows, sequenceDiagram for FE/BE/API calls, stateDiagram-v2 for statuses, erDiagram for data; first line `%% title: <name>`), and write .omp/insights/docs/<slug>.json and .omp/insights/testcases/<slug>.json in the formats the Insights panel expects (see docs/insights.md in omp-desktop). Do not touch other documents' files.";
  const add = onAsk ? () => onAsk(prompt) : null;
  const Diagrams = window._IP_Diagrams;

  return (
    <div className="wp-panel ip-panel">
      <div className="wp-head ip-head">
        <span className="ip-brand"><_IP_Icon name="test" size={14} /><span>{OMP_TR("Insights")}</span></span>
        <span className="ip-head-sep" aria-hidden="true" />
        <div className="wp-seg small ip-tabs" role="tablist" aria-label={OMP_TR("Insights sections")}>
          {tabs.map(t => (
            <button type="button" key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
              <span>{t.label}</span>{t.n > 0 && <span className="wp-count">{t.n}</span>}
            </button>
          ))}
        </div>
      </div>
      {err && <div className="wp-note err wp-banner"><_IP_Icon name="warn" size={12} /> {err === "Insights needs the desktop app." ? OMP_TR("Insights needs the desktop app.") : err}</div>}
      <div className="wp-scroll ip-scroll">
        {!projectPath && <div className="wp-empty"><div className="wp-empty-title">{OMP_TR("Open a project")}</div><p>{OMP_TR("Insights read the project's .omp/insights folder.")}</p></div>}
        {projectPath && !data && !err && <div className="wp-empty-line pad" role="status">{OMP_TR("Loading insights…")}</div>}
        {projectPath && data && !data.exists && <_IP_Empty onAsk={onAsk} prompt={prompt} />}
        {data?.exists && (
          <div key={tab} className="ip-tab-stage">
            {tab === "diagrams" && Diagrams && <Diagrams diagrams={diagrams} onAsk={onAsk} onDelete={remove} />}
            {tab === "cases" && <_IP_Cases sets={sets} onDelete={remove} onAdd={add} />}
            {tab === "doc" && <_IP_Docs docs={docs} onDelete={remove} onAdd={add} />}
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { InsightsPanel, _IP_Delete });
