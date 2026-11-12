/* ═════════════════════════════════════════════════════════════════════
   design/insights-diagrams.jsx — Insights diagram cards (fork): Mermaid
   schematic, SVG, PNG, Excalidraw and sandboxed HTML diagrams with
   per-card collapse, collapse/expand all, floating zoom and copy.
   ═════════════════════════════════════════════════════════════════════ */

const { Icon: _IPD_Icon } = window;

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
      m.initialize(window.OMP_MERMAID_SCHEMATIC.config(name => css.getPropertyValue(name).trim()));
      return m;
    });
  }
  return _ipMermaid;
}

let _ipQueue = Promise.resolve();
let _ipSeq = 0;
function _ipRender(source) {
  const id = `ip-mmd-${++_ipSeq}`;
  const run = _ipQueue.then(async () => (await _ipLoadMermaid()).render(id, source))
    .catch(e => { document.getElementById(`d${id}`)?.remove(); throw e; });
  _ipQueue = run.catch(() => {});
  return run;
}

/** The card title: `%% title: X` (Mermaid), `<title>` (SVG/HTML), else file stem. */
function _ipDiagramTitle(source, file) {
  const m = /^\s*%%\s*title\s*:\s*(.+)$/im.exec(source ?? "") ?? /<title[^>]*>([^<]{1,200})<\/title>/i.exec(source ?? "");
  return m ? m[1].trim() : String(file).replace(/\.[a-z]+$/i, "");
}

const _IP_SKILLS = [
  { id: "mermaidjs-v11", label: "Mermaid", hint: "flow, sequence, state, ER, gantt", ext: "mmd", how: "Write the Mermaid source itself (no rendering), first line `%% title: <name>`." },
  { id: "diagram-design", label: "Diagram design", hint: "swimlane, journey, timeline, tables", ext: "svg", how: "Save the finished diagram as standalone SVG (or HTML if it needs CSS), with a <title>." },
  { id: "architecture-diagram", label: "Architecture", hint: "system / infra, dark SVG", ext: "html", how: "Save the standalone HTML file, with a <title>." },
  { id: "tech-graph", label: "Tech graph", hint: "publish-grade SVG + PNG", ext: "svg", how: "Save the SVG (a PNG beside it is fine), with a <title>." },
  { id: "excalidraw", label: "Excalidraw", hint: "whiteboard sketch", ext: "excalidraw", how: "Save the .excalidraw scene JSON." },
  { id: "preview", label: "Visual walkthrough", hint: "HTML walkthrough / slides", ext: "html", how: "Save the self-contained HTML page (no CDN scripts: it is shown without JavaScript), with a <title>." },
];

function _ipSkillText(s) {
  if (s.id === "mermaidjs-v11") return { label: s.label, hint: OMP_TR("flow, sequence, state, ER, gantt") };
  if (s.id === "diagram-design") return { label: OMP_TR("Diagram design"), hint: OMP_TR("swimlane, journey, timeline, tables") };
  if (s.id === "architecture-diagram") return { label: OMP_TR("Architecture"), hint: OMP_TR("system / infra, dark SVG") };
  if (s.id === "tech-graph") return { label: OMP_TR("Tech graph"), hint: OMP_TR("publish-grade SVG + PNG") };
  if (s.id === "excalidraw") return { label: s.label, hint: OMP_TR("whiteboard sketch") };
  if (s.id === "preview") return { label: OMP_TR("Visual walkthrough"), hint: OMP_TR("HTML walkthrough / slides") };
  return s;
}

function _ipSkillPrompt(skill) {
  return `Use the \`${skill.id}\` skill (load it; if it is not loaded, read its SKILL.md under ~/.agents/skills or ~/.hermes/skills) to draw: <what to draw, or attach the spec>.\n`
    + `Save the result into this project's .omp/insights/diagrams/<kebab-name>.${skill.ext}, one diagram per file. ${skill.how} `
    + "The Insights panel shows that folder.";
}

function _ipCopy(text) { navigator.clipboard?.writeText(text).catch(() => {}); }
const _IP_ZOOMS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];

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

