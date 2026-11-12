/* ═════════════════════════════════════════════════════════════════════
   tab-group-chip.jsx — tab strip pieces shared with the project sidebar

   TabCluster: a project (folder + profile) with several conversations in
   the tab strip: its name once, then one tab per conversation and a "+"
   for another in that project. Grouping itself is
   `OMP_PROJECT_NAV.groupTabs` (app/project-nav.js); this file only renders.
   Also TabRunDot, TabLabel, TabNumber, tabClickProps and the strip's "+"
   menu (NewTabMenu).
   ═════════════════════════════════════════════════════════════════════ */

const { Icon, RenameField } = window;
const { groupTarget, membersNewestFirst, tabLabel } = window.OMP_PROJECT_NAV;

// A tab's click props: select on click, close on middle-click, as in
// browsers (#24). WebKit before Safari 18.2 / WebKitGTK 2.46 has no
// `auxclick` and reports it as a `click` with button 1, hence the check in
// onClick too; newer engines never send `click` for button 1, so this
// can't double-fire. Swallowing the middle-button mousedown stops Windows
// autoscroll and Linux primary-selection paste from firing on the tab.
function tabClickProps(onSelect, onClose) {
  return {
    onClick: e => (e.button === 1 ? onClose?.() : onSelect?.()),
    onMouseDown: e => { if (e.button === 1) e.preventDefault(); },
    onAuxClick: e => { if (e.button === 1) { e.preventDefault(); onClose?.(); } },
  };
}

/** A tab's (or group's) run-state dot; nothing while idle. Shared by the
 *  tab bar and the project sidebar so the titles stay in one place. */
function TabRunDot({ state }) {
  if (!state || state === "idle") return null;
  const title = state === "waiting-user" ? "waiting for you"
    : state === "failed" ? "agent process exited"
    : state === "background" ? "background job running · the agent resumes when it finishes"
    : state === "retrying" ? "retrying a failed request"
    : "running";
  return <span className={`tab-run-dot ${state}`} title={title} />;
}

/** Name of a tab shown on its own (#46): `folder · title` once the title
 *  is no longer the folder name, the folder truncating first. Shared by the
 *  tab bar and the project sidebar; `className` is the caller's name class. */
function TabLabel({ tab, className, title }) {
  const { prefix, title: name } = tabLabel(tab);
  if (!prefix) return <span className={className} title={title}>{name}</span>;
  return (
    <span className={`${className} tab-label`} title={title}>
      {/* A few letters of the folder stay visible however long the title;
          a shorter folder keeps its own width, not a padded 4ch box. */}
      <span className="tab-prefix" style={{ minWidth: `${Math.min(4, prefix.length)}ch` }}>{prefix}</span>
      <span className="tab-sep">·</span>
      <span className="tab-title">{name}</span>
    </span>
  );
}

/** A tab's "go to tab N" number, or a project's range of them
 *  (`OMP_PROJECT_NAV.tabDigits` / `groupDigits`). Shown only while the
 *  chord's modifier is held (use-keymap.jsx useTabNumberHint; chrome.css
 *  `.tab-num`). Shared by the tab bar and the project sidebar. */
function TabNumber({ label }) {
  return label ? <span className="tab-num" aria-hidden="true">{label}</span> : null;
}

