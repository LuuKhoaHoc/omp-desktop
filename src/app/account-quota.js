(function () {
  const QUOTA_SELECTOR = /^OAuth credential #(\d+)$/;

  function identityKey(identity) {
    if (!identity || typeof identity !== "object") return null;
    const provider = text(identity.provider);
    const organization = text(identity.organization ?? identity.org ?? identity.workspace);
    const account = text(identity.accountId ?? identity.userId ?? identity.email ?? identity.account);
    if (!provider || !organization || !account) return null;
    return JSON.stringify([provider, organization, account]);
  }

  function text(value) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  function sameIdentity(a, b) {
    const left = identityKey(a);
    return left !== null && left === identityKey(b);
  }

  function normalizeWindow(window, fetchedAt) {
    if (!window || typeof window !== "object") return null;
    const amount = finiteNonnegative(window.amount ?? window.limit);
    const remaining = finiteNonnegative(window.remaining);
    const used = finiteNonnegative(window.used);
    const resetAt = validEpoch(window.resetAt ?? window.reset_at);
    const fetched = validEpoch(fetchedAt ?? window.fetchedAt);
    const stale = fetched === null || Date.now() - fetched > 5 * 60 * 1000;
    const identity = window.identity && typeof window.identity === "object" ? window.identity : null;
    const orgIdentity = identityKey(identity);
    const unknownReason = amount === null && remaining === null && used === null ? "amount-unknown" : null;
    return {
      identity: orgIdentity === null ? null : identity,
      identityKey: orgIdentity,
      scope: text(window.scope),
      window: text(window.window ?? window.name),
      unit: text(window.unit),
      amount,
      remaining,
      used,
      resetAt,
      fetchedAt: fetched,
      stale,
      status: unknownReason ?? (stale ? "stale" : resetAt === null ? "reset-unknown" : "known"),
    };
  }

  function finiteNonnegative(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  }

  function validEpoch(value) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  function presentWindow(window, now = Date.now()) {
    const w = window && Object.prototype.hasOwnProperty.call(window, "status") ? window : normalizeWindow(window);
    if (!w) return { state: "unknown", remaining: null, resetAt: null, fetchedAt: null };
    const stale = w.fetchedAt === null || now - w.fetchedAt > 5 * 60 * 1000;
    const state = w.identityKey === null ? "identity-unknown"
      : w.amount === null && w.remaining === null && w.used === null ? "amount-unknown"
        : stale ? "stale" : w.resetAt === null ? "reset-unknown" : "known";
    return { state, remaining: w.remaining, amount: w.amount, used: w.used, resetAt: w.resetAt, fetchedAt: w.fetchedAt };
  }

  function observedDelta(before, after) {
    if (!before || !after || typeof before.identityKey !== "string" || !before.identityKey || before.identityKey !== after.identityKey) return { state: "identity-mismatch", amount: null };
    if (!before.scope || !before.window || !before.unit || before.scope !== after.scope || before.window !== after.window || before.unit !== after.unit) return { state: "window-mismatch", amount: null };
    if (before.resetAt === null || after.resetAt === null || before.resetAt !== after.resetAt) return { state: "reset-mismatch", amount: null };
    if (before.stale || after.stale || typeof before.remaining !== "number" || typeof after.remaining !== "number") return { state: "unknown", amount: null };
    const delta = before.remaining - after.remaining;
    return { state: "observed", amount: Math.max(0, delta), direction: delta < 0 ? "increased" : "decreased" };
  }

  function credentialSelector(id, provider, eligibleProviders) {
    if (!Number.isSafeInteger(id) || id <= 0 || typeof provider !== "string" || !provider.trim()) return null;
    if (!Array.isArray(eligibleProviders) || !eligibleProviders.includes(provider)) return null;
    return `OAuth credential #${id}`;
  }

  function parseCredentialSelector(selector, provider, eligibleProviders) {
    if (typeof selector !== "string" || typeof provider !== "string" || !Array.isArray(eligibleProviders) || !eligibleProviders.includes(provider)) return null;
    const match = QUOTA_SELECTOR.exec(selector);
    if (!match) return null;
    const id = Number(match[1]);
    return Number.isSafeInteger(id) && id > 0 ? { id, selector: `OAuth credential #${id}`, provider } : null;
  }

  function pinEligibility(account, currentProvider, profileId, busy) {
    if (!account || typeof account !== "object") return { eligible: false, reason: "account-unknown" };
    if (busy) return { eligible: false, reason: "session-busy" };
    if (!Number.isSafeInteger(account.id) || account.id <= 0) return { eligible: false, reason: "credential-id-unknown" };
    if (!currentProvider || account.provider !== currentProvider) return { eligible: false, reason: "provider-mismatch" };
    if (!profileId || account.profileId !== profileId) return { eligible: false, reason: "profile-mismatch" };
    if (account.enabled === false || account.available === false) return { eligible: false, reason: "unavailable" };
    return { eligible: true, selector: `OAuth credential #${account.id}` };
  }

  window.OMP_ACCOUNT_QUOTA = Object.freeze({
    identityKey, sameIdentity, normalizeWindow, presentWindow, observedDelta,
    credentialSelector, parseCredentialSelector, pinEligibility,
  });
})();
