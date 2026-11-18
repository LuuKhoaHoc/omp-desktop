/* dock-tabs.js — pure model for unified dock tabs
   (merging browser web page tabs and first-party tool tabs in the dock).
   Free of DOM and React; tested by tests/test-dock-tabs.mjs. */

(function () {
  "use strict";

  const TOOLS = Object.freeze({
    terminal: Object.freeze({ id: "terminal", title: "Terminal", icon: "terminal" }),
    changes: Object.freeze({ id: "changes", title: "Changes", icon: "branch" }),
    files: Object.freeze({ id: "files", title: "Files", icon: "file" }),
  });

  /**
   * Initial dock tabs state.
   */
  function initial(saved) {
    return {
      activeId: saved?.activeId || null,
      tools: Array.isArray(saved?.tools) ? [...saved.tools] : [],
    };
  }

  /**
   * Tool info for standard dock tools.
   */
  function toolInfo(toolId) {
    return TOOLS[toolId] || { id: toolId, title: toolId, icon: "web" };
  }

  /**
   * Open or activate a tool tab in the dock.
   */
  function openTool(state, toolId) {
    const cur = state || initial();
    const tools = cur.tools.includes(toolId) ? cur.tools : [...cur.tools, toolId];
    return {
      ...cur,
      tools,
      activeId: "tool:" + toolId,
    };
  }

  /**
   * Close a tool tab in the dock. If it was active, switch to another open
   * tool or fall back to fallbackPageId (e.g. "page:<targetId>").
   */
  function closeTool(state, toolId, fallbackPageId) {
    const cur = state || initial();
    const tools = cur.tools.filter((t) => t !== toolId);
    let activeId = cur.activeId;
    if (activeId === "tool:" + toolId) {
      if (tools.length > 0) {
        activeId = "tool:" + tools[tools.length - 1];
      } else {
        activeId = fallbackPageId || null;
      }
    }
    return { ...cur, tools, activeId };
  }

  /**
   * Activate a specific tab (either "page:<targetId>" or "tool:<toolId>").
   */
  function activate(state, tabId) {
    const cur = state || initial();
    return { ...cur, activeId: tabId };
  }

  /**
   * Switch active tab to a web page.
   */
  function showPage(state, targetId) {
    return activate(state, "page:" + targetId);
  }

  /**
   * Parse an active tab ID into its kind ("page" | "tool") and target.
   */
  function parseTabId(tabId) {
    if (!tabId || typeof tabId !== "string") return { kind: "page", target: "" };
    if (tabId.startsWith("tool:")) {
      return { kind: "tool", target: tabId.slice(5) };
    }
    if (tabId.startsWith("page:")) {
      return { kind: "page", target: tabId.slice(5) };
    }
    return { kind: "page", target: tabId };
  }

  /**
   * Merge browser page tabs and dock tools into an ordered tab strip model.
   * browserTabs: [{ targetId, title, url, favicon, active }, ...]
   */
  function strip(state, browserTabs = []) {
    const cur = state || initial();
    const parsedActive = parseTabId(cur.activeId);

    // If activeId is null, the active browser tab wins by default
    const activeIsTool = parsedActive.kind === "tool";

    const pageTabs = (browserTabs || []).map((t) => {
      const id = "page:" + t.targetId;
      const isActive = activeIsTool
        ? cur.activeId === id
        : (cur.activeId === id || (cur.activeId == null && !!t.active));
      return {
        id,
        kind: "page",
        targetId: t.targetId,
        title: t.title || t.url || "new tab",
        url: t.url,
        favicon: t.favicon,
        active: isActive,
      };
    });

    const toolTabs = (cur.tools || []).map((toolId) => {
      const id = "tool:" + toolId;
      const info = toolInfo(toolId);
      return {
        id,
        kind: "tool",
        toolId,
        title: info.title,
        icon: info.icon,
        active: cur.activeId === id,
      };
    });

    return [...pageTabs, ...toolTabs];
  }

  /**
   * Formats display label for a tab.
   */
  function label(tab) {
    if (!tab) return "";
    return tab.title || tab.url || "tab";
  }

  const api = {
    initial,
    toolInfo,
    openTool,
    closeTool,
    activate,
    showPage,
    parseTabId,
    strip,
    label,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.OMP_DOCK_TABS = api;
  }
})();
