#!/usr/bin/env node
// Regression script for src/design/ui/icon-paths.js (vendored Phosphor
// icons, scripts/vendor-phosphor.mjs): every icon name the app asks for
// exists, and the vendored markup is plain shapes only (it goes into the
// DOM through dangerouslySetInnerHTML).
// Run: node tests/test-icons.mjs

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const win = {};
// eslint-disable-next-line no-new-func
new Function("window", readFileSync(join(root, "src/design/ui/icon-paths.js"), "utf8"))(win);
const PATHS = win.OMP_ICON_PATHS;

let passed = 0;
function check(label, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`FAILED: ${label}`);
    throw err;
  }
  passed++;
}

function files(dir) {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(jsx?)$/.test(f) ? [p] : [];
  });
}

// Literal icon names: <Icon name="x">, <_XX_Icon name="x">, icon="x", icon: "x".
const used = new Map();
for (const f of [...files(join(root, "src/design")), ...files(join(root, "src/app")), join(root, "src/app-live.jsx")]) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/<(?:window\.)?_?\w*Icon\s+name=["'](\w+)["']|\bicon(?:=|:\s*)["'](\w+)["']/g)) {
    const name = m[1] || m[2];
    if (!used.has(name)) used.set(name, f.slice(root.length + 1));
  }
}

check("the scan finds the app's icons", () => {
  assert.ok(used.size >= 30, `only ${used.size} names found`);
});

check("every icon name the app uses is vendored", () => {
  const missing = [...used].filter(([n]) => !(n in PATHS)).map(([n, f]) => `${n} (${f})`);
  assert.deepEqual(missing, []);
});

check("vendored markup is shapes only", () => {
  for (const [name, markup] of Object.entries(PATHS)) {
    assert.ok(!/<script|<foreignObject|\son\w+=|javascript:|href=/i.test(markup), name);
    assert.match(markup, /^<(path|g|circle|rect|line|polyline|polygon)\b/, name);
  }
});

check("the rail toggle is the sidebar toggle mirrored", () => {
  assert.equal(PATHS.rail, `<g transform="matrix(-1 0 0 1 256 0)">${PATHS.sidebar}</g>`);
});

console.log(`icons: ${passed} checks passed (${used.size} names in use)`);
