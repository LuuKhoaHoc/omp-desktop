/* ═════════════════════════════════════════════════════════════════════
   app/ship-text.js — the offline default text of the ship bar: a commit
   message, a pull-request title and a body, derived from the staged paths
   alone (src-tauri/src/ship/staged text). No agent turn, no network: the
   bar always shows this text editable, and a user edit wins.

   Pure and dependency-free (IIFE per AGENTS.md); exposes
   `window.OMP_SHIP_TEXT`. Paths are Git's own, `/`-separated.
   ═════════════════════════════════════════════════════════════════════ */
(function () {
  // A commit subject reads well around 50–72 characters; Git's own guidance
  // is 50, the hard wrap 72. Clipped at the word boundary below it.
  const MAX_SUBJECT = 72;
  // A PR body long enough to say what changed, short enough to read.
  const MAX_BULLETS = 20;

  /** One line: control characters and runs of whitespace collapsed. */
  function clean(value) {
    return String(value ?? "")
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Distinct, cleaned, sorted paths — a rename can list one twice. */
  function uniqueSorted(files) {
    const seen = new Set();
    const out = [];
    for (const file of files ?? []) {
      const path = clean(file);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      out.push(path);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }

  /** `text` cut to `limit` characters without splitting a surrogate pair or
   *  a word, and without trailing punctuation or space. */
  function clip(text, limit) {
    // Array.from iterates code points, so a clip never halves an emoji.
    const chars = Array.from(text);
    if (chars.length <= limit) return text;
    const head = chars.slice(0, limit + 1).join("");
    const space = head.lastIndexOf(" ");
    const kept = space > limit / 2 ? head.slice(0, space) : chars.slice(0, limit).join("");
    return `${kept.replace(/[\s,;:.\-]+$/, "")}…`;
  }

  /** The first path component: `src/app/a.js` → `src`. */
  function topDir(path) {
    const parts = path.split("/");
    return parts.length > 1 ? parts[0] : "";
  }

  /** The default commit subject: the one file, its folder, or the count. */
  function subject(files) {
    const list = uniqueSorted(files);
    if (list.length === 0) return "";
    if (list.length === 1) return clip(`Update ${list[0]}`, MAX_SUBJECT);
    const dirs = new Set(list.map(topDir));
    const only = dirs.size === 1 ? [...dirs][0] : "";
    return clip(
      only ? `Update ${only} (${list.length} files)` : `Update ${list.length} files`,
      MAX_SUBJECT,
    );
  }

  /** The default PR title: the same sentence a commit would get. */
  function prTitle(files) {
    return subject(files);
  }

  /** The default PR body: the staged paths as a capped bullet list. */
  function prBody(files) {
    const list = uniqueSorted(files);
    if (list.length === 0) return "";
    const shown = list.slice(0, MAX_BULLETS);
    const lines = ["## Changes", "", ...shown.map(path => `- ${path}`)];
    if (list.length > shown.length) {
      lines.push(`- …and ${list.length - shown.length} more`);
    }
    return lines.join("\n");
  }

  window.OMP_SHIP_TEXT = { subject, prTitle, prBody, clean, clip, uniqueSorted };
})();
