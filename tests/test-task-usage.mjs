import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInNewContext(readFileSync(new URL("../src/app/task-usage.js", import.meta.url), "utf8"), { window });
const U = window.OMP_TASK_USAGE;
const eq = (a, b, label) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, label);
const stats = (n = 0) => ({ inputTokens: n, outputTokens: n, reasoningTokens: n, cacheReadTokens: n, cacheWriteTokens: n, premiumRequests: n / 10, cost: n / 100 });
let checks = 0;
const check = (name, fn) => { fn(); checks++; };

check("baseline is a full authoritative snapshot; missing counters cannot become zero", () => {
  assert.equal(U.baseline(null).status, "missing-baseline");
  assert.equal(U.baseline({ ...stats(), outputTokens: undefined }).status, "missing-baseline");
  assert.equal(U.baseline(stats()).status, "ready");
});

check("task includes all authoritative deltas once at settled completion", () => {
  let state = U.baseline(stats(10));
  state = U.begin(state, "request-1");
  state = U.update(state, stats(15));
  state = U.update(state, stats(20)); // multi-turn/tool activity is one request
  const result = U.settle(state, "request-1", stats(30), "completed");
  eq({ ...result.task, stats: { ...result.task.stats, cost: null } }, { taskId: "request-1", outcome: "completed", stats: {
    inputTokens: 20, outputTokens: 20, reasoningTokens: 20, cacheReadTokens: 20,
    cacheWriteTokens: 20, premiumRequests: 2, cost: null,
  }, costLabel: "provider/model-reported" });
  assert.ok(Math.abs(result.task.stats.cost - 0.2) < 1e-12);
  assert.equal(result.state.status, "ready");
  assert.equal(result.state.completed.includes("request-1"), true);
});

check("failed and aborted user requests settle with only the authoritative reported delta", () => {
  const start = U.begin(U.baseline(stats(4)), "request-2");
  eq(U.settle(start, "request-2", stats(4), "aborted").task.stats, {
    inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0,
    cacheWriteTokens: 0, premiumRequests: 0, cost: 0,
  });
  assert.equal(U.settle(start, "request-2", stats(5), "failed").task.outcome, "failed");
});

check("duplicate begin and mismatched settle preserve the live task; replay cannot double count", () => {
  const start = U.begin(U.baseline(stats()), "request-3");
  assert.equal(U.begin(start, "request-4"), start);
  assert.equal(U.settle(start, "wrong-id", stats(5)).state, start);
  const done = U.settle(U.update(start, stats(5)), "request-3", stats(8));
  assert.equal(done.task.stats.cost, 0.08);
  assert.equal(U.settle(done.state, "request-3", stats(8)).task, null);
  assert.equal(U.update(done.state, stats(9)).stats.cost, 0.09);
  let bounded = done.state;
  for (let i = 0; i < 140; i++) {
    bounded = U.begin(bounded, `request-${i + 10}`);
    bounded = U.settle(bounded, `request-${i + 10}`, stats(9 + i));
    if (bounded.state.status !== "ready") break;
    bounded = bounded.state;
  }
  assert.ok(bounded.completed.length <= 128);
});

check("regressed or missing counters are unavailable, never negative spend", () => {
  const start = U.begin(U.baseline(stats(10)), "request-4");
  const regressed = U.update(start, stats(9));
  assert.equal(regressed.status, "regressed-counters");
  assert.equal(U.settle(regressed, "request-4", stats(11)).task, null);
  const missing = U.update(start, { ...stats(11), cost: null });
  assert.equal(missing.status, "invalid-stats");
  assert.equal(U.settle(start, "request-4", null).task, null);
});

check("resume requires persisted task baseline and identity; otherwise historic task is not fabricated", () => {
  const start = U.begin(U.baseline(stats(5)), "request-5");
  eq(U.resume(start, "request-5", stats(7)).stats, stats(7));
  assert.equal(U.resume(null, "request-5", stats(7)).status, "missing-baseline");
  assert.equal(U.resume(start, "other", stats(7)).status, "missing-baseline");
});

check("session cumulative totals are deltas from its initial authoritative baseline", () => {
  const initial = U.baseline(stats(10));
  const done = U.settle(U.update(U.begin(initial, "request-6"), stats(12)), "request-6", stats(15));
  const delta = U.sessionDelta(done.state);
  assert.ok(Math.abs(delta.cost - 0.05) < 1e-12);
  eq({ ...delta, cost: 0.05 }, {
    inputTokens: 5, outputTokens: 5, reasoningTokens: 5, cacheReadTokens: 5,
    cacheWriteTokens: 5, premiumRequests: 0.5, cost: 0.05,
  });
});

console.log(`task-usage: ${checks} checks passed`);
