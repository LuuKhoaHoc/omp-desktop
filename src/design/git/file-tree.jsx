/* git/file-tree.jsx — the git browser's files pane: Rust's tree with git
   status marks, a changed-only filter and a name filter. While a commit is
   browsed the tree is the files it touched: changed-only is forced on, its
   toggle hidden and the head names the commit. Changed-only shows every
   directory open, so a directory row is inert there (the shared expansion
   set is the full tree's). Row logic is app/git-browser.js
   (OMP_GIT_BROWSER).

   The files panel (design/files/) mounts it too, with four optional props:
   `badges` (Map path → count, a number after the file's name),
   `commented` ({ count, on, onToggle }: a second head toggle), `searched`
   (the root already holds the filter's hits: listed flat, unfiltered) and
   `emptyText` (the message for an empty list). */

const { Icon: _GT_Icon } = window;
const { listRows: _GT_listRows } = window.OMP_GIT_BROWSER;

const GIT_STATUS_META = {
  Modified:  { label: "M", color: "var(--amber)",  title: "modified" },
  Added:     { label: "A", color: "var(--accent)", title: "added" },
  Deleted:   { label: "D", color: "var(--rose)",   title: "deleted" },
  Renamed:   { label: "R", color: "var(--cyan)",   title: "renamed" },
  Untracked: { label: "U", color: "var(--fg-3)",   title: "untracked" },
};

function GitFileTree({
  root, error, expanded, onToggle, selected, onSelect, changedOnly, onChangedOnly,
  filter, onFilter, changedCount, commit, truncated, badges, commented, searched = false, emptyText,
}) {
  const rows = React.useMemo(() => {
    if (searched) return (root?.children ?? []).map(node => ({ node, depth: 0, flat: true }));
    // A name filter lists matching files flat: the tree would need every
    // ancestor expanded to show them, and the match is on the whole path.
    return _GT_listRows(root, expanded, changedOnly, filter);
  }, [root, expanded, changedOnly, filter, searched]);

  // A selection moved by the keyboard (j / k) stays in view.
  const treeRef = React.useRef(null);
  React.useEffect(() => {
    treeRef.current?.querySelector(".gitb-row.active")?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // Enter opens the first hit; Escape clears the filter, and an empty one
  // hands the focus back to the browser so the next key (j, k, n…) acts.
  const onFilterKey = e => {
    if (e.key === "Enter") {
      const first = rows.find(r => !r.node.dir);
      if (first) { e.preventDefault(); onSelect(first.node.path); }
    } else if (e.key === "Escape") {
      if (filter) { e.preventDefault(); onFilter(""); return; }
      const host = e.currentTarget.closest(".gitb");
      if (host) { e.preventDefault(); host.focus(); }
    }
  };

  let empty = null;
  if (error) empty = error;
  // A failed status replaces the whole browser, so no root and no error
  // means still loading.
  else if (!root) empty = "loading…";
  else if (rows.length === 0) empty = emptyText ?? (filter.trim() ? "no match" : changedOnly && !commit ? "no changes" : "no files");

  return (
    <div className="gitb-pane gitb-files">
      <div className="gitb-pane-head">
        <span className="gitb-pane-title">{OMP_TR("files")}</span>
        {commit && (
          <span className="gitb-pane-sub mono" title={commit.id}>{commit.short} · {window.OMP_I18N.plural(commit.files, "{n} file", "{n} files", { n: commit.files })}</span>
        )}
        {commented && (
          <button type="button" className={`btn ghost gitb-toggle gitb-commented ${commented.on ? "on" : ""}`}
            onClick={() => commented.onToggle(!commented.on)} aria-pressed={commented.on}
            title={commented.on ? OMP_TR("show every file") : OMP_TR("show commented files only")}>
            <_GT_Icon name="edit" size={11} />
            <span>{commented.count} {OMP_TR("commented")}</span>
          </button>
        )}
        {onChangedOnly && (
          <button type="button" className={`btn ghost gitb-toggle ${changedOnly ? "on" : ""}`}
            onClick={() => onChangedOnly(!changedOnly)} title={changedOnly ? "show every file" : "show changed files only"}
            aria-pressed={changedOnly}>
            <_GT_Icon name="diff2" size={11} />
            <span>{changedCount} {OMP_TR("changed")}</span>
          </button>
        )}
      </div>
      <div className="gitb-filter">
        <_GT_Icon name="search" size={11} color="var(--fg-4)" />
        <input className="gitb-filter-input mono" value={filter} onChange={e => onFilter(e.target.value)} onKeyDown={onFilterKey}
          placeholder={OMP_TR("filter files")} title={OMP_TR("filter files (/)")} spellCheck={false} />
        {filter && <button type="button" className="btn ghost icon" onClick={() => onFilter("")} aria-label={OMP_TR("clear filter")}><_GT_Icon name="close" size={10} /></button>}
      </div>
      <div className="gitb-tree" role="tree" ref={treeRef}>
        {empty && <div className={`gitb-empty ${error ? "gitb-error" : ""}`}>{empty}</div>}
        {!error && rows.map(({ node, depth, flat }) => {
          const meta = node.status ? GIT_STATUS_META[node.status] : null;
          const active = !node.dir && node.path === selected;
          // A file and a dir can share a path ("x" deleted, "x/a" added).
          return (
            <div key={`${node.dir ? "d" : "f"}:${node.path}`} role="treeitem" aria-selected={active}
              aria-expanded={node.dir ? changedOnly || expanded.has(node.path) : undefined}
              className={`gitb-row ${node.dir ? "dir" : "file"} ${node.dir && changedOnly ? "inert" : ""} ${active ? "active" : ""} ${node.status === "Deleted" ? "deleted" : ""}`}
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() => {
                if (!node.dir) onSelect(node.path);
                else if (!changedOnly) onToggle(node.path);
              }}>
              {node.dir
                ? <_GT_Icon name={changedOnly || expanded.has(node.path) ? "chev" : "chevR"} size={11} color="var(--fg-4)" />
                : <span className="gitb-row-pad" />}
              <span className="gitb-row-name" style={meta ? { color: meta.color } : undefined}>
                {flat ? node.path : node.name}
              </span>
              {node.dir && node.changed > 0 && !changedOnly && <span className="gitb-dot" title={OMP_TR("{n} changed", { n: node.changed })} />}
              {!node.dir && badges?.get(node.path) > 0 && <span className="gitb-badge mono">{badges.get(node.path)}</span>}
              {meta && <span className="gitb-mark mono" style={{ color: meta.color }} title={meta.title}>{meta.label}</span>}
            </div>
          );
        })}
        {!error && root && truncated && <div className="gitb-empty">{OMP_TR("list truncated — too many files to show them all")}</div>}
      </div>
    </div>
  );
}

window.GitFileTree = GitFileTree;
window.GIT_STATUS_META = GIT_STATUS_META;
