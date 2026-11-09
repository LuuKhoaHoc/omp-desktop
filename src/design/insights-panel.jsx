/* ═════════════════════════════════════════════════════════════════════
   design/insights-panel.jsx — the Insights panel (fork): diagrams, test
   cases and a document analysis that the agent writes into the project,
   drawn beside the chat. Data: `<project>/.omp/insights/` read by Rust
   (`insights_read`, src-tauri/src/work.rs), re-read every few seconds
   while the panel is open, so the agent's writes show up as it works.

   File formats (documented in docs/insights.md):
     doc-analysis.json  { title, source?, summary, sections?: [{ heading, points[] }],
                          requirements?: [{ id, text, priority? }] }
     testcases.json     { cases: [{ id, title, requirement?, priority?, type?,
                          preconditions?, steps: [string | { action, expected }],
                          expected?, status?: "untested"|"pass"|"fail"|"blocked" }] }
     diagrams/*         what the diagram skills write: .mmd/.mermaid
                          (Mermaid), .svg, .png, .html, .excalidraw
   Mermaid uses the vendored src/mermaid.min.js, loaded on first use, strict
   security level. SVG, PNG and Excalidraw (app/excalidraw-svg.js) render as
   <img> data URLs, so nothing in them runs; HTML pages go in a sandboxed
   iframe with no scripts. "New diagram" drafts a prompt naming the skill.
   ═════════════════════════════════════════════════════════════════════ */

const { Icon: _IP_Icon } = window;
const _IP_POLL_MS = 4000;
const _IP_STATUS = ["untested", "pass", "fail", "blocked"];

