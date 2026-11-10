// Terminal tabs (fork): a shell in the tab bar beside the omp tabs, in the
// folder of the omp tab it was opened from, for running other CLI agents
// (hermes, agy, …) next to omp. Pure state helpers, like settings-tab.js.
//
// Exposes `window.OMP_TERMINAL_TABS`; IIFE per the AGENTS.md rule.
//
// Like the Settings tab, a terminal tab is no omp session: the omp tab that
// was active stays `activeSessionId` while a terminal shows, so closing or
// leaving it returns there. Rust owns the shell (`terminal_tab_open` +
// `close_tab`); nothing is persisted, a restart starts without them.
(function () {
  /** `{ tabs: [{ id, path, profile, name }], active: id | null }` */
  const initial = () => ({ tabs: [], active: null });

  /** "terminal", then "terminal 2", … for the next tab on `path`. */
  function nameFor(tabs, path) {
    const taken = new Set(tabs.filter(t => t.path === path).map(t => t.name));
    if (!taken.has("terminal")) return "terminal";
    let n = 2;
    while (taken.has(`terminal ${n}`)) n++;
    return `terminal ${n}`;
  }

  /** Adds `{ id, path, profile }` (named by nameFor) and shows it. */
  function add(state, tab) {
    const entry = { ...tab, name: nameFor(state.tabs, tab.path) };
    return { tabs: [...state.tabs, entry], active: entry.id };
  }

  /** Drops `id`. Closing the shown one goes back to the omp tab. */
  function remove(state, id) {
    if (!state.tabs.some(t => t.id === id)) return state;
    return { tabs: state.tabs.filter(t => t.id !== id), active: state.active === id ? null : state.active };
  }

  const select = (state, id) => (state.active === id || !state.tabs.some(t => t.id === id) ? state : { ...state, active: id });

  /** An omp tab or the Settings tab was picked: the terminal steps back. */
  const selectProject = state => (state.active === null ? state : { ...state, active: null });

  window.OMP_TERMINAL_TABS = Object.freeze({ initial, nameFor, add, remove, select, selectProject });
})();
