/* ═════════════════════════════════════════════════════════════════════
   toolbar.jsx — the app's controls, each placed over what it acts on
   (the layout OpenChamber, Claude Desktop and Codex share):
   - HeaderStart / HeaderEnd: the one header row (chrome.jsx WindowChrome
     slots). Start: sidebar toggle, new conversation, and history while
     the sidebar is closed. End: the command bridge.
   - PanelRail: a column of toggles at the window's right edge, one per
     panel that opens beside or under the chat (rail cards, conversation
     tree, subagents, browser, work, insights, terminal) plus the git
     browser. An open panel's own actions sit under its toggle.
   - SidebarFooter: settings, history, usage, at the foot of the project
     sidebar (project-sidebar.jsx `footer`).
   - SessionPills: the tab's approval mode and omp profile, in the
     composer's foot beside model / thinking / plan / goal.
   Panels carry no close button of their own: their toggle closes them.
   ═════════════════════════════════════════════════════════════════════ */

const { Icon: _TB_Icon, ProfileMenu: _TB_ProfileMenu } = window;

// An action's chord, or "" while it is unbound (or the keymap not loaded).
function _tbChord(actionId) {
  return window.OMP_KEYMAP ? window.OMP_KEYMAP.hintFor(actionId) : "";
}
// `label (chord)`, or just the label while the action is unbound. The label
// is dictionary text (window chrome), the chord is a key binding.
function _tbTip(label, actionId) {
  const chord = _tbChord(actionId);
  const text = OMP_TR(label);
  return chord ? `${text} (${chord})` : text;
}

// A `.btn ghost` icon button. `pressed` undefined: a plain button;
// boolean: a toggle.
function ToolButton({ icon, title, onClick, pressed, disabled, color, size = 16, children }) {
  return (
    <button type="button" className={`btn ghost tb-btn${pressed ? " on" : ""}`}
      title={title} aria-label={children ? undefined : title} aria-pressed={pressed}
      disabled={disabled} onClick={onClick}>
      <_TB_Icon name={icon} size={size} color={color} />
      {children}
    </button>
  );
}

// ── Header ────────────────────────────────────────────────────────────
/** nav: { sidebarOpen, onToggleSidebar, onNewChat, onHistory } */
function HeaderStart({ nav }) {
  return (
    <div className="hd-cluster">
      <ToolButton icon="sidebar" title={_tbTip("project sidebar", "desktop.sidebar.toggle")}
        pressed={nav.sidebarOpen} onClick={nav.onToggleSidebar} />
      <ToolButton icon="plus" title={_tbTip("new conversation", "desktop.chat.new")} onClick={nav.onNewChat} />
      {/* The sidebar's footer holds history; with it closed, the header does. */}
      {!nav.sidebarOpen && (
        <ToolButton icon="clock" title={_tbTip("conversation history", "desktop.history.open")} onClick={nav.onHistory} />
      )}
    </div>
  );
}

function HeaderEnd({ onCommands }) {
  const chord = _tbChord("desktop.commands.open");
  return (
    <div className="hd-cluster">
      <button type="button" className="hd-bridge" title={chord ? `${OMP_TR("command bridge")} (${chord})` : OMP_TR("command bridge")} onClick={onCommands}>
        <_TB_Icon name="search" size={13} />
        <span className="hd-bridge-label">{OMP_TR("commands, models…")}</span>
        {chord && <span className="kbd">{chord}</span>}
      </button>
    </div>
  );
}

// ── Panel rail (right edge) ───────────────────────────────────────────
/**
 * rail, subagents, terminal: { open, onToggle }
 * tree:     { open, onToggle, onRefresh, canRefresh }
 * work, insights: { open, onToggle } (fork panels; optional)
 * browser:  { open, onToggle, annotate, canAnnotate, onAnnotate(on), fullView, onFullView(on) }
 * files:    { open, onToggle, fullView, onFullView(on) }
 * onGit
 */
