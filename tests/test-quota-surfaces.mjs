import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

const root = new URL("../", import.meta.url);
const Babel = createRequire(import.meta.url)(new URL("src/babel.min.js", root).pathname);
const source = path => readFileSync(new URL(path, root), "utf8");
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useRef: current => ({ current }),
  useState: initial => [typeof initial === "function" ? initial() : initial, () => {}],
  useCallback: fn => fn,
  useEffect() {},
};
const window = {
  OMP_BRIDGE: null,
  Icon: () => null,
  AccountQuotaSection: () => ({ type: "account-quota" }),
  TaskUsageSection: () => ({ type: "task-usage" }),
};
const scope = {
  window, React,
  ReactDOM: { createPortal: child => child },
  useModalLayer: () => {},
  OMP_TR: value => value,
  document: { body: {} },
};
const mount = (path, symbol) => {
  const { code } = Babel.transform(source(path), { presets: ["react"] });
  runInNewContext(`${code}\nwindow.__render = ${symbol};`, scope);
  return window.__render;
};
const nodes = (node, out = []) => {
  if (Array.isArray(node)) { for (const child of node) nodes(child, out); return out; }
  if (!node || typeof node !== "object") return out;
  out.push(node);
  nodes(node.children, out);
  return out;
};

const usage = mount("src/design/usage-stats-panel.jsx", "UsageStatsPanel")({ onClose() {}, profileLabel: "default" });
const usageNodes = nodes(usage);
const usageComponents = usageNodes.filter(node => typeof node.type === "function").map(node => node.type.name);
assert.ok(usageComponents.includes("TaskUsageSection"), "Usage keeps task accounting");
assert.ok(!usageComponents.includes("AccountQuotaSection"), "Usage does not render account quota controls");

let openedAccounts = 0;
const footer = mount("src/design/toolbar.jsx", "SidebarFooter")({
  settings: { active: false, onOpen() {} }, onHistory() {}, onStats() {}, onAccounts() { openedAccounts++; },
});
const accountButton = nodes(footer).find(node => node.props?.title === "Accounts & quota");
assert.ok(accountButton, "sidebar exposes Accounts & quota");
accountButton.props.onClick();
assert.equal(openedAccounts, 1, "sidebar account action opens its dialog");

const accountPanel = mount("src/design/account-quota-panel.jsx", "AccountQuotaPanel")({ onClose() {} });
const accountComponents = nodes(accountPanel).filter(node => typeof node.type === "function").map(node => node.type.name);
assert.ok(accountComponents.includes("AccountQuotaSection"), "Accounts & quota dialog renders account controls");

const app = source("src/app-live.jsx");
assert.match(app, /\{accountsOpen\s*&&\s*<window\.AccountQuotaPanel/);
console.log("quota surfaces: Usage/task accounting and separate account dialog pass");
