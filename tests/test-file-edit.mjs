// Regression checks for src/app/file-edit.js (the files panel's editor).
//   node tests/test-file-edit.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const window = {};
runInNewContext(readFileSync(new URL("../src/app/file-edit.js", import.meta.url), "utf8"), { window });
const E = window.OMP_FILE_EDIT;
let checks = 0;
const eq = (actual, expected, label) => { assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, label); checks++; };

// Line ends: one kind round-trips, a mix is refused.
eq(E.eolOf("a\nb\n"), "\n", "lf");
eq(E.eolOf("a\r\nb\r\n"), "\r\n", "crlf");
eq(E.eolOf("no newline"), "\n", "none");
eq(E.eolOf("a\r\nb\n"), null, "mixed");
eq(E.eolOf("a\rb"), null, "lone cr");
for (const text of ["a\r\nb\r\n\r\n", "a\nb\n", "", "x"]) {
  eq(E.toDisk(E.toEditor(text), E.eolOf(text)), text, `round trip ${JSON.stringify(text)}`);
}
eq(E.toDisk("a\nnew\nb", "\r\n"), "a\r\nnew\r\nb", "a typed line takes the file's line end");

eq(E.blocker({ kind: "Text", editable: true, text: "a\n" }), null, "editable text");
eq(E.blocker({ kind: "Text", editable: false, text: "a\n" }), "encoding", "lossy text");
eq(E.blocker({ kind: "Text", editable: true, text: "a\r\nb\n" }), "eol", "mixed line ends");
eq(E.blocker({ kind: "Image" }), "kind", "an image");
eq(E.blocker(null), "kind", "nothing loaded");

eq(E.indentUnit("a\n\tb\n"), "\t", "tabs");
eq(E.indentUnit("a {\n    b {\n        c\n"), "    ", "four spaces");
eq(E.indentUnit("a:\n  b:\n      c\n"), "  ", "the smallest indent");
eq(E.indentUnit("flat\n"), "  ", "no indent: two spaces");
eq(E.indentUnit(" * comment\nx\n"), "  ", "a one-space continuation is not an indent");

// Tab at a caret inserts one unit; on a one-line selection it replaces it.
eq(E.indent("ab", 1, 1, "  ", false), { from: 1, to: 1, text: "  ", start: 3, end: 3 }, "caret");
eq(E.indent("abc", 1, 2, "\t", false), { from: 1, to: 2, text: "\t", start: 2, end: 2 }, "one-line selection");
// Several lines move as a block and stay selected; an empty line gets nothing.
eq(E.indent("a\n\nb\nc", 0, 4, "  ", false), { from: 0, to: 4, text: "  a\n\n  b", start: 2, end: 8 }, "indent block");
// A selection ending at a line's start leaves that line alone.
eq(E.indent("a\nb\nc", 0, 4, "  ", false), { from: 0, to: 3, text: "  a\n  b", start: 2, end: 8 }, "trailing line start");
// Shift+Tab: a unit, a tab, or what spaces there are.
eq(E.indent("  a\n\tb\n c", 0, 9, "  ", true), { from: 0, to: 9, text: "a\nb\nc", start: 0, end: 5 }, "outdent block");
eq(E.indent("    a", 5, 5, "  ", true), { from: 0, to: 5, text: "  a", start: 3, end: 3 }, "outdent at a caret");
eq(E.indent("a\nb", 0, 3, "  ", true), null, "nothing to outdent");

console.log(`test-file-edit: ${checks} checks passed`);
