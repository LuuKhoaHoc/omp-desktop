#!/usr/bin/env node
// Regression script for src/app/swarm-view.js: the swarm pane's post-body
// tokens (`code`, `#n` references) and the Graph's geometry and time span.
// Run: node tests/test-swarm-view.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src/app/swarm-view.js"), "utf8");
const win = {};
// eslint-disable-next-line no-new-func
new Function("window", src)(win);
const V = win.OMP_SWARM_VIEW;

let passed = 0;
function check(label, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`FAILED: ${label}`);
    throw err;
  }
  passed += 1;
}

check("plain text is one token", () => {
  assert.deepEqual(V.bodyTokens("nothing special", 3), [{ kind: "text", text: "nothing special" }]);
});

check("backtick spans become code and lose their ticks", () => {
  assert.deepEqual(V.bodyTokens("edit `a.go` now", 0), [
    { kind: "text", text: "edit " }, { kind: "code", text: "a.go" }, { kind: "text", text: " now" },
  ]);
});

check("#n is a ref only when post n exists", () => {
  const t = V.bodyTokens("see #2 and #9 and #0", 3);
  assert.deepEqual(t.filter(x => x.kind === "ref"), [{ kind: "ref", text: "#2", n: 2 }]);
  assert.equal(t.map(x => x.text).join(""), "see #2 and #9 and #0");
});

check("a #n inside a code span stays code", () => {
  assert.deepEqual(V.bodyTokens("`#1`", 5), [{ kind: "code", text: "#1" }]);
});

check("an unclosed or empty tick stays text; markup is never parsed", () => {
  assert.deepEqual(V.bodyTokens("a ` b", 1), [{ kind: "text", text: "a ` b" }]);
  assert.deepEqual(V.bodyTokens("<b>x</b>", 1), [{ kind: "text", text: "<b>x</b>" }]);
  assert.deepEqual(V.bodyTokens("", 1), []);
});

check("pill width grows with the name", () => {
  assert.ok(V.pillWidth("verifier") > V.pillWidth("ab"));
});

check("layout puts the first name at 12 o'clock and every pill inside the box", () => {
  const pos = V.layout(["a", "b", "c", "d"]);
  assert.ok(Math.abs(pos.a.x - V.W / 2) < 1e-9 && pos.a.y < V.H / 2);
  for (const p of Object.values(pos)) assert.ok(p.x > 0 && p.x < V.W && p.y > 0 && p.y < V.H);
});

check("layout keeps the whole pill of a long name inside the box", () => {
  const pos = V.layout(["coordinator", "verifier", "dedupe-packages", "stats"]);
  for (const [n, p] of Object.entries(pos)) assert.ok(p.x - V.pillWidth(n) / 2 >= 0 && p.x + V.pillWidth(n) / 2 <= V.W, n);
});

check("an arrow leaves the pill's border toward the target", () => {
  const a = { x: 0, y: 0, hw: 10, hh: 5 };
  assert.deepEqual(V.edgePoint(a, { x: 100, y: 0 }), { x: 10, y: 0 });
  assert.deepEqual(V.edgePoint(a, { x: 0, y: -50 }), { x: 0, y: -5 });
  const diag = V.edgePoint(a, { x: 100, y: 100 });
  assert.equal(diag.y, 5);
});

check("curve.at walks from the source's border to the target's, and passes the label point", () => {
  const p = { x: 0, y: 0, hw: 10, hh: 5 };
  const q = { x: 100, y: 0, hw: 10, hh: 5 };
  const c = V.curve(p, q);
  assert.deepEqual(c.at(0), V.edgePoint(p, q));
  assert.deepEqual(c.at(1), V.edgePoint(q, p));
  const mid = c.at(0.5);
  assert.ok(Math.abs(mid.x - c.lx) < 1e-9 && Math.abs(mid.y - c.ly) < 1e-9);
});

check("the two directions of a pair curve to opposite sides", () => {
  const p = { x: 0, y: 0, hw: 10, hh: 5 };
  const q = { x: 100, y: 0, hw: 10, hh: 5 };
  const ab = V.curve(p, q);
  const ba = V.curve(q, p);
  assert.ok(ab.ly < 0 !== ba.ly < 0);
  assert.match(ab.d, /^M[\d.-]+,[\d.-]+ Q[\d.-]+,[\d.-]+ [\d.-]+,[\d.-]+$/);
});

check("span reads seconds, then minutes, and hides under a second", () => {
  const at = s => ({ t: 1_000_000 + s * 1000 });
  assert.equal(V.span([at(0)]), "");
  assert.equal(V.span([at(0), at(0.3)]), "");
  assert.equal(V.span([at(0), at(42)]), "42s");
  assert.equal(V.span([at(0), at(389)]), "6m 29s");
});

check("replay delay: even is fixed, real follows the gap within bounds, speed divides", () => {
  const posts = [{ t: 0 }, { t: 1_000 }, { t: 61_000 }, { t: 400_000 }];
  assert.equal(V.playDelay(posts, 1, "even", 1), 700);
  assert.equal(V.playDelay(posts, 1, "even", 2), 350);
  assert.equal(V.playDelay(posts, 1, "real", 1), 250); // 1s gap / 10 = 100 ms, raised to the floor
  assert.equal(V.playDelay(posts, 2, "real", 1), 2500); // 60s gap / 10 = 6s, capped
  assert.equal(V.playDelay(posts, 2, "real", 2), 1250);
  assert.equal(V.playDelay(posts, 0, "real", 1), 700); // nothing shown yet: no gap to follow
  assert.equal(V.playDelay(posts, 1, "even", 0), 700); // a bad speed falls back to 1x
});

console.log(`test-swarm-view: ${passed} checks passed`);
