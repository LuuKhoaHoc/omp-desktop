// Platform detection and per-OS window-controls policy.
// Exposes `window.OMP_PLATFORM`; wrapped as an IIFE per the project rule
// for plain <script> tags (see AGENTS.md "IIFE rule").
//
// Dependency-free; loads in src/index.html before design/chrome.jsx and
// src/live.js so both agree on which window controls (if any) exist.
(function () {
  "use strict";

  /**
   * Map one platform/UA hint string to a canonical OS bucket, or `null`
   * when the string gives no usable signal.
   * @param {unknown} hint
   * @returns {"windows"|"macos"|"linux"|"other"|null}
   */
  function classifyHint(hint) {
    if (typeof hint !== "string") return null;
    const s = hint.trim();
    if (!s) return null;
    if (/^win|\bwindows\b/i.test(s)) return "windows";
    // Mobile/tablet UAs often mention "like Mac OS X" or "Linux".
    if (/\b(?:iphone|ipad|ipod|android)\b/i.test(s)) return "other";
    if (/^mac|\bmacintosh\b|\bmac\s?os\b/i.test(s)) return "macos";
    if (/\blinux\b|\bx11\b|\bwayland\b/i.test(s)) return "linux";
    return null;
  }

  /**
   * Detect the host desktop OS from a `Navigator`-like object.
   * Accepts an explicit argument so tests can probe every OS without
   * mutating global `navigator`.
   * @param {{ userAgentData?: { platform?: string }, platform?: string, userAgent?: string } | null | undefined} [nav]
   * @returns {"windows"|"macos"|"linux"|"other"}
   */
  function detectOs(nav = typeof navigator !== "undefined" ? navigator : null) {
    if (!nav || typeof nav !== "object") return "other";
    // Android WebViews report `navigator.platform` as "Linux armv8l".
    if (/\bandroid\b/i.test(typeof nav.userAgent === "string" ? nav.userAgent : "")) {
      return "other";
    }
    return (
      classifyHint(nav.userAgentData?.platform) ??
      classifyHint(nav.platform) ??
      classifyHint(nav.userAgent) ??
      "other"
    );
  }

  /**
   * Which in-app window controls to render and wire:
   * - `"macos"`: left-side traffic lights (tauri.conf.json `decorations: false`)
   * - `"windows"`: right-side Win11 controls (tauri.conf.json `decorations: false`)
   * - `"none"`: Linux uses native OS decorations (tauri.linux.conf.json `decorations: true`);
   *   unknown environments also omit fake OS buttons.
   * @param {"windows"|"macos"|"linux"|"other"} [os]
   * @returns {"macos"|"windows"|"none"}
   */
  function windowControlsKind(os = detectOs()) {
    if (os === "macos") return "macos";
    if (os === "windows") return "windows";
    return "none";
  }

  const DEFAULT_PALETTE_TIP_RE = /^type \/ to give orders(?: · .+ opens the bridge)?$/;

  /**
   * Fallback shortcut label for opening the command bridge when
   * `OMP_KEYMAP` has not been loaded (macOS uses `"⌘K"`, Linux/Windows
   * use `"Ctrl+K"`).
   * @param {"windows"|"macos"|"linux"|"other"} [os]
   * @returns {string}
   */
  function defaultBridgeHint(os = detectOs()) {
    return os === "macos" ? "⌘K" : "Ctrl+K";
  }

  /**
   * Whether `tip` is an uncustomized built-in `microcopy.paletteTip` string
   * (so renderers substitute the live keybinding and i18n template rather
   * than showing a hardcoded macOS `⌘K` on Linux/Windows).
   * @param {unknown} tip
   * @returns {boolean}
   */
  function isDefaultPaletteTip(tip) {
    return !tip || (typeof tip === "string" && DEFAULT_PALETTE_TIP_RE.test(tip));
  }

  /**
   * Plain English `microcopy.paletteTip` for a given command-bridge chord
   * (or the short tip when the shortcut is unbound).
   * @param {string | null | undefined} hintKey
   * @returns {string}
   */
  function paletteTipFor(hintKey) {
    return hintKey
      ? `type / to give orders · ${hintKey} opens the bridge`
      : "type / to give orders";
  }

  window.OMP_PLATFORM = {
    detectOs,
    windowControlsKind,
    defaultBridgeHint,
    isDefaultPaletteTip,
    paletteTipFor,
  };
})();
