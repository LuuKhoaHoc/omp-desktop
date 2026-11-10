/* ═════════════════════════════════════════════════════════════════════
   app/chat-quotes.js — quotes of the chat (window.OMP_CHAT_QUOTES): text
   selected in the transcript, with an optional comment, kept per tab as
   chips above the composer (design/chat/quote-popover.jsx adds them,
   composer.jsx shows them) and merged into the next message the tab sends
   (app-live.jsx, ahead of the typed text).
   ═════════════════════════════════════════════════════════════════════ */
(function () {
  // A quote is a pointer for the model, not a paste: a long selection is cut.
  const MAX_QUOTE_CHARS = 2000;
  const MAX_LABEL_CHARS = 60;
  const EMPTY = [];

  let nextId = 1;

  /** A quote of `text` (whitespace-trimmed, cut at MAX_QUOTE_CHARS) with
   *  `comment`; null when nothing but whitespace was selected. */
  function makeQuote(text, comment) {
    let quote = String(text ?? "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!quote) return null;
    if (quote.length > MAX_QUOTE_CHARS) quote = `${quote.slice(0, MAX_QUOTE_CHARS).trimEnd()} …`;
    return { id: `q${nextId++}`, quote, comment: String(comment ?? "").trim() };
  }

  /** `"first words…" — comment` for the chip. */
  function label(q) {
    const flat = q.quote.replace(/\s+/g, " ");
    const head = flat.length > MAX_LABEL_CHARS ? `${flat.slice(0, MAX_LABEL_CHARS).trimEnd()}…` : flat;
    return q.comment ? `“${head}” — ${q.comment}` : `“${head}”`;
  }

  /** `text` with `quotes` ahead of it: each a markdown blockquote, its
   *  comment under it. No quotes: `text` unchanged. */
  function mergeIntoMessage(text, quotes) {
    if (!quotes?.length) return text;
    const blocks = quotes.map(q => {
      const quoted = q.quote.split("\n").map(l => (l ? `> ${l}` : ">")).join("\n");
      return q.comment ? `${quoted}\n\n${q.comment}` : quoted;
    });
    return [...blocks, text].filter(Boolean).join("\n\n");
  }

  // Per-tab store: `{ [sessionId]: quote[] }`, never mutated.
  const of = (map, sid) => map[sid] ?? EMPTY;
  const add = (map, sid, q) => ({ ...map, [sid]: [...of(map, sid), q] });
  /** Drop `ids` from tab `sid` (a send takes those it merged; one added
   *  since stays for the next message). */
  function remove(map, sid, ids) {
    const keep = of(map, sid).filter(q => !ids.includes(q.id));
    const next = { ...map };
    if (keep.length) next[sid] = keep; else delete next[sid];
    return next;
  }
  /** Only the tabs still open (`sids`). Same map when nothing goes. */
  function prune(map, sids) {
    const gone = Object.keys(map).filter(sid => !sids.includes(sid));
    if (!gone.length) return map;
    const next = { ...map };
    for (const sid of gone) delete next[sid];
    return next;
  }

  window.OMP_CHAT_QUOTES = { MAX_QUOTE_CHARS, makeQuote, label, mergeIntoMessage, of, add, remove, prune };
})();
