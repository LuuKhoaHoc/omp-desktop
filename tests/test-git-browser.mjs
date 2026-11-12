#!/usr/bin/env node
// Regression script for src/app/git-browser.js (the git browser's view
// helpers over Rust's payloads).
// No test framework, no bundler — zero dependencies beyond node:assert/strict.
// Run: node tests/test-git-browser.mjs  (or: npm run test:git-browser)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src  = readFileSync(join(root, "src/app/git-browser.js"), "utf8");
const win  = {};
// eslint-disable-next-line no-new-func
new Function("window", src)(win);
const G = win.OMP_GIT_BROWSER;

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

// A TreeNode as git_browser_status returns it: dirs first, then files.
const file = (path, status = null) => ({ name: path.split("/").pop(), path, dir: false, status, changed: 0, children: [] });
const dir = (path, children) => ({
  name: path.split("/").pop(), path, dir: true, status: null,
  changed: children.reduce((n, c) => n + (c.dir ? c.changed : c.status ? 1 : 0), 0),
  children,
});
const tree = dir("", [
  dir("docs", [file("docs/readme.md")]),
  dir("src", [
    dir("src/app", [file("src/app/a.js", "Modified"), file("src/app/b.js")]),
    file("src/index.html"),
    file("src/main.js", "Untracked"),
  ]),
  file("Cargo.toml", "Deleted"),
  file("README.md"),
]);
const paths = rows => rows.map(r => `${r.depth}:${r.node.path}`);

// ── flatten ──────────────────────────────────────────────────────────────────

check("flatten: nothing expanded lists the top level only", () =>
  assert.deepEqual(paths(G.flatten(tree, new Set(), false)),
    ["0:docs", "0:src", "0:Cargo.toml", "0:README.md"]));

check("flatten: an expanded dir's children follow it one level deeper", () =>
  assert.deepEqual(paths(G.flatten(tree, new Set(["src"]), false)),
    ["0:docs", "0:src", "1:src/app", "1:src/index.html", "1:src/main.js", "0:Cargo.toml", "0:README.md"]));

check("flatten: a child dir stays closed under an expanded parent unless itself expanded", () => {
  const rows = paths(G.flatten(tree, new Set(["src", "src/app"]), false));
  assert.deepEqual(rows.slice(1, 5), ["0:src", "1:src/app", "2:src/app/a.js", "2:src/app/b.js"]);
});

check("flatten: an expanded dir under a collapsed one is not shown", () =>
  assert.deepEqual(paths(G.flatten(tree, new Set(["src/app"]), false)),
    ["0:docs", "0:src", "0:Cargo.toml", "0:README.md"]));

check("flatten: changedOnly opens every dir and keeps changed files and their dirs only", () =>
  assert.deepEqual(paths(G.flatten(tree, new Set(), true)),
    ["0:src", "1:src/app", "2:src/app/a.js", "1:src/main.js", "0:Cargo.toml"]));

check("flatten: a null root has no rows", () =>
  assert.deepEqual(G.flatten(null, new Set(), false), []));

// ── changedDirs / ancestorDirs ───────────────────────────────────────────────

check("changedDirs: every dir with a change below it, nested ones too, never the root", () =>
  assert.deepEqual([...G.changedDirs(tree)].sort(), ["src", "src/app"]));

check("changedDirs: a clean tree opens nothing", () =>
  assert.equal(G.changedDirs(dir("", [dir("a", [file("a/x")])])).size, 0));

check("ancestorDirs: outermost first, the file itself excluded", () =>
  assert.deepEqual(G.ancestorDirs("src/app/a.js"), ["src", "src/app"]));

check("ancestorDirs: a top-level file has none", () =>
  assert.deepEqual(G.ancestorDirs("README.md"), []));

// ── filterFiles ──────────────────────────────────────────────────────────────

check("filterFiles: case-insensitive match on the whole path, in tree order", () =>
  assert.deepEqual(G.filterFiles(tree, "SRC/", false).map(n => n.path),
    ["src/app/a.js", "src/app/b.js", "src/index.html", "src/main.js"]));

