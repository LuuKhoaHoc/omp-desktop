/* browser-toolbar.jsx — the browser panel's tab strip and control bar
   (browser-panel.jsx renders it). `ui` is app/use-browser.jsx's result.
   Page tabs wear the project tab bar's look (`.tab`, `.tab-name`,
   `.tab-close`; layout/chrome.css), sized down for the panel in
   layout/browser.css, which also styles the `+` (`.tab-add`). The name is
   a button so the keyboard reaches it. */

const { Icon: _BT_Icon, OMP_BROWSER: _BT, OMP_BROWSER_BAR: _BT_BAR, BrowserMoreMenu: _BT_More } = window;

function BrowserTabs({ ui }) {
  const tabs = ui.dock?.strip || ui.tabs;
  return (
    <div className="browser-tabs">
      <div className="browser-tabs-scroll">
        {tabs.map((t) => {
          if (t.kind === "tool") {
            return (
              <div key={t.id} className={`tab${t.active ? " active" : ""}`} title={OMP_TR(t.title)} onClick={() => ui.dock?.activate(t.id)}>
                <span className="tab-icon-wrap" aria-hidden="true"><_BT_Icon name={t.icon} size={12} /></span>
                <button type="button" className="tab-name" aria-current={t.active ? "page" : undefined}>{OMP_TR(t.title)}</button>
                <button type="button" className="tab-close" aria-label={OMP_TR("close {name}", { name: t.title })}
                  onClick={(e) => { e.stopPropagation(); ui.dock?.closeTool(t.toolId); }}>
                  <_BT_Icon name="close" size={9} />
                </button>
              </div>
            );
          }

          const name = t.title || t.url || "new tab";
          const loading = t.active && ui.state?.loading;
          const targetId = t.targetId || (t.id ? t.id.replace(/^page:/, "") : "");
          return (
            <div key={t.id || targetId} className={`tab${t.active ? " active" : ""}`} title={t.url || name}
              onClick={() => { if (ui.dock) ui.dock.activate(t.id || `page:${targetId}`); else ui.activateTab(targetId); }}>
              <span className="tab-icon-wrap" aria-hidden="true">
                {loading ? <span className="tab-spinner" /> : t.favicon ? <img className="tab-favicon" src={t.favicon} alt="" width="14" height="14" /> : <_BT_Icon name="web" size={12} />}
              </span>
              <button type="button" className="tab-name" aria-current={t.active ? "page" : undefined}>{name}</button>
              <button type="button" className="tab-close" aria-label={OMP_TR("close {name}", { name })}
                onClick={(e) => { e.stopPropagation(); ui.closeTab(targetId); }}>
                <_BT_Icon name="close" size={9} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="tab-add"
        title={OMP_TR("new tab")}
        aria-label={OMP_TR("new tab")}
        onClick={() => (ui.dock ? ui.dock.newTab() : ui.newTab())}
      >
        <_BT_Icon name="plus" size={11} />
      </button>
      <div className="browser-tabs-actions">
        <button
          type="button"
          className={`tab-action-btn${ui.fullView ? " active" : ""}`}
          title={OMP_TR("browser full view")}
          aria-label={OMP_TR("browser full view")}
          aria-pressed={ui.fullView}
          onClick={() => ui.setFullView(!ui.fullView)}
        >
          <_BT_Icon name="focus" size={13} />
        </button>
        {ui.close && (
          <button
            type="button"
            className="tab-action-btn"
            title={OMP_TR("close panel")}
            aria-label={OMP_TR("close panel")}
            onClick={() => ui.close()}
          >
            <_BT_Icon name="close" size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

function BrowserToolbar({ ui }) {
  const { state } = ui;
  const [draft, setDraft] = React.useState(null); // null = show the page's address
  const [shake, setShake] = React.useState(false);
  const [moreOpen, setMoreOpen] = React.useState(false);

  const loadBtn = _BT_BAR
    ? _BT_BAR.loadButton(state)
    : { action: "reload", label: "reload", icon: "refresh", disabled: !state.url };

  const submit = (e) => {
    e.preventDefault();
    const url = _BT.normalizeUrl(draft ?? state.url);
    if (!url) { setShake(true); return; }
    setDraft(null);
    ui.navigate(url);
    e.currentTarget.elements.address.blur();
  };

  const onKeyDown = (e) => {
    if (e.key !== "Escape" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    setDraft(null);
    e.currentTarget.blur();
  };

  const isTool = ui.dock?.activeKind === "tool";

  if (isTool) {
    return <BrowserTabs ui={ui} />;
  }

  return (
    <>
      <BrowserTabs ui={ui} />
      <div className="browser-bar">
        <button
          className="btn icon ghost"
          title={OMP_TR("back")}
          aria-label={OMP_TR("back")}
          disabled={!state.canBack}
          onClick={() => ui.history(-1)}
        >
          <_BT_Icon name="back" size={11} />
        </button>
        <button
          className="btn icon ghost"
          title={OMP_TR("forward")}
          aria-label={OMP_TR("forward")}
          disabled={!state.canForward}
          onClick={() => ui.history(1)}
        >
          <_BT_Icon name="arrow" size={11} />
        </button>
        <button
          className="btn icon ghost"
          title={OMP_TR(loadBtn.label)}
          aria-label={OMP_TR(loadBtn.label)}
          disabled={loadBtn.disabled}
          onClick={() => {
            if (loadBtn.action === "stop") ui.stopLoading?.();
            else if (state.url) ui.navigate(state.url);
          }}
        >
          <_BT_Icon name={loadBtn.icon} size={11} />
        </button>
        <button
          type="button"
          className={`browser-pill-btn${ui.annotate ? " active" : ""}`}
          title={OMP_TR("Annotate")}
          aria-label={OMP_TR("Annotate")}
          aria-pressed={ui.annotate}
          disabled={state.status !== "running"}
          onClick={() => ui.setAnnotate(!ui.annotate)}
        >
          <_BT_Icon name="edit" size={12} />
          <span>{OMP_TR("Annotate")}</span>
        </button>
        <form
          className={`browser-address${shake ? " shake" : ""}`}
          onSubmit={submit}
          onAnimationEnd={() => setShake(false)}
        >
          <input
            name="address"
            className="mono"
            value={draft ?? state.url}
            placeholder={OMP_TR("address or localhost:3000")}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={() => setDraft(null)}
            onKeyDown={onKeyDown}
          />
        </form>
        <div className="browser-more-wrap">
          <button
            type="button"
            className="btn icon ghost"
            title={OMP_TR("more options")}
            aria-label={OMP_TR("more options")}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(!moreOpen)}
          >
            <_BT_Icon name="more" size={13} />
          </button>
          {moreOpen && _BT_More && (
            <_BT_More
              state={state}
              onClose={() => setMoreOpen(false)}
              onPick={(id) => {
                if (id === "open_external") {
                  if (state.url) ui.openExternal?.(state.url);
                } else if (id === "copy_url") {
                  if (state.url) navigator.clipboard?.writeText?.(state.url);
                } else if (id === "reload") {
                  if (state.url) ui.navigate(state.url);
                } else if (id === "stop_browser") {
                  ui.stop?.();
                }
              }}
            />
          )}
        </div>
      </div>
    </>
  );
}

Object.assign(window, { BrowserToolbar });
