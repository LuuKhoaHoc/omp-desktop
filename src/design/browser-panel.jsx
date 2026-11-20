/* browser-panel.jsx — the browser panel (docs/architecture/browser.md):
   toolbar, the streamed page on a canvas, status overlay, the
   annotate popover, numbered markers and the page's context menu
   (browser-menu.jsx). `ui` is app/use-browser.jsx's result;
   the canvas is painted and fed input by app/browser-screen.js through
   `ui.viewRef` / `ui.canvasRef`, and the hidden `ui.sinkRef` textarea holds
   the page's keyboard focus (paste, IME and dead keys need an editable
   target). Page coordinates here are CSS px of the shown page (`ui.page`),
   placed as percentages of the view. */

const {
  BrowserToolbar: _BP_Toolbar,
  BrowserMenu: _BP_Menu,
  BrowserStart: _BP_Start,
  TerminalTabViews: _BP_Terminal,
  FilesPanel: _BP_Files,
  GitBrowser: _BP_Git,
  AgentCursor: _BP_Cursor,
  OMP_BROWSER: _BP,
  OMP_BROWSER_START: _BP_START,
} = window;

const _BP_STATUS = {
  starting: "starting browser…",
  stopped: "browser stopped — reload to restart",
  error: "browser unavailable",
};

// Place a page-px point as % of the view.
const _bpPct = (v, whole) => `${(v / whole) * 100}%`;
// The popover's width (layout/browser.css `.browser-popover`); its left
// edge is clamped so the whole box stays inside the view's 8px margins.
const _BP_POP_W = "min(260px, 100% - 16px)";
const _BP_POP_MARGIN = 8; // px, the view margin the popover keeps

function BrowserPopover({ pick, page, failed, onSave, onCancel }) {
  const [text, setText] = React.useState("");
  // The popover's and the view's heights in px, measured before paint and
  // again when either resizes: the vertical placement needs both.
  const ref = React.useRef(null);
  const [size, setSize] = React.useState(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    const view = el?.parentElement;
    if (!el || !view) return undefined;
    const measure = () => setSize((s) => {
      const pop = el.offsetHeight, viewH = view.clientHeight;
      return s && s.pop === pop && s.view === viewH ? s : { pop, view: viewH };
    });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(view);
    return () => ro.disconnect();
  }, []);
  const { rect } = pick;
  const style = { left: `max(8px, min(${_bpPct(rect.x, page.cssW)}, 100% - ${_BP_POP_W} - 8px))`, top: `${_BP_POP_MARGIN}px` };
  // Below the pick, else above it, else pinned inside the view
  // (OMP_BROWSER.popoverTop); the first, unmeasured render is replaced
  // before it paints.
  if (size && size.view > 0) {
    style.top = `${_BP.popoverTop(rect, page.cssH, size.pop / size.view, _BP_POP_MARGIN / size.view) * 100}%`;
  }
  const onKeyDown = (e) => {
    // Escape that ends an IME composition belongs to the IME.
    if (e.key === "Escape" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSave(text);
    }
  };
  return (
    <div className="browser-popover" style={style} ref={ref}>
      <div className="browser-popover-what mono">
        {pick.kind === "area" ? "area" : pick.selector || pick.tag || "element"}
      </div>
      {failed && (
        <div className="browser-popover-note">
          {OMP_TR("Screenshot failed — annotation will be sent without image")}
        </div>
      )}
      <textarea
        autoFocus
        rows={3}
        value={text}
        placeholder={OMP_TR("comment — Enter saves, Shift+Enter new line, Esc cancels")}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

function BrowserPanel({ ui }) {
  const { state, page, pending, chips } = ui;
  // Rust's error text wins whatever the status: a stopped browser says why
  // ("browser connection lost"), a running one reports a failed tab switch
  // or load. While running it is a strip that leaves the page usable.
  const message = state.error || _BP_STATUS[state.status];
  const strip = state.status === "running";
  const retry = state.status === "stopped" || state.status === "error";
  const isTool = ui.dock?.activeKind === "tool";
  const toolId = ui.dock?.activeTarget;
  const showStart = !isTool && _BP_START?.isStart(state.url) && !state.loading && state.status !== "stopped" && state.status !== "error";
  const marked = page && !showStart && !isTool ? chips.filter((c) => c.pick.url === state.url) : [];
  return (
    <section className="browser-panel" aria-label={OMP_TR("browser")}>
      <_BP_Toolbar ui={ui} />
      <div className="browser-body">
        {state.loading && !isTool && <div className="browser-loading" />}
        {isTool && (
          <div className="dock-tool-body">
            {toolId === "terminal" && ui.terminal && _BP_Terminal && (
              <_BP_Terminal tabs={[{ id: ui.activeSessionId }]} active={ui.activeSessionId} terminal={ui.terminal} />
            )}
            {toolId === "files" && ui.files && _BP_Files && (
              <_BP_Files ui={ui.files} canSendNow={ui.canSendNow} onSendNow={ui.onSendNow} onOpenGit={ui.onOpenGit} submitKey={ui.submitKey} />
            )}
            {toolId === "changes" && _BP_Git && (
              <_BP_Git bridge={ui.bridge} embedded={true} onClose={() => ui.dock?.closeTool("changes")} project={ui.project} />
            )}
          </div>
        )}
        <div className={`browser-view${ui.annotate ? " annotating" : ""}`} ref={ui.viewRef} style={{ display: isTool ? "none" : undefined }}>
          <textarea className="browser-sink" ref={ui.sinkRef} aria-label={OMP_TR("page keyboard input")} tabIndex={0}
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} />
          <canvas className="browser-canvas" ref={ui.canvasRef} />
          {showStart && _BP_Start && <_BP_Start ui={ui} onOpenTool={ui.dock?.openTool} />}
          {ui.agentCursor && _BP_Cursor && <_BP_Cursor cursor={ui.agentCursor} page={page} />}
          {marked.map((c) => (
            <span
              key={c.id}
              className="browser-marker"
              style={{ left: _bpPct(c.pick.rect.x, page.cssW), top: _bpPct(c.pick.rect.y, page.cssH) }}
            >
              {c.n}
            </span>
          ))}
          {pending && page && (
            <BrowserPopover key={pending.pick.rect.x + ":" + pending.pick.rect.y} pick={pending.pick} page={page} failed={pending.image === null} onSave={ui.savePending} onCancel={ui.cancelPending} />
          )}
          {ui.menu && <_BP_Menu menu={ui.menu} state={state} onPick={ui.menuPick} onClose={ui.closeMenu} />}
          {message && (
            <div className={`browser-status ${state.status}${state.error ? " failed" : ""}${strip ? " strip" : ""}`}
              role={state.error ? "alert" : "status"}>
              <span>{message}</span>
              {retry && <button className="btn" onClick={ui.restart}>{OMP_TR("reload")}</button>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

Object.assign(window, { BrowserPanel });
