/* ═════════════════════════════════════════════════════════════════════
   app/mermaid-blocks.js — colored block look for Mermaid diagrams
   (window.OMP_MERMAID_BLOCKS), shared by Insights cards and ```mermaid
   blocks in chat (both draw through insights-diagrams.jsx's _IP_Diagram).
     config(read)           Mermaid initialize() options from the CSS tokens
     diagramType(src)       "flowchart", "sequence", … for the card's kind label
     kindOf(label)          "db", "auth", … from a node label, or null
     classFor(label)        the `ipk-*` class a node gets (kind, else a color)
     annotate(src, nodes)   src plus `class` lines that tag every node
     prepare(mermaid, src)  annotate() for flowcharts, src as is otherwise
     styleSheet()           CSS text: one color and one icon per kind
     graph(nodeIds, edgeIds) edges per node, pure
     decorate(svg)          sets each edge's length for the draw-in, returns
                            the graph for focus()
     focus(svg, g, id)      lights one node's edges (null clears)
   Shared look lives in layout/diagram.css; the per-kind rules come from
   styleSheet() because the icons are data: URLs, which the frontend build
   refuses in CSS files. Colors are var(--…) tokens, so a theme switch
   restyles a drawn diagram without re-rendering it.
   ═════════════════════════════════════════════════════════════════════ */
