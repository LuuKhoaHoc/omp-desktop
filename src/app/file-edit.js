/* app/file-edit.js — pure helpers of the files panel's editor
   (docs/architecture/file-comments.md, "Editing"). The editor is a
   <textarea>, which keeps only "\n" line ends: a file's own line ends are
   noted when it is opened and put back when it is saved.

     eolOf(text)            "\n" | "\r\n", or null when the text mixes line
                            ends (or has a lone "\r"): saving would rewrite
                            lines the user never touched
     blocker(file)          why a FilePreview can't be edited ("kind" |
                            "encoding" | "eol"), or null
     toEditor(text)         the text as the textarea holds it
     toDisk(draft, eol)     the textarea's text with the file's line ends
     indentUnit(text)       "\t", or the file's smallest space indent (2
                            spaces when it has none)
     indent(value, start, end, unit, out)
                            Tab / Shift+Tab on a selection: { from, to, text,
                            start, end } — replace value[from, to) by `text`
                            and select [start, end) — or null for nothing */
(function () {
  function eolOf(text) {
    const crlf = text.split("\r\n").length - 1;
    const bare = text.replace(/\r\n/g, "");
    if (bare.includes("\r")) return null;
    if (!crlf) return "\n";
    return bare.includes("\n") ? null : "\r\n";
  }

  function blocker(file) {
    if (!file || file.kind !== "Text") return "kind";
    if (!file.editable) return "encoding";
    return eolOf(file.text) ? null : "eol";
  }

  const toEditor = (text) => text.replace(/\r\n/g, "\n");
  const toDisk = (draft, eol) => (eol === "\r\n" ? draft.replace(/\n/g, "\r\n") : draft);

  function indentUnit(text) {
    let width = 0;
    for (const line of text.split("\n", 2000)) {
      if (line[0] === "\t") return "\t";
      const spaces = line.length - line.trimStart().length;
      if (line[0] === " " && spaces >= 2 && spaces < line.length && (!width || spaces < width)) width = spaces;
    }
    return " ".repeat(Math.min(width || 2, 8));
  }

  function indent(value, start, end, unit, out) {
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const oneLine = !value.slice(start, end).includes("\n");
    if (!out && oneLine) return { from: start, to: end, text: unit, start: start + unit.length, end: start + unit.length };
    // Whole lines; a selection ending at a line's very start leaves that line alone.
    const last = end > start && value[end - 1] === "\n" ? end - 1 : end;
    let lineEnd = value.indexOf("\n", last);
    if (lineEnd < 0) lineEnd = value.length;
    const lines = value.slice(lineStart, lineEnd).split("\n");
    let first = 0; // how far the first line moved
    const moved = lines.map((line, i) => {
      if (!out) { if (i === 0) first = unit.length; return line ? unit + line : line; }
      const cut = line.startsWith(unit) ? unit.length
        : line[0] === "\t" ? 1 : Math.min(unit.length, line.length - line.trimStart().length);
      if (i === 0) first = -cut;
      return line.slice(cut);
    });
    const text = moved.join("\n");
    const delta = text.length - (lineEnd - lineStart);
    if (!delta) return null;
    return {
      from: lineStart, to: lineEnd, text,
      start: Math.max(lineStart, start + first),
      end: Math.max(lineStart, end + delta),
    };
  }

  window.OMP_FILE_EDIT = { eolOf, blocker, toEditor, toDisk, indentUnit, indent };
})();
