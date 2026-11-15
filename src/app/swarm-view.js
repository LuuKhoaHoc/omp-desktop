/* app/swarm-view.js: the pure parts of the swarm pane's Board and Graph tabs,
   kept out of the JSX so they can be asserted (tests/test-swarm-view.mjs).
   `bodyTokens` splits a post's text into plain text, `code` spans and `#n`
   references; the rest is the Graph's geometry (pill size, circular layout,
   where an arrow leaves a pill, the bowed curve and its label spot) and the
   "N posts over T" span. */
(function () {
  const W = 360;
  const H = 320;
  const RX = 140;
  const RY = 118;
  const PILL_H = 32;
  const CHAR_W = 8;
  const TOKEN = /(`[^`\n]+`|#\d+\b)/g;

  /** Text → `[{ kind: "text" | "code" | "ref", text, n? }]`. A `#n` is a
   *  `ref` only when post n exists (1..total); otherwise it stays text. */
  function bodyTokens(text, total) {
    const out = [];
    for (const part of String(text).split(TOKEN)) {
      if (part === "") continue;
      if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
        out.push({ kind: "code", text: part.slice(1, -1) });
      } else if (/^#\d+$/.test(part) && Number(part.slice(1)) >= 1 && Number(part.slice(1)) <= total) {
        out.push({ kind: "ref", text: part, n: Number(part.slice(1)) });
      } else {
        out.push({ kind: "text", text: part });
      }
    }
    return out;
  }

  const pillWidth = name => Math.round(name.length * CHAR_W + 46);

  /** Expand the ellipse until padded node bounds no longer intersect.
   *  Keep natural text size; the viewport scrolls rather than shrinking names. */
  function layout(names, width = W) {
    const pos = {};
    const widest = Math.max(0, ...names.map(pillWidth));
    let rx = Math.max(RX, (width - widest) / 2 - 24);
    let ry = Math.max(RY, names.length * 12);
    for (let pass = 0; pass < 100; pass++) {
      names.forEach((n, i) => {
        const a = (2 * Math.PI * i) / names.length - Math.PI / 2;
        pos[n] = { x: rx * Math.cos(a), y: ry * Math.sin(a), hw: pillWidth(n) / 2 + 3, hh: PILL_H / 2 + 3 };
      });
      const nodes = Object.values(pos);
      const overlap = nodes.some((a, i) => nodes.slice(i + 1).some(b =>
        Math.abs(a.x - b.x) < a.hw + b.hw + 48 && Math.abs(a.y - b.y) < a.hh + b.hh + 40));
      if (!overlap) break;
      rx *= 1.12;
      ry *= 1.12;
    }
    const nodes = Object.values(pos);
    const left = Math.min(0, ...nodes.map(n => n.x - n.hw)) - 32;
    const top = Math.min(0, ...nodes.map(n => n.y - n.hh)) - 32;
    nodes.forEach(n => { n.x -= left; n.y -= top; });
    return pos;
  }

  function bounds(pos) {
    const nodes = Object.values(pos);
    return { width: Math.max(W, ...nodes.map(n => n.x + n.hw + 32)), height: Math.max(H, ...nodes.map(n => n.y + n.hh + 32)) };
  }

  /** Where the straight line from `a` toward `b` leaves a's pill. */
  function edgePoint(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.min(dx === 0 ? Infinity : a.hw / Math.abs(dx), dy === 0 ? Infinity : a.hh / Math.abs(dy));
    return { x: a.x + dx * t, y: a.y + dy * t };
  }

  /** A quadratic curve bowed to the side of travel, so A→B and B→A do not
   *  overlap; `lx`/`ly` is the curve's midpoint, where its label sits and
   *  `at(t)` the point a fraction `t` (0..1) along it, where a pulse rides. */
  function curve(from, to) {
    const a = edgePoint(from, to);
    const b = edgePoint(to, from);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const cx = (a.x + b.x) / 2 - (dy / len) * 16;
    const cy = (a.y + b.y) / 2 + (dx / len) * 16;
    const at = t => {
      const u = 1 - t;
      return { x: u * u * a.x + 2 * u * t * cx + t * t * b.x, y: u * u * a.y + 2 * u * t * cy + t * t * b.y };
    };
    return { d: `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`, lx: (a.x + 2 * cx + b.x) / 4, ly: (a.y + 2 * cy + b.y) / 4, at };
  }

  /** How long the posts spread over ("6m 29s"); "" when under a second. */
  function span(posts) {
    if (posts.length < 2) return "";
    const s = Math.round((posts[posts.length - 1].t - posts[0].t) / 1000);
    if (s < 1) return "";
    return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
  }

  /** Milliseconds before the replay shows post `at + 1` (0-based count of
   *  posts already shown). "even" is a fixed step; "real" follows the gap
   *  between the two posts, compressed 10x and kept between 250 ms and 2.5 s.
   *  `speed` divides either. */
  function playDelay(posts, at, pacing, speed) {
    const s = speed > 0 ? speed : 1;
    if (pacing !== "real" || at < 1 || at >= posts.length) return 700 / s;
    const gap = (posts[at].t - posts[at - 1].t) / 10;
    return Math.min(2500, Math.max(250, gap)) / s;
  }

  window.OMP_SWARM_VIEW = { W, H, PILL_H, bodyTokens, pillWidth, layout, bounds, edgePoint, curve, span, playDelay };
})();
