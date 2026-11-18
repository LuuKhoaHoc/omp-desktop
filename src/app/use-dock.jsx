/* use-dock.jsx — hook for unified dock tabs
   (coordinates web page tabs and first-party tool tabs in the dock). */

const { OMP_DOCK_TABS: _UD_TABS } = window;

function useDock({ browser, openSide, activeSessionId }) {
  // sid -> { activeId, tools }
  const [store, setStore] = React.useState({});
  const sid = activeSessionId || "default";

  const dockState = React.useMemo(() => {
    return _UD_TABS.initial(store[sid]);
  }, [store, sid]);

  const updateState = React.useCallback((fn) => {
    setStore((prev) => {
      const cur = _UD_TABS.initial(prev[sid]);
      const next = fn(cur);
      return { ...prev, [sid]: next };
    });
  }, [sid]);

  const strip = React.useMemo(() => {
    return _UD_TABS.strip(dockState, browser?.tabs || []);
  }, [dockState, browser?.tabs]);

  const activeParsed = React.useMemo(() => {
    return _UD_TABS.parseTabId(dockState.activeId);
  }, [dockState.activeId]);

  const activeKind = activeParsed.kind; // "page" | "tool"
  const activeTarget = activeParsed.target;

  const openTool = React.useCallback((toolId) => {
    updateState((cur) => _UD_TABS.openTool(cur, toolId));
    openSide?.("browser");
  }, [updateState, openSide]);

  const closeTool = React.useCallback((toolId) => {
    const activePage = browser?.tabs?.find((t) => t.active)?.targetId;
    const fallback = activePage ? "page:" + activePage : null;
    updateState((cur) => _UD_TABS.closeTool(cur, toolId, fallback));
  }, [updateState, browser?.tabs]);

  const activate = React.useCallback((tabId) => {
    updateState((cur) => _UD_TABS.activate(cur, tabId));
    if (tabId.startsWith("page:")) {
      browser?.activateTab?.(tabId.slice(5));
    }
  }, [updateState, browser]);

  const showPage = React.useCallback((targetId) => {
    activate("page:" + targetId);
  }, [activate]);

  const newTab = React.useCallback(() => {
    updateState((cur) => ({ ...cur, activeId: null }));
    browser?.newTab?.();
    openSide?.("browser");
  }, [updateState, browser, openSide]);

  return {
    state: dockState,
    strip,
    activeKind,
    activeTarget,
    openTool,
    closeTool,
    activate,
    showPage,
    newTab,
  };
}

window.useDock = useDock;