function PanelRail({ rail, subagents, tree, browser, files, terminal, work, insights, onGit }) {
  return (
    <nav className="panel-rail" aria-label={OMP_TR("panels")}>
      <ToolButton icon="radar" title={_tbTip("rail: context, activity, widgets", "desktop.rail.toggle")} pressed={rail.open} onClick={rail.onToggle} />
      <ToolButton icon="branch" title={_tbTip("conversation tree (prompt-cache status)", "desktop.tree.toggle")} pressed={tree.open} onClick={tree.onToggle} />
      {tree.open && (
        <span className="tb-sub" role="group" aria-label={OMP_TR("conversation tree")}>
          <ToolButton icon="refresh" size={14} title={OMP_TR("refresh conversation tree")} disabled={!tree.canRefresh} onClick={tree.onRefresh} />
        </span>
      )}
      <ToolButton icon="agent" title={_tbTip("subagent manager", "desktop.subagents.toggle")} pressed={subagents.open} onClick={subagents.onToggle} />
      <ToolButton icon="web" title={_tbTip("browser panel", "desktop.browser.toggle")} pressed={browser.open} onClick={browser.onToggle} />
      {browser.open && (
        <span className="tb-sub" role="group" aria-label={OMP_TR("browser panel")}>
          <ToolButton icon="edit" size={14} title={_tbTip("annotate the page", "desktop.browser.annotate")} pressed={browser.annotate}
            disabled={!browser.canAnnotate} onClick={() => browser.onAnnotate(!browser.annotate)} />
          <ToolButton icon="focus" size={14} title={_tbTip("browser full view", "desktop.browser.fullView")} pressed={browser.fullView}
            onClick={() => browser.onFullView(!browser.fullView)} />
        </span>
      )}
      <ToolButton icon="file" title={_tbTip("files panel", "desktop.files.toggle")} pressed={files.open} onClick={files.onToggle} />
      {files.open && (
        <span className="tb-sub" role="group" aria-label={OMP_TR("files panel")}>
          <ToolButton icon="focus" size={14} title={OMP_TR("files panel full view")} pressed={files.fullView}
            onClick={() => files.onFullView(!files.fullView)} />
        </span>
      )}
      {(work || insights) && <span className="pr-sep" />}
      {work && <ToolButton icon="tag" title={_tbTip("work: tickets", "desktop.panel.work")} pressed={work.open} onClick={work.onToggle} />}
      {insights && <ToolButton icon="test" title={_tbTip("insights: diagrams and test cases", "desktop.panel.insights")} pressed={insights.open} onClick={insights.onToggle} />}
      <span className="pr-sep" />
      <ToolButton icon="diff2" title={_tbTip("git browser", "desktop.panel.changes")} onClick={onGit} />
      <span className="pr-fill" />
      <ToolButton icon="terminal" title={_tbTip("terminal", "desktop.terminal.toggle")} pressed={terminal.open} onClick={terminal.onToggle} />
    </nav>
  );
}

// ── Sidebar footer ────────────────────────────────────────────────────
/** settings: { active, onOpen }; onHistory, onStats */
function SidebarFooter({ settings, onHistory, onStats }) {
  return (
    <div className="psb-foot" role="group" aria-label={OMP_TR("app")}>
      <ToolButton icon="cog" size={15} title={_tbTip("settings", "desktop.settings.open")}
        pressed={settings.active} onClick={settings.onOpen}>
        <span className="psb-foot-label">{OMP_TR("Settings")}</span>
      </ToolButton>
      <span className="pr-fill" />
      <ToolButton icon="clock" size={15} title={_tbTip("conversation history", "desktop.history.open")} onClick={onHistory} />
      <ToolButton icon="cost" size={15} title={_tbTip("usage statistics", "desktop.panel.stats")} onClick={onStats} />
    </div>
  );
}

// ── Composer session pills ────────────────────────────────────────────
// The approvals pill names the tab's running tool approval mode
// (`OMP_APPROVAL_MODE.statusCell`). Yolo as the target turns the glyph to
// `warn` and amber; a change waiting for the turn to end reads
// `running ⇢ target` with the running mode muted.
/** approvals: { cell, onOpen }; profile: ProfileMenu's props */
function SessionPills({ approvals, profile }) {
  const { cell } = approvals;
  const targetColor = cell.warn ? "var(--amber)" : undefined;
  return (
    <>
      <button type="button" className="composer-pill" onClick={approvals.onOpen}
        title={cell.pending
          ? OMP_TR("approvals — switches to {target} when the agent finishes its turn", { target: OMP_TR(cell.target) })
          : OMP_TR("approvals")}>
        <_TB_Icon name={cell.warn ? "warn" : "check"} size={13} color={targetColor ?? "var(--fg-3)"} />
        <span style={targetColor ? { color: targetColor } : undefined}>
          {cell.pending && <span style={{ color: "var(--fg-4)" }}>{OMP_TR(cell.running)} ⇢ </span>}
          {OMP_TR(cell.target)}
        </span>
      </button>
      {/* Per-tab omp profile — the selector acts on the active tab only. */}
      <span className="composer-profile"><_TB_ProfileMenu {...profile} /></span>
    </>
  );
}

Object.assign(window, { HeaderStart, HeaderEnd, PanelRail, SidebarFooter, SessionPills });
