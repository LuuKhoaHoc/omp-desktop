import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInNewContext(readFileSync(new URL("../src/app/account-quota.js", import.meta.url), "utf8"), { window, Date });
const Q = window.OMP_ACCOUNT_QUOTA;
const orgA = { provider: "openai", organization: "org-a", accountId: "user-1" };
const orgB = { provider: "openai", organization: "org-b", accountId: "user-1" };
let checks = 0;
const check = (name, fn) => { fn(); checks++; };
const eq = (a, b, label) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, label);

check("identity includes provider, organization and account; incomplete identity remains ambiguous", () => {
  assert.equal(Q.sameIdentity(orgA, { ...orgA }), true);
  assert.equal(Q.sameIdentity(orgA, orgB), false);
  assert.equal(Q.identityKey({ provider: "openai", accountId: "user-1" }), null);
});

check("quota values preserve unknown and stale states instead of implying zero", () => {
  const unknown = Q.normalizeWindow({ identity: orgA, scope: "model", window: "week", resetAt: 2000 }, 1000);
  assert.equal(Q.presentWindow(unknown, 1000).state, "amount-unknown");
  assert.equal(Q.presentWindow(unknown, 1000).remaining, null);
  const stale = Q.normalizeWindow({ identity: orgA, remaining: 0, amount: 100, resetAt: 2000 }, 1000);
  assert.equal(Q.presentWindow(stale, 400001).state, "stale");
  assert.equal(Q.presentWindow({ ...stale, identityKey: null }, 1000).state, "identity-unknown");
  assert.equal(Q.presentWindow({ ...stale, resetAt: null }, 1000).state, "reset-unknown");
});

check("observed quota difference requires same org-qualified identity, meter/window and reset epoch", () => {
  const at = Date.now() + 10_000;
  const before = Q.normalizeWindow({ identity: orgA, scope: "model", window: "week", unit: "requests", remaining: 90, resetAt: at + 5000 }, at);
  const after = Q.normalizeWindow({ identity: orgA, scope: "model", window: "week", unit: "requests", remaining: 81, resetAt: at + 5000 }, at + 100);
  eq(Q.observedDelta(before, after), { state: "observed", amount: 9, direction: "decreased" });
  assert.equal(Q.observedDelta(before, { ...after, identityKey: Q.identityKey(orgB) }).state, "identity-mismatch");
  assert.equal(Q.observedDelta(before, { ...after, window: "day" }).state, "window-mismatch");
  assert.equal(Q.observedDelta(before, { ...after, resetAt: at + 9000 }).state, "reset-mismatch");
  eq(Q.observedDelta(after, before), { state: "observed", amount: 0, direction: "increased" });
});
check("manual selector is stable, integer-validated and provider-gated", () => {
  assert.equal(Q.credentialSelector(12, "openai", ["openai"]), "OAuth credential #12");
  for (const bad of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "12"]) assert.equal(Q.credentialSelector(bad, "openai", ["openai"]), null);
  assert.equal(Q.credentialSelector(12, "anthropic", ["openai"]), null);
  eq(Q.parseCredentialSelector("OAuth credential #12", "openai", ["openai"]), { id: 12, selector: "OAuth credential #12", provider: "openai" });
  for (const selector of ["12", "OAuth credential #0", "OAuth credential #12 extra", "OAuth credential #9007199254740992"]) assert.equal(Q.parseCredentialSelector(selector, "openai", ["openai"]), null);
});

check("pin eligibility checks session idle, profile/provider and account availability", () => {
  const account = { id: 12, provider: "openai", profileId: "work", enabled: true, available: true };
  eq(Q.pinEligibility(account, "openai", "work", false), { eligible: true, selector: "OAuth credential #12" });
  assert.equal(Q.pinEligibility(account, "openai", "work", true).reason, "session-busy");
  assert.equal(Q.pinEligibility(account, "anthropic", "work", false).reason, "provider-mismatch");
  assert.equal(Q.pinEligibility(account, "openai", "other", false).reason, "profile-mismatch");
  assert.equal(Q.pinEligibility({ ...account, available: false }, "openai", "work", false).reason, "unavailable");
});

console.log(`account-quota: ${checks} checks passed`);
