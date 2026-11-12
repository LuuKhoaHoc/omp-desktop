#!/usr/bin/env node
// Regression script for per-OS platform detection (src/app/platform.js),
// WindowChrome rendering (src/design/chrome.jsx), Tauri chrome listener
// wiring (src/live.js _setupWindowChrome), and OS/keymap-aware paletteTip
// hints (src/live.js DEFAULT_DATA.microcopy.paletteTip & src/design/composer.jsx).
// Run: node tests/test-platform.mjs  (or: npm run test:platform)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const Babel = require(join(root, "src/babel.min.js"));
const source = (rel) => readFileSync(join(root, rel), "utf8");

let passed = 0;
function check(label, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`FAILED: ${label}`);
    throw err;
  }
  passed++;
}

const platformWin = {};
new Function("window", source("src/app/platform.js"))(platformWin);
const P = platformWin.OMP_PLATFORM;

// ── 1. OS detection & windowControlsKind ───────────────────────────────────

check("detectOs: identifies Windows from userAgentData, platform, and userAgent", () => {
  assert.equal(P.detectOs({ userAgentData: { platform: "Windows" } }), "windows");
  assert.equal(P.detectOs({ platform: "Win32", userAgent: "" }), "windows");
  assert.equal(P.detectOs({ platform: "Win64", userAgent: "" }), "windows");
  assert.equal(P.detectOs({ platform: "", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }), "windows");
});