(function () {
  /** `#rrggbb` (or `#rgb`) as [r, g, b], null for anything else. */
  function rgb(hex) {
    let h = String(hex ?? "").trim().replace(/^#/, "");
    if (h.length === 3) h = [...h].map(c => c + c).join("");
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  }

  /** `a` over `b` at weight `t` (0..1) as `#rrggbb`; `b` when either is not hex. */
  function mix(a, b, t) {
    const x = rgb(a), y = rgb(b);
    if (!x || !y) return b;
    return "#" + x.map((c, i) => Math.round(c * t + y[i] * (1 - t)).toString(16).padStart(2, "0")).join("");
  }

  /** Relative luminance of a hex color (0 dark … 1 light); 0 for anything
   *  else, which keeps Mermaid in dark mode. */
  function luminance(hex) {
    const v = rgb(hex);
    if (!v) return 0;
    const [r, g, b] = v.map(c => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  /** Mermaid options. `read(name)` is a CSS custom property's value. */
  function config(read) {
    const bg = read("--bg-window") || "#111111";
    const tint = (name, t = 0.18) => mix(read(name), bg, t);
    const edge = (name, t = 0.6) => mix(read(name), bg, t);
    const pie = ["--cyan", "--lilac", "--accent", "--amber", "--rose", "--magenta", "--lime"].map(n => read(n) || read("--fg-3"));
    return {
      startOnLoad: false, securityLevel: "strict", theme: "base", look: "classic",
      // Layout is measured in this font and weight, so the CSS must not change their size.
      fontFamily: read("--font-sans") || "sans-serif", fontSize: 14,
      flowchart: { padding: 16, nodeSpacing: 48, rankSpacing: 56, wrappingWidth: 260, curve: "rounded" },
      themeVariables: {
        darkMode: luminance(bg) < 0.5, background: "transparent", fontSize: "14px",
        primaryColor: tint("--cyan"), primaryTextColor: read("--fg"), primaryBorderColor: edge("--cyan"),
        secondaryColor: tint("--lilac"), secondaryBorderColor: edge("--lilac"), secondaryTextColor: read("--fg"),
        tertiaryColor: tint("--accent"), tertiaryBorderColor: edge("--accent"), tertiaryTextColor: read("--fg"),
        lineColor: read("--fg-4"), textColor: read("--fg-2"), mainBkg: tint("--cyan"), nodeBorder: edge("--cyan"),
        clusterBkg: "transparent", clusterBorder: read("--line-bright"), edgeLabelBackground: bg, labelBackground: bg,
        noteBkgColor: tint("--amber"), noteTextColor: read("--fg"), noteBorderColor: edge("--amber"),
        actorBkg: tint("--cyan"), actorBorder: edge("--cyan"), actorTextColor: read("--fg"),
        signalColor: read("--fg-3"), signalTextColor: read("--fg-2"),
        ...Object.fromEntries(pie.map((c, i) => [`pie${i + 1}`, c])),
      },
    };
  }

  const TYPES = {
    flowchart: "flowchart", graph: "flowchart", sequencediagram: "sequence", classdiagram: "class",
    statediagram: "state", "statediagram-v2": "state", erdiagram: "er", gantt: "gantt", pie: "pie",
    journey: "journey", gitgraph: "git", mindmap: "mindmap", timeline: "timeline", quadrantchart: "quadrant",
    "xychart-beta": "xy chart", "sankey-beta": "sankey", "block-beta": "block", architecture: "architecture",
    "architecture-beta": "architecture", kanban: "kanban", packet: "packet", "packet-beta": "packet",
  };
  /** The diagram kind from the first keyword after front matter, `%%`
   *  comments and blank lines; "mermaid" when it is not one Mermaid names. */
  function diagramType(source) {
    const lines = String(source ?? "").split("\n");
    let i = 0;
    if (lines[0]?.trim() === "---") { i = 1; while (i < lines.length && lines[i].trim() !== "---") i++; i++; }
    for (; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l || l.startsWith("%%")) continue;
      return TYPES[l.split(/[\s;]/)[0].toLowerCase()] ?? "mermaid";
    }
    return "mermaid";
  }

  /* ── Node kinds ─────────────────────────────────────────────────────── */
  // 24×24 stroke icons (the inside of an <svg>), drawn in the mask color.
  const ICONS = {
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
    web: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    mobile: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    gateway: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M6 16v-3h12v3M12 8v5"/>',
    server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01"/>',
    logic: '<path d="M8 4C6 4 5 5 5 7v2c0 1-1 3-2 3 1 0 2 2 2 3v2c0 2 1 3 3 3M16 4c2 0 3 1 3 3v2c0 1 1 3 2 3-1 0-2 2-2 3v2c0 2-1 3-3 3"/>',
    auth: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    cache: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    queue: '<path d="M3 6h18M3 12h18M3 18h12"/>',
    external: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    payment: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    cloud: '<path d="M7 18a4 4 0 0 1-.5-7.97A6 6 0 0 1 18 9.5 4.5 4.5 0 0 1 17.5 18z"/>',
    monitor: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    ai: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16v4M17 18h4"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    job: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  };

  // Hue = the theme token that colors the block. Order matters: the first
  // pattern that matches wins, so "Redis Cache" is cache and "Auth Service"
  // is auth before "service" would make them servers. Patterns run on the
  // lowercased label with accents removed (Vietnamese labels work too).
  const KINDS = [
    ["user", "magenta", /^(the |an? |end )*(user|users|customer|customers|person|actor|admin|nguoi dung|khach hang)\b(?! (table|tables|record|records|data|store|list|service|api)\b)/],
    ["cache", "rose", /redis|cache|memcache|bo nho dem/],
    ["db", "lime", /database|\bdb\b|\btables?\b|sql|postgres|mongo|dynamo|cassandra|datastore|warehouse|storage|co so du lieu/],
    ["queue", "amber", /queue|kafka|rabbit|\bsqs\b|pub ?sub|broker|event bus|stream|hang doi|message/],
    ["auth", "rose", /auth|login|oauth|\bsso\b|jwt|token|permission|security|identity|xac thuc|dang nhap|phan quyen/],
    ["gateway", "amber", /gateway|proxy|load ?balancer|nginx|\bcdn\b|ingress|router/],
    ["mobile", "cyan", /mobile|\bios\b|android/],
    ["web", "cyan", /front ?end|\bui\b|\bweb|browser|client|\bspa\b|react|vue|giao dien|dashboard|website/],
    ["payment", "lime", /payment|stripe|billing|paypal|invoice|thanh toan/],
    ["mail", "cyan", /mail|smtp|\bsms\b|notification|push|thong bao/],
    ["external", "magenta", /external|third ?party|3rd|partner|webhook|ben thu|dich vu ngoai/],
    ["cloud", "cyan", /\baws\b|\bgcp\b|azure|cloud|\bs3\b|bucket|lambda/],
    ["monitor", "accent", /monitor|metric|\blogs?\b|logging|observab|grafana|prometheus|alert|telemetry|giam sat/],
    ["ai", "lilac", /\bai\b|llm|\bml\b|\bgpt|machine learning|\bmodel\b|agent/],
    ["file", "amber", /file|document|\bpdf\b|upload|report|tai lieu|bao cao/],
    ["job", "lilac", /cron|\bjobs?\b|schedul|worker|batch/],
    ["search", "cyan", /search|index|tim kiem/],
    ["logic", "lilac", /business|logic|domain|\bcore\b|nghiep vu|use ?case|controller|handler|process/],
    ["server", "accent", /backend|back-end|server|service|\bapi\b|microservice|rest\b|graphql|engine|may chu|dich vu/],
  ];
  // Blocks with no known kind take one of these, picked from the label text.
  const PALETTE = ["cyan", "lilac", "accent", "amber", "rose", "magenta"];

  const plain = label => String(label ?? "").replace(/<[^>]*>/g, " ").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d").toLowerCase();

  /** The kind of a node label ("db", "auth", …), null when none fits. */
  function kindOf(label) {
    const text = plain(label);
    return KINDS.find(([, , re]) => re.test(text))?.[0] ?? null;
  }

  /** The class a node gets: `ipk-<kind>`, or `ipk-c<n>` (color only) when no kind fits. */
  function classFor(label) {
    const kind = kindOf(label);
    if (kind) return `ipk-${kind}`;
    const text = plain(label);
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
    return `ipk-c${h % PALETTE.length}`;
  }

  /** `source` plus `class` lines that give every node its ipk class.
   *  `nodes` is [id, label] pairs; ids Mermaid would not read in a class list are skipped. */
  function annotate(source, nodes) {
    const byClass = new Map();
    for (const [id, label] of nodes) {
      if (!/^[\w-]+$/.test(id)) continue;
      const cls = classFor(label);
      if (!byClass.has(cls)) byClass.set(cls, []);
      byClass.get(cls).push(id);
    }
    if (!byClass.size) return source;
    return `${source}\n${[...byClass].map(([cls, ids]) => `class ${ids.join(",")} ${cls}`).join("\n")}\n`;
  }

  /** Source ready to render. A flowchart is parsed once to read its node
   *  labels, so the icons exist while Mermaid measures the nodes (the
   *  node boxes then fit label and icon). A parse error is left for
   *  render() to report. */
  async function prepare(mermaid, source) {
    if (diagramType(source) !== "flowchart") return source;
    try {
      const diagram = await mermaid.mermaidAPI.getDiagramFromText(source);
      return annotate(source, [...diagram.db.getVertices()].map(([id, v]) => [id, v.text]));
    } catch (_) {
      return source;
    }
  }

  /** CSS for the per-kind color and icon, and the colors of unknown kinds. */
  function styleSheet() {
    const node = cls => `svg[id^="ip-mmd-"] .node.${cls}`;
    const kinds = KINDS.map(([kind, hue]) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[kind]}</svg>`;
      const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
      return `${node(`ipk-${kind}`)} { --k: var(--${hue}); }\n`
        + `${node(`ipk-${kind}`)} .nodeLabel::before { content: ""; -webkit-mask-image: ${url}; mask-image: ${url}; }`;
    });
    const colors = PALETTE.map((hue, i) => `${node(`ipk-c${i}`)} { --k: var(--${hue}); }`);
    return [...kinds, ...colors].join("\n");
  }

  /** Graph of a drawn flowchart: `nodeIds` its node ids, `edgeIds`
   *  Mermaid's edge ids (`L_<from>_<to>_<n>`; ids may hold `_`, so each
   *  split is checked against the known nodes). Unparsable edges are left
   *  out. `edgesOf[node]` = indexes into `edges`. */
  function graph(nodeIds, edgeIds) {
    const known = new Set(nodeIds);
    const edges = [];
    edgeIds.forEach((raw, index) => {
      const m = /^L_(.+)_\d+$/.exec(raw ?? "");
      if (!m) return;
      const parts = m[1].split("_");
      for (let k = 1; k < parts.length; k++) {
        const from = parts.slice(0, k).join("_"), to = parts.slice(k).join("_");
        if (known.has(from) && known.has(to)) { edges.push({ from, to, index }); return; }
      }
    });
    const edgesOf = {};
    edges.forEach((e, i) => { (edgesOf[e.from] ??= []).push(i); if (e.to !== e.from) (edgesOf[e.to] ??= []).push(i); });
    return { edges, edgesOf };
  }

  // `<svg id>-flowchart-<node>-<n>` → `<node>`.
  const nodeIdOf = (svgId, el) => {
    const m = new RegExp(`^${svgId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-flowchart-(.+)-\\d+$`).exec(el.id);
    return m ? m[1] : null;
  };

  /** Prepare a freshly drawn `svg`: each edge gets its length as `--ip-len`
   *  (the draw-in), the svg `ip-drawing` for the first 900ms. Returns what
   *  focus() needs. */
  function decorate(svg) {
    const nodeEls = [...svg.querySelectorAll("g.node")];
    const nodeIds = nodeEls.map(el => nodeIdOf(svg.id, el));
    const edgeEls = [...svg.querySelectorAll("path[data-edge]")];
    const g = graph(nodeIds.filter(Boolean), edgeEls.map(el => el.dataset.id));
    nodeEls.forEach((el, i) => { if (nodeIds[i]) el.dataset.node = nodeIds[i]; });
    for (const el of edgeEls) {
      const len = el.getTotalLength?.();
      if (len) el.style.setProperty("--ip-len", `${Math.ceil(len)}`);
    }
    svg.classList.add("ip-drawing");
    setTimeout(() => svg.classList.remove("ip-drawing"), 900);
    return { ...g, edgeEls, nodeEls };
  }

  /** Light the edges of node `id` and the nodes at their other ends; null
   *  clears. A node without edges clears too. */
  function focus(svg, g, id) {
    const lit = id ? g.edgesOf[id] ?? [] : [];
    svg.classList.toggle("ip-focusing", lit.length > 0);
    const near = new Set([id]);
    g.edgeEls.forEach(el => el.classList.remove("ip-lit"));
    for (const i of lit) {
      const e = g.edges[i];
      g.edgeEls[e.index]?.classList.add("ip-lit");
      near.add(e.from); near.add(e.to);
    }
    for (const el of g.nodeEls) el.classList.toggle("ip-near", lit.length > 0 && near.has(el.dataset.node));
  }

  window.OMP_MERMAID_BLOCKS = { config, mix, luminance, diagramType, kindOf, classFor, annotate, prepare, styleSheet, graph, decorate, focus };
})();
