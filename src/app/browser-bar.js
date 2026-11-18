// browser-bar.js — pure helpers of the browser bar and tab strip
(function (global) {
  "use strict";

  /**
   * The "..." more menu rows and their disabled states based on the active tab state.
   * @param {{ url?: string }} state
   * @returns {{ id: string, label: string, disabled: boolean }[]}
   */
  function moreMenu(state) {
    const url = state?.url || "";
    const isSpecial = url.startsWith("about:") || url.startsWith("data:");
    return [
      {
        id: "openExternal",
        label: "Open in system browser",
        disabled: !url || isSpecial,
      },
      {
        id: "copyAddress",
        label: "Copy page address",
        disabled: !url,
      },
      {
        id: "reload",
        label: "Reload",
        disabled: !url,
      },
      {
        id: "stopBrowser",
        label: "Stop browser",
        disabled: false,
      },
    ];
  }

  /**
   * Decide between reload and stop button based on loading status.
   * @param {{ loading?: boolean }} state
   * @returns {{ icon: string, label: string, action: "stop" | "reload" }}
   */
  function loadButton(state) {
    if (state?.loading) {
      return { icon: "close", label: "stop loading", action: "stop" };
    }
    return { icon: "refresh", label: "reload", action: "reload" };
  }

  global.OMP_BROWSER_BAR = Object.freeze({
    moreMenu,
    loadButton,
  });
})(typeof window !== "undefined" ? window : globalThis);
