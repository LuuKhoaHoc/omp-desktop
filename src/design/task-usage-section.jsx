function TaskUsageSection() {
  const service = window.OMP_ACCOUNT_SERVICE;
  const [, redraw] = React.useReducer(n => n + 1, 0);
  React.useEffect(() => service?.subscribe(redraw), [service]);
  const entry = service?.session(service.snapshot()?.activeSessionId);
  const stats = entry?.stats;
  const task = entry?.tasks?.at(-1);
  const count = value => Number.isFinite(value) ? value.toLocaleString() : OMP_TR("Unavailable");
  return <section className="quota-section" aria-label={OMP_TR("Current task usage")}>
    <h3>{OMP_TR("Current task usage")}</h3>
    <p className="quota-note">{OMP_TR("Reported token and model cost accounting, not your subscription bill. Other clients may also consume account quota.")}</p>
    {entry?.accounting?.active && <p role="status">{OMP_TR("Task running; totals finalize when all work settles.")}</p>}
    {!task && <p className="quota-note">{OMP_TR("No measured task yet. Tracking starts with the next request after a session baseline is available.")}</p>}
    {task && <dl className="quota-metrics">
      <div><dt>{OMP_TR("Last task input / output")}</dt><dd>{count(task.stats.inputTokens)} / {count(task.stats.outputTokens)}</dd></div>
      <div><dt>{OMP_TR("Last task cache read / write")}</dt><dd>{count(task.stats.cacheReadTokens)} / {count(task.stats.cacheWriteTokens)}</dd></div>
      <div><dt>{OMP_TR("Last task reported cost")}</dt><dd>${task.stats.cost.toFixed(4)}</dd></div>
    </dl>}
    <dl className="quota-metrics">
      <div><dt>{OMP_TR("Session input / output")}</dt><dd>{count(stats?.tokens?.input)} / {count(stats?.tokens?.output)}</dd></div>
      <div><dt>{OMP_TR("Session cache read / write")}</dt><dd>{count(stats?.tokens?.cacheRead)} / {count(stats?.tokens?.cacheWrite)}</dd></div>
      <div><dt>{OMP_TR("Session reported cost")}</dt><dd>{Number.isFinite(stats?.cost) ? `$${stats.cost.toFixed(4)}` : OMP_TR("Unavailable")}</dd></div>
    </dl>
    <p className="quota-note">{OMP_TR("Session totals follow omp's native ledger. Task deltas are available only for requests observed during this app run.")}</p>
    {entry?.error && <p role="alert">{entry.error}</p>}
  </section>;
}
window.TaskUsageSection = TaskUsageSection;