function TabCluster({ group, activeId, digits, profileLabel, onSelect, onClose, onNewInProject, onRename, reorder }) {
  // Member tab whose name is being edited inline (#32).
  const [renaming, setRenaming] = React.useState(null);
  const active  = group.tabs.find(t => t.id === activeId);
  const profile = profileLabel(group.profile);
  // Drag to reorder (#40), on TabBar's `useDragReorder`: the head moves the
  // project along the strip, a tab moves within this project.
  const members = `members:${group.key}`;
  return (
    <div {...reorder.itemProps("projects", group.key, "x")}
      className={`tab-cluster${active ? " active" : ""}${reorder.dropClass("projects", group.key)}`}>
      <button className="tab-cluster-head" title={group.path}
        onClick={() => onSelect(groupTarget(group, activeId))}>
        <Icon name="folder" size={11} color={active ? active.color : "var(--fg-4)"} />
        <span className="tab-name">{group.name}</span>
        {profile && (
          <span className="chip muted tab-profile" title={`${OMP_TR("profile:")} ${profile}`}>{profile}</span>
        )}
      </button>
      {/* Newest first, the order the sidebar lists them and "go to tab N"
          counts in. */}
      {membersNewestFirst(group).map(t => {
        const on = t.id === activeId;
        // A conversation not named yet still carries its folder's name,
        // which the head already shows.
        const name = tabLabel(t).prefix ? t.name : OMP_TR("new conversation");
        return (
          <div key={t.id}
            {...reorder.itemProps(members, t.id, "x")}
            className={`tab ${on ? "active" : ""}${reorder.dropClass(members, t.id)}`}
            {...tabClickProps(() => onSelect(t.id), () => onClose?.(t.id))}
            // The first click of the pair already selected the tab.
            onDoubleClick={e => { if (onRename && !e.target.closest(".tab-close")) setRenaming(t.id); }}>
            <span className="tab-bar-mark" style={{ background: on ? t.color : "transparent" }} />
            <TabRunDot state={t.runState} />
            {renaming === t.id ? (
              <RenameField value={t.name}
                onCommit={next => onRename(t.id, next)}
                onClose={() => setRenaming(null)} />
            ) : (
              <span className="tab-name" title={`${name}\n${OMP_TR("double-click to rename")}`}>{name}</span>
            )}
            <TabNumber label={digits.get(t.id)} />
            <button className="tab-close" title={OMP_TR("close tab")} onClick={e => { e.stopPropagation(); onClose?.(t.id); }}>
              <Icon name="close" size={9} />
            </button>
          </div>
        );
      })}
      <button className="tab-cluster-new" title={OMP_TR("new conversation in this project")}
        onClick={() => onNewInProject?.(group.path, group.profile)}>
        <Icon name="plus" size={10} />
      </button>
    </div>
  );
}

/** The "+" menu (fork): a new omp chat or a terminal tab in the project
 *  that is open. Without an open project the chat entry picks a folder and
 *  the terminal entry is off (it opens in a project's folder). `header`
 *  renders the trigger as the header's tool button (toolbar.jsx), the way
 *  in while the tab strip is hidden; otherwise it is the strip's own "+". */
function NewTabMenu({ project, onChat, onTerminal, header = false, chatChord = "" }) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef(null);
  const triggerRef = React.useRef(null);
  const close = React.useCallback(() => { setOpen(false); triggerRef.current?.focus(); }, []);
  window.usePopoverDismiss(open, rootRef, close);
  const where = project?.name ? ` in ${project.name}` : "";
  const title = `new chat or terminal${where}${chatChord ? ` (chat: ${chatChord})` : ""}`;
  return (
    <div ref={rootRef} className={header ? "tab-new tab-new-header" : "tab-new"} data-no-reorder>
      <button ref={triggerRef} className={header ? "btn ghost tb-btn" : "tab-new-btn"} title={title}
        aria-label={title} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Icon name="plus" size={header ? 16 : 12} />
      </button>
      {open && (
        <div className="tab-group-pop" role="menu">
          <button className="tab-group-item" role="menuitem" onClick={() => { close(); onChat(); }}>
            <span className="tab-group-dot"><Icon name="sparkle" size={11} /></span>
            <span className="tab-name">{project ? "omp chat" : "omp chat in a folder…"}</span>
          </button>
          <button className="tab-group-item" role="menuitem" disabled={!project}
            title={project ? undefined : "open a project first"} onClick={() => { close(); onTerminal(); }}>
            <span className="tab-group-dot"><Icon name="terminal" size={11} /></span>
            <span className="tab-name">Terminal</span>
            <span className="tab-new-hint">hermes, agy…</span>
          </button>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { TabCluster, TabRunDot, TabLabel, TabNumber, NewTabMenu, tabClickProps });
