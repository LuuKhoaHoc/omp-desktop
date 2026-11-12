// Git browser view helpers (design/git/*.jsx, app/use-git-browser.jsx) and
// the status bar's branch picker (design/branch-menu.jsx).
//
// Every git fact — the tree with its status marks, the inline line diff, the
// commit graph and its lanes, the branch list — comes from Rust
// (src-tauri/src/git_browser/). What is left here is view state over those
// payloads: which tree rows an expansion set shows (`flatten`), which
// directories to open so every change is in view (`changedDirs`,
// `ancestorDirs`), the name filter (`filterFiles`), the first file to select
// (`firstFile`), hunk navigation (`hunkStarts`), the copy-diff text
// (`diffText`), compact commit ages (`relativeTime`), the discard
// confirmation rule (`discardDeletes`), the refresh trigger counting
// finished edit/write tool cards (`finishedEdits`), an edit card's path made
// absolute (`absolutePath`) and the branch picker's filtered rows
// (`branchMatches`), the tree rows a keyboard step walks (`listRows`,
// `stepFile`), the unchanged-run folding of the file view (`foldContext`)
// and the history pane's find (`historyMatches`, `stepMatch`).
//
// A tree node is Rust's `TreeNode`: `{ name, path, dir, status, changed,
// children }`, children dirs first then files, `status` null when unchanged.
//
// Exposes `window.OMP_GIT_BROWSER`; IIFE per AGENTS.md. Pure and
// dependency-free (tests/test-git-browser.mjs).
(function () {
  "use strict";

  const shows = (node, changedOnly) => !changedOnly || (node.dir ? node.changed > 0 : Boolean(node.status));

  /** Rows a tree view renders: `[{ node, depth }]` in display order. A
   *  directory's children follow it when it is in `expanded` (a Set of
   *  paths), or always under `changedOnly`, which also hides every unchanged
   *  file and every directory without a change below it. */
  function flatten(root, expanded, changedOnly) {
    const rows = [];
    const walk = (node, depth) => {
      for (const c of node.children) {
        if (!shows(c, changedOnly)) continue;
        rows.push({ node: c, depth });
        if (c.dir && (changedOnly || expanded.has(c.path))) walk(c, depth + 1);
      }
    };
    if (root) walk(root, 0);
    return rows;
  }

  /** Paths of the directories with a changed file below them (root excluded). */
  function changedDirs(root) {
    const dirs = new Set();
    const walk = node => {
      for (const c of node.children) {
        if (c.dir && c.changed > 0) {
          dirs.add(c.path);
          walk(c);
        }
      }
    };
    if (root) walk(root);
    return dirs;
  }

  /** Directories containing `path`, outermost first: "a/b/c.js" → ["a", "a/b"]. */
  function ancestorDirs(path) {
    const parts = path.split("/").filter(Boolean);
    const dirs = [];
    for (let i = 1; i < parts.length; i++) dirs.push(parts.slice(0, i).join("/"));
    return dirs;
  }

  /** Files whose project-relative path contains `query` (case-insensitive),
   *  in tree order; only changed ones under `changedOnly`. A blank query
   *  matches nothing — the caller shows the tree instead. */
  function filterFiles(root, query, changedOnly) {
    const q = query.trim().toLowerCase();
    const hits = [];
    if (!q || !root) return hits;
    const walk = node => {
      for (const c of node.children) {
        if (c.dir) walk(c);
        else if (c.path.toLowerCase().includes(q) && shows(c, changedOnly)) hits.push(c);
      }
    };
    walk(root);
    return hits;
  }

  /** First file in display order (every directory open); only a changed one
   *  under `changedOnly`. Null when there is none. */
  function firstFile(root, changedOnly) {
    const walk = node => {
      for (const c of node.children) {
        if (!shows(c, changedOnly)) continue;
        const hit = c.dir ? walk(c) : c;
        if (hit) return hit;
      }
      return null;
    };
    return root ? walk(root) : null;
  }

  /** Index of the first line of every run of changed lines. */
  function hunkStarts(lines) {
    const starts = [];
    let inHunk = false;
    lines.forEach((l, i) => {
      const changed = l.kind !== "ctx";
      if (changed && !inHunk) starts.push(i);
      inHunk = changed;
    });
    return starts;
  }

  /** `[dir, name]` with the directory's trailing slash kept: "a/b.js" → ["a/", "b.js"]. */
  function splitPath(path) {
    const i = path.lastIndexOf("/");
    return i === -1 ? ["", path] : [path.slice(0, i + 1), path.slice(i + 1)];
  }

  const MINUTE = 60;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  /** Compact age of `atSecs` at `nowSecs` (both unix seconds): "now" under a
   *  minute, then minutes, hours, days, weeks (from 7 days), months (from 30
   *  days) and years (from 365 days), each floored. A future time is "now". */
  function relativeTime(atSecs, nowSecs) {
    const d = Math.max(0, nowSecs - atSecs);
    if (d < MINUTE) return "now";
    if (d < HOUR) return `${Math.floor(d / MINUTE)}m`;
    if (d < DAY) return `${Math.floor(d / HOUR)}h`;
    const days = Math.floor(d / DAY);
    if (days < 7) return `${days}d`;
    if (days < 30) return `${Math.floor(days / 7)}w`;
    if (days < 365) return `${Math.floor(days / 30)}mo`;
    return `${Math.floor(days / 365)}y`;
  }

  /** The changed lines of a `FileView`, one per line prefixed `+`/`-`, for
   *  the copy button; "" when nothing changed. */
  function diffText(lines) {
    return lines
      .filter(l => l.kind !== "ctx")
      .map(l => `${l.kind === "add" ? "+" : "-"}${l.text}`)
      .join("\n");
  }

  /** Whether discarding a file of this status deletes it outright: an
   *  untracked or added file, or a rename's new path, has no HEAD blob, so
   *  `workspace_reject` removes it with no git history to recover it. */
  function discardDeletes(status) {
    return status === "Untracked" || status === "Added" || status === "Renamed";
  }

  /** Count of finished edit/write tool cards in a transcript: a rise while
   *  the browser is open means a file on disk changed. */
  function finishedEdits(messages) {
    let n = 0;
    for (const m of messages) {
      if (m.kind === "tool" && (m.tool === "edit" || m.tool === "write") && m.status !== "running") n++;
    }
    return n;
  }

  const ABSOLUTE = /^(?:[/\\]|[A-Za-z]:[/\\])/;

  /** An edit card's path made absolute: omp reports tool paths relative to
   *  the tab's folder, while Rust reads a relative path as repo-root-relative
   *  (tree rows), so a relative `target` is joined onto `projectPath` with
   *  `/`. A path starting with `/`, `\` or a drive (`C:\`, `C:/`) is already
   *  absolute and returned as is, as is any path when there is no project. */
  function absolutePath(projectPath, target) {
    if (!projectPath || ABSOLUTE.test(target)) return target;
    return `${projectPath.replace(/[/\\]+$/, "")}/${target.replace(/^\.[/\\]/, "")}`;
  }

  /** Rows the status bar's branch picker shows a cap of. */
  const MAX_BRANCH_ROWS = 200;

  /** The branch picker's rows for `query`: Rust's `Branch[]` (newest first)
   *  whose name contains it (case-insensitive, blanks ignored; a blank query
   *  keeps all), split into `local` and `remote` in that order, at most
   *  `MAX_BRANCH_ROWS` together, locals first; `hidden` counts the matches
   *  cut off. */
  function branchMatches(branches, query) {
    const q = query.trim().toLowerCase();
    const hits = q ? branches.filter(b => b.name.toLowerCase().includes(q)) : branches;
    const local = hits.filter(b => !b.remote).slice(0, MAX_BRANCH_ROWS);
    const remote = hits.filter(b => b.remote).slice(0, MAX_BRANCH_ROWS - local.length);
    return { local, remote, hidden: hits.length - local.length - remote.length };
  }

  /** The files pane's rows for the name filter and the changed-only /
   *  expansion state: `[{ node, depth, flat? }]` — a filter lists matching
   *  files flat, otherwise the tree as expanded. The one place both the
   *  pane and the keyboard step read the visible order from. */
  function listRows(root, expanded, changedOnly, filter) {
    if (filter.trim()) return filterFiles(root, filter, changedOnly).map(node => ({ node, depth: 0, flat: true }));
    return flatten(root, expanded, changedOnly);
  }

  /** The file `delta` rows from `selected` among the visible rows (dirs are
   *  skipped, no wrap-around); nothing selected yet (or the selection is
   *  filtered out) starts at the first file going down, the last going up.
   *  null when there is no file to move to. */
  function stepFile(rows, selected, delta) {
    const files = rows.filter(r => !r.node.dir);
    if (!files.length) return null;
    const at = files.findIndex(r => r.node.path === selected);
    if (at < 0) return files[delta > 0 ? 0 : files.length - 1].node.path;
    const to = Math.min(files.length - 1, Math.max(0, at + delta));
    return to === at ? null : files[to].node.path;
  }

  /** Unchanged lines kept around each change in the folded file view. */
  const CONTEXT_LINES = 3;
  /** A run of unchanged lines is folded only when it hides at least this
   *  many: a fold row for one or two lines costs more than it saves. */
  const MIN_FOLD = 4;

  /** The file view's lines cut into runs: `[{ kind: "lines" | "fold", from,
   *  to }]` over line indices (`to` exclusive). Lines within `context` of a
   *  change stay; a longer unchanged run between them becomes a `fold`. A
   *  file with no change at all is one `lines` run: there is nothing to fold
   *  toward, and an untouched file is read whole. */
  function foldContext(lines, context = CONTEXT_LINES) {
    const n = lines.length;
    const keep = new Uint8Array(n);
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (lines[i].kind === "ctx") continue;
      changed = true;
      const hi = Math.min(n - 1, i + context);
      for (let j = Math.max(0, i - context); j <= hi; j++) keep[j] = 1;
    }
    if (!changed) return n ? [{ kind: "lines", from: 0, to: n }] : [];
    const runs = [];
    for (let i = 0; i < n;) {
      let j = i;
      while (j < n && keep[j] === keep[i]) j++;
      const fold = !keep[i] && j - i >= MIN_FOLD;
      const kind = fold ? "fold" : "lines";
      const last = runs[runs.length - 1];
      if (last && last.kind === kind) last.to = j;
      else runs.push({ kind, from: i, to: j });
      i = j;
    }
    return runs;
  }

  /** Indices of the history rows that match `query`: every whitespace-
   *  separated term (case-insensitive) must occur in the subject, author,
   *  short or full sha, or a ref name. The working-tree row ("@") never
   *  matches; a blank query matches nothing. */
  function historyMatches(rows, query) {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const hits = [];
    rows.forEach((r, i) => {
      if (r.id === "@") return;
      const hay = [r.subject, r.author, r.short, r.id, ...r.refs.map(x => x.name)].join("\n").toLowerCase();
      if (terms.every(t => hay.includes(t))) hits.push(i);
    });
    return hits;
  }

  /** The match cursor `delta` away from `at` among `count` matches, wrapping;
   *  -1 (none chosen yet) steps to the first going down, the last going up. */
  function stepMatch(count, at, delta) {
    if (!count) return -1;
    if (at < 0) return delta > 0 ? 0 : count - 1;
    return (at + delta + count) % count;
  }

  window.OMP_GIT_BROWSER = {
    listRows, stepFile, CONTEXT_LINES, MIN_FOLD, foldContext, historyMatches, stepMatch,
    flatten, changedDirs, ancestorDirs, filterFiles, firstFile, hunkStarts,
    splitPath, relativeTime, diffText, discardDeletes, finishedEdits, absolutePath,
    MAX_BRANCH_ROWS, branchMatches,
  };
})();
