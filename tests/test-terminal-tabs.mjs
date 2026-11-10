// Regression: src/app/terminal-tabs.js (fork terminal tabs state).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const win = {};
new Function("window", readFileSync(new URL("../src/app/terminal-tabs.js", import.meta.url), "utf8"))(win);
const T = win.OMP_TERMINAL_TABS;
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`  ok  ${name}`); } catch (e) { failed++; console.log(`FAILED ${name}\n${e.stack}`); } };

check("add names per folder and shows the new tab", () => {
  let st = T.add(T.initial(), { id: "a", path: "/p", profile: "default" });
  st = T.add(st, { id: "b", path: "/p", profile: "default" });
  st = T.add(st, { id: "c", path: "/q", profile: "default" });
  assert.deepEqual(st.tabs.map(t => t.name), ["terminal", "terminal 2", "terminal"]);
  assert.equal(st.active, "c");
  st = T.remove(st, "a");
  assert.equal(T.nameFor(st.tabs, "/p"), "terminal");
  st = T.add(st, { id: "d", path: "/p" });
  assert.equal(T.nameFor(st.tabs, "/p"), "terminal 3");
});

check("remove the shown tab goes back to the omp tab; others keep it", () => {
  let st = T.add(T.add(T.initial(), { id: "a", path: "/p" }), { id: "b", path: "/p" });
  assert.equal(T.remove(st, "a").active, "b");
  assert.equal(T.remove(st, "b").active, null);
  assert.equal(T.remove(st, "zz"), st);
});

check("select ignores unknown ids; selectProject steps back", () => {
  const st = T.add(T.initial(), { id: "a", path: "/p" });
  const off = T.selectProject(st);
  assert.equal(off.active, null);
  assert.equal(T.selectProject(off), off);
  assert.equal(T.select(off, "a").active, "a");
  assert.equal(T.select(off, "nope"), off);
});

if (failed) { console.log(`${failed} FAILED`); process.exit(1); }
console.log("terminal-tabs: all checks passed");
