---
title: 'feat: Codex-style browser panel (toolbar, start page, unified dock tabs)'
type: feat
status: active
date: 2026-11-18
---

# feat: Codex-style browser panel

## Summary

Make the browser panel look and behave like the Codex desktop browser: a pill toolbar with favicon tabs, a stop button, an inline Annotate button and a `...` menu (Phase 1); a start page with an omnibox and shortcut tiles on a blank tab (Phase 2); one tab strip in the dock that holds browser pages, a terminal, Changes and Files side by side (Phase 3).

The engine does not change: one headless Chromium per desktop tab, CDP over the pipe, pages streamed as JPEG frames to a canvas. This plan is a UI layer on top of it plus three small Rust additions (favicon, stop loading, nothing else).

## Read before coding

1. `AGENTS.md` sections: Frontend load order, Cross-feature invariants, Things easy to break, God-file prevention, Code style, Changelog workflow.
2. `docs/architecture/browser.md` (whole file), `docs/architecture/frontend-load-order.md`, `docs/architecture/terminal.md`, `docs/architecture/file-comments.md`, `docs/architecture/git-browser.md`, `docs/architecture/i18n.md`.
3. Current code this plan builds on:
   - `src/design/browser-toolbar.jsx` (tabs + bar, 88 lines), `src/design/browser-panel.jsx`, `src/design/browser-dock.jsx`, `src/design/browser-menu.jsx`, `src/design/layout/browser.css`
   - `src/app/use-browser.jsx` (hook, 306 lines), `src/app/browser.js` (pure helpers, 433 lines)
   - `src/design/toolbar.jsx:84` `PanelRail`
   - `src/app-live.jsx:92` (`sides`), `:256-267` (`side`, `toggleSide`, `setBrowserOpen`, `setFilesOpen`), `:495-548` (terminal, browser, files hooks), `:1159-1170` (full view, `sideRail`, `usePaneWidths`), `:1271` (stage class), `:1393-1402` (side column render), `:1457-1476` (`PanelRail` props), `:1518` (`GitBrowser` modal)
   - `src-tauri/src/browser/view/{emit.rs,model.rs,core.rs,worker.rs,mod.rs}`, `src-tauri/src/browser/commands.rs`, `src-tauri/src/lib.rs:2089` (command registration)

## Working setup

- Branch `feat/browser-codex-ux` in a new worktree off `origin/develop`. Do not work in `.worktrees/develop`: it has uncommitted Insights / Work changes owned by someone else.
- One commit per unit below. Do not push, do not open an MR; the user does that.
- After every unit: the unit's own test, then `npm test`. After a Rust unit: `cd src-tauri && cargo fmt && cargo test --locked` and the pedantic clippy command from `AGENTS.md` § Commands.

## Scope boundaries

