// Regression for src/app/chat-pages.js (fork: interactive pages in the chat).
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const read = (p) => fs.readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const ctx = vm.createContext({ console });
ctx.window = ctx;
vm.runInContext(read("app/marked-setup.js"), ctx); // fenceCode needs no library
vm.runInContext(read("app/chat-pages.js"), ctx);
const P = ctx.OMP_PAGES;
let n = 0;
const check = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };

check("html/svg blocks are pages; `page`/`live` shows them running", () => {
  assert.deepEqual({ ...P.pageInfo("html") }, { kind: "html", live: false });
  assert.deepEqual({ ...P.pageInfo("HTML page") }, { kind: "html", live: true });
  assert.deepEqual({ ...P.pageInfo("svg live") }, { kind: "svg", live: true });
  assert.equal(P.pageInfo("xml"), null);
  assert.equal(P.pageInfo("htmlbars"), null);
  assert.equal(P.pageInfo(undefined), null);
});

check("wrapPage puts theme + bridge first in a fragment, a head, or a bare <html>", () => {
  const frag = P.wrapPage("<form><button>Ok</button></form>", "html", { accent: "#f00", fg: "red</style><script>x()" });
  assert.match(frag, /^<!doctype html><html><head>.*--omp-accent:#f00/s);
  assert.ok(frag.indexOf("window.omp=") < frag.indexOf("<form>"), "bridge before the page");
  assert.ok(!frag.includes("</style><script>x()"), "theme values cannot close the style");
  const doc = P.wrapPage("<!doctype html><html lang=vi><head><title>T</title></head><body>b</body></html>", "html");
  assert.match(doc, /<head><meta charset="utf-8">.*<title>T<\/title>/s);
  assert.equal((doc.match(/<head/g) ?? []).length, 1);
  const bare = P.wrapPage("<html><body>x</body></html>", "html");
  assert.match(bare, /^<html><head><meta charset/);
  assert.match(P.wrapPage("<svg/>", "svg"), /:where\(svg\)/);
});

check("readMessage accepts only the bridge's shapes, bounded", () => {
  assert.equal(P.readMessage(null), null);
  assert.equal(P.readMessage("x"), null);
  assert.equal(P.readMessage({ type: "submit", data: "hi" }), null, "needs omp:'page'");
  assert.deepEqual({ ...P.readMessage({ omp: "page", type: "height", h: 99999 }) }, { type: "height", h: 4000 });
  assert.equal(P.readMessage({ omp: "page", type: "height", h: "abc" }), null);
  assert.deepEqual(JSON.parse(JSON.stringify(P.readMessage({ omp: "page", type: "submit", data: "  Option B " }))), { type: "submit", text: "Option B", structured: false, lines: [], reply: "" });
  const s = P.readMessage({ omp: "page", type: "submit", data: { plan: "pro", seats: ["1", "2"] } });
  assert.equal(s.structured, true);
  assert.deepEqual(JSON.parse(s.text), { plan: "pro", seats: ["1", "2"] });
  assert.equal(P.readMessage({ omp: "page", type: "submit", data: "   " }), null);
  assert.equal(P.readMessage({ omp: "page", type: "submit", data: "x".repeat(30000) }).text.length, 20000);
  const loop = {}; loop.self = loop;
  assert.equal(P.readMessage({ omp: "page", type: "submit", data: loop }), null);
  assert.equal(P.readMessage({ omp: "page", type: "navigate", url: "x" }), null);
});

check("a form answer keeps only bounded { q, a } lines; the page says whether the card's Send answers for it", () => {
  const m = P.readMessage({ omp: "page", type: "submit", data: { plan: "pro" }, lines: [
    { q: " Which   plan: ", a: " Pro, yearly " }, { q: "note", a: "" }, { q: 1, a: "x" }, null, { q: "x".repeat(500), a: "y".repeat(5000) },
  ] });
  assert.deepEqual(JSON.parse(JSON.stringify(m.lines.slice(0, 1))), [{ q: "Which plan", a: "Pro, yearly" }]);
  assert.equal(m.lines.length, 2, "blank, non-string and null lines are dropped");
  assert.equal(m.lines[1].q.length, 300);
  assert.equal(m.lines[1].a.length, 4000);
  assert.equal(P.readMessage({ omp: "page", type: "submit", data: { a: "1" }, lines: "x" }).lines.length, 0);
  const many = Array.from({ length: 200 }, (_, i) => ({ q: `q${i}`, a: "a" }));
  assert.equal(P.readMessage({ omp: "page", type: "submit", data: { a: "1" }, lines: many }).lines.length, 60);
  assert.equal(P.readMessage({ omp: "page", type: "submit", data: "typed", lines: many }).lines.length, 0, "plain text has no lines");
  assert.deepEqual({ ...P.readMessage({ omp: "page", type: "form", on: true, label: "  Find\n jobs " }) }, { type: "form", on: true, label: "Find jobs" });
  assert.deepEqual({ ...P.readMessage({ omp: "page", type: "form", on: "yes", label: 3 }) }, { type: "form", on: false, label: "" });
});

check("only the reply to the card's own ask, in time, skips the confirmation strip", () => {
  const ask = { id: "ask-1", until: 1000 };
  const reply = P.readMessage({ omp: "page", type: "submit", data: { a: "1" }, reply: "ask-1" });
  assert.equal(P.isReply(reply, ask, 500), true);
  assert.equal(P.isReply(reply, ask, 1000), false, "a reply after the window is confirmed like any other");
  assert.equal(P.isReply(reply, null, 500), false, "nothing was asked (never clicked, or cleared by a reload or a decline)");
  assert.equal(P.isReply(P.readMessage({ omp: "page", type: "submit", data: { a: "1" } }), ask, 500), false, "the page's own submit during the window");
  assert.equal(P.isReply(P.readMessage({ omp: "page", type: "submit", data: { a: "1" }, reply: "ask-0" }), ask, 500), false, "an earlier ask's id");
  assert.equal(P.isReply(P.readMessage({ omp: "page", type: "submit", data: { a: "1" }, reply: 7 }), { id: "", until: 1000 }, 500), false);
  const declined = P.readMessage({ omp: "page", type: "declined", reply: "ask-1" });
  assert.deepEqual({ ...declined }, { type: "declined", reply: "ask-1" });
  assert.equal(P.isReply(declined, ask, 500), true, "a decline (empty required field) ends that ask");
});

check("answerText: text as typed, a form as question: answer lines, other data as a fenced JSON block", () => {
  assert.equal(P.answerText("Plan", { text: "B", structured: false }), "B");
  const a = P.answerText("Chọn gói", { text: '{\n  "x": "```"\n}', structured: true });
  assert.match(a, /^My answer in the page "Chọn gói":\n````json\n/);
  assert.match(a, /\n````$/);
  const form = P.readMessage({ omp: "page", type: "submit", data: { exp: "2-3", note: "a\nb" }, lines: [
    { q: "Kinh nghiệm", a: "2–3 năm" }, { q: "Ghi chú", a: "a\nb" },
  ] });
  assert.equal(P.answerText("Tìm việc", form), 'My answer in the page "Tìm việc":\n- Kinh nghiệm: 2–3 năm\n- Ghi chú: a\n  b');
});

// The bridge is a string that runs inside the page: it must stay free of
// anything the wrapping template literal or the <script> element would eat.
check("the bridge parses as a script and cannot close its own element", () => {
  const doc = P.wrapPage("<p>x</p>", "html");
  const script = /<script>([\s\S]*?)<\/script>/.exec(doc)[1];
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(script, /replace\(\/\\s\+\/g/, "the whitespace class survives the template literal");
});

check("pageTitle and pageUrl", () => {
  assert.equal(P.pageTitle("<title> Gói </title>"), "Gói");
  assert.equal(P.pageTitle("<p>x</p>"), null);
  assert.equal(P.pageUrl("a_b-c", false), "omp-page://localhost/a_b-c");
  assert.equal(P.pageUrl("a/b", true), "http://omp-page.localhost/a%2Fb");
});

console.log(`test-chat-pages: ${n} checks passed`);