check("filterFiles: matches a directory name inside the path, never lists dirs", () =>
  assert.deepEqual(G.filterFiles(tree, "app", false).map(n => n.path), ["src/app/a.js", "src/app/b.js"]));

check("filterFiles: changedOnly keeps changed hits only", () =>
  assert.deepEqual(G.filterFiles(tree, "src", true).map(n => n.path), ["src/app/a.js", "src/main.js"]));

check("filterFiles: surrounding blanks are ignored, a blank query matches nothing", () => {
  assert.deepEqual(G.filterFiles(tree, "  readme ", false).map(n => n.path), ["docs/readme.md", "README.md"]);
  assert.deepEqual(G.filterFiles(tree, "   ", false), []);
});

// ── firstFile ────────────────────────────────────────────────────────────────

check("firstFile: first file in display order, descending into dirs", () =>
  assert.equal(G.firstFile(tree, false).path, "docs/readme.md"));

check("firstFile: changedOnly skips clean files and clean dirs", () =>
  assert.equal(G.firstFile(tree, true).path, "src/app/a.js"));

check("firstFile: none in a clean tree under changedOnly, none for a null root", () => {
  assert.equal(G.firstFile(dir("", [file("x")]), true), null);
  assert.equal(G.firstFile(null, false), null);
});

// ── hunkStarts / splitPath ───────────────────────────────────────────────────

const L = kinds => [...kinds].map(k => ({ kind: { c: "ctx", a: "add", r: "rem" }[k], text: k }));

check("hunkStarts: one start per run of changed lines, rem+add runs merge", () =>
  assert.deepEqual(G.hunkStarts(L("ccrraccaccr")), [2, 7, 10]));

check("hunkStarts: a change on the first line starts at 0; no change → none", () => {
  assert.deepEqual(G.hunkStarts(L("acc")), [0]);
  assert.deepEqual(G.hunkStarts(L("ccc")), []);
});

check("splitPath: dir keeps its trailing slash; a bare name has no dir", () => {
  assert.deepEqual(G.splitPath("src/app/a.js"), ["src/app/", "a.js"]);
  assert.deepEqual(G.splitPath("a.js"), ["", "a.js"]);
});

// ── relativeTime ─────────────────────────────────────────────────────────────

const NOW = 1_800_000_000;
const ago = secs => G.relativeTime(NOW - secs, NOW);
const M = 60, H = 3600, D = 86400;

check("relativeTime: under a minute is now, a future time too", () => {
  assert.equal(ago(0), "now");
  assert.equal(ago(59), "now");
  assert.equal(ago(-500), "now");
});

check("relativeTime: each unit starts at its boundary and floors", () => {
  assert.equal(ago(M), "1m");
  assert.equal(ago(H - 1), "59m");
  assert.equal(ago(H), "1h");
  assert.equal(ago(D - 1), "23h");
  assert.equal(ago(D), "1d");
  assert.equal(ago(7 * D - 1), "6d");
  assert.equal(ago(7 * D), "1w");
  assert.equal(ago(29 * D), "4w");
  assert.equal(ago(30 * D), "1mo");
  assert.equal(ago(364 * D), "12mo");
  assert.equal(ago(365 * D), "1y");
  assert.equal(ago(3 * 365 * D + 10 * D), "3y");
});

// ── diffText ─────────────────────────────────────────────────────────────────

check("diffText: changed lines only, +/- prefixed, newline-joined", () =>
  assert.equal(G.diffText([
    { kind: "ctx", text: "keep" },
    { kind: "rem", text: "old" },
    { kind: "add", text: "new" },
    { kind: "ctx", text: "tail" },
    { kind: "add", text: "" },
  ]), "-old\n+new\n+"));

check("diffText: an unchanged file copies nothing", () =>
  assert.equal(G.diffText([{ kind: "ctx", text: "x" }]), ""));

// ── discardDeletes / finishedEdits ───────────────────────────────────────────

check("discardDeletes: no HEAD blob (untracked, added, renamed) deletes; modified/deleted restore", () => {
  for (const s of ["Untracked", "Added", "Renamed"]) assert.equal(G.discardDeletes(s), true, s);
  for (const s of ["Modified", "Deleted", null]) assert.equal(G.discardDeletes(s), false, String(s));
});

