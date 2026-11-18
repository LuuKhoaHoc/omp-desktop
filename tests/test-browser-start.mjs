#!/usr/bin/env node
// Regression script for src/app/browser-start.js — pure model for the
// start page: isStart, classify, tiles, pickResult.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const win = {};
new Function("window", readFileSync(join(root, "src/app/browser-start.js"), "utf8"))(win);
const START = win.OMP_BROWSER_START;

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

check("isStart identifies blank start states", () => {
  assert.equal(START.isStart(null), true);
  assert.equal(START.isStart(undefined), true);
  assert.equal(START.isStart(""), true);
  assert.equal(START.isStart("   "), true);
  assert.equal(START.isStart("about:blank"), true);
  assert.equal(START.isStart(" about:blank "), true);

  assert.equal(START.isStart("https://example.com"), false);
  assert.equal(START.isStart("http://localhost:3000"), false);
  assert.equal(START.isStart("data:text/html,hi"), false);
});

check("classify empty inputs", () => {
  assert.deepEqual(START.classify(null), { kind: "empty", target: "" });
  assert.deepEqual(START.classify(""), { kind: "empty", target: "" });
  assert.deepEqual(START.classify("   "), { kind: "empty", target: "" });
});

check("classify file query syntax", () => {
  assert.deepEqual(START.classify("@src/app/browser.js"), {
    kind: "file",
    query: "src/app/browser.js",
    target: "@src/app/browser.js",
  });
  assert.deepEqual(START.classify("/home/user/file.txt"), {
    kind: "file",
    query: "/home/user/file.txt",
    target: "/home/user/file.txt",
  });
});

check("classify URLs and localhost", () => {
  assert.deepEqual(START.classify("https://vite.dev/guide/"), {
    kind: "url",
    target: "https://vite.dev/guide/",
  });
  assert.deepEqual(START.classify("http://foo.bar"), {
    kind: "url",
    target: "http://foo.bar",
  });
  assert.deepEqual(START.classify("localhost:5173"), {
    kind: "url",
    target: "http://localhost:5173",
  });
  assert.deepEqual(START.classify("127.0.0.1:8080/test"), {
    kind: "url",
    target: "http://127.0.0.1:8080/test",
  });
  assert.deepEqual(START.classify("github.com/google/gemini"), {
    kind: "url",
    target: "https://github.com/google/gemini",
  });
});

check("classify search queries", () => {
  assert.deepEqual(START.classify("how to fix rust borrow error"), {
    kind: "search",
    query: "how to fix rust borrow error",
    target: "https://www.google.com/search?q=how%20to%20fix%20rust%20borrow%20error",
  });
  assert.deepEqual(START.classify("react router v7"), {
    kind: "search",
    query: "react router v7",
    target: "https://www.google.com/search?q=react%20router%20v7",
  });
});

check("tiles list has expected tools", () => {
  const list = START.tiles();
  assert.equal(Array.isArray(list), true);
  assert.equal(list.length, 3);
  const ids = list.map((t) => t.id);
  assert.deepEqual(ids, ["terminal", "changes", "files"]);
});

check("pickResult dispatches correctly", () => {
  let navigated = null;
  let toolOpened = null;
  let fileOpened = null;

  const handlers = {
    navigate: (url) => { navigated = url; },
    openTool: (id) => { toolOpened = id; },
    openFile: (file) => { fileOpened = file; },
  };

  START.pickResult({ kind: "url", target: "https://example.com" }, handlers);
  assert.equal(navigated, "https://example.com");

  START.pickResult({ kind: "search", target: "https://google.com/search?q=test" }, handlers);
  assert.equal(navigated, "https://google.com/search?q=test");

  START.pickResult({ kind: "tool", target: "terminal" }, handlers);
  assert.equal(toolOpened, "terminal");

  START.pickResult({ kind: "file", target: "@src/test.js" }, handlers);
  assert.equal(fileOpened, "@src/test.js");
});

console.log(`test-browser-start: ${passed} checks passed`);
