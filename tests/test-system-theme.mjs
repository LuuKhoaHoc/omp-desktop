#!/usr/bin/env node
// Regression script for src/app/system-theme.js — "Follow the system theme":
// Omarchy's colour names as this app's CSS tokens, which theme class stays,
// and which font roles follow the system.
// Run: node tests/test-system-theme.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const win  = {};
for (const file of ["src/app/accent.js", "src/app/system-theme.js"]) {
  // eslint-disable-next-line no-new-func
  new Function("window", readFileSync(join(root, file), "utf8"))(win);
}
const S = win.OMP_SYSTEM_THEME;

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

const tokyo = {
  name: "tokyo-night", light: false, fontMono: "Maple Mono NF",
  colors: {
    accent: "#7aa2f7", selection: "#292e42", muted: "#414868",
    background: "#1a1b26", dark_background: "#13141c", darker_background: "#0e0e14", lighter_background: "#24283b",
    foreground: "#a9b1d6", dark_foreground: "#565f89", bright_foreground: "#c0caf5",
    red: "#f7768e", yellow: "#e0af68", orange: "#eb927b", green: "#9ece6a", cyan: "#449dab", blue: "#7aa2f7", magenta: "#ad8ee6",
    bright_magenta: "#bb9af7",
  },
};

check("a theme's own names land on the matching tokens", () => {
  const t = S.tokens(tokyo);
  assert.equal(t["--bg-window"], "#1a1b26");
  assert.equal(t["--bg-app"], "#0e0e14");
  assert.equal(t["--bg-input"], "#13141c");
  assert.equal(t["--bg-elevated"], "#272832", "neutral step, not the terminal's lighter_background");
  assert.equal(t["--bg-active"], "#31323c", "neutral step, not the terminal's selection");
  assert.equal(t["--kiln-bubble"], "#272832", "no accent tint in the user's bubble");
  assert.equal(t["--fg"], "#c0caf5");
  assert.equal(t["--fg-2"], "#a9b1d6");
  assert.equal(t["--fg-4"], "#7e7e82", "grey, readable on the background, unlike dark_foreground");
  assert.equal(t["--fg-5"], "#717176");
  assert.equal(t["--accent"], "#7aa2f7");
  assert.equal(t["--accent-soft"], "rgba(122, 162, 247, 0.12)");
  assert.equal(t["--rose"], "#f7768e");
  assert.equal(t["--lime"], "#9ece6a");
  assert.equal(t["--amber"], "#e0af68");
  assert.equal(t["--lilac"], "#bb9af7");
  assert.equal(t["--syntax-num"], "#eb927b");
  assert.equal(t["--diff-add-bg"], "rgba(158, 206, 106, 0.1)");
});

check("every value is a hex colour or an rgba()", () => {
  for (const [name, value] of Object.entries(S.tokens(tokyo))) {
    assert.match(value, /^(#[0-9a-f]{6}|rgba\(\d+, \d+, \d+, [\d.]+\))$/, name);
  }
});

check("a palette with only the three required colours derives the rest", () => {
  const t = S.tokens({ light: false, colors: { background: "#000000", foreground: "#ffffff", accent: "#f00" } });
  assert.equal(t["--bg-window"], "#000000");
  assert.equal(t["--bg-hover"], "#121212");
  assert.equal(t["--line"], "#171717");
  assert.equal(t["--fg-4"], "#9e9e9e");
  assert.equal(t["--rose"], "#f00");
  assert.equal(t["--accent"], "#ff0000");
});

check("a light palette steps toward the text, never to black", () => {
  const t = S.tokens({ light: true, colors: { background: "#ffffff", foreground: "#000000", accent: "#0000ff" } });
  assert.equal(t["--bg-input"], "#f5f5f5");
  assert.equal(t["--bg-app"], "#ebebeb");
});

check("no palette without background, foreground and accent", () => {
  for (const sys of [null, {}, { colors: {} }, { colors: { background: "#000000", accent: "#ffffff" } }]) {
    assert.equal(S.usable(sys), false);
    assert.equal(S.tokens(sys), null);
    assert.equal(S.baseTheme(sys, "night"), "night");
  }
});

check("the picked theme stays unless its tone is wrong", () => {
  assert.equal(S.baseTheme(tokyo, "night"), "night");
  assert.equal(S.baseTheme(tokyo, "daylight"), "kiln");
  assert.equal(S.baseTheme({ ...tokyo, light: true }, "kiln"), "daylight");
});

check("unpicked font roles follow the system, picked ones are left alone", () => {
  assert.deepEqual(S.fonts(tokyo, { fontUi: "", fontMono: "" }), {
    "--font-sans": "system-ui, sans-serif",
    "--font-display": "system-ui, sans-serif",
    "--font-mono": "\"Maple Mono NF\", ui-monospace, monospace",
  });
  assert.deepEqual(S.fonts(tokyo, { fontUi: "Inter", fontMono: "Fira Code" }), {});
  assert.deepEqual(Object.keys(S.fonts({ ...tokyo, fontMono: null }, { fontUi: "", fontMono: "" })), ["--font-sans", "--font-display"]);
  assert.deepEqual(S.fonts(null, { fontUi: "", fontMono: "" }), {});
  assert.deepEqual(S.fonts({ name: null, light: false, colors: {}, fontMono: "Maple Mono NF" }, { fontUi: "", fontMono: "" }), {}, "fontconfig alone, no theme: nothing changes");
});

check("same: a re-read of the same look is no change", () => {
  assert.equal(S.same(tokyo, JSON.parse(JSON.stringify(tokyo))), true);
  assert.equal(S.same(tokyo, { ...tokyo, name: "gruvbox" }), false);
  assert.equal(S.same(null, undefined), true);
});

console.log(`test-system-theme: ${passed} checks passed`);
