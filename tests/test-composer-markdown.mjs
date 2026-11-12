#!/usr/bin/env node
// Regression script for src/app/composer-markdown.js — the scanner behind
// the composer's coloured draft. Its runs must join back to the draft exactly
// (the coloured copy sits under the textarea, character for character) and
// name the markdown the sent message will render.
// Run: node tests/test-composer-markdown.mjs  (or: npm run test:composer-markdown)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const win = {};
new Function("window", readFileSync(new URL("../src/app/composer-markdown.js", import.meta.url), "utf8"))(win);
const { spans } = win.OMP_COMPOSER_MD;

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

/** Runs as `kind:text` strings, plain runs as bare text. */
const runs = (text) => spans(text).map((r) => (r.kind ? `${r.kind}:${r.text}` : r.text));
const kindOf = (text, piece) => spans(text).find((r) => r.text.includes(piece))?.kind;

check("runs join back to the draft, whatever it holds", () => {
  const drafts = [
    "", "\n", "plain", "a\n\nb\n",
    "**bold** and *em* and `code` and ~~gone~~",
    "# Title\n> quote **x**\n- [ ] task\n1. one\n```js\nconst a = `b`;\n```\nafter",
    "unclosed **bold\nunclosed `code\n```\nopen fence",
    "\\*not em\\* trailing backslash \\",
    "[text](https://example.com/a_(b)) ![img](x.png) [broken](",
    "***both*** __under__ snake_case_name 2*3*4 ** spaced **",
    "~~~\ntilde fence\n~~~",
    "   ```\n  indented fence\n   ```",
    "emoji 👍 **đậm** _nghiêng_",
  ];
  for (const d of drafts) assert.equal(spans(d).map((r) => r.text).join(""), d, JSON.stringify(d));
});

check("no run is empty and neighbours differ in kind", () => {
  const out = spans("# a **b** `c`\n\n- d\n```\ne\n```\n");
  for (const [i, r] of out.entries()) {
    assert.ok(r.text.length > 0);
    if (i) assert.notEqual(r.kind, out[i - 1].kind);
  }
});

check("plain text is one plain run", () =>
  assert.deepEqual(runs("just a sentence, nothing else."), ["just a sentence, nothing else."]));

check("strong, em, strike and code keep their markers as marks", () => {
  assert.deepEqual(runs("a **b** c"), ["a ", "mark:**", "strong:b", "mark:**", " c"]);
  assert.deepEqual(runs("a *b* c"), ["a ", "mark:*", "em:b", "mark:*", " c"]);
  assert.deepEqual(runs("__b__ _c_"), ["mark:__", "strong:b", "mark:__", " ", "mark:_", "em:c", "mark:_"]);
  assert.deepEqual(runs("~~b~~"), ["mark:~~", "strike:b", "mark:~~"]);
  assert.deepEqual(runs("run `npm test` now"), ["run ", "mark:`", "code:npm test", "mark:`", " now"]);
});

check("emphasis nests: em inside strong, the markers merging into one run", () => {
  assert.deepEqual(runs("***x***"), ["mark:***", "em:x", "mark:***"]);
  assert.deepEqual(runs("**a *b* c**"), ["mark:**", "strong:a ", "mark:*", "em:b", "mark:*", "strong: c", "mark:**"]);
});

check("a strong run may hold a single star", () =>
  assert.equal(kindOf("**a * b**", "a * b"), "strong"));

check("an unclosed or spaced delimiter stays plain", () => {
  assert.deepEqual(runs("a **b"), ["a **b"]);
  assert.deepEqual(runs("a * b * c"), ["a * b * c"]);
  assert.deepEqual(runs("2 ** 3"), ["2 ** 3"]);
  assert.deepEqual(runs("one `tick"), ["one `tick"]);
});

check("underscores inside a word are not emphasis", () => {
  assert.deepEqual(runs("snake_case_name"), ["snake_case_name"]);
  assert.deepEqual(runs("tên_biến_dài"), ["tên_biến_dài"]);
});

check("a backslash escapes the delimiter after it", () =>
  assert.deepEqual(runs("\\*not em\\*"), ["\\*not em\\*"]));

check("code spans: nothing inside is markdown, and double ticks hold a tick", () => {
  assert.deepEqual(runs("`**x**`"), ["mark:`", "code:**x**", "mark:`"]);
  assert.deepEqual(runs("``a ` b``"), ["mark:``", "code:a ` b", "mark:``"]);
});

check("links: text and url are told apart, balanced parentheses stay in the url", () => {
  assert.deepEqual(runs("see [docs](https://e.com/a_(b)) now"),
    ["see ", "mark:[", "link:docs", "mark:](", "url:https://e.com/a_(b)", "mark:)", " now"]);
  assert.deepEqual(runs("[x](a b)"), ["[x](a b)"]);
});

check("headings, quotes, list markers, task boxes and rules", () => {
  assert.deepEqual(runs("## Plan **now**"), ["mark:## ", "heading:Plan ", "mark:**", "strong:now", "mark:**"]);
  assert.deepEqual(runs("#123 is an issue"), ["#123 is an issue"]);
  assert.deepEqual(runs("> said *so*"), ["mark:> ", "quote:said ", "mark:*", "em:so", "mark:*"]);
  assert.deepEqual(runs("- item"), ["list:-", " item"]);
  assert.deepEqual(runs("  2) item"), ["  ", "list:2)", " item"]);
  assert.deepEqual(runs("- [x] done"), ["list:-", " ", "mark:[x]", " done"]);
  assert.deepEqual(runs("---"), ["mark:---"]);
  assert.deepEqual(runs("* * *"), ["mark:* * *"]);
  assert.deepEqual(runs("-not a list"), ["-not a list"]);
});

check("a fenced block is code until a matching fence closes it", () => {
  assert.deepEqual(runs("```js\nlet a = **1**;\n```\n**b**"),
    ["mark:```js", "code:\nlet a = **1**;\n", "mark:```", "\n", "mark:**", "strong:b", "mark:**"]);
  // A shorter or other-character fence does not close it; an open fence runs to the end.
  assert.equal(kindOf("````\n```\nstill code", "still code"), "code");
  assert.equal(kindOf("```\n~~~\nstill code", "still code"), "code");
  assert.equal(kindOf("~~~\n**x**\n~~~\nplain", "plain"), "");
});

console.log(`composer-markdown: ${passed} checks passed`);
