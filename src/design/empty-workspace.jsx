const _EMPTY_WORKTREE_START = window.OMP_EMPTY_WORKTREE_START;
/* ═════════════════════════════════════════════════════════════════════
   empty-workspace.jsx — the session column while no tab is open

   The app starts without a tab (no pathless launch session), and closing
   the last tab returns here. Opening a project is the sidebar's and the
   tab bar's job; this space is a welcome screen — the start screen picked
   in Settings → Appearance (`startScreen`; an unknown id runs matrix)
   behind the ASCII-art OMP-DESKTOP logo (canvas host:
   design/backdrops/backdrop.jsx), paused while the Settings page covers
   it — plus any note the bridge filed while no tab existed (e.g. a failed
   "Open with"), which would otherwise have no transcript to land in.
   ═════════════════════════════════════════════════════════════════════ */

const { MarkdownContent, Backdrop, Icon: _EWIcon } = window;

function EmptyWorkspace({ notes, screen, paused, bridge, recentProjects, profileId, onOpenSession, onOpenWorktree }) {
  const [project, setProject] = React.useState("");
  const [branches, setBranches] = React.useState(null);
  const [baseBranch, setBaseBranch] = React.useState("");
  const [branchesProject, setBranchesProject] = React.useState("");
  const [newWorktree, setNewWorktree] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [branchesLoading, setBranchesLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const rows = recentProjects ?? [];

  React.useEffect(() => {
    if (!project || !newWorktree) {
      setBranches(null);
      setBranchesProject("");
      setBranchesLoading(false);
      setBaseBranch("");
      setError("");
      return;
    }
    let current = true;
    const initial = _EMPTY_WORKTREE_START.beginBranchLoad({ project, branches, branchesProject, baseBranch, branchesLoading, error });
    setBranches(initial.branches);
    setBranchesProject(initial.branchesProject);
    setBranchesLoading(initial.branchesLoading);
    setBaseBranch(initial.baseBranch);
    setError(initial.error);
    bridge.listWorktreeBranches(project).then(result => {
      if (!current) return;
      const next = _EMPTY_WORKTREE_START.finishBranchLoad(initial, project, result);
      setBranches(next.branches);
      setBranchesProject(next.branchesProject);
      setBranchesLoading(next.branchesLoading);
      setBaseBranch(next.baseBranch);
      setError(next.error);
    }).catch(err => {
      if (current) {
        setBranches(null);
        setBranchesProject("");
        setBranchesLoading(false);
        setError(String(err?.message ?? err));
      }
    });
    return () => { current = false; };
  }, [bridge, newWorktree, project]);

  const selectProject = path => {
    const next = _EMPTY_WORKTREE_START.resetForProject({ project, branches, branchesProject, baseBranch, error }, path);
    setProject(next.project);
    setBranches(next.branches);
    setBranchesProject(next.branchesProject);
    setBranchesLoading(next.branchesLoading);
    setBaseBranch(next.baseBranch);
    setError(next.error);
  };
  const chooseFolder = async () => {
    const path = await bridge?.pickFolder();
    if (path) selectProject(path);
  };
  const open = async () => {
    if (!_EMPTY_WORKTREE_START.canOpen({ project, branches, branchesProject, baseBranch, branchesLoading }, newWorktree, loading)) return;
    setLoading(true);
    setError("");
    try {
      if (newWorktree) await onOpenWorktree(project, profileId, baseBranch);
      else await onOpenSession(project, profileId);
    } catch (err) {
      setError(String(err?.message ?? err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="empty-ws" aria-label={OMP_TR("no project open")}>
      <Backdrop screen={screen} paused={paused} className="empty-ws-canvas" />
      <section className="empty-ws-start" aria-label={OMP_TR("New session")}>
        <h1>{OMP_TR("Start a session")}</h1>
        <div className="empty-ws-project">
          <label htmlFor="empty-ws-project">{OMP_TR("Project")}</label>
          <select id="empty-ws-project" value={project} onChange={e => selectProject(e.target.value)}>
            <option value="">{OMP_TR("Choose a project…")}</option>
            {rows.map(row => <option key={row.path} value={row.path}>{window.OMP_PROJECT_NAV.basename(row.path)}</option>)}
          </select>
          <button type="button" className="btn ghost empty-ws-browse" onClick={chooseFolder}>
            <_EWIcon name="folder" size={13} />{OMP_TR("Browse…")}
          </button>
        </div>
        {newWorktree && (
          <div className="empty-ws-branch">
            <label htmlFor="empty-ws-branch">{OMP_TR("Base branch")}</label>
            <select id="empty-ws-branch" value={baseBranch} disabled={branchesProject !== project || branchesLoading || !branches?.length || loading}
              onChange={e => setBaseBranch(e.target.value)}>
              <option value="">{branchesLoading ? OMP_TR("Loading branches…") : branches?.length ? OMP_TR("Choose a branch…") : OMP_TR("No branches available")}</option>
              {(branches ?? []).map(branch => (
                <option key={branch.reference} value={branch.reference}>{branch.name}{branch.remote ? ` · ${OMP_TR("remote")}` : ""}</option>
              ))}
            </select>
          </div>
        )}
        <label className="empty-ws-worktree">
          <input type="checkbox" checked={newWorktree} onChange={e => setNewWorktree(e.target.checked)} />
          <span>{OMP_TR("New worktree")}</span>
        </label>
        {newWorktree && <p className="empty-ws-hint">{OMP_TR("Creates a detached worktree at the selected base. Uncommitted changes are copied into it when applicable.")}</p>}
        {error && (() => {
          const shown = window.OMP_GIT_ERROR.present(error);
          return <div className="empty-ws-error" role="alert">
            <div>{OMP_TR(shown.message)}</div>
            <details><summary>{OMP_TR("Show technical details")}</summary><pre>{shown.detail}</pre></details>
          </div>;
        })()}
        <button type="button" className="btn primary empty-ws-open" disabled={!_EMPTY_WORKTREE_START.canOpen({ project, branches, branchesProject, baseBranch, branchesLoading }, newWorktree, loading)} onClick={open}>
          {loading ? OMP_TR("Opening…") : OMP_TR("Open session")}
        </button>
      </section>
      {notes.length > 0 && (
        <div className="empty-ws-notes">
          {notes.map((note, i) => (
            <div key={i} className="empty-ws-note"><MarkdownContent text={note} /></div>
          ))}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { EmptyWorkspace });
