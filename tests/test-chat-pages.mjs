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
  assert.deepEqual({ ...P.readMessage({ omp: "page", type: "submit", data: "  Option B " }) }, { type: "submit", text: "Option B", structured: false });
  const s = P.readMessage({ omp: "page", type: "submit", data: { plan: "pro", seats: ["1", "2"] } });
  assert.equal(s.structured, true);
  assert.deepEqual(JSON.parse(s.text), { plan: "pro", seats: ["1", "2"] });
  assert.equal(P.readMessage({ omp: "page", type: "submit", data: "   " }), null);
  assert.equal(P.readMessage({ omp: "page", type: "submit", data: "x".repeat(30000) }).text.length, 20000);
  const loop = {}; loop.self = loop;
  assert.equal(P.readMessage({ omp: "page", type: "submit", data: loop }), null);
  assert.equal(P.readMessage({ omp: "page", type: "navigate", url: "x" }), null);
});

check("answerText: text as typed, data as a fenced JSON block naming the page", () => {
  assert.equal(P.answerText("Plan", { text: "B", structured: false }), "B");
  const a = P.answerText("Chọn gói", { text: '{\n  "x": "```"\n}', structured: true });
  assert.match(a, /^My answer in the page "Chọn gói":\n````json\n/);
  assert.match(a, /\n````$/);
});

check("pageTitle and pageUrl", () => {
  assert.equal(P.pageTitle("<title> Gói </title>"), "Gói");
  assert.equal(P.pageTitle("<p>x</p>"), null);
  assert.equal(P.pageUrl("a_b-c", false), "omp-page://localhost/a_b-c");
  assert.equal(P.pageUrl("a/b", true), "http://omp-page.localhost/a%2Fb");
});

console.log(`test-chat-pages: ${n} checks passed`);