function _IP_Diagram({ file, kind = "mermaid", source, data, error, onDelete, isOpen = true, onToggle }) {
  const Delete = window._IP_Delete;
  const out = _ipUseDiagram({ kind, source, data, error });
  const [localOpen, setLocalOpen] = React.useState(isOpen);
  const [zoom, setZoom] = React.useState(null);
  const [max, setMax] = React.useState(false);
  const [showSrc, setShowSrc] = React.useState(false);
  const [copied, setCopied] = React.useState("");
  const cardRef = React.useRef(null);
  const view = React.useRef(null);
  const drag = React.useRef(null);
  const graph = React.useRef(null);
  const open = max || (onToggle ? isOpen : localOpen);
  const toggle = () => {
    if (max) return;
    if (onToggle) onToggle();
    else setLocalOpen(v => !v);
  };

  React.useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(""), 1400);
    return () => clearTimeout(id);
  }, [copied]);

  React.useLayoutEffect(() => {
    const svg = out?.mermaid && view.current?.querySelector(".ip-mmd svg");
    graph.current = svg ? { svg, ...window.OMP_MERMAID_SCHEMATIC.decorate(svg) } : null;
  }, [out?.mermaid, showSrc]);

  const onOver = e => {
    const g = graph.current;
    if (!g || drag.current) return;
    const node = e.target.closest?.("g.node");
    window.OMP_MERMAID_SCHEMATIC.focus(g.svg, g, node?.dataset.node ?? null);
  };

  React.useLayoutEffect(() => {
    const el = view.current?.querySelector("svg, img");
    if (!el) return;
    const natural = el.tagName === "IMG" ? el.naturalWidth : (el.viewBox?.baseVal?.width || el.getBBox?.().width || 0);
    el.style.maxWidth = zoom == null ? "100%" : "none";
    el.style.width = zoom == null || !natural ? "" : `${Math.round(natural * zoom)}px`;
    el.style.height = "auto";
  });

  window._wpUseDialog(cardRef, max, () => setMax(false), { inertRoot: true });

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
  const kindLabel = kind === "mermaid" ? window.OMP_MERMAID_SCHEMATIC.diagramType(source) : kind;
  const text = kind !== "png" && source != null;
  const zoomable = out && (out.mermaid || out.img);

  const canvas = showSrc && text ? <pre className="ip-src mono">{source}</pre>
    : !out ? <span className="wp-loading">{OMP_TR("rendering…")}</span>
    : out.err ? (text ? <pre className="ip-src mono">{source}</pre> : null)
    : out.html != null ? <iframe className="ip-frame" sandbox="" title={title} srcDoc={out.html} />
    : (
      <div className="ip-view-wrap">
        <div ref={view} className={`ip-view${zoom == null ? " fit" : ""}${out.mermaid ? " ip-sheet" : ""}`} onWheel={onWheel}
          onPointerOver={onOver} onPointerLeave={e => { drag.current = null; onOver(e); }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => { drag.current = null; }}>
          {out.mermaid ? <div className="ip-mmd" dangerouslySetInnerHTML={{ __html: out.mermaid }} /> : <img src={out.img} alt={title} draggable={false} />}
        </div>
        {zoomable && !showSrc && (
          <div className="ip-zoom-float" role="group" aria-label={OMP_TR("Zoom")}>
            <button type="button" aria-label={OMP_TR("Zoom out")} onClick={() => step(-1)}><_IPD_Icon name="minus" size={11} /></button>
            <button type="button" className="mono ip-zoom-fit" title={OMP_TR("Toggle Fit / 100%")} onClick={() => setZoom(z => (z == null ? 1 : null))}>
              {zoom == null ? OMP_TR("Fit") : `${Math.round(zoom * 100)}%`}
            </button>
            <button type="button" aria-label={OMP_TR("Zoom in")} onClick={() => step(1)}><_IPD_Icon name="plus" size={11} /></button>
          </div>
        )}
      </div>
    );

  const card = (
    <figure ref={cardRef} tabIndex={max ? -1 : undefined}
      role={max ? "dialog" : undefined} aria-modal={max ? "true" : undefined} aria-label={max ? title : undefined}
      className={`ip-card ip-diagram${max ? " max" : ""}${!open ? " collapsed" : ""}`}>
      <figcaption className="ip-card-head">
        <button type="button" className="ip-diagram-toggle" aria-expanded={open} disabled={max}
          title={open ? OMP_TR("Collapse {file}", { file }) : OMP_TR("Expand {file}", { file })} onClick={toggle}>
          <span className="ip-chev" aria-hidden="true"><_IPD_Icon name="chev" size={12} /></span>
          <span className="ip-diagram-name" title={file}>{title}</span>
          <span className="ip-kind">{kindLabel}</span>
        </button>
        <div className="ip-card-actions">
          {open && text && (
            <button type="button" className="btn ghost small" aria-pressed={showSrc} onClick={() => setShowSrc(v => !v)}>
              {showSrc ? OMP_TR("Diagram") : OMP_TR("Code")}
            </button>
          )}
          {open && text && (
            <button type="button" className="btn ghost small" title={OMP_TR("Copy source")}
              onClick={() => { _ipCopy(source); setCopied("src"); }}>
              {copied === "src" ? OMP_TR("Copied") : OMP_TR("Copy")}
            </button>
          )}
          {open && out?.mermaid && (
            <button type="button" className="btn ghost small" title={OMP_TR("Copy as SVG")}
              onClick={() => { _ipCopy(out.mermaid); setCopied("svg"); }}>
              {copied === "svg" ? OMP_TR("SVG copied") : "SVG"}
            </button>
          )}
          <button type="button" className="btn ghost small" aria-pressed={max}
            title={max ? OMP_TR("Close fullscreen (Esc)") : OMP_TR("Fullscreen")} onClick={() => setMax(v => !v)}>
            {max ? OMP_TR("Close") : OMP_TR("Expand")}
          </button>
          {onDelete && !max && Delete && <Delete label={file} onDelete={onDelete} />}
        </div>
      </figcaption>
      <div className="ip-diagram-collapse">
        <div className="ip-diagram-inner">
          {out?.err && <div className="wp-note err"><_IPD_Icon name="warn" size={12} /> {file}: {out.err}</div>}
          {canvas}
        </div>
      </div>
    </figure>
  );
  if (max && typeof document !== "undefined" && typeof ReactDOM !== "undefined") {
    return ReactDOM.createPortal(
      <>
        <div className="ip-max-scrim" onClick={() => setMax(false)} aria-hidden="true" />
        {card}
      </>,
      document.body,
    );
  }
  return card;
}

