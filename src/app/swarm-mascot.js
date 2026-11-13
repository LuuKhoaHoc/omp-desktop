/* app/swarm-mascot.js: the swarm's bee as pixel art, drawn on a 2-D canvas
   context (no three.js, no image files). A 16 x 16 grid of squares, side view,
   head to the left like Antigravity's member tiles: a body in the member's
   colour with two dark bands, one big eye, a stinger and a grey-white cloud
   of wings. The wings have two poses; a working bee swaps them, a quiet one
   holds the raised pose. Every member is a bee in its own colour; the
   coordinator wears a gold crown. `draw` reads nothing from the page, so the
   caller supplies the colours and the clock. Squares are whole device pixels
   (the canvas scale is read back from the context), so the edges stay sharp
   at any size. Plain-script IIFE. */
(function () {
  const GRID = 16;

  // B body, S band (body darkened), E eye, H eye glint, T stinger, A antenna, W wing, V wing shade, C crown.
  const BODY = [
    "..BBBBBBBBBBB...",
    ".BBBBBBSSBBSSB..",
    ".BBBBBBSSBBSSB..",
    ".BHEBBBSSBBSSBT.",
    ".BEEBBBSSBBSSBT.",
    ".BBBBBBSSBBSSB..",
    "..BBBBBBSSBBSB..",
    "...BBBBBBBBBB...",
  ];
  const ANTENNA = [".A.A............", "..AA............"];
  const WINGS = [
    // 0: raised
    ["......WWWW......", ".....WWWWWW.....", "....WWWWWWWV....", "....WWWWWWVV....", ".....VVWWVV....."],
    // 1: down, lying on the back
    ["................", "................", "................", "......WWWW......", ".....WWWWWWV...."],
  ];
  const CROWN = ["C.C.............", "CCCC............"];

  /** Wing pose at time `t` ms: 0 (raised) or 1 (down). A quiet bee holds 0. */
  const wingFrame = (t, busy) => (busy ? Math.floor(t / 150) % 2 : 0);

  /** The cells of one frame as [col, row, kind] rows, wings last (on top). A
   *  working bee in pose 1 sits one row lower, as if the beat dipped it. */
  function sprite(frame, crown) {
    const cells = [];
    const put = (rows, row0) => rows.forEach((line, r) => {
      for (let col = 0; col < GRID; col += 1) if (line[col] !== ".") cells.push([col, row0 + r, line[col]]);
    });
    const dip = frame === 1 ? 1 : 0;
    put(crown ? CROWN : ANTENNA, 3 + dip);
    put(BODY, 5 + dip);
    put(WINGS[frame], 1 + dip);
    return cells;
  }

  /** Draw one frame into a `size` x `size` square. `c` = { body, dark, wing,
   *  crown } CSS colours (`body` is the member's own colour, `dark` the ink
   *  of the eye, bands and stinger, `wing` the wings); `t` ms; `busy` makes
   *  the wings beat; `crown` marks the coordinator. */
  function draw(g, size, t, c, busy, crown = false) {
    g.clearRect(0, 0, size, size);
    const dpr = g.getTransform?.()?.a || 1;
    const cell = Math.max(1, Math.floor((size * dpr) / GRID)) / dpr; // whole device pixels
    const o = Math.round(((size - cell * GRID) * dpr) / 2) / dpr;
    const fill = (colour, alpha, col, row) => {
      g.globalAlpha = alpha;
      g.fillStyle = colour;
      g.fillRect(o + col * cell, o + row * cell, cell, cell);
    };
    for (const [col, row, kind] of sprite(wingFrame(t, busy), crown)) {
      if (kind === "B" || kind === "A") fill(c.body, 1, col, row);
      else if (kind === "S") { fill(c.body, 1, col, row); fill(c.dark, 0.55, col, row); }
      else if (kind === "E" || kind === "T") fill(c.dark, 1, col, row);
      else if (kind === "H") fill("#fff", 1, col, row);
      else if (kind === "W") fill(c.wing, 1, col, row);
      else if (kind === "V") { fill(c.wing, 1, col, row); fill(c.dark, 0.25, col, row); }
      else if (kind === "C") fill(c.crown, 1, col, row);
    }
    g.globalAlpha = 1;
  }

  /** The shared animation loop: every beating bee joins one loop. After a
   *  draw it waits `minMs` on `later` (a timer) before asking `raf` for the
   *  next frame, so a throttled loop costs nothing between draws. When the
   *  loop wakes and `hidden()` it sleeps for good (no timer, no frame
   *  request) until `resume()`; it also stops once the last bee has left.
   *  `join(frame)` returns the leave function. */
  function createBeat(raf, hidden, minMs = 0, later = setTimeout) {
    const frames = new Set();
    let armed = false; // a frame request or the wait before one is outstanding
    function loop(now) {
      if (!frames.size || hidden()) { armed = false; return; }
      for (const frame of [...frames]) frame(now);
      if (minMs > 0) later(() => raf(loop), minMs);
      else raf(loop);
    }
    const start = () => { if (!armed && frames.size) { armed = true; raf(loop); } };
    return {
      join(frame) { frames.add(frame); start(); return () => { frames.delete(frame); }; },
      /** Wake a loop that went to sleep while hidden. */
      resume: start,
      size: () => frames.size,
    };
  }

  window.OMP_SWARM_MASCOT = { GRID, wingFrame, sprite, draw, createBeat };
})();
