#!/usr/bin/env node
// Regression script for src/app/chat-quotes.js (quote the chat into the next message).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const win = {};
// eslint-disable-next-line no-new-func
new Function("window", readFileSync(join(root, "src/app/chat-quotes.js"), "utf8"))(win);
let passed = 0;
function check(label, fn) {
  try { fn(); } catch (err) { console.error(`FAILED: ${label}`); throw err; }
  passed++;
}
const Q = win.OMP_CHAT_QUOTES;

check("makeQuote trims, normalises, cuts, rejects blank", () => {
  assert.equal(Q.makeQuote("  \n ", "x"), null);
  const q = Q.makeQuote("\r\n a\r\n\n\n\nb ", "  why? ");
  assert.equal(q.quote, "a\n\nb");
  assert.equal(q.comment, "why?");
  assert.ok(Q.makeQuote("x".repeat(Q.MAX_QUOTE_CHARS + 50), "").quote.endsWith(" …"));
  assert.notEqual(Q.makeQuote("a").id, Q.makeQuote("a").id);
});

check("mergeIntoMessage puts blockquotes and comments ahead of the text", () => {
  const a = Q.makeQuote("line 1\n\nline 2", "fix this");
  const b = Q.makeQuote("other", "");
  assert.equal(Q.mergeIntoMessage("go", [a, b]), "> line 1\n>\n> line 2\n\nfix this\n\n> other\n\ngo");
  assert.equal(Q.mergeIntoMessage("", [b]), "> other");
  assert.equal(Q.mergeIntoMessage("go", []), "go");
});

check("per-tab store: add, remove only taken ids, prune closed tabs", () => {
  const a = Q.makeQuote("a"), b = Q.makeQuote("b");
  let m = Q.add(Q.add({}, "t1", a), "t1", b);
  m = Q.add(m, "t2", a);
  assert.deepEqual(Q.of(m, "t1").map(q => q.quote), ["a", "b"]);
  m = Q.remove(m, "t1", [a.id]);
  assert.deepEqual(Q.of(m, "t1").map(q => q.quote), ["b"]);
  m = Q.remove(m, "t1", [b.id]);
  assert.ok(!("t1" in m));
  assert.equal(Q.prune(m, ["t2"]), m);
  assert.deepEqual(Q.prune(m, []), {});
  assert.deepEqual(Q.of({}, "x"), []);
});

check("label: short head, comment after", () => {
  assert.equal(Q.label({ quote: "a  b", comment: "" }), "“a b”");
  assert.ok(Q.label({ quote: "x".repeat(200), comment: "c" }).endsWith("…” — c"));
});

console.log(`test-chat-quotes: ${passed} checks passed`);
