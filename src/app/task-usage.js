(function () {
  const COUNTERS = Object.freeze(["inputTokens", "outputTokens", "reasoningTokens", "cacheReadTokens", "cacheWriteTokens", "premiumRequests", "cost"]);
  const COMPLETED_LIMIT = 128;

  function readStats(stats) {
    if (!stats || typeof stats !== "object") return null;
    const result = {};
    for (const key of COUNTERS) {
      const value = stats[key];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
      result[key] = value;
    }
    return result;
  }

  function baseline(stats) {
    const counters = readStats(stats);
    if (!counters) return { status: "missing-baseline", sessionBaseline: null, stats: null, active: null, completed: [] };
    return { status: "ready", sessionBaseline: counters, stats: counters, active: null, completed: [] };
  }

  function begin(state, taskId) {
    if (!state || state.status !== "ready" || !state.sessionBaseline || typeof taskId !== "string" || !taskId) return state ?? baseline(null);
    if (state.active || state.completed.includes(taskId)) return state;
    return { ...state, status: "tracking", active: { taskId, baseline: state.stats } };
  }

  function update(state, stats) {
    if (!state || !state.sessionBaseline) return state ?? baseline(null);
    if (state.status === "invalid-stats" || state.status === "regressed-counters") return state;
    const nextStats = readStats(stats);
    if (!nextStats) return { ...state, status: "invalid-stats" };
    if (COUNTERS.some((key) => nextStats[key] < state.stats[key])) return { ...state, status: "regressed-counters" };
    if (state.status !== "tracking") return { ...state, status: "ready", stats: nextStats };
    return { ...state, stats: nextStats };
  }

  function settle(state, taskId, stats, outcome = "completed") {
    if (!state || !state.active || state.status !== "tracking") return { state: state ?? baseline(null), task: null };
    if (taskId !== state.active.taskId || state.completed.includes(taskId)) return { state, task: null };
    const reconciled = update(state, stats);
    if (reconciled.status !== "tracking") return { state: reconciled, task: null };
    const delta = {};
    for (const key of COUNTERS) delta[key] = reconciled.stats[key] - state.active.baseline[key];
    const task = { taskId, outcome, stats: delta, costLabel: "provider/model-reported" };
    const completed = [...state.completed, taskId].slice(-COMPLETED_LIMIT);
    return { state: { ...reconciled, status: "ready", active: null, completed }, task };
  }

  function resume(state, taskId, stats) {
    if (!state || state.status !== "tracking" || !state.active || state.active.taskId !== taskId) return {
      status: "missing-baseline", sessionBaseline: state?.sessionBaseline ?? null,
      stats: state?.stats ?? null, active: null, completed: state?.completed ?? [],
    };
    return update(state, stats);
  }

  function sessionDelta(state) {
    if (!state?.sessionBaseline || !state.stats || COUNTERS.some((key) => state.stats[key] < state.sessionBaseline[key])) return null;
    const delta = {};
    for (const key of COUNTERS) delta[key] = state.stats[key] - state.sessionBaseline[key];
    return delta;
  }

  window.OMP_TASK_USAGE = Object.freeze({ COUNTERS, readStats, baseline, update, settle, begin, resume, sessionDelta });
})();
