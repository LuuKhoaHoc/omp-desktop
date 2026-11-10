#!/usr/bin/env node
// Regression script for src/app/mermaid-schematic.js (diagram look: config, kind, graph).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const win = {};
// eslint-disable-next-line no-new-func
new Function("window", readFileSync(join(root, "src/app/mermaid-schematic.js"), "utf8"))(win);
let passed = 0;
function check(label, fn) {
  try { fn(); } catch (err) { console.error(`FAILED: ${label}`); throw err; }
  passed++;
}
const M = win.OMP_MERMAID_SCHEMATIC;

check("config: mono font, strict, transparent, dark mode from the paper colour", () => {
  const vars = { "--bg-window": "#17181A", "--font-mono": "JetBrains Mono", "--fg": "#eee" };
  const c = M.config(n => vars[n] ?? "");
  assert.equal(c.securityLevel, "strict");
  assert.equal(c.fontFamily, "JetBrains Mono");
  assert.equal(c.themeVariables.background, "transparent");
  assert.equal(c.themeVariables.darkMode, true);
  assert.equal(M.config(n => (n === "--bg-window" ? "#F6F3EB" : "")).themeVariables.darkMode, false);
});

check("luminance: 3/6-digit hex, junk is dark", () => {
  assert.equal(M.luminance("#000"), 0);
  assert.ok(Math.abs(M.luminance("#ffffff") - 1) < 1e-9);
  assert.equal(M.luminance("rgb(1,2,3)"), 0);
});

check("diagramType skips front matter and comments", () => {
  assert.equal(M.diagramType("flowchart LR\n A-->B"), "flowchart");
  assert.equal(M.diagramType("---\ntitle: x\n---\n%% c\n\nsequenceDiagram\n A->>B: hi"), "sequence");
  assert.equal(M.diagramType("graph TD;A-->B"), "flowchart");
  assert.equal(M.diagramType("stateDiagram-v2\n[*]-->A"), "state");
  assert.equal(M.diagramType("nonsense"), "mermaid");
  assert.equal(M.diagramType(""), "mermaid");
});

check("graph: underscores in ids, sources/sinks, edges per node", () => {
  const g = M.graph(["A", "auth_svc", "DB", "lonely"], ["L_A_auth_svc_0", "L_auth_svc_DB_0", "L_auth_svc_DB_1", "junk"]);
  assert.deepEqual(g.edges.map(e => [e.from, e.to, e.index]), [["A", "auth_svc", 0], ["auth_svc", "DB", 1], ["auth_svc", "DB", 2]]);
  assert.deepEqual(g.sources, ["A"]);
  assert.deepEqual(g.sinks, ["DB"]);
  assert.deepEqual(g.edgesOf.auth_svc, [0, 1, 2]);
  assert.equal(g.edgesOf.lonely, undefined);
});

check("graph: a cycle has no terminals, no edges no terminals", () => {
  const g = M.graph(["A", "B"], ["L_A_B_0", "L_B_A_0"]);
  assert.deepEqual([g.sources, g.sinks], [[], []]);
  assert.deepEqual(M.graph(["A"], []).sources, []);
});

console.log(`test-mermaid-schematic: ${passed} checks passed`);
