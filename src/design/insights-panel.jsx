/* ═════════════════════════════════════════════════════════════════════
   design/insights-panel.jsx — the Insights panel (fork): charts, test
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
     charts/*.json      { type: "bar"|"line"|"pie"|"stacked", title, unit?,
                          labels: [..], series: [{ name, data: [numbers] }] }
   Charts are drawn as inline SVG here (no chart library, CSP-safe).
   ═════════════════════════════════════════════════════════════════════ */

const { Icon: _IP_Icon } = window;
const _IP_POLL_MS = 4000;
// Series colours: tokens first so every theme stays coherent.
const _IP_COLORS = ["var(--accent)", "var(--cyan)", "var(--lime)", "var(--lilac)", "var(--rose)", "var(--amber)"];

function _ipNum(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function _ipFmt(n) {
  const a = Math.abs(n);
  if (a >= 1e9) return `${+(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${+(n / 1e3).toFixed(1)}k`;
  return `${+n.toFixed(2)}`;
}
// A "nice" axis top: 1, 2, 2.5, 5 × 10^k at or above `max`.
function _ipNiceMax(max) {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  return [1, 2, 2.5, 5, 10].map(m => m * p).find(v => v >= max);
}

// A line chart's axis: four "nice" steps around [min, max], zero kept when
// the data reaches it.
function _ipRange(min, max) {
  if (min === max) { min -= 1; max += 1; }
  const step = _ipNiceMax((max - min) / 4);
  const lo = Math.floor(min / step) * step;
  return [min >= 0 && lo < 0 ? 0 : lo, lo + step * Math.max(4, Math.ceil((max - lo) / step))];
}

function _IP_Legend({ series }) {
  if (series.length < 2) return null;
  return (
    <div className="ip-legend">
      {series.map((s, i) => <span key={i}><i style={{ background: _IP_COLORS[i % _IP_COLORS.length] }} />{s.name}</span>)}
    </div>
  );
}

function _IP_Cartesian({ chart }) {
  const labels = chart.labels ?? [];
  const series = (chart.series ?? []).map(s => ({ name: s.name ?? "", data: (s.data ?? []).map(_ipNum) }));
  const stacked = chart.type === "stacked";
  const W = 520, H = 220, L = 44, R = 8, T = 10, B = 30;
  const n = Math.max(1, labels.length);
  const totals = labels.map((_, i) => series.reduce((a, s) => a + Math.max(0, s.data[i] ?? 0), 0));
  const all = series.flatMap(s => s.data);
  // Bars start at zero; a line zooms to its data so close series separate.
  const [lo, max] = chart.type === "line" && all.length
    ? _ipRange(Math.min(...all), Math.max(...all))
    : [0, _ipNiceMax(stacked ? Math.max(0, ...totals) : Math.max(0, ...all))];
  const y = v => T + (H - T - B) * (1 - (v - lo) / (max - lo || 1));
  const band = (W - L - R) / n;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => lo + f * (max - lo));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ip-svg" role="img" aria-label={chart.title}>
      {ticks.map(v => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="ip-gridline" />
          <text x={L - 6} y={y(v) + 3} className="ip-tick" textAnchor="end">{_ipFmt(v)}</text>
        </g>
      ))}
      {labels.map((lab, i) => (
        <text key={i} x={L + band * (i + 0.5)} y={H - 10} className="ip-tick" textAnchor="middle">
          {String(lab).length > 10 ? `${String(lab).slice(0, 9)}…` : lab}
        </text>
      ))}
      {chart.type === "line"
        ? series.map((s, si) => {
            const pts = s.data.map((v, i) => `${L + band * (i + 0.5)},${y(v)}`).join(" ");
            const c = _IP_COLORS[si % _IP_COLORS.length];
            return (
              <g key={si}>
                <polyline points={pts} fill="none" stroke={c} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                {s.data.map((v, i) => <circle key={i} cx={L + band * (i + 0.5)} cy={y(v)} r="3" fill="var(--bg-surface)" stroke={c} strokeWidth="1.5"><title>{`${s.name} ${labels[i]}: ${v}`}</title></circle>)}
              </g>
            );
          })
        : labels.map((lab, i) => {
            const inner = band * 0.7, x0 = L + band * i + (band - inner) / 2;
            if (stacked) {
              let acc = 0;
              return series.map((s, si) => {
                const v = Math.max(0, s.data[i] ?? 0); const top = acc + v;
                const r = <rect key={`${i}-${si}`} x={x0} width={inner} y={y(top)} height={Math.max(0, y(acc) - y(top))} rx="2" fill={_IP_COLORS[si % _IP_COLORS.length]}><title>{`${s.name} ${lab}: ${v}`}</title></rect>;
                acc = top; return r;
              });
            }
            const w = inner / Math.max(1, series.length);
            return series.map((s, si) => {
              const v = s.data[i] ?? 0;
              return <rect key={`${i}-${si}`} x={x0 + w * si} width={Math.max(1, w - 2)} y={y(Math.max(0, v))} height={Math.abs(y(0) - y(v))} rx="2" fill={_IP_COLORS[si % _IP_COLORS.length]}><title>{`${s.name} ${lab}: ${v}`}</title></rect>;
            });
          })}
    </svg>
  );
}