check("finishedEdits: counts finished edit/write cards only", () =>
  assert.equal(G.finishedEdits([
    { kind: "tool", tool: "edit", status: "ok" },
    { kind: "tool", tool: "write", status: "ok", isError: true },
    { kind: "tool", tool: "edit", status: "running" },
    { kind: "tool", tool: "bash", status: "ok" },
    { kind: "assistant", tool: "edit" },
  ]), 2));

// ── absolutePath ─────────────────────────────────────────────────────────────

check("absolutePath: a relative tool path joins onto the project with /", () => {
  assert.equal(G.absolutePath("/home/u/p", "src/a.js"), "/home/u/p/src/a.js");
  assert.equal(G.absolutePath("/home/u/p/", "./src/a.js"), "/home/u/p/src/a.js");
  assert.equal(G.absolutePath("C:\\Users\\u\\p", "src\\a.js"), "C:\\Users\\u\\p/src\\a.js");
  assert.equal(G.absolutePath("C:\\Users\\u\\p\\", "a.js"), "C:\\Users\\u\\p/a.js");
});

check("absolutePath: /, \\ and drive prefixes are already absolute", () => {
  assert.equal(G.absolutePath("/home/u/p", "/etc/x"), "/etc/x");
  assert.equal(G.absolutePath("C:\\p", "\\\\srv\\share\\x"), "\\\\srv\\share\\x");
  assert.equal(G.absolutePath("C:\\p", "D:\\x.js"), "D:\\x.js");
  assert.equal(G.absolutePath("C:\\p", "d:/x.js"), "d:/x.js");
});

check("absolutePath: no project leaves the path as it is", () => {
  assert.equal(G.absolutePath(null, "src/a.js"), "src/a.js");
  assert.equal(G.absolutePath("", "src/a.js"), "src/a.js");
});

// ── branchMatches ─────────────────────────────────────────────────────────────

const br = (name, remote = false) => ({ name, remote, at: 0 });
const branchList = [br("feat/login"), br("origin/fix-login", true), br("main-old"), br("origin/docs", true)];
const names = m => [m.local.map(b => b.name), m.remote.map(b => b.name), m.hidden];

check("branchMatches: a blank query keeps every branch, locals and remotes apart in Rust's order", () =>
  assert.deepEqual(names(G.branchMatches(branchList, "  ")),
    [["feat/login", "main-old"], ["origin/fix-login", "origin/docs"], 0]));

check("branchMatches: case-insensitive name match, surrounding blanks ignored", () =>
  assert.deepEqual(names(G.branchMatches(branchList, " LOGIN ")),
    [["feat/login"], ["origin/fix-login"], 0]));

check("branchMatches: no match leaves both groups empty", () =>
  assert.deepEqual(names(G.branchMatches(branchList, "nope")), [[], [], 0]));

check("branchMatches: past the row cap, locals fill first and the rest count as hidden", () => {
  const many = [
    ...Array.from({ length: G.MAX_BRANCH_ROWS - 1 }, (_, i) => br(`l${i}`)),
    br("origin/a", true), br("origin/b", true), br("origin/c", true),
  ];
  const m = G.branchMatches(many, "");
  assert.equal(m.local.length, G.MAX_BRANCH_ROWS - 1);
  assert.deepEqual(m.remote.map(b => b.name), ["origin/a"]);
  assert.equal(m.hidden, 2);
});

// ── Keyboard stepping, folding and history find ──────────────────────────────

const fnode = (path, status = null) => ({ name: path.split("/").at(-1), path, dir: false, status, changed: 0, children: [] });
const dnode = (path, children) => ({ name: path, path, dir: true, status: null, changed: 0, children });
const kinds = str => [...str].map((c, i) => ({ kind: c === "+" ? "add" : c === "-" ? "rem" : "ctx", old: i, new: i, text: `l${i}` }));

