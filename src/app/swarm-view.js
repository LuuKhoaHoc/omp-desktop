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

  /** Names around an ellipse, the first at 12 o'clock; `hw`/`hh` are the
   *  half sizes (padded) the arrows stop short of. The horizontal radius
   *  shrinks so the widest pill stays inside the canvas. */
  function layout(names) {
    const pos = {};
    const widest = Math.max(0, ...names.map(pillWidth));
    const rx = Math.max(0, Math.min(RX, W / 2 - widest / 2 - 6));
    names.forEach((n, i) => {
      const a = (2 * Math.PI * i) / names.length - Math.PI / 2;
      pos[n] = { x: W / 2 + rx * Math.cos(a), y: H / 2 + RY * Math.sin(a), hw: pillWidth(n) / 2 + 3, hh: PILL_H / 2 + 3 };
    });
    return pos;
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

  window.OMP_SWARM_VIEW = { W, H, PILL_H, bodyTokens, pillWidth, layout, edgePoint, curve, span, playDelay };
})();