function _IP_Pie({ chart }) {
  const labels = chart.labels ?? [];
  const data = (chart.series?.[0]?.data ?? []).map(v => Math.max(0, _ipNum(v)));
  const total = data.reduce((a, b) => a + b, 0) || 1;
  let a0 = -Math.PI / 2;
  const R = 70, r = 42, cx = 90, cy = 90;
  const arc = (a1, a2) => {
    const large = a2 - a1 > Math.PI ? 1 : 0;
    const p = (rad, a) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
    return `M${p(R, a1)} A${R},${R} 0 ${large} 1 ${p(R, a2)} L${p(r, a2)} A${r},${r} 0 ${large} 0 ${p(r, a1)} Z`;
  };
  return (
    <div className="ip-pie">
      <svg viewBox="0 0 180 180" className="ip-svg pie" role="img" aria-label={chart.title}>
        {data.map((v, i) => {
          const a1 = a0, a2 = a0 + (v / total) * Math.PI * 2 - 1e-6; a0 = a2;
          return <path key={i} d={arc(a1, a2)} fill={_IP_COLORS[i % _IP_COLORS.length]}><title>{`${labels[i]}: ${v}`}</title></path>;
        })}
        <text x={cx} y={cy + 5} textAnchor="middle" className="ip-pie-total">{_ipFmt(total)}</text>
      </svg>
      <ul className="ip-pie-keys">
        {data.map((v, i) => (
          <li key={i}><i style={{ background: _IP_COLORS[i % _IP_COLORS.length] }} />{labels[i]}<span className="mono">{Math.round((v / total) * 100)}%</span></li>
        ))}
      </ul>
    </div>
  );
}

function _IP_Chart({ file, chart }) {
  if (chart?.error) return <div className="ip-card"><div className="ip-card-title">{file}</div><div className="wp-note err">{chart.error}</div></div>;
  const type = chart?.type ?? "bar";
  return (
    <figure className="ip-card">
      <figcaption className="ip-card-title">{chart.title ?? file}{chart.unit && <span className="ip-unit">{chart.unit}</span>}</figcaption>
      {type === "pie" ? <_IP_Pie chart={chart} /> : <_IP_Cartesian chart={chart} />}
      {type !== "pie" && <_IP_Legend series={chart.series ?? []} />}
    </figure>
  );
}

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

function InsightsPanel({ projectPath, onAsk }) {
  const [data, setData] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [tab, setTab] = React.useState("charts");
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

  const charts = data?.charts ?? [];
  const cases = data?.testcases?.cases ?? [];
  const tabs = [
    { id: "charts", label: "Charts", n: charts.length },
    { id: "cases", label: "Test cases", n: cases.length },
    { id: "doc", label: "Document", n: data?.doc ? 1 : 0 },
  ];
  const prompt = "Read the document I attach, then write .omp/insights/doc-analysis.json, testcases.json and charts/*.json in the formats the Insights panel expects (see docs/insights.md in omp-desktop).";
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
            <p>Ask the agent to analyse a document: it writes charts, test cases and a summary into <code className="mono">.omp/insights/</code>, and they appear here as it works.</p>
            {onAsk && <button className="btn primary" onClick={() => onAsk(prompt)}><_IP_Icon name="sparkle" size={12} /> Draft the request</button>}
          </div>
        )}
        {data?.exists && tab === "charts" && (charts.length
          ? <div className="ip-grid">{charts.map(c => <_IP_Chart key={c.file} file={c.file} chart={c.chart} />)}</div>
          : <div className="wp-empty-line pad">No charts yet (charts/*.json).</div>)}
        {data?.exists && tab === "cases" && <_IP_Cases data={data.testcases} />}
        {data?.exists && tab === "doc" && <_IP_Doc doc={data.doc} />}
      </div>
    </div>
  );
}

Object.assign(window, { InsightsPanel, _ipNiceMax, _ipRange });
