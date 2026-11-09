/* app/chat-pages.js — interactive pages in the chat (fork), the pure half.
   An assistant's ```html / ```svg block can run as a live page: the card
   (design/chat/chat-page.jsx) wraps the block with `wrapPage`, stores it in
   Rust (`page_register`, src-tauri/src/chat_pages.rs) and loads it from the
   `omp-page:` scheme in a script-only sandboxed iframe. The page talks back
   with postMessage; `readMessage` is the only shape the card accepts.
   window.OMP_PAGES = { pageInfo, wrapPage, readMessage, answerText, pageTitle, pageUrl } */
(function () {
  const MAX_ANSWER = 20000;
  const MAX_HEIGHT = 4000;

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

  // Runs first in the page: reports its height, exposes `omp.submit(data)` /
  // `omp.send(text)`, turns a form submit and a click on [data-omp-send] into
  // a submit message. The page has no network (its CSP), so a form never posts.
  const BRIDGE = `(function(){
var post=function(m){m.omp="page";parent.postMessage(m,"*");};
var last=-1,measure=function(){var b=document.body;if(!b)return;var h=Math.ceil(Math.max(b.scrollHeight,b.getBoundingClientRect().height));if(h!==last){last=h;post({type:"height",h:h});}};
addEventListener("DOMContentLoaded",function(){measure();if(window.ResizeObserver)new ResizeObserver(measure).observe(document.body);});
addEventListener("load",function(){measure();[100,500,1500].forEach(function(t){setTimeout(measure,t);});});
document.addEventListener("visibilitychange",measure);
window.omp={submit:function(d){post({type:"submit",data:d});},send:function(t){post({type:"submit",data:String(t)});}};
document.addEventListener("submit",function(e){e.preventDefault();var f=e.target,o={},fd;try{fd=new FormData(f,e.submitter);}catch(_){fd=new FormData(f);}
fd.forEach(function(v,k){if(typeof v!=="string")return;o[k]=k in o?[].concat(o[k],v):v;});post({type:"submit",data:o});},true);
document.addEventListener("click",function(e){var el=e.target&&e.target.closest&&e.target.closest("[data-omp-send]");if(el){e.preventDefault();post({type:"submit",data:el.getAttribute("data-omp-send")});}},true);
})();`;

  /** The document the iframe loads: theme variables and quiet defaults (zero
   *  specificity, so the page's own CSS wins), the bridge, then the source. */
  function wrapPage(source, kind, theme = {}) {
    const t = (k, d) => cssValue(theme[k]) || d;
    const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>
:root{color-scheme:${t("scheme", "dark")};--omp-bg:${t("bg", "#16161a")};--omp-surface:${t("surface", "#202024")};--omp-fg:${t("fg", "#ececec")};--omp-fg-2:${t("fg2", "#c8c8c8")};--omp-muted:${t("muted", "#8a867e")};--omp-accent:${t("accent", "#d9a04a")};--omp-line:${t("line", "#3a3a40")};--omp-font:${t("font", "system-ui, sans-serif")};--omp-mono:${t("mono", "monospace")}}
:where(html,body){margin:0;background:transparent}
:where(body){padding:12px;font:14px/1.5 var(--omp-font);color:var(--omp-fg)}
:where(a){color:var(--omp-accent)}
:where(button,input,select,textarea){font:inherit;color:inherit}
:where(button){background:var(--omp-surface);border:1px solid var(--omp-line);border-radius:6px;padding:5px 12px;cursor:pointer}
:where(button[type=submit],button.primary){background:var(--omp-accent);border-color:var(--omp-accent);color:var(--omp-bg)}
:where(input,select,textarea){background:var(--omp-bg);border:1px solid var(--omp-line);border-radius:6px;padding:5px 8px}
:where(table){border-collapse:collapse}:where(th,td){border:1px solid var(--omp-line);padding:4px 8px;text-align:left}
:where(code,pre){font-family:var(--omp-mono)}
${kind === "svg" ? ":where(body){display:flex;justify-content:center}:where(svg){max-width:100%;height:auto}" : ""}
</style><script>${BRIDGE}</script>`;
    const src = String(source ?? "");
    const at = /<head(\s[^>]*)?>/i.exec(src);
    if (at) return src.slice(0, at.index + at[0].length) + head + src.slice(at.index + at[0].length);
    if (/^\s*(<!doctype[^>]*>\s*)?<html/i.test(src)) return src.replace(/<html[^>]*>/i, (m) => `${m}<head>${head}</head>`);
    return `<!doctype html><html><head>${head}</head><body>${src}</body></html>`;
  }

  /** A message from the page, or null for anything else. */
  function readMessage(data) {
    if (!data || typeof data !== "object" || data.omp !== "page") return null;
    if (data.type === "height") {
      const h = Number(data.h);
      return Number.isFinite(h) ? { type: "height", h: Math.max(0, Math.min(MAX_HEIGHT, Math.round(h))) } : null;
    }
    if (data.type === "submit") {
      const d = data.data;
      if (d == null) return null;
      let text;
      try { text = typeof d === "string" ? d.trim() : JSON.stringify(d, null, 2); } catch { return null; }
      if (!text) return null;
      return { type: "submit", text: text.slice(0, MAX_ANSWER), structured: typeof d !== "string" };
    }
    return null;
  }

  /** What reaches the agent: plain text as typed, structured data as a JSON
   *  block naming the page. */
  function answerText(title, msg) {
    if (!msg.structured) return msg.text;
    const fence = window.OMP_MARKDOWN?.fenceCode ?? ((t, l) => "```" + l + "\n" + t + "\n```");
    return `My answer in the page "${title || "page"}":\n${fence(msg.text, "json")}`;
  }

  /** The iframe URL of a stored page (Tauri serves custom schemes as
   *  http://<scheme>.localhost on Windows). */
  function pageUrl(id, windows = /Windows/.test(globalThis.navigator?.userAgent ?? "")) {
    const safe = encodeURIComponent(String(id));
    return windows ? `http://omp-page.localhost/${safe}` : `omp-page://localhost/${safe}`;
  }

  window.OMP_PAGES = { pageInfo, wrapPage, readMessage, answerText, pageTitle, pageUrl };
})();
