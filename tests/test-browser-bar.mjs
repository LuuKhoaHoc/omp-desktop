#!/usr/bin/env node
// Regression script for src/app/browser-bar.js — pure helpers of the
// browser toolbar: moreMenu rows and disabled states, and loadButton state.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const win = {};
new Function("window", readFileSync(join(root, "src/app/browser-bar.js"), "utf8"))(win);
const BAR = win.OMP_BROWSER_BAR;

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

check("moreMenu disabled states with no URL", () => {
  const rows = BAR.moreMenu(null);
  assert.equal(rows.length, 4);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId.openExternal.disabled, true);
  assert.equal(byId.copyAddress.disabled, true);
  assert.equal(byId.reload.disabled, true);
  assert.equal(byId.stopBrowser.disabled, false);
});

check("moreMenu disabled states with about:blank and data:", () => {
  for (const url of ["about:blank", "data:text/html,hello"]) {
    const rows = BAR.moreMenu({ url });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.equal(byId.openExternal.disabled, true, `openExternal disabled for ${url}`);
    assert.equal(byId.copyAddress.disabled, false);
    assert.equal(byId.reload.disabled, false);
    assert.equal(byId.stopBrowser.disabled, false);
  }
});

check("moreMenu disabled states with valid HTTP URL", () => {
  const rows = BAR.moreMenu({ url: "https://example.com" });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId.openExternal.disabled, false);
  assert.equal(byId.copyAddress.disabled, false);
  assert.equal(byId.reload.disabled, false);
  assert.equal(byId.stopBrowser.disabled, false);
});

check("loadButton returns stop when loading is true", () => {
  const res = BAR.loadButton({ loading: true });
  assert.deepEqual(res, { icon: "close", label: "stop loading", action: "stop" });
});

check("loadButton returns reload when loading is false or missing", () => {
  assert.deepEqual(BAR.loadButton({ loading: false }), {
    icon: "refresh",
    label: "reload",
    action: "reload",
  });
  assert.deepEqual(BAR.loadButton(null), {
    icon: "refresh",
    label: "reload",
    action: "reload",
  });
});

console.log(`test-browser-bar: ${passed} checks passed`);