check("detectOs: identifies macOS without misclassifying iOS/iPadOS", () => {
  assert.equal(P.detectOs({ userAgentData: { platform: "macOS" } }), "macos");
  assert.equal(P.detectOs({ platform: "MacIntel", userAgent: "" }), "macos");
  assert.equal(P.detectOs({ platform: "", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" }), "macos");
  assert.equal(P.detectOs({ platform: "iPhone", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" }), "other");
  assert.equal(P.detectOs({ platform: "", userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)" }), "other");
});

check("detectOs: identifies Linux (X11 and Wayland) without misclassifying Android", () => {
  assert.equal(P.detectOs({ userAgentData: { platform: "Linux" } }), "linux");
  assert.equal(P.detectOs({ platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15" }), "linux");
  assert.equal(P.detectOs({ platform: "Linux aarch64", userAgent: "Mozilla/5.0 (Wayland; Linux aarch64)" }), "linux");
  assert.equal(P.detectOs({ userAgentData: { platform: "" }, platform: "Linux x86_64" }), "linux");
  assert.equal(P.detectOs({ platform: "Linux armv8l", userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)" }), "other");
  assert.equal(P.detectOs(null), "other");
  assert.equal(P.detectOs({}), "other");
});

check("windowControlsKind: maps each OS to its window-control mode", () => {
  assert.equal(P.windowControlsKind("macos"), "macos");
  assert.equal(P.windowControlsKind("windows"), "windows");
  assert.equal(P.windowControlsKind("linux"), "none");
  assert.equal(P.windowControlsKind("other"), "none");
});

check("defaultBridgeHint, paletteTipFor, and isDefaultPaletteTip handle per-OS defaults and custom tips", () => {
  assert.equal(P.defaultBridgeHint("macos"), "⌘K");
  assert.equal(P.defaultBridgeHint("linux"), "Ctrl+K");
  assert.equal(P.defaultBridgeHint("windows"), "Ctrl+K");
  assert.equal(P.defaultBridgeHint("other"), "Ctrl+K");

  assert.equal(P.paletteTipFor("Ctrl+K"), "type / to give orders · Ctrl+K opens the bridge");
  assert.equal(P.paletteTipFor("Cmd+K"), "type / to give orders · Cmd+K opens the bridge");
  assert.equal(P.paletteTipFor(""), "type / to give orders");

  assert.equal(P.isDefaultPaletteTip("type / to give orders · ⌘K opens the bridge"), true);
  assert.equal(P.isDefaultPaletteTip("type / to give orders · Ctrl+K opens the bridge"), true);
  assert.equal(P.isDefaultPaletteTip("type / to give orders"), true);
  assert.equal(P.isDefaultPaletteTip(""), true);
  assert.equal(P.isDefaultPaletteTip("custom prompt hint"), false);
});
// ── 2. Real chrome.jsx compilation & WindowChrome render per OS ────────────

const compiledChrome = Babel.transform(source("src/design/chrome.jsx"), {
  filename: "src/design/chrome.jsx",
  presets: ["react", "env"],
  plugins: ["transform-class-properties", "transform-object-rest-spread", "transform-flow-strip-types"],
  targets: { browsers: undefined },
  sourceMaps: false,
}).code;

const reactSrc = source("src/react.development.js");

function collectClasses(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) collectClasses(item, out);
    return out;
  }
  if (node.props) {
    if (typeof node.props.className === "string") {
      for (const cls of node.props.className.split(/\s+/).filter(Boolean)) out.push(cls);
    }
    if (node.props.children !== undefined) collectClasses(node.props.children, out);
  }
  return out;
}

function renderChromeForNavigator(navigatorStub) {
  const ctx = { navigator: navigatorStub, window: {} };
  ctx.window.navigator = navigatorStub;
  ctx.window.OMP_TR = (s) => s;
  ctx.window.OMP_PROJECT_NAV = { groupTabs: () => [], tabDigits: () => new Map() };
  ctx.window.DEFAULT_PROFILE_ID = "default";
  for (const key of ["Icon", "TokenGauge", "ActivityRadar", "Sparkline", "TOOL_META", "SubagentRailCard", "TabCluster", "TabRunDot", "TabLabel", "TabNumber", "tabClickProps", "RenameField", "BranchMenu"]) {
    ctx.window[key] = () => null;
  }
  ctx.OMP_TR = ctx.window.OMP_TR;
  runInNewContext(reactSrc, ctx);
  ctx.React = ctx.window.React;
  runInNewContext(source("src/app/platform.js"), ctx);
  runInNewContext(compiledChrome, ctx);

  const tree = ctx.window.WindowChrome({
    project: { id: "proj-1", name: "omp-desktop" },
    start: ctx.React.createElement("div", { className: "hd-cluster" }),
    end: ctx.React.createElement("div", { className: "hd-end" }),
  });
  return collectClasses(tree);
}

check("WindowChrome renders traffic lights only on macOS", () => {
  const classes = renderChromeForNavigator({ platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" });
  assert.ok(classes.includes("chrome-lights"), "macOS renders .chrome-lights");
  assert.ok(!classes.includes("win-controls"), "macOS omits .win-controls");
  assert.ok(classes.includes("hd-cluster"));
  assert.ok(classes.includes("hd-end"));
});

check("WindowChrome renders Win11 controls only on Windows", () => {
  const classes = renderChromeForNavigator({ platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });
  assert.ok(classes.includes("win-controls"), "Windows renders .win-controls");
  assert.ok(classes.includes("win-min"));
  assert.ok(classes.includes("win-max"));
  assert.ok(classes.includes("win-close"));
  assert.ok(!classes.includes("chrome-lights"), "Windows omits .chrome-lights");
});

check("WindowChrome omits both macOS lights and Windows buttons on Linux and unknown hosts", () => {
  for (const nav of [
    { platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15" },
    { platform: "Linux aarch64", userAgent: "Mozilla/5.0 (Wayland; Linux aarch64)" },
    undefined,
  ]) {
    const classes = renderChromeForNavigator(nav);
    assert.ok(!classes.includes("chrome-lights"), "Linux/unknown must not render macOS .chrome-lights");
    assert.ok(!classes.includes("win-controls"), "Linux/unknown must not render .win-controls");
    assert.ok(classes.includes("hd-cluster"), "header start stays rendered");
    assert.ok(classes.includes("hd-end"), "header end stays rendered");
  }
});

// ── 3. Real live.js _setupWindowChrome click wiring per OS ─────────────────

function testLiveChrome(navigatorStub, { withKeymap = false } = {}) {
  const listeners = new Map();
  const winActions = { minimize: 0, maximize: 0, unmaximize: 0, startDragging: 0, close: 0 };
  const doc = {
    readyState: "complete",
    documentElement: { classList: { add() {} } },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
  };
  const winObj = {
    navigator: navigatorStub,
    OMP_SLASH: { LOCAL_COMMANDS: [] },
    OMP_SUBAGENTS: { emptySubagents: () => ({}) },
    OMP_QUEUE: { EMPTY_QUEUE: {} },
    OMP_GOAL: { UNKNOWN: {} },
    OMP_EXT_WIDGETS: { EMPTY: {} },
    OMP_TRANSCRIPT: {},
    OMP_PROMPT_HISTORY: { DEFAULT_LIMIT: 100 },
    OMP_SESSION_PREFS: {
      fromTweaks: () => ({}),
      closeGuardArmed: () => false,
      quitConfirm: () => null,
    },
    OMP_TWEAKS_STORE: { read: () => ({}) },
    OMP_APPROVAL_MODE: { DEFAULT: { defaultMode: "prompt", projects: {} }, fromPayload: (x) => x },
    OMP_TURN_STATUS: {},
    INTENT_FRAMING: () => "",
    timeNow: () => "00:00",
    __TAURI__: {
      core: { async invoke() { return []; } },
      event: { async listen() { return () => {}; } },
      window: {
        getCurrentWindow: () => ({
          minimize: () => { winActions.minimize++; },
          isMaximized: async () => false,
          maximize: () => { winActions.maximize++; },
          unmaximize: () => { winActions.unmaximize++; },
          close: async () => { winActions.close++; },
          startDragging: async () => { winActions.startDragging++; },
        }),
      },
    },
  };
  const ctx = {
    window: winObj,
    navigator: navigatorStub,
    document: doc,
    console: { log() {}, error() {} },
    setTimeout,
    clearTimeout,
  };
  runInNewContext(source("src/app/platform.js"), ctx);
  if (withKeymap) runInNewContext(source("src/app/keymap.js"), ctx);
  runInNewContext(source("src/app/live-voice.js"), ctx);
  runInNewContext(source("src/live.js"), ctx);

  const click = (classes) => {
    const target = {
      classList: { contains: (c) => classes.includes(c) },
      closest: (sel) => {
        const parts = sel.split(",").map((s) => s.trim());
        const hit = parts.some((p) => p.startsWith(".") && classes.includes(p.slice(1)));
        return hit ? target : null;
      },
    };
    for (const fn of listeners.get("click") ?? []) fn({ target });
  };
  const mousedownChrome = () => {
    const target = {
      closest: (sel) => (sel === ".chrome" ? target : null),
    };
    for (const fn of listeners.get("mousedown") ?? []) fn({ target });
  };

  return { click, mousedownChrome, winActions, window: winObj };
}

check("live.js _setupWindowChrome binds traffic lights only on macOS, Win buttons only on Windows, and neither on Linux", () => {
  const mac = testLiveChrome({ platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)" });
  mac.click(["light", "amber"]);
  mac.click(["win-min"]);
  assert.equal(mac.winActions.minimize, 1, "macOS clicks .light.amber and ignores .win-min");

  const win = testLiveChrome({ platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });
  win.click(["win-min"]);
  win.click(["light", "amber"]);
  assert.equal(win.winActions.minimize, 1, "Windows clicks .win-min and ignores .light.amber");

  const linux = testLiveChrome({ platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux x86_64)" });
  linux.click(["light", "amber"]);
  linux.click(["light", "red"]);
  linux.click(["win-min"]);
  linux.click(["win-close"]);
  linux.mousedownChrome();
  assert.equal(linux.winActions.minimize, 0, "Linux ignores both .light and .win-min");
  assert.equal(linux.winActions.close, 0, "Linux ignores both .light.red and .win-close");
  assert.equal(linux.winActions.startDragging, 1, "Linux still supports .chrome drag region");
});
const compiledComposer = Babel.transform(source("src/design/composer.jsx"), {
  filename: "src/design/composer.jsx",
  presets: ["react", "env"],
  plugins: ["transform-class-properties", "transform-object-rest-spread", "transform-flow-strip-types"],
  targets: { browsers: undefined },
  sourceMaps: false,
}).code;

function findNodes(node, pred, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) findNodes(item, pred, out);
    return out;
  }
  if (pred(node)) out.push(node);
  if (node.props && node.props.children !== undefined) findNodes(node.props.children, pred, out);
  if (Array.isArray(node.children)) findNodes(node.children, pred, out);
  return out;
}

function textContent(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (typeof node === "object") {
    return textContent(node.props?.children) + textContent(node.children);
  }
  return "";
}

function renderComposerSuite(navigatorStub, { locale = "en", customBindings = null, microcopyOverride } = {}) {
  const slots = [];
  let slotIdx = 0;
  const ReactStub = {
    Fragment: "fragment",
    createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), children }, children }),
    useState(initial) {
      const k = slotIdx++;
      if (!(k in slots)) slots[k] = { value: typeof initial === "function" ? initial() : initial };
      const s = slots[k];
      return [s.value, (v) => { s.value = typeof v === "function" ? v(s.value) : v; }];
    },
    useRef(initial) {
      const k = slotIdx++;
      if (!(k in slots)) slots[k] = { current: initial };
      return slots[k];
    },
    useEffect() {},
    useLayoutEffect() {},
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
  };
  const noop = () => {};
  const stubComp = () => null;
  const doc = {
    readyState: "complete",
    documentElement: { classList: { add: noop } },
    addEventListener: noop,
  };
  const winObj = {
    navigator: { languages: [locale], language: locale, ...navigatorStub },
    localStorage: { getItem: () => null },
    useActiveRowIntoView: noop,
    Icon: stubComp,
    ComposerHighlight: stubComp,
    QueueStrip: stubComp,
    QuoteChips: stubComp,
    BrowserChips: stubComp,
    PasteStrip: stubComp,
    VoiceSpectrum: stubComp,
    VoiceModeButton: stubComp,
    ThinkingMenu: stubComp,
    FastModePill: stubComp,
    TabRunDot: stubComp,
    MentionMenu: stubComp,
    OMP_MENTIONS: { parseMentionQuery: () => null, applyMention: noop },
    OMP_IMAGES: {
      prepareImage: noop,
      imageFilesFromTransfer: () => [],
      imageFilesFromClipboardAsync: async () => [],
      toDataUrl: async () => "",
      MAX_ATTACHMENTS: 4,
    },
    OMP_SLASH: {
      LOCAL_COMMANDS: [],
      isDesktop: () => false,
      slashMenu: () => [],
      midPromptSlashToken: () => null,
      skillMenu: () => [],
      matchesQuery: () => true,
      insertText: (s) => s,
    },
    OMP_SESSION_UI: {
      entryOf: (_m, _id, idle) => idle,
      updateEntry: (m) => m,
      pruneEntries: (m) => m,
      DRAFT_IDLE: { text: "", attachments: [], pendingImages: 0, collapsed: [], historyNav: null },
      recallInDraft: (d) => d,
      normalizePaste: (s) => s,
      shouldCollapsePaste: () => false,
      collapsePaste: (d) => d,
      pastesIn: () => [],
      expandPastes: (d) => d,
      inlinePaste: (d) => d,
    },
    OMP_QUEUE: { EMPTY_QUEUE: {}, restoredDraft: () => "" },
    OMP_SUBAGENTS: { emptySubagents: () => ({}) },
    OMP_GOAL: { UNKNOWN: {} },
    OMP_EXT_WIDGETS: { EMPTY: {} },
    OMP_TRANSCRIPT: {},
    OMP_PROMPT_HISTORY: { DEFAULT_LIMIT: 100 },
    OMP_SESSION_PREFS: {
      fromTweaks: () => ({}),
      closeGuardArmed: () => false,
      quitConfirm: () => null,
    },
    OMP_TWEAKS_STORE: { read: () => ({}) },
    OMP_APPROVAL_MODE: { DEFAULT: { defaultMode: "prompt", projects: {} }, fromPayload: (x) => x },
    OMP_TURN_STATUS: {},
    OMP_FILE_COMMENTS: { location: () => "", chipLabel: () => "" },
    OMP_BROWSER: { droppedScreenshots: () => 0 },
    INTENT_FRAMING: () => "",
    timeNow: () => "00:00",
  };
  const ctx = {
    window: winObj,
    navigator: winObj.navigator,
    document: doc,
    React: ReactStub,
    Icon: stubComp,
    LiveVoicePanel: stubComp,
    DictationPanel: stubComp,
    ReadAloudPanel: stubComp,
    ComposerHighlight: stubComp,
    QueueStrip: stubComp,
    QuoteChips: stubComp,
    BrowserChips: stubComp,
    PasteStrip: stubComp,
    VoiceSpectrum: stubComp,
    VoiceModeButton: stubComp,
    ThinkingMenu: stubComp,
    FastModePill: stubComp,
    TabRunDot: stubComp,
    MentionMenu: stubComp,
    console: { log: noop, error: noop },
    setTimeout,
    clearTimeout,
  };
  runInNewContext(source("src/app/i18n.js"), ctx);
  runInNewContext(source("src/app/i18n-zh.js"), ctx);
  winObj.OMP_I18N.set(locale);
  ctx.OMP_TR = winObj.OMP_TR;
  ctx.OMP_I18N = winObj.OMP_I18N;
  runInNewContext(source("src/app/platform.js"), ctx);
  runInNewContext(source("src/app/keymap.js"), ctx);
  if (customBindings !== null) {
    winObj.OMP_KEYMAP.setResolved(winObj.OMP_KEYMAP.resolve(winObj.OMP_KEYMAP.KEYMAP_ACTIONS, customBindings));
  }
  runInNewContext(source("src/app/live-voice.js"), ctx);
  runInNewContext(source("src/live.js"), ctx);
  runInNewContext(compiledComposer, ctx);

  const microcopy = microcopyOverride !== undefined ? microcopyOverride : winObj.OMP_DATA.microcopy;
  if (microcopyOverride !== undefined) winObj.OMP_DATA.microcopy = microcopy;
  slotIdx = 0;
  const composerTree = winObj.Composer({
    sessionId: "tab-1",
    sessionIds: ["tab-1"],
    microcopy,
    currentModel: { id: "m1", name: "Model" },
    queue: [],
  });
  const textarea = findNodes(composerTree, (n) => n.type === "textarea")[0];
  slots.length = 0;
  slotIdx = 0;
  const bridgeTree = winObj.CommandBridge({
    open: true,
    onClose: noop,
    onPick: noop,
    onPickModel: noop,
    currentModelId: "m1",
    profileId: "default",
    loginProviders: null,
  });
  const bridgeFoot = findNodes(bridgeTree, (n) => typeof n.props?.className === "string" && n.props.className.includes("bridge-foot"))[0];

  return {
    livePaletteTip: winObj.OMP_DATA.microcopy.paletteTip,
    placeholder: textarea?.props?.placeholder ?? "",
    bridgeFooter: textContent(bridgeFoot),
  };
}

check("live.js DEFAULT_DATA.microcopy.paletteTip matches the host OS and keymap", () => {
  const linux = testLiveChrome({ platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux x86_64)" }, { withKeymap: true });
  assert.equal(linux.window.OMP_DATA.microcopy.paletteTip, "type / to give orders · Ctrl+K opens the bridge");

  const win = testLiveChrome({ platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }, { withKeymap: true });
  assert.equal(win.window.OMP_DATA.microcopy.paletteTip, "type / to give orders · Ctrl+K opens the bridge");

  const macWithKeymap = testLiveChrome({ platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)" }, { withKeymap: true });
  assert.equal(macWithKeymap.window.OMP_DATA.microcopy.paletteTip, "type / to give orders · Cmd+K opens the bridge");

  const macFallback = testLiveChrome({ platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)" }, { withKeymap: false });
  assert.equal(macFallback.window.OMP_DATA.microcopy.paletteTip, "type / to give orders · ⌘K opens the bridge");
});

check("Composer placeholder and CommandBridge footer follow OS, custom rebinds, unbinding, custom overrides, and i18n", () => {
  const linux = renderComposerSuite({ platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux x86_64)" });
  assert.equal(linux.placeholder, "type / to give orders · Ctrl+K opens the bridge");
  assert.match(linux.bridgeFooter, /type \/ to give orders · Ctrl\+K opens the bridge$/);

  const windows = renderComposerSuite({ platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });
  assert.equal(windows.placeholder, "type / to give orders · Ctrl+K opens the bridge");
  assert.match(windows.bridgeFooter, /type \/ to give orders · Ctrl\+K opens the bridge$/);

  const mac = renderComposerSuite({ platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)" });
  assert.equal(mac.placeholder, "type / to give orders · Cmd+K opens the bridge");
  assert.match(mac.bridgeFooter, /type \/ to give orders · Cmd\+K opens the bridge$/);

  const rebound = renderComposerSuite(
    { platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux x86_64)" },
    { customBindings: { "desktop.commands.open": ["alt+p"] } },
  );
  assert.equal(rebound.placeholder, "type / to give orders · Alt+P opens the bridge");
  assert.match(rebound.bridgeFooter, /type \/ to give orders · Alt\+P opens the bridge$/);

  const unbound = renderComposerSuite(
    { platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux x86_64)" },
    { customBindings: { "desktop.commands.open": [] } },
  );
  assert.equal(unbound.placeholder, "type / to give orders");
  assert.ok(!unbound.bridgeFooter.includes("opens the bridge"), "unbound shortcut omits shortcut clause");
  assert.match(unbound.bridgeFooter, /type \/ to give orders$/);

  const zh = renderComposerSuite(
    { platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux x86_64)" },
    { locale: "zh" },
  );
  assert.equal(zh.placeholder, "输入 / 下达指令 · Ctrl+K 打开命令桥");
  assert.match(zh.bridgeFooter, /输入 \/ 下达指令 · Ctrl\+K 打开命令桥$/);

  const custom = renderComposerSuite(
    { platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux x86_64)" },
    { microcopyOverride: { paletteTip: "Ask anything" } },
  );
  assert.equal(custom.placeholder, "Ask anything");
  assert.match(custom.bridgeFooter, /Ask anything$/);
});

check("src/index.html loads app/platform.js before design/chrome.jsx, design/composer.jsx, and src/live.js", () => {
  const html = source("src/index.html");
  const platformIdx = html.indexOf('src="app/platform.js"');
  const chromeIdx = html.indexOf('src="design/chrome.jsx"');
  const composerIdx = html.indexOf('src="design/composer.jsx"');
  const liveIdx = html.indexOf('src="live.js"');
  assert.ok(platformIdx >= 0, "app/platform.js tag exists");
  assert.ok(platformIdx < chromeIdx, "app/platform.js precedes design/chrome.jsx");
  assert.ok(platformIdx < composerIdx, "app/platform.js precedes design/composer.jsx");
  assert.ok(platformIdx < liveIdx, "app/platform.js precedes src/live.js");
});

console.log(`test-platform: ${passed} checks passed`);
