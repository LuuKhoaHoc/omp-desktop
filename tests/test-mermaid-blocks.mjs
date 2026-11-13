#!/usr/bin/env node
// Regression script for src/app/mermaid-blocks.js (diagram look: config, kinds, source prep, graph).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const win = {};
// eslint-disable-next-line no-new-func
new Function("window", readFileSync(join(root, "src/app/mermaid-blocks.js"), "utf8"))(win);
let passed = 0;
async function check(label, fn) {
  try { await fn(); } catch (err) { console.error(`FAILED: ${label}`); throw err; }
  passed++;
}
const M = win.OMP_MERMAID_BLOCKS;

await check("config: sans font, strict, transparent, dark mode from the paper colour", () => {
  const vars = { "--bg-window": "#17181A", "--font-sans": "Geist", "--fg": "#eee", "--cyan": "#6EE7FF" };
  const c = M.config(n => vars[n] ?? "");
  assert.equal(c.securityLevel, "strict");
  assert.equal(c.fontFamily, "Geist");
  assert.equal(c.themeVariables.background, "transparent");
  assert.equal(c.themeVariables.darkMode, true);
  assert.equal(M.config(n => (n === "--bg-window" ? "#F6F3EB" : "")).themeVariables.darkMode, false);
});

await check("mix: weights two hex colours, falls back to the base for non-hex", () => {
  assert.equal(M.mix("#ffffff", "#000000", 0.5), "#808080");
  assert.equal(M.mix("#f00", "#000", 1), "#ff0000");
  assert.equal(M.mix("rgb(1,2,3)", "#101010", 0.5), "#101010");
});

await check("luminance: 3/6-digit hex, junk is dark", () => {
  assert.equal(M.luminance("#000"), 0);
  assert.ok(Math.abs(M.luminance("#ffffff") - 1) < 1e-9);
  assert.equal(M.luminance("rgb(1,2,3)"), 0);
});

await check("diagramType skips front matter and comments", () => {
  assert.equal(M.diagramType("flowchart LR\n A-->B"), "flowchart");
  assert.equal(M.diagramType("---\ntitle: x\n---\n%% c\n\nsequenceDiagram\n A->>B: hi"), "sequence");
  assert.equal(M.diagramType("graph TD;A-->B"), "flowchart");
  assert.equal(M.diagramType("stateDiagram-v2\n[*]-->A"), "state");
  assert.equal(M.diagramType("nonsense"), "mermaid");
  assert.equal(M.diagramType(""), "mermaid");
});

await check("kindOf: the ChatGPT-style architecture labels", () => {
  const expect = {
    User: "user", Frontend: "web", "API Gateway": "gateway", Backend: "server", Authentication: "auth",
    "Business Logic": "logic", Database: "db", "Redis Cache": "cache", "External Services": "external",
    PostgreSQL: "db", Redis: "cache", "Auth Service": "auth", "Message Queue": "queue", "Payment Service": "payment",
  };
  for (const [label, kind] of Object.entries(expect)) assert.equal(M.kindOf(label), kind, label);
});

await check("kindOf: Vietnamese labels, html in labels, unknown labels", () => {
  assert.equal(M.kindOf("Người dùng"), "user");
  assert.equal(M.kindOf("Cơ sở dữ liệu"), "db");
  assert.equal(M.kindOf("Máy chủ API"), "server");
  assert.equal(M.kindOf("Giao diện web"), "web");
  assert.equal(M.kindOf("Redis<br/>Cache"), "cache");
  assert.equal(M.kindOf("Foo bar"), null);
  assert.equal(M.kindOf("Users table"), "db");
  assert.equal(M.kindOf("User Service"), "server");
  assert.equal(M.kindOf(""), null);
});

await check("classFor: kind class, else a stable palette class", () => {
  assert.equal(M.classFor("Database"), "ipk-db");
  const c = M.classFor("Foo bar");
  assert.match(c, /^ipk-c[0-5]$/);
  assert.equal(M.classFor("Foo bar"), c);
});

await check("annotate: one class line per class, odd ids skipped", () => {
  const out = M.annotate("flowchart TD\n A-->B", [["A", "User"], ["B", "Database"], ["C", "Users"], ["d.e", "Redis"]]);
  assert.ok(out.startsWith("flowchart TD\n A-->B\n"));
  assert.ok(out.includes("class A,C ipk-user\n"));
  assert.ok(out.includes("class B ipk-db\n"));
  assert.ok(!out.includes("d.e"));
  assert.equal(M.annotate("flowchart TD", []), "flowchart TD");
});

await check("prepare: only flowcharts are annotated; a parse failure leaves the source", async () => {
  const fake = { mermaidAPI: { getDiagramFromText: async () => ({ db: { getVertices: () => new Map([["A", { text: "User" }]]) } }) } };
  assert.ok((await M.prepare(fake, "flowchart TD\n A")).includes("class A ipk-user"));
  assert.equal(await M.prepare(fake, "sequenceDiagram\n A->>B: x"), "sequenceDiagram\n A->>B: x");
  const bad = { mermaidAPI: { getDiagramFromText: async () => { throw new Error("parse"); } } };
  assert.equal(await M.prepare(bad, "flowchart TD\n A["), "flowchart TD\n A[");
});

await check("styleSheet: every kind gets a color and an icon mask", () => {
  const css = M.styleSheet();
  for (const kind of ["user", "web", "gateway", "server", "logic", "auth", "db", "cache", "external"]) {
    assert.ok(css.includes(`.node.ipk-${kind} { --k:`), kind);
    assert.ok(css.includes(`.node.ipk-${kind} .nodeLabel::before`), kind);
  }
  assert.ok(css.includes(".node.ipk-c5 { --k:"));
  assert.ok(css.includes("data:image/svg+xml,%3Csvg"));
});

await check("graph: underscores in ids, edges per node", () => {
  const g = M.graph(["A", "auth_svc", "DB", "lonely"], ["L_A_auth_svc_0", "L_auth_svc_DB_0", "L_auth_svc_DB_1", "junk"]);
  assert.deepEqual(g.edges.map(e => [e.from, e.to, e.index]), [["A", "auth_svc", 0], ["auth_svc", "DB", 1], ["auth_svc", "DB", 2]]);
  assert.deepEqual(g.edgesOf.auth_svc, [0, 1, 2]);
  assert.equal(g.edgesOf.lonely, undefined);
});

console.log(`test-mermaid-blocks: ${passed} checks passed`);
