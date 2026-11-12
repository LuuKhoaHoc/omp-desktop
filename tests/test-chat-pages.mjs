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
  const doc = P.wrapPage("<p>x</p>", "html", {}, { other: "Khác</script>", otherPlaceholder: "Nhập</script>..." });
  const script = /<script>([\s\S]*?)<\/script>/.exec(doc)[1];
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(script, /replace\(\/\\s\+\/g/, "the whitespace class survives the template literal");
  assert.ok(!script.includes("</script>"), "custom labels cannot close the script element");
  assert.ok(script.includes("Khác\\u003c/script>"), "custom Other label is embedded safely");
});
check("pageTitle and pageUrl", () => {
  assert.equal(P.pageTitle("<title> Gói </title>"), "Gói");
  assert.equal(P.pageTitle("<p>x</p>"), null);
  assert.equal(P.pageUrl("a_b-c", false), "omp-page://localhost/a_b-c");
  assert.equal(P.pageUrl("a/b", true), "http://omp-page.localhost/a%2Fb");
});

check("bridge enhanceOthers + collect: radio beside textarea, CJK deduplication, checkbox multi, validation & submit", () => {
  function makeDom() {
    class Node {
      constructor(tag, attrs = {}) {
        this.tagName = tag.toUpperCase();
        this.attrs = { ...attrs };
        this.children = [];
        this.parentElement = null;
        this.listeners = {};
        this._text = "";
        this.value = attrs.value ?? "";
        this.type = attrs.type ?? "";
        this.name = attrs.name ?? "";
        this.checked = !!attrs.checked;
        this.required = false;
        this.validityMsg = "";
        this.style = { setProperty() {} };
      }
      get textContent() { return this._text + this.children.map(c => c.textContent).join(""); }
      set textContent(v) { this._text = String(v); this.children = []; }
      setAttribute(k, v) {
        this.attrs[k] = String(v);
        if (k === "type") this.type = String(v);
        if (k === "name") this.name = String(v);
        if (k === "value") this.value = String(v);
      }
      hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); }
      getAttribute(k) { return this.attrs[k] ?? null; }
      appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
      insertAdjacentElement(pos, el) {
        if (pos !== "afterend" || !this.parentElement) return;
        const idx = this.parentElement.children.indexOf(this);
        el.parentElement = this.parentElement;
        this.parentElement.children.splice(idx + 1, 0, el);
      }
      cloneNode(deep) {
        const c = new Node(this.tagName, this.attrs);
        c._text = this._text;
        if (deep) c.children = this.children.map(ch => { const k = ch.cloneNode(true); k.parentElement = c; return k; });
        return c;
      }
      remove() {
        if (!this.parentElement) return;
        this.parentElement.children = this.parentElement.children.filter(x => x !== this);
        this.parentElement = null;
      }
      get nextElementSibling() {
        if (!this.parentElement) return null;
        const idx = this.parentElement.children.indexOf(this);
        return this.parentElement.children[idx + 1] ?? null;
      }
      get form() { return this.closest("form"); }
      get elements() { return this.querySelectorAll("input,textarea,select,button,fieldset"); }
      matches(sel) {
        return sel.split(",").map(s => s.trim()).some(part => {
          if (part === "[data-omp-other]") return this.hasAttribute("data-omp-other");
          if (part === "[data-omp-other-text]") return this.hasAttribute("data-omp-other-text");
          if (part === "[data-omp-other-row]") return this.hasAttribute("data-omp-other-row");
          if (part === "[data-omp-no-other]") return this.hasAttribute("data-omp-no-other");
          if (part === "textarea") return this.tagName === "TEXTAREA";
          if (part === "input[type=radio]") return this.tagName === "INPUT" && this.type === "radio";
          if (part === "input[type=checkbox]") return this.tagName === "INPUT" && this.type === "checkbox";
          if (part.startsWith("input:not(")) return this.tagName === "INPUT" && !["radio", "checkbox", "range", "color", "file", "submit", "button", "reset", "image", "hidden"].includes(this.type);
          return this.tagName === part.toUpperCase();
        });
      }
      closest(sel) {
        for (let cur = this; cur; cur = cur.parentElement) if (cur.matches(sel)) return cur;
        return null;
      }
      querySelectorAll(sel) {
        const out = [];
        const walk = n => { for (const c of n.children) { if (c.matches(sel)) out.push(c); walk(c); } };
        walk(this);
        return out;
      }
      querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
      addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
      dispatchEvent(ev) {
        ev.target = ev.target || this;
        for (let cur = this; cur; cur = ev.bubbles ? cur.parentElement : null) {
          for (const fn of cur.listeners[ev.type] || []) fn(ev);
        }
      }
      focus() {}
      setCustomValidity(m) { this.validityMsg = String(m || ""); }
      reportValidity() {
        return !this.querySelectorAll("input,textarea").some(el => el.validityMsg || (el.required && !String(el.value).trim()));
      }
      getBoundingClientRect() { return { height: 200 }; }
    }

    const h = (tag, attrs = {}, kids = []) => {
      const n = new Node(tag, attrs);
      for (const k of kids) n.appendChild(typeof k === "string" ? Object.assign(new Node("#text"), { _text: k }) : k);
      return n;
    };

    const form = h("form", {}, [
      // Radio group beside a separate textarea in the SAME fieldset
      h("fieldset", {}, [
        h("legend", {}, ["Deploy mode"]),
        h("label", {}, [h("input", { type: "radio", name: "mode", value: "worker", checked: true }), " Worker"]),
        h("label", {}, [h("input", { type: "radio", name: "mode", value: "local" }), " Local"]),
        h("label", {}, ["Note", h("textarea", { name: "note" })]),
      ]),
      // Checkbox group (>= 2)
      h("fieldset", {}, [
        h("legend", {}, ["Features"]),
        h("label", {}, [h("input", { type: "checkbox", name: "feat", value: "stream" }), " Streaming"]),
        h("label", {}, [h("input", { type: "checkbox", name: "feat", value: "cache" }), " Cache"]),
      ]),
      // Existing CJK Other ("その他") must NOT get a duplicate Other row
      h("fieldset", {}, [
        h("legend", {}, ["Language"]),
        h("label", {}, [h("input", { type: "radio", name: "lang", value: "ja", checked: true }), " 日本語"]),
        h("label", {}, [h("input", { type: "radio", name: "lang", value: "other_ja" }), " その他"]),
      ]),
      // Standalone single checkbox must NOT get an Other row
      h("label", {}, [h("input", { type: "checkbox", name: "agree", value: "yes" }), " Agree"]),
    ]);
    const body = h("body", {}, [form]);
    body.scrollHeight = 200;
    const posted = [];
    const winListeners = {};
    const docListeners = {};
    class FakeFormData {
      constructor(f) {
        this.entries = [];
        for (const el of f.elements) {
          if (!el.name || el.disabled) continue;
          if ((el.type === "radio" || el.type === "checkbox") && !el.checked) continue;
          if (el.tagName === "TEXTAREA" && !el.value) continue;
          this.entries.push([el.name, el.value]);
        }
      }
      forEach(fn) { for (const [k, v] of this.entries) fn(v, k); }
    }
    const parent = { postMessage(m) { posted.push(m); } };
    const ctx = vm.createContext({
      console, parent, FormData: FakeFormData,
      Event: class { constructor(type, opts = {}) { this.type = type; this.bubbles = !!opts.bubbles; } },
      document: {
        body, forms: [form],
        createElement: tag => new Node(tag),
        querySelectorAll: sel => body.querySelectorAll(sel),
        addEventListener: (t, fn) => (docListeners[t] = docListeners[t] || []).push(fn),
      },
      addEventListener: (t, fn) => (winListeners[t] = winListeners[t] || []).push(fn),
      setTimeout,
    });
    ctx.window = ctx;
    return { form, posted, winListeners, ctx };
  }

  const { form, posted, winListeners, ctx } = makeDom();
  const doc = P.wrapPage("<p>x</p>", "html");
  const script = /<script>([\s\S]*?)<\/script>/.exec(doc)[1];
  vm.runInContext(script, ctx);
  for (const fn of winListeners.DOMContentLoaded || []) fn();

  // Radio beside textarea + multi checkbox both get Other; CJK その他 + single checkbox do NOT.
  assert.equal(form.querySelectorAll("[data-omp-other-row]").length, 2);
  const modeOther = form.querySelectorAll("[data-omp-other]").find(e => e.name === "mode");
  assert.ok(modeOther, "radio group beside textarea still gets Other");
  assert.equal(form.querySelectorAll("[data-omp-other]").filter(e => e.name === "lang").length, 0);
  assert.equal(form.querySelectorAll("[data-omp-other]").filter(e => e.name === "agree").length, 0);

  // Checking radio Other with blank text declines collect
  const radios = form.elements.filter(e => e.name === "mode");
  radios[0].checked = false;
  modeOther.checked = true;
  modeOther.dispatchEvent({ type: "change", bubbles: true });
  for (const fn of winListeners.message || []) fn({ source: ctx.parent, data: { omp: "card", type: "collect", id: "r1" } });
  assert.equal(posted.at(-1).type, "declined");

  // Typing into radio Other and checkbox Other sends custom values in both data and lines
  const modeInput = modeOther.closest("[data-omp-other-row]").querySelector("[data-omp-other-text]");
  modeInput.value = "Hybrid daemon";
  modeInput.dispatchEvent({ type: "input", bubbles: true });

  const featStream = form.elements.find(e => e.name === "feat" && e.value === "stream");
  featStream.checked = true;
  const featOther = form.elements.find(e => e.name === "feat" && e.hasAttribute("data-omp-other"));
  const featInput = featOther.closest("[data-omp-other-row]").querySelector("[data-omp-other-text]");
  featInput.value = "Audit log";
  featInput.dispatchEvent({ type: "input", bubbles: true });
  assert.equal(featOther.checked, true, "typing in checkbox Other checks its tick");

  for (const fn of winListeners.message || []) fn({ source: ctx.parent, data: { omp: "card", type: "collect", id: "r2" } });
  const reply = posted.at(-1);
  assert.equal(reply.type, "submit");
  assert.equal(reply.reply, "r2");
  assert.equal(reply.data.mode, "Hybrid daemon");
  assert.deepEqual(JSON.parse(JSON.stringify(reply.data.feat)), ["stream", "Audit log"]);
  assert.deepEqual(JSON.parse(JSON.stringify(reply.lines)), [
    { q: "Deploy mode", a: "Hybrid daemon" },
    { q: "Features", a: "Streaming; Audit log" },
    { q: "Language", a: "日本語" },
  ]);
});

console.log(`test-chat-pages: ${n} checks passed`);
