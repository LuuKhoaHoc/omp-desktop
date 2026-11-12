/* app/chat-pages.js — interactive pages in the chat (fork), the pure half.
   An assistant's ```html / ```svg block can run as a live page: the card
   (design/chat/chat-page.jsx) wraps the block with `wrapPage`, stores it in
   Rust (`page_register`, src-tauri/src/chat_pages.rs) and loads it from the
   `omp-page:` scheme in a script-only sandboxed iframe. The page talks back
   with postMessage; `readMessage` is the only shape the card accepts.
   window.OMP_PAGES = { pageInfo, wrapPage, readMessage, isReply, answerText, pageTitle, pageUrl } */
(function () {
  const MAX_ANSWER = 20000;
  const MAX_HEIGHT = 4000;
  const MAX_LINES = 60;

  /** `html`/`svg` code blocks are pages; a `page` (or `live`) word in the
   *  info string (```html page) shows them running at once. */
  function pageInfo(lang) {
    const words = String(lang ?? "").trim().toLowerCase().split(/\s+/);
    const kind = words[0] === "html" || words[0] === "svg" ? words[0] : null;
    if (!kind) return null;
    return { kind, live: words.includes("page") || words.includes("live") };
  }

  function pageTitle(source) {
    const m = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(source ?? "");
    return m ? m[1].trim() : null;
  }

  // Theme values come from the app's own CSS variables; strip anything that
  // could close the declaration or the <style> element anyway.
  const cssValue = (v) => String(v ?? "").replace(/[<>{};\\]/g, "").trim();

  // Runs first in the page: reports its height and whether it holds a form
  // the card's own Send button can answer for (`scan`: at most one submit
  // button, which the card's button replaces and takes its text from),
  // exposes `omp.submit(data)` / `omp.send(text)`, turns a form submit and a
  // click on [data-omp-send] into a submit message, and answers the card's
  // `collect` with every form's fields. A form answer carries `lines`, one
  // `{ q, a }` per filled field: the question as the page shows it (legend,
  // label, placeholder, else the name) and the option's label or the typed
  // value. The page has no network (its CSP), so a form never posts.
  const BRIDGE = `(function(){
var post=function(m){m.omp="page";parent.postMessage(m,"*");};
var txt=function(s){return String(s==null?"":s).replace(/\\s+/g," ").trim().slice(0,300);};
var own=function(l){if(!l)return"";var c=l.cloneNode(true);[].forEach.call(c.querySelectorAll("input,select,textarea,button"),function(x){x.remove();});return txt(c.textContent);};
var labelOf=function(el){var l=el.closest("label");if(!l&&el.id)[].some.call(document.querySelectorAll("label[for]"),function(x){return x.htmlFor===el.id&&(l=x);});return own(l);};
var legendOf=function(el){var f=el.closest("fieldset"),g=f&&f.querySelector("legend");return g?txt(g.textContent):"";};
var SUBMIT="button:not([type]),button[type=submit],input[type=submit],input[type=image]";
var collect=function(forms,submitter){var o={},lines=[],at=Object.create(null);
forms.forEach(function(f){var mine=submitter&&submitter.form===f?submitter:undefined,fd;try{fd=new FormData(f,mine);}catch(_){fd=new FormData(f);}
fd.forEach(function(v,k){if(typeof v!=="string")return;o[k]=k in o?[].concat(o[k],v):v;});
[].forEach.call(f.elements,function(el){var t=String(el.type||"").toLowerCase(),q,a;
if(!el.name||el.disabled||/^(submit|button|reset|image|file|password|fieldset|output)$/.test(t))return;
if(t==="radio"||t==="checkbox"){if(!el.checked)return;q=legendOf(el)||el.name;a=labelOf(el)||el.value;}
else if(el.tagName==="SELECT"){q=labelOf(el)||legendOf(el)||el.name;a=[].map.call(el.selectedOptions,function(x){return txt(x.textContent);}).join("; ");}
else{q=t==="hidden"?el.name:labelOf(el)||txt(el.placeholder)||legendOf(el)||el.name;a=String(el.value).trim();}
if(!a)return;
if(t==="checkbox"&&at[q]!=null)lines[at[q]].a+="; "+a;else{at[q]=lines.length;lines.push({q:q,a:a});}});
if(mine&&mine.name)lines.push({q:mine.name,a:txt(mine.textContent)||mine.value});});
return{data:o,lines:lines};};
var seen="",scan=function(){var f=document.forms.length===1?document.forms[0]:null,subs=f?f.querySelectorAll(SUBMIT):[];
var on=!!f&&subs.length<2,label=on&&subs[0]?txt(subs[0].textContent||subs[0].value).slice(0,80):"",key=on+"|"+label;
if(on&&subs[0])subs[0].style.setProperty("display","none","important");
if(key!==seen){seen=key;post({type:"form",on:on,label:label});}};
var last=-1,measure=function(){var b=document.body;if(!b)return;scan();var h=Math.ceil(Math.max(b.scrollHeight,b.getBoundingClientRect().height));if(h!==last){last=h;post({type:"height",h:h});}};
addEventListener("DOMContentLoaded",function(){measure();if(window.ResizeObserver)new ResizeObserver(measure).observe(document.body);});
addEventListener("load",function(){measure();[100,500,1500].forEach(function(t){setTimeout(measure,t);});});
document.addEventListener("visibilitychange",measure);
window.omp={submit:function(d){post({type:"submit",data:d});},send:function(t){post({type:"submit",data:String(t)});}};
document.addEventListener("submit",function(e){e.preventDefault();var r=collect([e.target],e.submitter);post({type:"submit",data:r.data,lines:r.lines});},true);
addEventListener("message",function(e){var d=e.data;if(e.source!==parent||!d||d.omp!=="card"||d.type!=="collect")return;var id=String(d.id||""),f=document.forms.length===1?document.forms[0]:null;
var r=f&&f.reportValidity()?collect([f]):null;
if(r&&(r.lines.length||Object.keys(r.data).length))post({type:"submit",data:r.data,lines:r.lines,reply:id});else post({type:"declined",reply:id});});
document.addEventListener("click",function(e){var el=e.target&&e.target.closest&&e.target.closest("[data-omp-send]");if(el){e.preventDefault();post({type:"submit",data:el.getAttribute("data-omp-send")});}},true);
})();`;

  // Inputs that hold typed text (not a tick, a slider, a colour or a button).
  const TEXT_INPUT = "input:not([type=radio],[type=checkbox],[type=range],[type=color],[type=file],[type=submit],[type=button],[type=reset],[type=image])";
  const TICK = "input:is([type=radio],[type=checkbox])";
  const BUTTON = "button,input[type=submit],input[type=button],input[type=reset]";
  const mix = (v, pct) => `color-mix(in srgb,var(--omp-${v}) ${pct}%,transparent)`;

  // What a page looks like before its own CSS: a plain form reads as a set of
  // cards (fieldset, `.glass`) with one option per row and stacked fields.
  // Every rule is inside `:where()`, so it has zero specificity and any rule
  // of the page wins (the placeholder colour aside, a pseudo-element).
  // An option label is a block with its tick inline, not a flex row (its
  // text and inline tags must keep flowing as one paragraph) and not an
  // absolutely placed tick (a page that restyles the label's padding would
  // get the tick on top of its text).
  const DEFAULTS = `
:where(html,body){margin:0;background:transparent}
:where(body){padding:12px;font:14px/1.55 var(--omp-font);color:var(--omp-fg);accent-color:var(--omp-accent)}
:where(h1,h2,h3){margin:0 0 8px;font-weight:600;line-height:1.3}:where(h1){font-size:18px}:where(h2){font-size:16px}:where(h3){font-size:14px}
:where(p,ul,ol,pre,table){margin:0 0 10px}:where(ul,ol){padding-left:20px}
:where(a){color:var(--omp-accent)}:where(small){color:var(--omp-muted)}
:where(hr){border:0;border-top:1px solid var(--omp-line);margin:12px 0}
:where(img){max-width:100%;height:auto}
:where(code,pre){font-family:var(--omp-mono);font-size:.92em}
:where(pre){padding:8px 10px;overflow:auto;background:${mix("fg", 5)};border:1px solid var(--omp-line);border-radius:8px}
:where(table){border-collapse:collapse}:where(th,td){border:1px solid var(--omp-line);padding:5px 9px;text-align:left}:where(th){background:${mix("fg", 5)};font-weight:600}
:where(fieldset,.glass){margin:0 0 12px;min-width:0;padding:12px 14px;border:1px solid ${mix("fg", 13)};border-radius:12px;background:radial-gradient(120% 90% at 0 0,${mix("accent", 9)},transparent 62%),linear-gradient(180deg,${mix("fg", 7)},${mix("fg", 2)});box-shadow:inset 0 1px 0 ${mix("fg", 9)},0 10px 28px -16px rgba(0,0,0,.5);-webkit-backdrop-filter:blur(14px) saturate(1.3);backdrop-filter:blur(14px) saturate(1.3)}
:where(fieldset>*,.glass>*){margin-top:0}:where(fieldset>:last-child,.glass>:last-child){margin-bottom:0}
:where(legend){float:left;width:100%;padding:0;margin:0 0 8px;font-weight:600}:where(legend+*){clear:both}
:where(form){display:grid;gap:12px}:where(form>*){margin:0;min-width:0}
:where(${BUTTON},input,select,textarea){box-sizing:border-box;font:inherit;color:inherit}
:where(label:has(>${TICK})){display:block;padding:7px 10px;border:1px solid transparent;border-radius:8px;cursor:pointer;transition:background .12s,border-color .12s}
:where(label:has(>${TICK}):hover){background:${mix("fg", 6)}}
:where(label:has(>${TICK}:checked)){background:${mix("accent", 13)};border-color:${mix("accent", 45)}}
:where(label:has(>${TICK}:focus-visible)){border-color:var(--omp-accent)}
:where(label>${TICK}){width:16px;height:16px;margin:0 8px 0 0;vertical-align:-3px;cursor:pointer}
:where(label+label:has(>${TICK})){margin-top:2px}
:where(label:has(>${TEXT_INPUT},>textarea,>select)){display:grid;gap:5px;color:var(--omp-fg-2)}
:where(${TEXT_INPUT},select,textarea){background:${mix("bg", 65)};border:1px solid var(--omp-line);border-radius:8px;padding:7px 10px;color:var(--omp-fg);outline:none;transition:border-color .12s,box-shadow .12s}
:where(${TEXT_INPUT},select,textarea):where(:focus){border-color:var(--omp-accent);box-shadow:0 0 0 3px ${mix("accent", 22)}}
:where(form,fieldset,label,.glass)>:where(${TEXT_INPUT},select,textarea){width:100%}
:where(form,fieldset,label,.glass)>:where(input:is([type=number],[type=date],[type=time])){width:auto;min-width:9em;justify-self:start}
:where(textarea){display:block;min-height:76px;resize:vertical;line-height:1.5}
:where(select:not([multiple],[size])){-webkit-appearance:none;appearance:none;padding-right:30px;background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);background-position:calc(100% - 16px) 55%,calc(100% - 11px) 55%;background-size:5px 5px;background-repeat:no-repeat}
::placeholder{color:var(--omp-muted)}
:where(${BUTTON}){background:${mix("fg", 7)};border:1px solid var(--omp-line);border-radius:8px;padding:6px 14px;cursor:pointer;transition:background .12s,border-color .12s,filter .12s}
:where(${BUTTON}):where(:hover){background:${mix("fg", 12)}}
:where(${BUTTON}):where(:focus-visible){outline:2px solid var(--omp-accent);outline-offset:2px}
:where(${BUTTON}):where(:disabled){opacity:.5;cursor:default}
:where(button[type=submit],form button:not([type]):last-of-type,input[type=submit],button.primary){background:var(--omp-accent);border-color:var(--omp-accent);color:var(--omp-bg);font-weight:600}
:where(button[type=submit],form button:not([type]):last-of-type,input[type=submit],button.primary):where(:hover){background:var(--omp-accent);filter:brightness(1.1)}
:where(form>:where(${BUTTON})){justify-self:start}
`;

  /** The document the iframe loads: theme variables and the defaults above,
   *  the bridge, then the source. */
  function wrapPage(source, kind, theme = {}) {
    const t = (k, d) => cssValue(theme[k]) || d;
    const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>
:root{color-scheme:${t("scheme", "dark")};--omp-bg:${t("bg", "#16161a")};--omp-surface:${t("surface", "#202024")};--omp-fg:${t("fg", "#ececec")};--omp-fg-2:${t("fg2", "#c8c8c8")};--omp-muted:${t("muted", "#8a867e")};--omp-accent:${t("accent", "#d9a04a")};--omp-line:${t("line", "#3a3a40")};--omp-font:${t("font", "system-ui, sans-serif")};--omp-mono:${t("mono", "monospace")}}${DEFAULTS}${kind === "svg" ? ":where(body){display:flex;justify-content:center}:where(svg){max-width:100%;height:auto}" : ""}
</style><script>${BRIDGE}</script>`;
    const src = String(source ?? "");
    const at = /<head(\s[^>]*)?>/i.exec(src);
    if (at) return src.slice(0, at.index + at[0].length) + head + src.slice(at.index + at[0].length);
    if (/^\s*(<!doctype[^>]*>\s*)?<html/i.test(src)) return src.replace(/<html[^>]*>/i, (m) => `${m}<head>${head}</head>`);
    return `<!doctype html><html><head>${head}</head><body>${src}</body></html>`;
  }

  // A form answer's lines, bounded: `{ q, a }` strings only.
  function readLines(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const l of list.slice(0, MAX_LINES)) {
      if (!l || typeof l.q !== "string" || typeof l.a !== "string") continue;
      const q = l.q.replace(/\s+/g, " ").trim().replace(/\s*[:：]$/, "").slice(0, 300);
      const a = l.a.trim().slice(0, 4000);
      if (q && a) out.push({ q, a });
    }
    return out;
  }

  // The id of the card's `collect` a message answers, if it names one.
  const replyId = (data) => (typeof data.reply === "string" ? data.reply.slice(0, 64) : "");

  /** Whether `msg` answers the card's own ask `{ id, until }`: the one
   *  submit that may go out without the confirmation strip. */
  function isReply(msg, ask, now = Date.now()) {
    return !!ask?.id && !!msg && msg.reply === ask.id && now < ask.until;
  }

  /** A message from the page, or null for anything else. */
  function readMessage(data) {
    if (!data || typeof data !== "object" || data.omp !== "page") return null;
    if (data.type === "height") {
      const h = Number(data.h);
      return Number.isFinite(h) ? { type: "height", h: Math.max(0, Math.min(MAX_HEIGHT, Math.round(h))) } : null;
    }
    if (data.type === "form") {
      return { type: "form", on: data.on === true, label: typeof data.label === "string" ? data.label.replace(/\s+/g, " ").trim().slice(0, 80) : "" };
    }
    if (data.type === "declined") return { type: "declined", reply: replyId(data) };
    if (data.type === "submit") {
      const d = data.data;
      if (d == null) return null;
      let text;
      try { text = typeof d === "string" ? d.trim() : JSON.stringify(d, null, 2); } catch { return null; }
      if (!text) return null;
      return { type: "submit", text: text.slice(0, MAX_ANSWER), structured: typeof d !== "string", lines: typeof d === "string" ? [] : readLines(data.lines), reply: replyId(data) };
    }
    return null;
  }

  /** What reaches the agent: plain text as typed; a form as one
   *  `- question: answer` line per field under a line naming the page; other
   *  structured data as a JSON block under that line. */
  function answerText(title, msg) {
    if (!msg.structured) return msg.text;
    const head = `My answer in the page "${title || "page"}":`;
    if (msg.lines?.length) {
      return `${head}\n${msg.lines.map((l) => `- ${l.q}: ${l.a.replace(/\n/g, "\n  ")}`).join("\n")}`.slice(0, MAX_ANSWER);
    }
    const fence = window.OMP_MARKDOWN?.fenceCode ?? ((t, l) => "```" + l + "\n" + t + "\n```");
    return `${head}\n${fence(msg.text, "json")}`;
  }

  /** The iframe URL of a stored page (Tauri serves custom schemes as
   *  http://<scheme>.localhost on Windows). */
  function pageUrl(id, windows = /Windows/.test(globalThis.navigator?.userAgent ?? "")) {
    const safe = encodeURIComponent(String(id));
    return windows ? `http://omp-page.localhost/${safe}` : `omp-page://localhost/${safe}`;
  }

  window.OMP_PAGES = { pageInfo, wrapPage, readMessage, isReply, answerText, pageTitle, pageUrl };
})();