check("stepFile moves through files only, in display order, without wrapping", () => {
  const root = dnode("", [dnode("a", [fnode("a/x"), fnode("a/y")]), fnode("z")]);
  const rows = G.listRows(root, new Set(["a"]), false, "");
  assert.equal(G.stepFile(rows, "a/x", 1), "a/y");
  assert.equal(G.stepFile(rows, "a/y", 1), "z");
  assert.equal(G.stepFile(rows, "z", 1), null);
  assert.equal(G.stepFile(rows, "a/x", -1), null);
});

check("stepFile: nothing selected starts at an end; a collapsed dir hides its files", () => {
  const root = dnode("", [dnode("a", [fnode("a/x")]), fnode("z")]);
  const collapsed = G.listRows(root, new Set(), false, "");
  assert.equal(G.stepFile(collapsed, null, 1), "z");
  assert.equal(G.stepFile(collapsed, "gone", -1), "z");
  assert.equal(G.stepFile([], null, 1), null);
});

check("listRows: a filter lists the matching files flat, as the pane does", () => {
  const root = dnode("", [dnode("a", [fnode("a/x.js"), fnode("a/y.md")])]);
  const rows = G.listRows(root, new Set(), false, "x.js");
  assert.deepEqual(rows.map(r => [r.node.path, r.flat]), [["a/x.js", true]]);
});

check("foldContext keeps three lines around a change and folds the long runs between", () => {
  // 10 ctx, change, 2 ctx, change, 10 ctx
  const lines = kinds("..........+..+..........");
  const runs = G.foldContext(lines);
  assert.deepEqual(runs, [
    { kind: "fold", from: 0, to: 7 },
    { kind: "lines", from: 7, to: 17 },
    { kind: "fold", from: 17, to: 24 },
  ]);
});

check("foldContext: a short unchanged run between changes is not folded", () => {
  const runs = G.foldContext(kinds("+..........+"));
  assert.deepEqual(runs.map(r => r.kind), ["lines", "fold", "lines"]);
  assert.deepEqual(G.foldContext(kinds("+.........+")).map(r => r.kind), ["lines"]);
});

check("foldContext: an unchanged or empty file is one run, never folded", () => {
  assert.deepEqual(G.foldContext(kinds("..........")), [{ kind: "lines", from: 0, to: 10 }]);
  assert.deepEqual(G.foldContext([]), []);
});

check("foldContext covers every line exactly once, in order", () => {
  const lines = kinds("....+......-.......+..");
  const runs = G.foldContext(lines);
  assert.equal(runs[0].from, 0);
  assert.equal(runs.at(-1).to, lines.length);
  for (let i = 1; i < runs.length; i++) assert.equal(runs[i].from, runs[i - 1].to);
});

const hrow = (id, subject, author, refs = []) => ({ id, short: id.slice(0, 7), subject, author, refs });

check("historyMatches: every term must hit subject, author, sha or a ref; the worktree row never", () => {
  const rows = [
    { id: "@", short: "", subject: "", author: "", refs: [] },
    hrow("a1b2c3d4e5", "fix login redirect", "Ada", [{ name: "develop" }]),
    hrow("f6e5d4c3b2", "add login page", "Linus"),
  ];
  assert.deepEqual(G.historyMatches(rows, "login"), [1, 2]);
  assert.deepEqual(G.historyMatches(rows, "LOGIN ada"), [1]);
  assert.deepEqual(G.historyMatches(rows, "develop"), [1]);
  assert.deepEqual(G.historyMatches(rows, "f6e5d4"), [2]);
  assert.deepEqual(G.historyMatches(rows, "   "), []);
});

check("stepMatch wraps and starts at an end when nothing is chosen", () => {
  assert.equal(G.stepMatch(3, -1, 1), 0);
  assert.equal(G.stepMatch(3, -1, -1), 2);
  assert.equal(G.stepMatch(3, 2, 1), 0);
  assert.equal(G.stepMatch(3, 0, -1), 2);
  assert.equal(G.stepMatch(0, -1, 1), -1);
});

// ── Done ──────────────────────────────────────────────────────────────────────

console.log(`git-browser: ${passed} checks passed`);
