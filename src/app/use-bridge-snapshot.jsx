/* app/use-bridge-snapshot.jsx — custom hooks that decouple the App
   component from the cross-cutting effects:
   - useBridgeSnapshot:  subscribes to OMP_BRIDGE.onUpdate and routes the
                         snapshot fields into a setter map.
   - useThemeEffect:     reflects tweaks state onto <html> classes /
                         CSS custom properties. Shortcuts dispatch is handled
                         by useKeymapDispatch in app/use-keymap.jsx. */

const { NULL_MODEL: _UB_NULL_MODEL, DEFAULT_PROFILE_ID: _UB_DEFAULT_PROFILE_ID } = window;

function useBridgeSnapshot(bridge, setters) {
  React.useEffect(() => {
    if (!bridge) return undefined;
    const unsub = bridge.onUpdate((snap) => {
      setters.setMessages(snap.messages);
      setters.setStreaming(snap.isStreaming);
      setters.setCtx(snap.ctx);
      setters.setKanban(snap.kanban);
      setters.setPlanMeta(snap.planMeta);
      setters.setModels(snap.models);
      setters.setActivity(snap.activity);
      setters.setSparkline(snap.sparkline);
      setters.setModelState(snap.model || _UB_NULL_MODEL);
      if (snap.thinkingLevel) setters.setThinkingLevel(snap.thinkingLevel);
      setters.setThinkingAuto(snap.thinkingAuto === true);
      setters.setFastMode(snap.fastMode ?? null);
      setters.setSessions(snap.sessions ?? []);
      setters.setPromptHistory(snap.promptHistory ?? []);
      setters.setSubagents(snap.subagents);
      setters.setSubagentTranscripts(snap.subagentTranscripts ?? {});
      setters.setQueue(snap.queue);
      setters.setQueueSending(snap.queueSending);
      setters.setGoal(snap.goal);
      setters.setExtWidgets(snap.extWidgets);
      setters.setLiveVoice(snap.liveVoice ?? null);
      setters.setDictation(snap.dictation ?? null);
      setters.setCodexLogin(snap.codexLogin ?? null);
      setters.setDictationCompleted(snap.dictationCompleted ?? []);
      setters.setProfiles(snap.profiles ?? []);
      setters.setStartupProfileId(snap.startupProfileId ?? _UB_DEFAULT_PROFILE_ID);
      setters.setRecentProjects(snap.recentProjects ?? []);
      setters.setNoTabProfileId(snap.noTabProfileId ?? _UB_DEFAULT_PROFILE_ID);
      setters.setWorkspaceNotes(snap.workspaceNotes ?? []);
      setters.setApprovalModes(snap.approvalModes ?? null);
      setters.setCloseConfirm(snap.closeConfirm ?? null);
      if (snap.activeSessionId) setters.setActiveSessionId(snap.activeSessionId);
    });
    return unsub;
  }, [bridge]);
}

// The last system look, so a start paints it at once instead of the picked
// theme first.
const _UB_SYSTEM_KEY = "omp-desktop:system-theme";
function _UB_storedSystem() {
  try { return JSON.parse(localStorage.getItem(_UB_SYSTEM_KEY) ?? "null"); } catch { return null; }
}

/** Rust's system look (system_theme) while `enabled`, else null. Re-read
 *  when the window gets focus: a theme switch in the desktop's own menu
 *  takes the focus and gives it back. */
function useSystemTheme(bridge, enabled) {
  const [sys, setSys] = React.useState(_UB_storedSystem);
  React.useEffect(() => {
    if (!enabled || !bridge) return undefined;
    let live = true;
    const read = () => bridge.systemTheme().then(res => {
      if (!live || !res.ok) return;
      try { localStorage.setItem(_UB_SYSTEM_KEY, JSON.stringify(res.value)); } catch {}
      setSys(prev => (window.OMP_SYSTEM_THEME.same(prev, res.value) ? prev : res.value));
    });
    read();
    window.addEventListener("focus", read);
    return () => { live = false; window.removeEventListener("focus", read); };
  }, [bridge, enabled]);
  return enabled ? sys : null;
}

// Tokens the last run set from the system palette, cleared by the next.
let _UB_systemTokens = [];

function useThemeEffect(t, sys = null) {
  React.useEffect(() => {
    const S = window.OMP_SYSTEM_THEME;
    const palette = S.tokens(sys);
    const root = document.documentElement;
    root.classList.remove("density-cozy", "density-compact", "density-dense");
    root.classList.add(`density-${t.density}`);
    if (t.monoChat) root.classList.add("mono-chat");
    else            root.classList.remove("mono-chat");
    // The accent override and its three derived tokens (app/accent.js), so
    // focus rings, glows and the xterm selection follow it. Cleared first:
    // an accent equal to the theme's own keeps the theme's hand-tuned set.
    // A system palette (app/system-theme.js) replaces the theme's colours,
    // accent included, and keeps the picked theme's structure. The last
    // palette goes first: it holds the accent tokens too.
    for (const name of _UB_systemTokens) root.style.removeProperty(name);
    window.OMP_ACCENT.applyThemeTokens(root, S.baseTheme(sys, t.theme), palette ? null : t.accent);
    _UB_systemTokens = Object.keys(palette ?? {});
    for (const [name, value] of Object.entries(palette ?? {})) root.style.setProperty(name, value);
    if (t.fontSize) root.style.fontSize = `${t.fontSize}%`;
    // Font roles (Settings → Appearance → Font): a family name wins over the
    // theme's stack, which stays as the fallback. "" clears the override.
    const fam = (name, fallback) => (name ? `"${String(name).replace(/["\\]/g, "")}", ${fallback}` : "");
    root.style.setProperty("--font-sans", fam(t.fontUi, "system-ui, sans-serif"));
    root.style.setProperty("--font-display", fam(t.fontUi, "system-ui, sans-serif"));
    root.style.setProperty("--font-chat", fam(t.fontChat, "var(--font-sans)"));
    root.style.setProperty("--font-mono", fam(t.fontMono, "ui-monospace, monospace"));
    // Roles left unpicked follow the system while it is followed.
    for (const [name, value] of Object.entries(S.fonts(sys, t))) root.style.setProperty(name, value);
  }, [t.theme, t.density, t.accent, t.monoChat, t.fontSize, t.fontUi, t.fontChat, t.fontMono, sys]);
}


Object.assign(window, { useBridgeSnapshot, useThemeEffect, useSystemTheme });