/** "New diagram" menu: drafts a prompt for the picked skill into the composer. */
function _IP_NewDiagram({ onAsk }) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef(null);
  const triggerRef = React.useRef(null);
  const menuRef = React.useRef(null);
  const close = React.useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);
  window.usePopoverDismiss(open, rootRef, () => close(false), close);

  React.useEffect(() => {
    if (!open) return undefined;
    const raf = requestAnimationFrame(() => menuRef.current?.querySelector('[role="menuitem"]')?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  return (
    <div className="ip-new" ref={rootRef}>
      <button ref={triggerRef} type="button" className="btn primary small" aria-haspopup="menu"
        aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <_IPD_Icon name="plus" size={12} /> {OMP_TR("New diagram")}
      </button>
      {open && (
        <div ref={menuRef} className="ip-new-menu" role="menu"
          onKeyDown={e => window.menuKeyNav(e, menuRef.current, '[role="menuitem"]', () => close(true))}>
          {_IP_SKILLS.map(s => {
            const meta = _ipSkillText(s);
            return (
              <button key={s.id} type="button" role="menuitem" onClick={() => { close(false); onAsk(_ipSkillPrompt(s)); }}>
                <span>{meta.label} <span className="ip-kind">.{s.ext}</span></span>
                <span className="ip-new-hint">{meta.hint} · <span className="mono">{s.id}</span></span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function _IP_Diagrams({ diagrams, onAsk, onDelete }) {
  const [q, setQ] = React.useState("");
  const [collapsed, setCollapsed] = React.useState(() => new Set());
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? diagrams.filter(d => `${_ipDiagramTitle(d.source, d.file)} ${d.file} ${d.kind}`.toLowerCase().includes(needle))
    : diagrams;

  const allCollapsed = shown.length > 0 && shown.every(d => collapsed.has(d.file));
  const toggleOne = file => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(file)) next.delete(file);
    else next.add(file);
    return next;
  });
  const toggleAll = () => setCollapsed(prev => {
    const next = new Set(prev);
    if (allCollapsed) { for (const d of shown) next.delete(d.file); }
    else { for (const d of shown) next.add(d.file); }
    return next;
  });

  return (
    <div className="ip-diagrams">
      <div className="ip-filter">
        {diagrams.length > 1 && (
          <input type="search" placeholder={OMP_TR("Filter {n} diagrams…", { n: diagrams.length })} value={q} onChange={e => setQ(e.target.value)} aria-label={OMP_TR("filter diagrams")} />
        )}
        <span style={{ flex: 1 }} />
        {shown.length > 0 && (
          <button type="button" className={`btn ghost small ip-collapse-all${allCollapsed ? " is-collapsed" : ""}`}
            onClick={toggleAll} title={allCollapsed ? OMP_TR("Expand all diagrams") : OMP_TR("Collapse all diagrams")}>
            <_IPD_Icon name="chev" size={11} />
            <span>{allCollapsed ? OMP_TR("Expand all") : OMP_TR("Collapse all")}</span>
          </button>
        )}
        {onAsk && <_IP_NewDiagram onAsk={onAsk} />}
      </div>
      {shown.map(d => (
        <_IP_Diagram key={d.file} {...d} isOpen={!collapsed.has(d.file)} onToggle={() => toggleOne(d.file)}
          onDelete={onDelete && (() => onDelete(`diagrams/${d.file}`))} />
      ))}
      {!diagrams.length && <div className="wp-empty-line pad">{OMP_TR("No diagrams yet. Pick a skill under \"New diagram\"; files land in .omp/insights/diagrams/.")}</div>}
      {diagrams.length > 0 && !shown.length && (
        <div className="wp-empty-line pad">
          {OMP_TR("No diagram matches \"{q}\".", { q })}{" "}
          <button type="button" className="btn ghost small" onClick={() => setQ("")}>{OMP_TR("Clear filters")}</button>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { _IP_Diagrams, _IP_Diagram, _ipDiagramTitle, _ipSkillPrompt, _ipSkillText, _IP_NewDiagram, _IP_SKILLS });
