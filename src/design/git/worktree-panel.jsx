/* git/worktree-panel.jsx — the worktree manager opened from the git browser
   header: the repository's worktrees (Rust `git_worktrees_list`), each with
   its branch and changed-file count, plus add (an existing local branch into
   a new folder) and remove (a linked worktree; a worktree with changes asks
   before force). Branch switching stays in the status bar's branch picker. */

const { Icon: _WP_Icon } = window;

function _WP_Error({ error, className }) {
  const shown = window.OMP_GIT_ERROR.present(error);
  return <div className={className}>
    <div>{OMP_TR(shown.message)}</div>
    <details><summary>{OMP_TR("Show technical details")}</summary><pre>{shown.detail}</pre></details>
  </div>;
}

/** The folder a new worktree goes in: a sibling of the repository, named
 *  after the branch. The user can edit it before adding. */
function _WP_defaultTarget(repoPath, branch) {
  const parent = repoPath.replace(/[\\/][^\\/]*[\\/]?$/, "");
  const slug = String(branch).replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `${parent}/${slug}`;
}

function WorktreePanel({ bridge, repoPath, onClose, onOpened }) {
  window.OMP_I18N.useLocale();
  const [list, setList] = React.useState(null);     // { value } | { error }
  const [branches, setBranches] = React.useState(null);
  const [branch, setBranch] = React.useState("");
  const [target, setTarget] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState(null); // { error } | { removeTarget, changed }

  // Open a worktree as a project tab (focusing an open one, as the recent
  // list does) and close the manager and the browser it sits over. A failed
  // open stays here with its error.
  const open = async w => {
    setBusy(true); setNotice(null);
    try {
      await bridge.openProject(w.path);
      setBusy(false);
      onClose();
      onOpened?.();
    } catch (err) {
      setBusy(false);
      setNotice({ error: String(err?.message ?? err) });
    }
  };

  const reload = React.useCallback(async () => {
    const res = await bridge.gitWorktrees();
    setList(!res ? { error: OMP_TR("this tab has no project folder") } : res.ok ? { value: res.value } : { error: res.error });
  }, [bridge]);

  React.useEffect(() => {
    let live = true;
    reload();
    bridge.gitBranches().then(res => {
      if (!live || !res || !res.ok) return;
      setBranches(res.value.filter(b => !b.remote));
    });
    return () => { live = false; };
  }, [bridge, reload]);

  const checkedOut = new Set((list?.value ?? []).map(w => w.branch).filter(Boolean));
  const addable = (branches ?? []).filter(b => !checkedOut.has(b.name));

  const add = async () => {
    if (!branch || !target) return;
    setBusy(true); setNotice(null);
    const res = await bridge.gitWorktreeAdd(branch, target);
    setBusy(false);
    if (!res || !res.ok) { setNotice({ error: res?.error ?? OMP_TR("worktree add failed") }); return; }
    setBranch(""); setTarget("");
    reload();
  };

  const remove = async (w, force) => {
    setBusy(true); setNotice(null);
    const res = await bridge.gitWorktreeRemove(w.path, force);
    setBusy(false);
    if (!res || !res.ok) {
      // Git refuses a worktree with changes; offer the forced removal.
      if (!force && w.changed) { setNotice({ removeTarget: w, changed: w.changed }); return; }
      setNotice({ error: res?.error ?? OMP_TR("worktree remove failed") });
      return;
    }
    setNotice(null);
    reload();
  };

  return (
    <div className="gitb-scrim" onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}>
      <div className="gitb wtp" role="dialog" aria-modal="true" aria-label={OMP_TR("worktrees")}>
        <div className="gitb-head">
          <_WP_Icon name="branch" size={13} color="var(--accent)" />
          <span className="gitb-title">{OMP_TR("worktrees")}</span>
          <span className="gitb-project">{repoPath}</span>
          <button type="button" className="btn ghost" onClick={onClose} aria-label={OMP_TR("close")}><_WP_Icon name="close" size={12} /></button>
        </div>
        <div className="wtp-body">
          {list?.error && <_WP_Error className="gitb-empty gitb-error" error={list.error} />}
          {list?.value && (
            <ul className="wtp-list">
              {list.value.map(w => (
                <li key={w.path} className="wtp-row">
                  <span className="gitb-ref head">{w.branch ?? (w.head ? w.head.slice(0, 7) : OMP_TR("detached"))}</span>
                  <span className="wtp-path mono" title={w.path}>{w.path}</span>
                  {w.main && <span className="gitb-chip">{OMP_TR("primary")}</span>}
                  {w.locked && <span className="gitb-chip">{OMP_TR("locked")}</span>}
                  <span className="gitb-chip mono">{w.changed ?? 0} {OMP_TR("changed")}</span>
                  <button type="button" className="btn ghost" disabled={busy} onClick={() => open(w)}>{OMP_TR("open")}</button>
                  {!w.main && (
                    <button type="button" className="btn ghost" disabled={busy || w.locked} onClick={() => remove(w, false)}>{OMP_TR("remove")}</button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <form className="wtp-add" onSubmit={e => { e.preventDefault(); add(); }}>
            <label>{OMP_TR("branch")}
              <select value={branch} onChange={e => { setBranch(e.target.value); setTarget(e.target.value ? _WP_defaultTarget(repoPath, e.target.value) : ""); }}>
                <option value="">{OMP_TR("choose a branch")}</option>
                {addable.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
              </select>
            </label>
            <label>{OMP_TR("folder")}
              <input type="text" value={target} onChange={e => setTarget(e.target.value)} />
            </label>
            <button type="submit" className="btn" disabled={busy || !branch || !target}>{OMP_TR("add worktree")}</button>
          </form>
          {notice?.removeTarget && (
            <div className="gitb-error">
              {OMP_TR("This worktree has {n} changed files. Remove it anyway?", { n: notice.changed })}
              <button type="button" className="btn" disabled={busy} onClick={() => remove(notice.removeTarget, true)}>{OMP_TR("force remove")}</button>
            </div>
          )}
          {notice?.error && <_WP_Error className="gitb-error" error={notice.error} />}
        </div>
      </div>
    </div>
  );
}

window.WorktreePanel = WorktreePanel;