- No change to Chromium launch flags, the broker, the proxy or the frame format. Never add `--remote-debugging-port`.
- Pages still never load in the app webview. The start page is a React overlay, not a page.
- No web search from the omnibox: text that is neither a URL nor a file match does nothing (shake). 
- No "Side chat" tile: omp-desktop has no equivalent. Tiles are Terminal, Changes, Files.
- The right `PanelRail`, the conversation tree, Work, Insights, the ambient rail and the bottom terminal panel keep working as today.
- Dock tool tabs are not persisted across app restarts (same as the fork's terminal tabs).
- UI strings stay English source strings through `OMP_TR`, with a `src/app/i18n-zh.js` entry each. The Vietnamese labels in the reference screenshots are Codex's locale, not a requirement.

## Hard constraints (repo invariants that bite here)

- **Load order:** every new file gets a `<script>` in `src/index.html` at its dependency point, never appended. Plain `.js` files are IIFEs that assign `window.X`. Babel `.jsx` files share one scope: destructure `window` under a unique alias (`_BS_`, `_DT_`, ...).
- **Policy in Rust:** the webview sends tab ids, input and sizes only. A favicon URL is found and fetched by Rust through CDP; the webview never fetches a page-derived URL.
- **CSP:** `img-src 'self' data: blob:`. A favicon reaches the UI as a `data:` URL only. Do not edit the CSP.
- **Untrusted page data:** title, URL and favicon bytes come from the page. Render title/URL as text; accept the favicon only after the Rust checks in U1.
- **i18n:** `tests/test-i18n.mjs` fails on a wrapped literal without a dictionary key.
- **Icons:** `src/design/ui/icon-paths.js` is generated. Add names in `scripts/vendor-phosphor.mjs` `NAMES` and rerun the script; `tests/test-icons.mjs` checks every name used.
- **Size caps:** `.jsx` ~250 lines, `.js` ~400, `.rs` ~250, `.css` ~300. `src/app/browser.js` is already 433 lines: new pure helpers go in new files, not there. `src/app-live.jsx` is 1574 lines: Phase 3 logic goes in a hook, `app-live.jsx` only wires it.
- **New Tauri command:** register in `lib.rs` next to the other `browser::commands::*`. (`ALLOWED_COMMAND_TYPES` is for omp RPC commands only; browser commands are Tauri commands and do not go there.)
- **Docs:** update `docs/architecture/browser.md` in the same commit as the behaviour it describes, and add a `CHANGELOG.md` line under `## [Unreleased]`.

---

## Phase 1: toolbar parity

### U1. Rust: favicon in `TabInfo`

**Goal:** each tab in the `tabs` channel message carries `favicon: string | null` (a `data:` URL).

**Files:** `src-tauri/src/browser/view/emit.rs` (`TabInfo`), `view/model.rs` (`Page`, `tabs_if_changed`), `view/core.rs` (next to `refresh_title`), `view/worker.rs` (`Page.loadEventFired` arm), new `view/favicon.rs` for the fetch + validation, tests in `view/tests.rs` or `favicon.rs`.

**Approach:**
1. On `Page.loadEventFired` for the active session, after `refresh_title`, call `refresh_favicon`.
2. Find the icon URL with `Runtime.evaluate` on the page session, `returnByValue: true`:
   `(document.querySelector('link[rel~="icon"]') || {}).href || (location.origin + '/favicon.ico')`.
   Treat the result as hostile: it must parse as `http:` / `https:` and pass the same check `navigate` uses (`checked_url` in `view/mod.rs`); otherwise no favicon.
3. Fetch through Chromium, not through Rust HTTP, so the tab's network stack and proxy apply: `Network.loadNetworkResource` (`frameId` of the main frame, `url`, `options: { disableCache: false, includeCredentials: false }`), then `IO.read` the returned stream until `eof`, then `IO.close`.
4. Validate in Rust: status success, total size <= 32 KiB (stop reading past the cap), and a magic-byte sniff that accepts only PNG, ICO, JPEG, GIF, WebP. No SVG. Build `data:<sniffed mime>;base64,...` from the sniffed type, never from the response header.
5. Store on `Page`, include in `TabInfo` and in the `tabs_if_changed` comparison. A navigation to another origin clears it at `Page.frameNavigated` (main frame) so a stale icon never shows on the new site.
6. Failure at any step = `None`, silently. Never set `state.error` for a favicon.

**Before coding, verify:** that `Network.loadNetworkResource` and `IO.read` answer on the broker's page session (the fake Chromium in `browser/broker/fake.rs` needs matching replies for tests). If the command is refused on the pipe, stop and report instead of switching to a Rust-side HTTP fetch; the fallback is "no favicon, globe icon only", and U2 already renders that.

**Tests (Rust, same module):**
- happy path: fake replies with a PNG -> `tabs` event carries a `data:image/png;base64,` favicon.
- hostile URL (`javascript:`, `file:`, `data:`) -> no `Network.loadNetworkResource` sent.
- oversized body -> `None`, stream closed.
- SVG / HTML body -> `None`.
- cross-origin navigation clears the stored favicon.

### U2. Frontend: Codex-style tab strip and bar

**Goal:** the panel header matches reference screenshot 1.

**Files:** `src/design/browser-toolbar.jsx` (split: keep `BrowserToolbar`, move `BrowserTabs` to new `src/design/browser-tabs.jsx` if the file passes ~200 lines), new `src/design/browser-more-menu.jsx`, `src/design/layout/browser.css` (move the header rules to new `src/design/layout/browser-bar.css` if the file passes 300 lines; register it in `src/design/layout/_index.css`), `src/app/use-browser.jsx`, `src/live.js`, `src/app/i18n-zh.js`, `scripts/vendor-phosphor.mjs`.

**Tab strip (row 1):**
- Each tab: 14 px favicon (`<img src={t.favicon} alt="">` when present, else `<Icon name="web">`), title, close button. Active tab is a filled rounded capsule; inactive tabs are flat.
- While the active tab's `state.loading` is true, its favicon slot shows a small spinner (CSS only; respect `prefers-reduced-motion`).
- `+` sits right after the last tab (already there).
- Right end of the row: full-view toggle (`ui.setFullView(!ui.fullView)`, icon `focus`, `aria-pressed`) and close-panel button (`ui.close()`, see below). These two replace the `tb-sub` buttons in `PanelRail`.

**Bar (row 2), left to right:**
- Back, forward (unchanged logic).
- Reload / stop: when `state.loading`, the button shows `close` icon, label "stop loading", and calls `ui.stopLoading()`; otherwise `refresh` and the current reload.
- Annotate: a pill button with the `edit` icon and the text "Annotate", `aria-pressed={ui.annotate}`, disabled unless `state.status === "running"`, calls `ui.setAnnotate(!ui.annotate)`.
- Address: pill, centered text when not focused, left-aligned while focused/editing; keep `draft`, `shake`, Escape and IME handling exactly as now. Not mono when unfocused is fine; keep it selectable.
- `...` menu button (new icon `more` = Phosphor `DotsThree`): opens `BrowserMoreMenu`.

**`...` menu rows** (reuse `usePopoverDismiss` and the `.browser-menu` styles):
- "Open in system browser" -> the hook's existing external open path (what `linkExternal` uses, with `state.url`). Disabled without a URL or on `about:`/`data:`.
- "Copy page address" -> same as `urlCopy`.
- "Reload" -> same as the reload button.
- "Stop browser" -> what `toggleSide("browser")` does today when the panel is open (`bridge.browserStop`) then closes the panel. Expose it as `ui.close()` wired from `app-live.jsx`.

Put the row list in a pure function (`OMP_BROWSER_BAR.moreMenu(state)` in new `src/app/browser-bar.js`) returning `{ id, label, disabled }[]`, like `OMP_BROWSER.contextMenu`, so it is testable.

**Stop loading (small Rust addition):** new command `browser_load_stop(session_id)` in `browser/commands.rs` -> `View::load_stop` -> `client.post(session, "Page.stopLoading", {})`. Register in `lib.rs`. Bridge: `browserLoadStop(sid)` in `src/live.js` next to `browserHistory`. Hook: `stopLoading` in the `act` memo of `use-browser.jsx`. Name it `load_stop`, not `stop`: `browser_stop` already means "stop this tab's Chromium".

**`PanelRail` change (`src/design/toolbar.jsx:96-103`):** remove the `browser.open && <span className="tb-sub">` group and the `annotate / canAnnotate / onAnnotate / fullView / onFullView` props; update the JSDoc above the component and the props passed at `src/app-live.jsx:1464`. Keymap ids `desktop.browser.annotate` and `desktop.browser.fullView` (`src/app-live.jsx:1102-1103`) stay and keep working.

**Tests:**
- `tests/test-browser-bar.mjs` (new; add `test:browser-bar` and chain it in `npm test`): `moreMenu` rows and disabled states for no URL, `about:blank`, http URL; reload-vs-stop decision helper (`loadButton(state)` -> `{ icon, label, action }`).
- Rust: `load_stop` sends exactly one `Page.stopLoading` on the active session; errors with no active page.
- `tests/test-icons.mjs` and `tests/test-i18n.mjs` pass with the new names and strings.

**Manual check (Bot Screen, `npm run dev`):** open the panel, load `https://www.google.com/`, compare with reference screenshot 1; confirm favicon, spinner then favicon, stop mid-load on a slow page, Annotate pill toggles, `...` rows work, full view from the strip.

---

## Phase 2: start page on a blank tab

### U3. Pure start-page model

**Files:** new `src/app/browser-start.js` (IIFE, `window.OMP_BROWSER_START`), new `tests/test-browser-start.mjs`.

**API:**
- `isStart(tab, state)` -> true when the active tab's URL is `""` or `about:blank` and `state.status === "running"` and `!state.loading`.
- `classify(input)` -> `{ kind: "url", url }` when `OMP_BROWSER.normalizeUrl(input)` returns a URL **and** the text looks like an address (has a scheme, a dot, `localhost`, or a port); `{ kind: "files", query }` for other non-empty text; `{ kind: "empty" }`. Reason: `normalizeUrl("readme")` yields `https://readme`, which would hide file search.
- `tiles()` -> `[{ id: "terminal", label: "Terminal", icon: "terminal" }, { id: "changes", label: "Changes", icon: "diff2" }, { id: "files", label: "Files", icon: "file" }]`.
- `pickResult(classified, hits, index)` -> the action for Enter: `{ type: "navigate", url }`, `{ type: "file", path }` or `null`.

**Tests:** table of inputs for `classify` (`google.com`, `localhost:3000`, `http://x`, `readme`, `src/app`, `  `, `javascript:alert(1)` -> not url), `isStart` for each status, `pickResult` bounds.

### U4. Start page component

**Files:** new `src/design/browser-start.jsx`, `src/design/browser-panel.jsx`, new `src/design/layout/browser-start.css`, `src/app/use-browser.jsx`, `src/app-live.jsx` (wiring only), `src/app/i18n-zh.js`.

**Approach:**
- `BrowserPanel` renders `<BrowserStart>` as an absolutely positioned layer over `.browser-view` when `OMP_BROWSER_START.isStart(...)`. The canvas, the sink textarea and the view ref stay mounted underneath (the hook binds them at open; see the header comment in `use-browser.jsx`).
- While the start page shows, the panel must not forward keys to the page: focus lives in the omnibox, not in `.browser-sink`. Check `app/browser-screen.js` so its focus handling does not steal focus back.
- Layout per reference screenshot 2: centered column, max-width ~560 px, pill omnibox with a `search` icon and placeholder "Search files or enter a URL", a "New" label, a row of tiles (`grid-template-columns: repeat(auto-fit, minmax(120px, 1fr))` so it survives the 360 px minimum panel width).
- Omnibox behaviour: debounce 120 ms, `bridge.listFiles(query, 8)` for `kind: "files"` (drop stale answers by comparing the query), list below the input, Arrow keys move, Enter runs `pickResult`, Escape clears then blurs (stop propagation as the address field does, so it never aborts a running turn).
- Actions come in as props, `BrowserStart` owns no policy: `onNavigate(url)` = `ui.navigate`, `onOpenFile(path)` and `onTile(id)` from `app-live.jsx`.
- Phase 2 tile wiring (replaced in Phase 3): `terminal` -> `terminal.toggle(planKey)` when closed, `changes` -> `setGitOpen({ path: null })`, `files` -> `setFilesOpen(true)`; `onOpenFile(path)` -> open the Files panel on that file through the action `useFileComments` exposes for selecting a path (the one `previewToFiles` uses).
- The address bar shows an empty field with its placeholder on the start page, not `about:blank`.

**Tests:** the logic is in U3. Add one case to `tests/test-browser.mjs` only if a helper in `browser.js` changes.

**Manual check:** `+` shows the start page; typing `google.com` + Enter loads it and the page replaces the start layer; typing part of a file name lists project files and Enter opens it; each tile opens its panel; panel at minimum width still shows all tiles; light and dark themes.

---

## Phase 3: one tab strip for pages and tools

Today the column beside the chat shows one of rail / tree / browser / files / work / insights (`side`), Changes is a full-window modal and the terminal is a bottom panel. After this phase the browser dock is a general dock: its strip holds browser pages and tool tabs (Terminal, Changes, Files), and the start-page tiles open tool tabs in place.

### U5. Pure dock-tab state

**Files:** new `src/app/dock-tabs.js` (IIFE, `window.OMP_DOCK_TABS`), new `tests/test-dock-tabs.mjs`. Model it on `src/app/terminal-tabs.js` + its test.

**State, per desktop tab** (kept in a per-tab map with `OMP_SESSION_UI.entryOf / updateEntry / pruneEntries`, like `sides`):

```
{ tools: [{ id, kind: "terminal" | "changes" | "files", termId?: string, path?: string }],
  active: null | toolId }   // null = the browser's own active page shows
```

**Functions:** `initial()`, `open(state, kind, extra)` (Changes and Files are singletons: opening again activates the existing one and updates `path`; Terminal always adds), `close(state, id)` (closing the active tool activates its left neighbour tool, else `null`), `activate(state, id)`, `showPage(state)` (sets `active: null`), `strip(state, pageTabs)` -> the ordered render list `[{ key, kind, title, favicon?, active, targetId?, toolId? }]` (pages first, then tools; a page is active only when `state.active === null`), `label(tool, tools)` ("Terminal", "Terminal 2", "Changes", "Files").

**Tests:** singleton rule, close-neighbour rule, `strip` active flags in both modes, unknown ids are no-ops returning the same object (cheap `===` bail-out for React).

### U6. `useDock` hook and the side-column merge

**Files:** new `src/app/use-dock.jsx`, `src/app-live.jsx`, `src/app/use-pane-widths.jsx` (only if `"files"` leaves `open`), `src/design/toolbar.jsx`.

**Approach:**
- `useDock({ bridge, planKey, sessionIds, browser, terminal, setSide })` owns the per-tab dock map and returns `{ tabs: strip, tools, active, openTool(kind, extra), closeTool(id), activate(key), showPage() }`.
- `side` values `"browser"` and `"files"` collapse into one value, `"dock"`. Replace every `side === "browser"` / `side === "files"` in `app-live.jsx` (see the line list in "Read before coding"); `sideRail` no longer returns `"files"`, so the Files column width tweak and `files-full` class go away (Files now uses the dock's width and full view).
- `useBrowser`'s `open` becomes `side === "dock"`. Chromium therefore starts when the dock opens even if a tool tab is the one showing. That is accepted for this plan; note it in `browser.md`.
- `PanelRail`: the browser button toggles the dock (as now, including `browserStop` on close); the Files button opens the dock with the Files tool active (and closes the dock only when Files is already the active tool). The `files.open && tb-sub` group is removed like the browser one in U2.
- `setBrowserOpen(true)` (agent browsing, chat link click, `/browser`) must also call `showPage()` so the page is visible, not a tool tab.
- `setFilesOpen(true)` callers (`previewToFiles`, file comments) become `openTool("files", { path })`.
- Terminal tool: `openTool("terminal")` calls `bridge.openTerminalTab(planKey)` and stores the returned id as `termId`; add these ids to `shellIds` (`app-live.jsx:496`) so `useTerminal` tracks them; `closeTool` calls `bridge.closeTerminalTab(termId)`. When a desktop tab closes (`sessionIds` loses it), close every `termId` of that tab, then prune the map. Do not reuse the fork's top-bar `ttabs` state: those tabs live in the project tab bar, these live in the dock.
- Changes: keep the modal for the existing entry points that pass a path from an edit card if embedding them proves risky; the rail's git button and the tile open the dock tool. Decide once and state it in the PR description.

**Tests:** `use-dock.jsx` stays thin; anything with a branch in it moves to `dock-tabs.js` and is covered by U5. Add cases there for "desktop tab closed -> its term ids are returned for closing" (`termIdsOf(state)`).

### U7. Dock rendering

**Files:** new `src/design/dock-tabs.jsx` (the strip), `src/design/browser-dock.jsx`, `src/design/browser-panel.jsx`, `src/design/browser-toolbar.jsx`, `src/design/terminal-panel.jsx`, `src/design/git/git-browser.jsx`, `src/design/files/files-panel.jsx`, `src/design/layout/browser.css`, `src/design/layout/{git,files,terminal}.css`.

**Approach:**
- `DockTabs` replaces `BrowserTabs`: renders `dock.tabs`; a page tab calls `dock.showPage()` + `ui.activateTab(targetId)` and closes with `ui.closeTab`; a tool tab calls `dock.activate` / `dock.closeTool`. Tool tabs show their icon instead of a favicon.
- Dock body: the browser bar + `.browser-body` render always and get `hidden` while a tool is active (canvas refs stay bound; frames keep being acked). Tool hosts:
  - Terminal: one host per terminal tool, `hidden` unless active, so output keeps arriving. Reuse the markup of `TerminalTabViews` (`terminal-panel.jsx:87`); extract the shared body into one component used by both.
  - Files: `<FilesPanel>` mounted only while active, same props as `app-live.jsx:1401`.
  - Changes: `<GitBrowser embedded>` mounted only while active. Add an `embedded` prop that drops the modal backdrop / focus trap / Esc-to-close and fills the host; `onClose` then closes the tool tab. Its single-key shortcuts (`j k n p f s /`) must only fire while focus is inside the dock host.
- Start-page tiles (U4) now call `dock.openTool(id)`. If the blank page is not the only page, close it (`ui.closeTab`) so the tool takes its place in the strip; if it is the only page, leave it (Rust always keeps one page).
- Full view (`ui.fullView`) applies to the whole dock whatever tab shows. Rename the stage classes if needed, but keep `.stage.browser-full` behaviour identical for the page case.
- Keyboard: tab strip is a `role="tablist"` with roving focus, Left/Right moves, Delete/middle-click closes; every tab keeps a visible focus ring.

**Manual check (Bot Screen):**
1. `+` -> tile Terminal -> a shell runs in the dock; switch to a page tab and back, output produced meanwhile is there.
2. Tile Changes and tile Files open, switch, close; closing the active tool lands on its neighbour, closing the last tool shows the page.
3. Agent runs a browser tool while a tool tab shows: the dock switches to the page.
4. Close the desktop tab: no orphan shell (`ps` shows the tool terminal gone). Reopen app: no tool tabs restored, no error.
5. Two desktop tabs keep separate dock tabs.
6. Rail buttons (browser, files, git), `/browser <url>`, chat link click, file-comment "open in files", edit-card "open in git" all still land somewhere sensible.
7. Bottom terminal panel (`ctrl+backtick`) still works next to a dock terminal tab.

### U8. Docs and changelog

- `docs/architecture/browser.md`: new sections "Toolbar and favicon", "Start page", "Dock tabs"; update the commands table (`browser_load_stop`), the `tabs` payload (`favicon`), the Panel section (the `side` value is now `dock`), and the module table.
- `docs/architecture/frontend-load-order.md`: every new script and where it sits.
- `docs/architecture/terminal.md`, `file-comments.md`, `git-browser.md`: one paragraph each on the dock host.
- `AGENTS.md` feature table rows if file ownership changed (keep fork edits small).
- `CHANGELOG.md` under `## [Unreleased]`: `### Added` (favicon tabs, stop button, `...` menu, start page, dock tabs for Terminal / Changes / Files), `### Changed` (Annotate and full view moved from the right rail into the browser bar; Files opens in the dock instead of its own column).

---

## New files and load-order slots

| File | Kind | Loads after | Used by |
|---|---|---|---|
| `src/app/browser-bar.js` | IIFE | `app/browser.js` | `design/browser-toolbar.jsx`, `design/browser-more-menu.jsx` |
| `src/app/browser-start.js` | IIFE | `app/browser.js` | `design/browser-start.jsx`, `design/browser-panel.jsx` |
| `src/app/dock-tabs.js` | IIFE | `app/session-ui.js` | `app/use-dock.jsx`, `design/dock-tabs.jsx` |
| `src/app/use-dock.jsx` | Babel | `app/use-browser.jsx`, `app/use-terminal.jsx` | `app-live.jsx` |
| `src/design/browser-more-menu.jsx` | Babel | `design/browser-menu.jsx` | `design/browser-toolbar.jsx` |
| `src/design/browser-start.jsx` | Babel | `design/ui/icons.jsx` | `design/browser-panel.jsx` |
| `src/design/dock-tabs.jsx` | Babel | `design/ui/icons.jsx` | `design/browser-toolbar.jsx` |
| `src-tauri/src/browser/view/favicon.rs` | Rust | | `view/core.rs` |

Each new test file gets a `test:<name>` script and joins the `npm test` chain in `package.json`.

## Risks

| Risk | Mitigation |
|---|---|
| `Network.loadNetworkResource` not usable over the broker session | Verify first (U1). Fallback is the globe icon; never a Rust HTTP fetch. |
| Favicon is attacker-controlled bytes | Size cap, magic-byte allowlist, no SVG, mime from the sniff, rendered only in `<img>`. |
| Hiding `.browser-body` while a tool shows breaks frame acks or resize | Use `hidden` on a wrapper that keeps layout size out of the equation: check `browser-screen.js` resize observer; if a zero size is reported, skip the resize while hidden. |
| `GitBrowser` embedded keeps modal behaviour (focus trap, global keys) | `embedded` prop turns both off; test with focus in the chat composer. |
| Orphan shells from dock terminal tabs | `termIdsOf` + close on desktop-tab close; manual check 4. |
| `app-live.jsx` grows | All new logic in `use-dock.jsx`; `app-live.jsx` net line count should not rise by more than ~30. |
| Upstream merges (`apoc/omp-desktop`) conflict in `browser-toolbar.jsx` / `toolbar.jsx` | Keep upstream files' structure; put new components in new files. |

## Open questions for the user

1. **Side chat tile:** left out. If wanted, say what it should open (conversation tree? subagent split pane?).
2. **Changes modal:** Phase 3 keeps the full-window Git browser for edit-card "open in git" unless told to move those into the dock too.
3. **Chromium start with tool-only dock:** opening the dock straight to Files still launches Chromium. Lazy launch (only when a page tab is first shown) is possible but touches `use-browser.jsx`'s open effect; not in this plan.

## Definition of done

- All units committed on `feat/browser-codex-ux`, one commit each.
- `npm test` passes; `cargo fmt`, `cargo test --locked` and the pedantic clippy command are clean.
- Every manual check above done on the Bot Screen with screenshots for Phase 1 (toolbar on google.com), Phase 2 (start page) and Phase 3 (dock with a terminal tab and a page tab).
- Report lists what ran, what did not, and the answers taken for the three open questions.
