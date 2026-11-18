/* worktree-menu.jsx — the composer's Local / Worktree pill (Codex-style),
   beside the approval and profile pills. What it offers follows the tab's
   worktree state (app/worktree-ux.js `tabState`):
     fresh     Local | Worktree for the first send, and the base branch a
               worktree starts from (default: the branch the checkout is
               on, whose uncommitted changes then come along);
     local     Hand off to worktree: chat + uncommitted work move into the
               chat's worktree (a new detached one the first time);
     worktree  Create branch here, Open folder, Hand off to local (asks for
               a branch name when the worktree's commits cannot fast-forward
               the local branch).
   Portaled above the pill like branch-menu.jsx. */

const { Icon: _WM_Icon, OMP_GIT_BROWSER: _WM_GIT } = window;

function _WM_place(trigger) {
  const rect = trigger.getBoundingClientRect();
  return {
    left: Math.max(8, Math.min(rect.left, window.innerWidth - 368)),
    bottom: window.innerHeight - rect.top + 4,
    maxHeight: Math.max(0, rect.top - 12),
  };
}

function WorktreeMenu({ tab, messageCount, busy: agentBusy, bridge }) {
  window.OMP_I18N.useLocale();
  const WT = window.OMP_WORKTREE_UX;
  const state = WT.tabState(tab, messageCount);
  const [place, setPlace] = React.useState(null);
  const open = place !== null;
  const [branches, setBranches] = React.useState(null); // BaseBranch[] | { error }
  const [query, setQuery] = React.useState("");
  // null | { kind: "branch" | "handoff", value }
  const [form, setForm] = React.useState(null);
  const triggerRef = React.useRef(null);
  const popRef = React.useRef(null);
  const inputRef = React.useRef(null);
  const rootRef = React.useRef(null);
  rootRef.current = {
    contains: node => triggerRef.current?.contains(node) || popRef.current?.contains(node),
  };
  const { busy, error, pick: run, close } = window.useMenuPick(triggerRef, () => {
    setPlace(null);
    setQuery("");
    setForm(null);
  });
  window.usePopoverDismiss(open, rootRef, () => close(false), close);

  // Fresh tabs list the base branches when the menu opens.
  React.useEffect(() => {
    if (!open || state !== "fresh") return undefined;
    let live = true;
    bridge.listWorktreeBranches(tab.path).then(res => {
      if (live) setBranches(res.ok ? res.value : { error: res.error });
    });
    return () => { live = false; };
  }, [open, state, tab?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => { if (form) inputRef.current?.focus(); }, [form?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // The Changes card's "Create branch" opens this menu on its branch form.
  const branchFormRef = React.useRef(null);
  React.useEffect(() => {
    const onAsk = () => branchFormRef.current?.();
    window.addEventListener("omp:worktree-branch-form", onAsk);
    return () => window.removeEventListener("omp:worktree-branch-form", onAsk);
  }, []);

  if (!state) return null;
  const draft = tab.worktreeDraft || {};
  const list = Array.isArray(branches) ? branches : null;
  const base = list ? WT.baseFor(draft, list) : null;

  const setMode = mode => bridge.setWorktreeDraft(tab.id, { mode });
  const pickBase = b => { bridge.setWorktreeDraft(tab.id, { mode: "worktree", base: b.reference }); close(); };

  const createBranch = () => run(async () => {
    const res = await bridge.worktreeCreateBranch(tab.id, form.value);
    if (!res.ok) throw new Error(res.error);
  }, e => e.message);

  const suggested = async () => {
    const settings = await bridge.worktreeSettings();
    return WT.suggestBranch(settings.ok ? settings.value.branchPrefix : "omp/", tab.name);
  };

  const handoff = branch => run(async () => {
    const res = await bridge.worktreeHandoff(tab.id, { branch });
    if (res.needsBranch) {
      setForm({ kind: "handoff", value: await suggested() });
      throw new Error(res.error);
    }
    if (!res.ok) throw new Error(res.error);
  }, e => e.message);

  const openBranchForm = async () => setForm({ kind: "branch", value: await suggested() });
  branchFormRef.current = state === "worktree" && !tab.branch
    ? () => { setPlace(_WM_place(triggerRef.current)); openBranchForm(); }
    : null;

  const submitForm = e => {
    e.preventDefault();
    if (!form?.value.trim()) return;
    if (form.kind === "branch") createBranch();
    else handoff(form.value.trim());
  };

  const label = WT.pillLabel(state, tab);
  const icon = state === "worktree" || draft.mode === "worktree" ? "branch" : "folder";
  const rows = list ? _WM_GIT.branchMatches(list, query) : null;
  const baseRow = b => (
    <button key={b.reference} className="branch-item" role="menuitem" onClick={() => pickBase(b)}
      title={b.current ? OMP_TR("the checkout's branch: its uncommitted changes come along") : b.reference}>
      <span className="branch-item-name mono">{b.name}</span>
      {base?.reference === b.reference && draft.mode === "worktree" && <_WM_Icon name="check" size={10} color="var(--accent)" />}
      {b.current && <span className="branch-item-age mono">{OMP_TR("current")}</span>}
    </button>
  );
  const locked = agentBusy && state !== "fresh";

  return (
    <>
      <button ref={triggerRef} type="button" className={`composer-pill worktree-pill${state === "worktree" ? " on" : ""}`}
        aria-haspopup="menu" aria-expanded={open}
        title={state === "worktree" ? tab.path : OMP_TR("where this chat works: the local checkout or an isolated worktree")}
        onClick={() => (open ? close() : setPlace(_WM_place(triggerRef.current)))}>
        <_WM_Icon name={icon} size={12} color="var(--fg-3)" />
        <span className="mono">{OMP_TR(label)}</span>
        {state === "fresh" && draft.mode === "worktree" && base && <span className="mono worktree-pill-base">· {base.name}</span>}
        <_WM_Icon name="chev" size={9} color="var(--fg-4)" />
      </button>
      {open && ReactDOM.createPortal(
        <div ref={popRef} className={`branch-pop worktree-pop${busy ? " busy" : ""}`} style={place} role="menu"
          aria-label={OMP_TR("worktree")}
          onKeyDown={e => { if (e.target.tagName !== "INPUT") window.menuKeyNav(e, popRef.current, '[role="menuitem"]', close); }}>
          {state === "fresh" && (<>
            <div className="worktree-seg" role="none">
              <button role="menuitemradio" aria-checked={draft.mode !== "worktree"}
                className={`worktree-seg-btn${draft.mode !== "worktree" ? " on" : ""}`} onClick={() => { setMode("local"); close(); }}>
                <_WM_Icon name="folder" size={11} /> {OMP_TR("Local")}
              </button>
              <button role="menuitemradio" aria-checked={draft.mode === "worktree"}
                className={`worktree-seg-btn${draft.mode === "worktree" ? " on" : ""}`} onClick={() => setMode("worktree")}>
                <_WM_Icon name="branch" size={11} /> {OMP_TR("Worktree")}
              </button>
            </div>
            <div className="branch-pop-note">{draft.mode === "worktree"
              ? OMP_TR("The first message starts a detached worktree from the base branch below.")
              : OMP_TR("Work directly in the project folder.")}</div>
            {draft.mode === "worktree" && (<>
              <div className="branch-pop-filter">
                <_WM_Icon name="search" size={11} color="var(--fg-4)" />
                <input className="mono" value={query} placeholder={OMP_TR("base branch")} spellCheck={false}
                  aria-label={OMP_TR("base branch")} onChange={e => setQuery(e.target.value)} />
              </div>
              <div className="branch-pop-list">
                {!branches ? <div className="branch-pop-note">{OMP_TR("loading…")}</div>
                  : branches.error ? <div className="branch-pop-note error">{branches.error}</div>
                  : (<>
                    {rows.local.length > 0 && <div className="branch-pop-head mono" role="none">{OMP_TR("local")}</div>}
                    {rows.local.map(baseRow)}
                    {rows.remote.length > 0 && <div className="branch-pop-head mono" role="none">{OMP_TR("remote")}</div>}
                    {rows.remote.map(baseRow)}
                  </>)}
              </div>
            </>)}
          </>)}

          {state === "local" && (
            <button className="branch-item" role="menuitem" aria-disabled={locked || busy || undefined}
              onClick={() => !locked && handoff(null)}>
              <_WM_Icon name="branch" size={11} /> <span>{OMP_TR("Hand off to worktree")}</span>
            </button>
          )}

          {state === "worktree" && (<>
            <div className="branch-pop-note mono worktree-pop-path" title={tab.path}>{`\u200e${tab.path}\u200e`}</div>
            {!tab.branch && (
              <button className="branch-item" role="menuitem" aria-disabled={busy || undefined} onClick={openBranchForm}>
                <_WM_Icon name="branch" size={11} /> <span>{OMP_TR("Create branch here")}</span>
              </button>
            )}
            <button className="branch-item" role="menuitem" onClick={() => run(async () => {
              const res = await bridge.revealWorktree(tab.path);
              if (!res.ok) throw new Error(res.error);
            }, e => e.message)}>
              <_WM_Icon name="folder" size={11} /> <span>{OMP_TR("Open folder")}</span>
            </button>
            <button className="branch-item" role="menuitem" aria-disabled={locked || busy || undefined}
              onClick={() => !locked && handoff(null)}>
              <_WM_Icon name="folder" size={11} /> <span>{OMP_TR("Hand off to local")}</span>
            </button>
          </>)}

          {form && (
            <form className="profile-form" onSubmit={submitForm}>
              <input ref={inputRef} className="profile-input mono" value={form.value} spellCheck={false}
                aria-label={OMP_TR("branch name")}
                onChange={e => setForm({ ...form, value: e.target.value })} />
              <button type="submit" className="btn ghost outlined" disabled={busy}>
                {OMP_TR(form.kind === "branch" ? "Create" : "Hand off")}
              </button>
            </form>
          )}
          {locked && <div className="branch-pop-note" role="status">{OMP_TR("the agent is working — hand off once it's idle")}</div>}
          {error && <div className="branch-pop-note error" role="alert">{error}</div>}
        </div>,
        document.body,
      )}
    </>
  );
}

Object.assign(window, { WorktreeMenu });
