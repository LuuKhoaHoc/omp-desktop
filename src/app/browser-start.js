/* browser-start.js — pure model for the browser start page
   (isStart, classify omnibox input, standard shortcut tiles, pickResult).
   Free of DOM and React; tested by tests/test-browser-start.mjs. */

(function () {
  "use strict";

  const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
  const LOCALHOST_RE = /^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i;
  const DOMAIN_LIKE_RE = /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d+)?(\/.*)?$/;

  /**
   * Whether the URL should present the start page rather than a web canvas.
   * Empty string and "about:blank" are the blank slate.
   */
  function isStart(url) {
    if (!url) return true;
    const u = String(url).trim();
    return u === "" || u === "about:blank";
  }

  /**
   * Classify user input in the start page omnibox.
   * Returns:
   *   - { kind: "empty", target: "" }
   *   - { kind: "file", query: string, target: string }
   *   - { kind: "url", target: string }
   *   - { kind: "search", query: string, target: string }
   */
  function classify(input) {
    if (input == null) return { kind: "empty", target: "" };
    const raw = String(input).trim();
    if (!raw) return { kind: "empty", target: "" };

    if (raw.startsWith("@")) {
      const q = raw.slice(1).trim();
      return { kind: "file", query: q, target: raw };
    }

    if (raw.startsWith("/")) {
      return { kind: "file", query: raw, target: raw };
    }

    if (URL_SCHEME_RE.test(raw)) {
      return { kind: "url", target: raw };
    }

    if (LOCALHOST_RE.test(raw)) {
      return { kind: "url", target: "http://" + raw };
    }

    // Has no spaces and looks like a hostname (example.com, vite.dev/guide)
    if (!raw.includes(" ") && DOMAIN_LIKE_RE.test(raw)) {
      return { kind: "url", target: "https://" + raw };
    }

    // Default to search query
    return {
      kind: "search",
      query: raw,
      target: "https://www.google.com/search?q=" + encodeURIComponent(raw),
    };
  }

  /**
   * Standard shortcut tiles shown on the blank start page.
   */
  function tiles() {
    return [
      { id: "terminal", icon: "terminal", label: "Open Terminal", desc: "Per-tab shell" },
      { id: "changes", icon: "branch", label: "Inspect Changes", desc: "Diffs & review" },
      { id: "files", icon: "file", label: "Browse Files", desc: "Project tree & marks" },
    ];
  }

  /**
   * Dispatch a classified selection to navigation or tool handlers.
   */
  function pickResult(result, handlers = {}) {
    if (!result) return false;
    if (result.kind === "url" || result.kind === "search") {
      handlers.navigate?.(result.target);
      return true;
    }
    if (result.kind === "file") {
      if (handlers.openFile) {
        handlers.openFile(result.target);
      } else {
        handlers.navigate?.(result.target);
      }
      return true;
    }
    if (result.kind === "tool") {
      handlers.openTool?.(result.target);
      return true;
    }
    return false;
  }

  const api = { isStart, classify, tiles, pickResult };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.OMP_BROWSER_START = api;
  }
})();
