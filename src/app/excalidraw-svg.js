/* app/excalidraw-svg.js — a `.excalidraw` scene as a static SVG string (fork,
   Insights panel). Clean shapes, not Excalidraw's hand-drawn strokes: enough
   to read a diagram the agent drew without vendoring Excalidraw itself.
   Covers rectangle, diamond, ellipse, line, arrow (with heads), freedraw and
   text; every value reaching the markup is escaped or forced to a number.
   window.OMP_EXCALIDRAW = { toSvg(scene) → { svg, width, height } }, throws
   on a scene that is not Excalidraw JSON. */
(function () {
  const PAD = 24;
  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // Colours: hex, rgb()/hsl() or a bare name; anything else falls back.
  const color = (c, d) => (typeof c === "string" && /^(#[0-9a-f]{3,8}|transparent|[a-z]+|(rgb|hsl)a?\([\d\s.,%]+\))$/i.test(c) ? c : d);
  const FONTS = { 1: "Virgil, 'Segoe Print', 'Comic Sans MS', cursive", 2: "Helvetica, Arial, sans-serif", 3: "'Cascadia Code', monospace" };

  function bounds(els) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const e of els) {
      const pts = Array.isArray(e.points) && e.points.length ? e.points : [[0, 0], [num(e.width), num(e.height)]];
      for (const [px, py] of pts) {
        const x = num(e.x) + num(px), y = num(e.y) + num(py);
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
    return Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: 0, y1: 0 };
  }

  function head(pts, atEnd, stroke, w) {
    const [a, b] = atEnd ? [pts[pts.length - 2], pts[pts.length - 1]] : [pts[1], pts[0]];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), len = 10 + 2 * w;
    const p = (s) => `${(b[0] - len * Math.cos(ang + s)).toFixed(1)},${(b[1] - len * Math.sin(ang + s)).toFixed(1)}`;
    return `<polyline points="${p(0.45)} ${b[0].toFixed(1)},${b[1].toFixed(1)} ${p(-0.45)}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  function shape(e) {
    const x = num(e.x), y = num(e.y), w = num(e.width), h = num(e.height);
    const stroke = color(e.strokeColor, "#1e1e1e");
    const fill = e.fillStyle === "hachure" || e.fillStyle === "cross-hatch" || e.fillStyle === "solid" || e.fillStyle === "zigzag" ? color(e.backgroundColor, "transparent") : "transparent";
    const sw = Math.max(0.5, num(e.strokeWidth, 2));
    const dash = e.strokeStyle === "dashed" ? ` stroke-dasharray="${sw * 4} ${sw * 3}"` : e.strokeStyle === "dotted" ? ` stroke-dasharray="${sw} ${sw * 2.5}"` : "";
    const op = num(e.opacity, 100) / 100;
    const common = `stroke="${stroke}" stroke-width="${sw}"${dash}${op < 1 ? ` opacity="${op}"` : ""}`;
    const rot = num(e.angle) ? ` transform="rotate(${(num(e.angle) * 180 / Math.PI).toFixed(2)} ${(x + w / 2).toFixed(1)} ${(y + h / 2).toFixed(1)})"` : "";
    switch (e.type) {
      case "rectangle": case "frame": {
        const r = e.roundness ? Math.min(w, h) * 0.12 : 0;
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r.toFixed(1)}" fill="${fill}" ${common}${rot}/>`;
      }
      case "diamond":
        return `<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}" fill="${fill}" stroke-linejoin="round" ${common}${rot}/>`;
      case "ellipse":
        return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" ${common}${rot}/>`;
      case "line": case "arrow": case "freedraw": {
        const pts = (Array.isArray(e.points) ? e.points : []).map(([px, py]) => [x + num(px), y + num(py)]);
        if (pts.length < 2) return "";
        const d = pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
        let out = `<polyline points="${d}" fill="none" stroke-linecap="round" stroke-linejoin="round" ${common}/>`;
        if (e.type === "arrow") {
          if (e.endArrowhead !== null) out += head(pts, true, stroke, sw);
          if (e.startArrowhead) out += head(pts, false, stroke, sw);
        }
        return out;
      }
      case "text": {
        const fs = num(e.fontSize, 20), lh = fs * num(e.lineHeight, 1.25);
        const lines = String(e.text ?? "").split("\n");
        const anchor = e.textAlign === "center" ? "middle" : e.textAlign === "right" ? "end" : "start";
        const tx = anchor === "middle" ? x + w / 2 : anchor === "end" ? x + w : x;
        const spans = lines.map((l, i) => `<tspan x="${tx.toFixed(1)}" y="${(y + i * lh + fs).toFixed(1)}">${esc(l) || " "}</tspan>`).join("");
        return `<text font-family="${esc(FONTS[e.fontFamily] ?? FONTS[1])}" font-size="${fs}" fill="${stroke}" text-anchor="${anchor}"${op < 1 ? ` opacity="${op}"` : ""}${rot}>${spans}</text>`;
      }
      default:
        return ""; // image, embeddable, …: not drawn
    }
  }

  function toSvg(scene) {
    if (!scene || typeof scene !== "object" || !Array.isArray(scene.elements)) throw new Error("not an Excalidraw scene (no elements array)");
    const els = scene.elements.filter((e) => e && !e.isDeleted);
    const b = bounds(els);
    const width = Math.ceil(b.x1 - b.x0 + 2 * PAD), height = Math.ceil(b.y1 - b.y0 + 2 * PAD);
    const bg = color(scene.appState?.viewBackgroundColor, "#ffffff");
    const body = els.map(shape).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${(b.x0 - PAD).toFixed(1)} ${(b.y0 - PAD).toFixed(1)} ${width} ${height}"><rect x="${(b.x0 - PAD).toFixed(1)}" y="${(b.y0 - PAD).toFixed(1)}" width="${width}" height="${height}" fill="${bg}"/>${body}</svg>`;
    return { svg, width, height };
  }

  window.OMP_EXCALIDRAW = { toSvg };
})();
