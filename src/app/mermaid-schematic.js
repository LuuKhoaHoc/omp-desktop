/* ═════════════════════════════════════════════════════════════════════
   app/mermaid-schematic.js — the schematic look of Mermaid diagrams
   (window.OMP_MERMAID_SCHEMATIC), shared by Insights cards and ```mermaid
   blocks in chat (both draw through insights-panel.jsx's _IP_Diagram).
     config(read)        Mermaid's initialize() options from the CSS tokens
     diagramType(src)    "flowchart", "sequence", … for the card's kind label
     graph(nodeIds, edgeIds)  sources / sinks / per-node edges, pure
     decorate(svg)       marks terminals, sets each edge's length for the
                         draw-in, returns the graph for focus()
     focus(svg, g, id)   lights one node's edges (null clears)
   Colours live in layout/diagram.css as var(--…) so a theme switch restyles
   a drawn diagram without re-rendering it; `config` only feeds Mermaid's
   own layout and the diagram kinds that CSS leaves alone.
   ═════════════════════════════════════════════════════════════════════ */
(function () {
  /** Mermaid options. `read(name)` is a CSS custom property's value. */
  function config(read) {
    const bg = read("--bg-window") || "#111111";
    return {
      startOnLoad: false, securityLevel: "strict", theme: "base", look: "classic",
      // Layout is measured in this font, so the CSS must not change its size.
      fontFamily: read("--font-mono") || "monospace", fontSize: 13,
      flowchart: { padding: 14, nodeSpacing: 44, rankSpacing: 56 },
      themeVariables: {
        darkMode: luminance(bg) < 0.5, background: "transparent", fontSize: "13px",
        primaryColor: bg, primaryTextColor: read("--fg"), primaryBorderColor: read("--fg-3"),
        secondaryColor: read("--bg-surface"), tertiaryColor: bg,
        lineColor: read("--fg-4"), textColor: read("--fg-2"), mainBkg: bg, nodeBorder: read("--fg-3"),
        clusterBkg: "transparent", clusterBorder: read("--line-bright"), edgeLabelBackground: bg, labelBackground: bg,
        noteBkgColor: bg, noteTextColor: read("--fg-2"), noteBorderColor: read("--line-bright"),
        actorBkg: bg, actorBorder: read("--fg-3"), actorTextColor: read("--fg"), signalColor: read("--fg-3"), signalTextColor: read("--fg-2"),
      },
    };
  }

  /** Relative luminance of `#rgb` / `#rrggbb` (0 dark … 1 light); 0 for
   *  anything else, which keeps Mermaid in dark mode. */
  function luminance(hex) {
    let h = String(hex).trim().replace(/^#/, "");
    if (h.length === 3) h = [...h].map(c => c + c).join("");
    if (!/^[0-9a-f]{6}$/i.test(h)) return 0;
    const [r, g, b] = [0, 2, 4].map(i => {
      const c = parseInt(h.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
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

  /** Graph of a drawn flowchart: `nodeIds` its node ids, `edgeIds`
   *  Mermaid's edge ids (`L_<from>_<to>_<n>`; ids may hold `_`, so each
   *  split is checked against the known nodes). Unparsable edges are left
   *  out. `sources` have no incoming edge, `sinks` no outgoing one; both
   *  are empty without edges. `edgesOf[node]` = indexes into `edges`. */
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
    const hasIn = new Set(edges.map(e => e.to)), hasOut = new Set(edges.map(e => e.from));
    const linked = nodeIds.filter(n => hasIn.has(n) || hasOut.has(n));
    const edgesOf = {};
    edges.forEach((e, i) => { (edgesOf[e.from] ??= []).push(i); if (e.to !== e.from) (edgesOf[e.to] ??= []).push(i); });
    return {
      edges, edgesOf,
      sources: linked.filter(n => !hasIn.has(n)),
      sinks: linked.filter(n => !hasOut.has(n)),
    };
  }

  // `<svg id>-flowchart-<node>-<n>` → `<node>`.
  const nodeIdOf = (svgId, el) => {
    const m = new RegExp(`^${svgId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-flowchart-(.+)-\\d+$`).exec(el.id);
    return m ? m[1] : null;
  };

  /** Prepare a freshly drawn `svg`: terminal nodes get `ip-terminal`, each
   *  edge its length as `--ip-len` (the draw-in), the svg `ip-drawing` for
   *  the first 900ms. Returns what focus() needs. */
  function decorate(svg) {
    const nodeEls = [...svg.querySelectorAll("g.node")];
    const nodeIds = nodeEls.map(el => nodeIdOf(svg.id, el));
    const edgeEls = [...svg.querySelectorAll("path[data-edge]")];
    const g = graph(nodeIds.filter(Boolean), edgeEls.map(el => el.dataset.id));
    const terminal = new Set([...g.sources, ...g.sinks]);
    nodeEls.forEach((el, i) => {
      if (nodeIds[i]) el.dataset.node = nodeIds[i];
      el.classList.toggle("ip-terminal", terminal.has(nodeIds[i]));
    });
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

  window.OMP_MERMAID_SCHEMATIC = { config, luminance, diagramType, graph, decorate, focus };
})();