function _IP_Cases({ data }) {
  const cases = Array.isArray(data?.cases) ? data.cases : [];
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [openId, setOpenId] = React.useState(null);
  const counts = Object.fromEntries(_IP_STATUS.map(s => [s, cases.filter(c => (c.status ?? "untested") === s).length]));
  const needle = q.trim().toLowerCase();
  const shown = cases.filter(c => (status === "all" || (c.status ?? "untested") === status)
    && (!needle || `${c.id} ${c.title} ${c.requirement ?? ""}`.toLowerCase().includes(needle)));
  if (!cases.length) return <div className="wp-empty-line pad">No test cases yet (testcases.json).</div>;
  const pct = s => `${(counts[s] / cases.length) * 100}%`;
  return (
    <div className="ip-cases">
      <div className="ip-progress" aria-label="test status">
        {_IP_STATUS.filter(s => counts[s]).map(s => <i key={s} className={s} style={{ width: pct(s) }} title={`${s}: ${counts[s]}`} />)}
      </div>
      <div className="ip-filter">
        <div className="wp-seg small">
          {["all", ..._IP_STATUS].map(s => (
            <button key={s} className={status === s ? "on" : ""} onClick={() => setStatus(s)}>
              {s} <span className="wp-count">{s === "all" ? cases.length : counts[s]}</span>
            </button>
          ))}
        </div>
        <input value={q} placeholder="Filter cases" onChange={e => setQ(e.target.value)} aria-label="filter test cases" />
      </div>
      <div className="ip-case-list">
        {shown.map(c => {
          const st = c.status ?? "untested", isOpen = openId === c.id;
          return (
            <div key={c.id} className={`ip-case${isOpen ? " open" : ""}`}>
              <button className="ip-case-head" aria-expanded={isOpen} onClick={() => setOpenId(isOpen ? null : c.id)}>
                <span className={`ip-st ${st}`} title={st} />
                <span className="mono ip-case-id">{c.id}</span>
                <span className="ip-case-title">{c.title}</span>
                {c.priority && <span className={`ip-pri p-${String(c.priority).toLowerCase()}`}>{c.priority}</span>}
                <_IP_Icon name="chev" size={11} />
              </button>
              {isOpen && (
                <div className="ip-case-body">
                  <div className="ip-case-meta">
                    {c.requirement && <span>Requirement <b className="mono">{c.requirement}</b></span>}
                    {c.type && <span>Type <b>{c.type}</b></span>}
                  </div>
                  {c.preconditions && <p className="ip-pre"><b>Preconditions</b> {Array.isArray(c.preconditions) ? c.preconditions.join("; ") : c.preconditions}</p>}
                  <ol className="ip-steps">
                    {(c.steps ?? []).map((s, i) => (
                      <li key={i}>
                        <span>{typeof s === "string" ? s : s.action}</span>
                        {typeof s === "object" && s.expected && <span className="ip-exp">→ {s.expected}</span>}
                      </li>
                    ))}
                  </ol>
                  {c.expected && <p className="ip-pre"><b>Expected</b> {c.expected}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function _IP_Doc({ doc }) {
  if (!doc) return <div className="wp-empty-line pad">No document analysis yet (doc-analysis.json).</div>;
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
          <h4>Requirements</h4>
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

// ── Diagrams (Mermaid) ─────────────────────────────────────────────────────
let _ipMermaid = null;
/** Loads the vendored Mermaid once, themed from the current CSS tokens. */
function _ipLoadMermaid() {
  if (!_ipMermaid) {
    _ipMermaid = new Promise((resolve, reject) => {
      if (window.mermaid) return resolve(window.mermaid);
      const s = document.createElement("script");
      s.src = "mermaid.min.js";
      s.onload = () => resolve(window.mermaid);
      s.onerror = () => { _ipMermaid = null; reject(new Error("Could not load mermaid.min.js")); };
      document.head.appendChild(s);
    }).then(m => {
      const css = getComputedStyle(document.documentElement);
      const v = name => css.getPropertyValue(name).trim();
      m.initialize({
        startOnLoad: false, securityLevel: "strict", theme: "base",
        fontFamily: v("--font-sans") || "sans-serif",
        themeVariables: {
          darkMode: true, background: "transparent",
          primaryColor: v("--bg-elevated"), primaryTextColor: v("--fg"), primaryBorderColor: v("--accent"),
          secondaryColor: v("--bg-surface"), tertiaryColor: v("--bg-window"),
          lineColor: v("--fg-3"), textColor: v("--fg-2"), mainBkg: v("--bg-elevated"), nodeBorder: v("--line-bright"),
          clusterBkg: v("--bg-window"), clusterBorder: v("--line"), edgeLabelBackground: v("--bg-window"), labelBackground: v("--bg-window"),
          noteBkgColor: v("--bg-surface"), noteTextColor: v("--fg-2"), noteBorderColor: v("--line-bright"),
          actorBkg: v("--bg-elevated"), actorBorder: v("--accent"), actorTextColor: v("--fg"), signalColor: v("--fg-2"), signalTextColor: v("--fg-2"),
        },
      });
      return m;
    });
  }
  return _ipMermaid;
}
// Mermaid renders through shared global state: one diagram at a time.
let _ipQueue = Promise.resolve();
let _ipSeq = 0;
function _ipRender(source) {
  const id = `ip-mmd-${++_ipSeq}`;
  // A failed render leaves Mermaid's scratch node (`d<id>`) in <body>.
  const run = _ipQueue.then(async () => (await _ipLoadMermaid()).render(id, source))
    .catch(e => { document.getElementById(`d${id}`)?.remove(); throw e; });
  _ipQueue = run.catch(() => {});
  return run;
}
/** The card title: `%% title: X` (Mermaid), `<title>` (SVG/HTML), else the
 *  file name without its extension. */
function _ipDiagramTitle(source, file) {
  const m = /^\s*%%\s*title\s*:\s*(.+)$/im.exec(source ?? "") ?? /<title[^>]*>([^<]{1,200})<\/title>/i.exec(source ?? "");
  return m ? m[1].trim() : String(file).replace(/\.[a-z]+$/i, "");
}

// The diagram skills the agent can use, and the file each one leaves here.
const _IP_SKILLS = [
  { id: "mermaidjs-v11", label: "Mermaid", hint: "flow, sequence, state, ER, gantt", ext: "mmd", how: "Write the Mermaid source itself (no rendering), first line `%% title: <name>`." },
  { id: "diagram-design", label: "Diagram design", hint: "30+ kinds: swimlane, journey, timeline, matrix…", ext: "svg", how: "Save the finished diagram as standalone SVG (or HTML if it needs CSS), with a <title>." },
  { id: "architecture-diagram", label: "Architecture", hint: "system / infra, dark SVG", ext: "html", how: "Save the standalone HTML file, with a <title>." },
  { id: "tech-graph", label: "Tech graph", hint: "publish-grade SVG + PNG", ext: "svg", how: "Save the SVG (a PNG beside it is fine), with a <title>." },
  { id: "excalidraw", label: "Excalidraw", hint: "whiteboard sketch", ext: "excalidraw", how: "Save the .excalidraw scene JSON." },
  { id: "preview", label: "Visual explanation", hint: "HTML walkthrough / slides", ext: "html", how: "Save the self-contained HTML page (no CDN scripts: it is shown without JavaScript), with a <title>." },
];
function _ipSkillPrompt(skill) {
  return `Use the \`${skill.id}\` skill (load it; if it is not loaded, read its SKILL.md under ~/.agents/skills or ~/.hermes/skills) to draw: <what to draw, or attach the spec>.\n`
    + `Save the result into this project's .omp/insights/diagrams/<kebab-name>.${skill.ext}, one diagram per file. ${skill.how} `
    + "The Insights panel shows that folder.";
}

function _ipCopy(text) { navigator.clipboard?.writeText(text).catch(() => {}); }
const _IP_ZOOMS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/** What a card shows: `{ mermaid }` (inline SVG string), `{ img }` (data URL),
 *  `{ html }` (sandboxed page), or `{ err }`. */
function _ipUseDiagram({ kind, source, data, error }) {
  const [out, setOut] = React.useState(error ? { err: error } : null);
  React.useEffect(() => {
    if (error) return setOut({ err: error });
    let live = true;
    try {
      if (kind === "mermaid") {
        setOut(null);
        _ipRender(source).then(r => live && setOut({ mermaid: r.svg }), e => live && setOut({ err: String(e?.message ?? e) }));
      } else if (kind === "png") setOut({ img: `data:image/png;base64,${data}` });
      else if (kind === "svg") setOut({ img: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}` });
      else if (kind === "excalidraw") setOut({ img: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(window.OMP_EXCALIDRAW.toSvg(JSON.parse(source)).svg)}` });
      else if (kind === "html") setOut({ html: source });
      else setOut({ err: `unknown kind ${kind}` });
    } catch (e) { setOut({ err: String(e?.message ?? e) }); }
    return () => { live = false; };
  }, [kind, source, data, error]);
  return out;
}

function _IP_Diagram({ file, kind = "mermaid", source, data, error }) {
  const out = _ipUseDiagram({ kind, source, data, error });
  const [zoom, setZoom] = React.useState(null); // null = fit width
  const [max, setMax] = React.useState(false);
  const [showSrc, setShowSrc] = React.useState(false);
  const view = React.useRef(null);
  const drag = React.useRef(null);
  // Zoom sets the drawing's width from its natural size; fit caps it at the card.
  React.useLayoutEffect(() => {
    const el = view.current?.querySelector("svg, img");
    if (!el) return;
    const natural = el.tagName === "IMG" ? el.naturalWidth : (el.viewBox?.baseVal?.width || el.getBBox?.().width || 0);
    el.style.maxWidth = zoom == null ? "100%" : "none";
    el.style.width = zoom == null || !natural ? "" : `${Math.round(natural * zoom)}px`;
    el.style.height = "auto";
  });
  React.useEffect(() => {
    if (!max) return;
    const onKey = e => { if (e.key === "Escape") { e.stopPropagation(); setMax(false); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [max]);
  const step = dir => setZoom(z => {
    const cur = z ?? 1, i = _IP_ZOOMS.findIndex(v => v >= cur - 1e-6);
    return _IP_ZOOMS[Math.max(0, Math.min(_IP_ZOOMS.length - 1, (i < 0 ? _IP_ZOOMS.length - 1 : i) + dir))];
  });
  const onWheel = e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); step(e.deltaY < 0 ? 1 : -1); } };
  const onDown = e => {
    if (e.button !== 0 || !view.current) return;
    drag.current = { x: e.clientX, y: e.clientY, l: view.current.scrollLeft, t: view.current.scrollTop };
  };
  const onMove = e => {
    const d = drag.current;
    if (!d || !view.current) return;
    view.current.scrollLeft = d.l - (e.clientX - d.x);
    view.current.scrollTop = d.t - (e.clientY - d.y);
  };
  const title = _ipDiagramTitle(source, file);
  const text = kind !== "png" && source != null;
  const zoomable = out && (out.mermaid || out.img);
  const body = showSrc && text ? <pre className="ip-src mono">{source}</pre>
    : !out ? <span className="wp-loading">rendering…</span>
    : out.err ? (text ? <pre className="ip-src mono">{source}</pre> : null)
    : out.html != null ? <iframe className="ip-frame" sandbox="" title={title} srcDoc={out.html} />
    : (
      <div ref={view} className={`ip-view${zoom == null ? " fit" : ""}`} onWheel={onWheel}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => { drag.current = null; }} onPointerLeave={() => { drag.current = null; }}>
        {out.mermaid ? <div className="ip-mmd" dangerouslySetInnerHTML={{ __html: out.mermaid }} /> : <img src={out.img} alt={title} draggable={false} />}
      </div>
    );
  return (
    <figure className={`ip-card ip-diagram${max ? " max" : ""}`}>
      <figcaption className="ip-card-title">
        <span className="ip-diagram-name" title={file}>{title}</span>
        <span className="ip-kind">{kind}</span>
        <span style={{ flex: 1 }} />
        {zoomable && !showSrc && (
          <span className="ip-zoom" role="group" aria-label="Zoom">
            <button className="btn ghost small" aria-label="Zoom out" onClick={() => step(-1)}>−</button>
            <button className="btn ghost small mono" title="Fit width" onClick={() => setZoom(z => (z == null ? 1 : null))}>{zoom == null ? "Fit" : `${Math.round(zoom * 100)}%`}</button>
            <button className="btn ghost small" aria-label="Zoom in" onClick={() => step(1)}>+</button>
          </span>
        )}
        {text && <button className="btn ghost small" aria-pressed={showSrc} onClick={() => setShowSrc(v => !v)}>{showSrc ? "Diagram" : "Source"}</button>}
        {text && <button className="btn ghost small" title="Copy source" onClick={() => _ipCopy(source)}>Copy</button>}
        {out?.mermaid && <button className="btn ghost small" title="Copy as SVG" onClick={() => _ipCopy(out.mermaid)}>SVG</button>}
        <button className="btn ghost small" aria-pressed={max} title={max ? "Close (Esc)" : "Expand"} onClick={() => setMax(v => !v)}>{max ? "Close" : "Expand"}</button>
      </figcaption>
      {out?.err && <div className="wp-note err"><_IP_Icon name="warn" size={12} /> {file}: {out.err}</div>}
      {body}
    </figure>
  );
}

/** "New diagram" menu: drafts a prompt for the picked skill into the composer. */
function _IP_NewDiagram({ onAsk }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="ip-new">
      <button className="btn primary small" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <_IP_Icon name="plus" size={12} /> New diagram
      </button>
      {open && (
        <div className="ip-new-menu" role="menu">
          {_IP_SKILLS.map(s => (
            <button key={s.id} role="menuitem" onClick={() => { setOpen(false); onAsk(_ipSkillPrompt(s)); }}>
              <span>{s.label} <span className="ip-kind">.{s.ext}</span></span>
              <span className="ip-new-hint">{s.hint} · <span className="mono">{s.id}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function _IP_Diagrams({ diagrams, onAsk }) {
  const [q, setQ] = React.useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle ? diagrams.filter(d => `${_ipDiagramTitle(d.source, d.file)} ${d.file} ${d.kind}`.toLowerCase().includes(needle)) : diagrams;
  return (
    <div className="ip-diagrams">
      <div className="ip-filter">
        {diagrams.length > 3 && <input type="search" placeholder={`Filter ${diagrams.length} diagrams`} value={q} onChange={e => setQ(e.target.value)} />}
        <span style={{ flex: 1 }} />
        {onAsk && <_IP_NewDiagram onAsk={onAsk} />}
      </div>
      {shown.map(d => <_IP_Diagram key={d.file} {...d} />)}
      {!diagrams.length && <div className="wp-empty-line pad">No diagrams yet. Pick a skill under "New diagram"; files land in .omp/insights/diagrams/.</div>}
      {diagrams.length > 0 && !shown.length && <div className="wp-empty-line pad">No diagram matches "{q}".</div>}
    </div>
  );
}

function InsightsPanel({ projectPath, onAsk }) {
  const [data, setData] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [tab, setTab] = React.useState("diagrams");
  React.useEffect(() => {
    if (!projectPath) { setData(null); return; }
    const inv = window.__TAURI__?.core?.invoke;
    if (!inv) { setErr("Insights needs the desktop app."); return; }
    let live = true, last = "";
    const load = () => inv("insights_read", { project: projectPath })
      .then(v => { const s = JSON.stringify(v); if (live && s !== last) { last = s; setData(v); } setErr(null); })
      .catch(e => live && setErr(String(e)));
    load();
    const id = setInterval(load, _IP_POLL_MS);
    return () => { live = false; clearInterval(id); };
  }, [projectPath]);

  const diagrams = data?.diagrams ?? [];
  const cases = data?.testcases?.cases ?? [];
  const tabs = [
    { id: "diagrams", label: "Diagrams", n: diagrams.length },
    { id: "cases", label: "Test cases", n: cases.length },
    { id: "doc", label: "Document", n: data?.doc ? 1 : 0 },
  ];
  const prompt = "Read the document I attach, then draw its flows as Mermaid diagrams in .omp/insights/diagrams/*.mmd (one diagram per file: flowchart for business flows, sequenceDiagram for FE/BE/API calls, stateDiagram-v2 for statuses, erDiagram for data; first line `%% title: <name>`), and write .omp/insights/doc-analysis.json and testcases.json in the formats the Insights panel expects (see docs/insights.md in omp-desktop).";
  return (
    <div className="wp-panel ip-panel">
      <div className="wp-head">
        <span className="wp-head-title">Insights</span>
        <div className="wp-tabs inline" role="tablist">
          {tabs.map(t => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
              {t.label}{t.n > 0 && <span className="wp-count">{t.n}</span>}
            </button>
          ))}
        </div>
      </div>
      {err && <div className="wp-note err wp-banner"><_IP_Icon name="warn" size={12} /> {err}</div>}
      <div className="wp-scroll ip-scroll">
        {!projectPath && <div className="wp-empty"><div className="wp-empty-title">Open a project</div><p>Insights read the project's .omp/insights folder.</p></div>}
        {projectPath && data && !data.exists && (
          <div className="wp-empty">
            <div className="wp-empty-title">No insights yet</div>
            <p>Ask the agent to analyse a document: it writes diagrams, test cases and a summary into <code className="mono">.omp/insights/</code>, and they appear here as it works.</p>
            {onAsk && <button className="btn primary" onClick={() => onAsk(prompt)}><_IP_Icon name="sparkle" size={12} /> Draft the request</button>}
            {onAsk && <div className="ip-empty-new"><_IP_NewDiagram onAsk={onAsk} /></div>}
          </div>
        )}
        {data?.exists && tab === "diagrams" && <_IP_Diagrams diagrams={diagrams} onAsk={onAsk} />}
        {data?.exists && tab === "cases" && <_IP_Cases data={data.testcases} />}
        {data?.exists && tab === "doc" && <_IP_Doc doc={data.doc} />}
      </div>
    </div>
  );
}

Object.assign(window, { InsightsPanel, _IP_Diagram, _ipDiagramTitle, _ipSkillPrompt });
