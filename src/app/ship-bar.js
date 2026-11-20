/* app/ship-bar.js — pure enablement state for the docked ship bar.
   The bar maps these stable reason codes to OMP_TR copy. */
(function () {
  "use strict";

  /** Provider for the named remote, or null when it is not configured. */
  function providerOf(remotes, name) {
    if (!Array.isArray(remotes) || !name) return null;
    return remotes.find(remote => remote?.name === name)?.provider ?? null;
  }

  /** Enablement and stable disabled reasons for Commit, Push and PR. */
  function state({ staged, message, remotes, remote, branch, pushed, busy } = {}) {
    const stagedFiles = Array.isArray(staged) ? staged : [];
    const configuredRemotes = Array.isArray(remotes) ? remotes : [];
    const validRemote = configuredRemotes.some(item => item?.name === remote);
    const provider = providerOf(configuredRemotes, remote);
    const hasBranch = Boolean(branch);
    const hasMessage = typeof message === "string" && message.trim() !== "";

    const commitReason = busy ? "busy"
      : !hasBranch ? "detached"
      : stagedFiles.length === 0 ? "nothing-staged"
      : !hasMessage ? "message-required"
      : null;
    const pushReason = busy ? "busy"
      : !hasBranch ? "detached"
      : configuredRemotes.length === 0 ? "no-remote"
      : !validRemote ? "remote-required"
      : null;
    const pullRequestReason = busy ? "busy"
      : !hasBranch ? "detached"
      : configuredRemotes.length === 0 ? "no-remote"
      : !validRemote ? "remote-required"
      : provider !== "github" && provider !== "gitlab" ? "unsupported-host"
      : !pushed ? "not-pushed"
      : null;

    return {
      commit: commitReason === null,
      push: pushReason === null,
      pullRequest: pullRequestReason === null,
      reasons: {
        commit: commitReason,
        push: pushReason,
        pullRequest: pullRequestReason,
      },
    };
  }

  window.OMP_SHIP_BAR = { state, providerOf };
})();
