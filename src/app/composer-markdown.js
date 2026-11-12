/* app/composer-markdown.js — the markdown syntax of a composer draft, for
   colouring it while it is typed (design/composer-highlight.jsx).

   Not a renderer: `spans(text)` cuts the draft into `{ text, kind }` runs
   whose texts join back to the draft exactly, so the coloured copy keeps
   every character where the textarea has it. Kinds: "" (plain), "mark"
   (the syntax characters themselves), "heading", "strong", "em", "strike",
   "code" (inline code and the body of a fenced block), "link" (a link's
   text), "url", "quote", "list" (a bullet or number).

   It follows what marked renders for the sent message closely enough to
   show what the draft will become; where the two differ (emphasis across a
   line break, a link title) only a colour is off. */
(function () {
  const FENCE = /^ {0,3}(`{3,}|~{3,})/;
  const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
  const HEADING = /^ {0,3}#{1,6}[ \t]+(?=\S)/;
  const QUOTE = /^ {0,3}>[ \t]?/;
  const LIST = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(\[[ xX]\](?=[ \t]))?/;
  const WORD = /[\p{L}\p{N}]/u;
  const SPACE = /\s/;

  const runLength = (s, i) => {
    let n = 1;
    while (s[i + n] === s[i]) n++;
    return n;
  };

  /** `code` between two backtick runs of the same length. */
  function codeSpan(s, i) {
    const n = runLength(s, i);
    for (let k = s.indexOf("`", i + n); k !== -1; k = s.indexOf("`", k)) {
      const r = runLength(s, k);
      if (r === n) return { open: n, close: n, kind: "code", inner: [i + n, k], end: k + n, plain: true };
      k += r;
    }
    return null;
  }

  /** `*em*`, `**strong**` and their `_` forms; `_` only at a word's edge. */
  function emphasis(s, i) {
    const ch = s[i];
    const run = runLength(s, i);
    const len = run >= 2 ? 2 : 1;
    const from = i + len;
    if (from >= s.length || SPACE.test(s[from])) return null;
    if (ch === "_" && i > 0 && WORD.test(s[i - 1])) return null;
    for (let k = from + 1; k < s.length; k++) {
      if (s[k] === "\\") { k++; continue; }
      if (s[k] !== ch) continue;
      const r = runLength(s, k);
      const after = s[k + r];
      const fits = len === 2 ? r >= 2 : r % 2 === 1;
      const edge = ch !== "_" || after === undefined || !WORD.test(after);
      if (fits && edge && !SPACE.test(s[k - 1])) {
        const close = k + r - len;
        return { open: len, close: len, kind: len === 2 ? "strong" : "em", inner: [from, close], end: close + len };
      }
      k += r - 1;
    }
    return null;
  }

  function strike(s, i) {
    if (s[i + 1] !== "~" || i + 2 >= s.length || SPACE.test(s[i + 2])) return null;
    for (let k = s.indexOf("~~", i + 3); k !== -1; k = s.indexOf("~~", k + 1)) {
      if (!SPACE.test(s[k - 1])) return { open: 2, close: 2, kind: "strike", inner: [i + 2, k], end: k + 2 };
    }
    return null;
  }

  // `[text](url)`; the url may hold one level of balanced parentheses.
  const LINK = /\[([^\]]*)\]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)\)/y;

  function spans(text) {
    const out = [];
    const push = (t, kind) => {
      if (!t) return;
      const last = out[out.length - 1];
      if (last && last.kind === kind) last.text += t;
      else out.push({ text: t, kind });
    };

    function inline(s, base) {
      let plain = 0;
      let i = 0;
      while (i < s.length) {
        const c = s[i];
        if (c === "\\") { i += 2; continue; }
        let m = null;
        let skip = 1;
        if (c === "`") { m = codeSpan(s, i); skip = runLength(s, i); }
        else if (c === "*" || c === "_") { m = emphasis(s, i); skip = runLength(s, i); }
        else if (c === "~") m = strike(s, i);
        else if (c === "[") {
          LINK.lastIndex = i;
          const l = LINK.exec(s);
          if (l) {
            push(s.slice(plain, i), base);
            push("[", "mark"); push(l[1], "link"); push("](", "mark");
            push(l[2], "url"); push(")", "mark");
            i = plain = i + l[0].length;
            continue;
          }
        }
        if (!m) { i += skip; continue; }
        push(s.slice(plain, i), base);
        push(s.slice(i, i + m.open), "mark");
        const inner = s.slice(m.inner[0], m.inner[1]);
        if (m.plain) push(inner, m.kind);
        else inline(inner, m.kind);
        push(s.slice(m.inner[1], m.inner[1] + m.close), "mark");
        i = plain = m.end;
      }
      push(s.slice(plain), base);
    }

    function block(line) {
      if (RULE.test(line)) { push(line, "mark"); return; }
      const h = HEADING.exec(line);
      if (h) { push(h[0], "mark"); inline(line.slice(h[0].length), "heading"); return; }
      let rest = line;
      let kind = "";
      const q = QUOTE.exec(rest);
      if (q) { push(q[0], "mark"); rest = rest.slice(q[0].length); kind = "quote"; }
      const l = LIST.exec(rest);
      if (l) {
        push(l[1], kind); push(l[2], "list"); push(l[3], kind); push(l[4], "mark");
        rest = rest.slice(l[0].length);
      }
      inline(rest, kind);
    }

    let fence = null; // the open fence's marker run
    const lines = String(text ?? "").split("\n");
    lines.forEach((line, i) => {
      const nl = i < lines.length - 1 ? "\n" : "";
      const f = FENCE.exec(line);
      if (fence) {
        const closes = f && f[1][0] === fence[0] && f[1].length >= fence.length
          && !line.slice(f[0].length).trim();
        push(line, closes ? "mark" : "code");
        push(nl, closes ? "" : "code");
        if (closes) fence = null;
      } else if (f) {
        fence = f[1];
        push(line, "mark");
        push(nl, "code");
      } else {
        block(line);
        push(nl, "");
      }
    });
    return out;
  }

  window.OMP_COMPOSER_MD = { spans };
})();
