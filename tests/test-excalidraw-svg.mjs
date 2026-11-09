// Regression for src/app/excalidraw-svg.js (fork: Insights panel .excalidraw cards).
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const win = {};
vm.runInNewContext(fs.readFileSync(new URL("../src/app/excalidraw-svg.js", import.meta.url), "utf8"), { window: win });
const { toSvg } = win.OMP_EXCALIDRAW;
let n = 0;
const check = (name, fn) => { fn(); n++; };

check("shapes, arrow heads and text are drawn inside the padded bounds", () => {
  const r = toSvg({
    elements: [
      { type: "rectangle", x: 0, y: 0, width: 100, height: 50, strokeColor: "#1971c2", backgroundColor: "#a5d8ff", fillStyle: "solid" },
      { type: "diamond", x: 200, y: 0, width: 80, height: 80 },
      { type: "arrow", x: 100, y: 25, width: 100, height: 0, points: [[0, 0], [100, 0]], endArrowhead: "arrow" },
      { type: "text", x: 10, y: 10, width: 80, height: 25, text: "Sale\ntạo yêu cầu", fontSize: 20, textAlign: "center", fontFamily: 2 },
      { type: "ellipse", x: 0, y: 0, width: 5, height: 5, isDeleted: true },
    ],
  });
  assert.equal(r.width, 280 + 48);
  assert.equal(r.height, 80 + 48);
  assert.match(r.svg, /<rect x="0" y="0" width="100" height="50" rx="0.0" fill="#a5d8ff" stroke="#1971c2"/);
  assert.match(r.svg, /<polygon points="240,0 280,40 240,80 200,40"/);
  assert.equal((r.svg.match(/<polyline/g) ?? []).length, 2, "line + one head");
  assert.match(r.svg, /text-anchor="middle"><tspan x="50.0" y="30.0">Sale<\/tspan><tspan x="50.0" y="55.0">tạo yêu cầu<\/tspan>/);
  assert.ok(!r.svg.includes("<ellipse"), "deleted elements are skipped");
});

check("text and colours cannot inject markup", () => {
  const r = toSvg({
    elements: [
      { type: "text", x: 0, y: 0, width: 10, height: 10, text: "<script>alert(1)</script>&", strokeColor: '"/><script>' },
      { type: "rectangle", x: "1e3", y: "oops", width: 1, height: 1, backgroundColor: "url(javascript:x)", fillStyle: "solid" },
    ],
    appState: { viewBackgroundColor: "red;}" },
  });
  assert.ok(!r.svg.includes("<script"), r.svg);
  assert.match(r.svg, /&lt;script&gt;alert\(1\)&lt;\/script&gt;&amp;/);
  assert.ok(!r.svg.includes("javascript"));
  assert.match(r.svg, /fill="#ffffff"/, "bad background falls back");
  assert.match(r.svg, /<rect x="1000" y="0"/, "numbers are coerced");
});

check("a non-scene throws; an empty scene is a padded blank", () => {
  assert.throws(() => toSvg({ type: "excalidraw" }), /not an Excalidraw scene/);
  assert.throws(() => toSvg(null));
  const r = toSvg({ elements: [] });
  assert.equal(r.width, 48);
});

console.log(`test-excalidraw-svg: ${n} checks passed`);
