#!/usr/bin/env node
// Regression script for src/app/dock-tabs.js — pure model for unified
// dock tabs (web pages + tools).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const win = {};
new Function("window", readFileSync(join(root, "src/app/dock-tabs.js"), "utf8"))(win);
const DOCK = win.OMP_DOCK_TABS;

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

check("initial returns clean state or adopts saved", () => {
  assert.deepEqual(DOCK.initial(), { activeId: null, tools: [] });
  assert.deepEqual(
    DOCK.initial({ activeId: "tool:terminal", tools: ["terminal"] }),
    { activeId: "tool:terminal", tools: ["terminal"] }
  );
});

check("toolInfo returns metadata for known tools and fallback", () => {
  assert.equal(DOCK.toolInfo("terminal").title, "Terminal");
  assert.equal(DOCK.toolInfo("terminal").icon, "terminal");
  assert.equal(DOCK.toolInfo("changes").title, "Changes");
  assert.equal(DOCK.toolInfo("changes").icon, "branch");
  assert.equal(DOCK.toolInfo("files").title, "Files");
  assert.equal(DOCK.toolInfo("files").icon, "file");

  const custom = DOCK.toolInfo("unknown");
  assert.equal(custom.title, "unknown");
  assert.equal(custom.icon, "web");
});

check("openTool adds tool and activates it without duplicates", () => {
  let state = DOCK.initial();
  state = DOCK.openTool(state, "terminal");
  assert.deepEqual(state.tools, ["terminal"]);
  assert.equal(state.activeId, "tool:terminal");

  state = DOCK.openTool(state, "changes");
  assert.deepEqual(state.tools, ["terminal", "changes"]);
  assert.equal(state.activeId, "tool:changes");

  // Re-opening existing tool activates it but doesn't duplicate
  state = DOCK.openTool(state, "terminal");
  assert.deepEqual(state.tools, ["terminal", "changes"]);
  assert.equal(state.activeId, "tool:terminal");
});

check("BrowserStart receives the dock openTool handler", () => {
  const browserPanel = readFileSync(join(root, "src/design/browser-panel.jsx"), "utf8");
  assert.match(
    browserPanel,
    /<_BP_Start\s+ui=\{ui\}\s+onOpenTool=\{ui\.dock\?\.openTool\}\s*\/>/
  );
});

check("closeTool removes tool and resolves activeId fallback", () => {
  let state = { activeId: "tool:terminal", tools: ["terminal", "changes"] };
  state = DOCK.closeTool(state, "terminal", "page:123");
  assert.deepEqual(state.tools, ["changes"]);
  assert.equal(state.activeId, "tool:changes"); // switches to remaining tool

  state = DOCK.closeTool(state, "changes", "page:123");
  assert.deepEqual(state.tools, []);
  assert.equal(state.activeId, "page:123"); // falls back to page
});

check("activate and showPage set exact active target", () => {
  let state = DOCK.initial();
  state = DOCK.activate(state, "tool:files");
  assert.equal(state.activeId, "tool:files");

  state = DOCK.showPage(state, "target-abc");
  assert.equal(state.activeId, "page:target-abc");
});

check("parseTabId splits kinds and targets", () => {
  assert.deepEqual(DOCK.parseTabId("page:abc"), { kind: "page", target: "abc" });
  assert.deepEqual(DOCK.parseTabId("tool:terminal"), { kind: "tool", target: "terminal" });
  assert.deepEqual(DOCK.parseTabId("xyz"), { kind: "page", target: "xyz" });
  assert.deepEqual(DOCK.parseTabId(""), { kind: "page", target: "" });
});

check("strip combines pages and tools with correct active states", () => {
  const browserTabs = [
    { targetId: "p1", title: "Page 1", url: "https://a.com", active: true },
    { targetId: "p2", title: "Page 2", url: "https://b.com", active: false },
  ];

  // Default state: activeId is null, browser tab active wins
  let state = DOCK.initial();
  let tabs = DOCK.strip(state, browserTabs);
  assert.equal(tabs.length, 2);
  assert.equal(tabs[0].id, "page:p1");
  assert.equal(tabs[0].active, true);
  assert.equal(tabs[1].id, "page:p2");
  assert.equal(tabs[1].active, false);

  // With open tool and tool active: no page tab is active
  state = DOCK.openTool(state, "terminal");
  tabs = DOCK.strip(state, browserTabs);
  assert.equal(tabs.length, 3);
  assert.equal(tabs[0].active, false);
  assert.equal(tabs[1].active, false);
  assert.equal(tabs[2].id, "tool:terminal");
  assert.equal(tabs[2].active, true);
  assert.equal(tabs[2].kind, "tool");

  // Switch back to second page
  state = DOCK.showPage(state, "p2");
  tabs = DOCK.strip(state, browserTabs);
  assert.equal(tabs[0].active, false);
  assert.equal(tabs[1].active, true);
  assert.equal(tabs[2].active, false);
});

check("label returns title or url fallback", () => {
  assert.equal(DOCK.label({ title: "My Tab" }), "My Tab");
  assert.equal(DOCK.label({ url: "https://example.com" }), "https://example.com");
  assert.equal(DOCK.label(null), "");
});

console.log(`test-dock-tabs: ${passed} checks passed`);
