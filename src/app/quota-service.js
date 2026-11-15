(function () {
  function create(bridge, tauri) {
    const sessions = new Map();
    const subscribers = new Set();
    let snapshot = null;
    let closed = false;
    const emit = () => subscribers.forEach(callback => callback());
    const counters = stats => ({
      inputTokens: stats?.tokens?.input,
      outputTokens: stats?.tokens?.output,
      reasoningTokens: stats?.tokens?.reasoning,
      cacheReadTokens: stats?.tokens?.cacheRead,
      cacheWriteTokens: stats?.tokens?.cacheWrite,
      premiumRequests: stats?.premiumRequests,
      cost: stats?.cost,
    });

    function attach(tab) {
      const entry = { tab, stats: null, tasks: [], accounting: window.OMP_TASK_USAGE.baseline(null), busy: tab.runState !== "idle", output: null, control: false, revision: 0 };
      const readStats = async () => {
        const revision = entry.revision;
        const stats = await entry.rpc.request({ type: "get_session_stats" });
        if (closed || sessions.get(tab.id) !== entry || revision !== entry.revision) return null;
        entry.stats = stats;
        if (entry.accounting.stats && Object.keys(counters(stats)).some(key => counters(stats)[key] < entry.accounting.stats[key])) entry.accounting = window.OMP_TASK_USAGE.baseline(counters(stats));
        return counters(stats);
      };
      entry.rpc = window.OMP_QUOTA_RPC.create(tab.id, tauri, frame => {
        if (frame.type === "quota_disconnected") {
          entry.accounting = window.OMP_TASK_USAGE.baseline(null);
          entry.stats = null; entry.tasks = []; entry.busy = true; entry.revision++;
          emit();
        }
        if (frame.type === "command_output" && entry.output) entry.output.push(frame.text);
        if (frame.type === "message_start" && frame.message?.role === "user") {
          if (!entry.busy && entry.accounting.active) entry.accounting = window.OMP_TASK_USAGE.baseline(null);
          entry.revision++;
          if (!entry.accounting.active) {
            entry.accounting = window.OMP_TASK_USAGE.begin(entry.accounting, String(frame.message.timestamp ?? entry.revision));
          }
          entry.busy = true;
        }
        if (frame.type === "agent_start") entry.busy = true;
        if (frame.type === "session_settled") {
          entry.busy = false;
          const revision = entry.revision;
          readStats().then(stats => {
            if (!stats || revision !== entry.revision) return;
            if (entry.accounting.active) {
              const result = window.OMP_TASK_USAGE.settle(entry.accounting, entry.accounting.active.taskId, stats);
              entry.accounting = result.state;
              if (result.task) entry.tasks = [...entry.tasks.slice(-19), result.task];
            } else entry.accounting = window.OMP_TASK_USAGE.baseline(stats);
            emit();
          }).catch(error => { entry.error = String(error.message ?? error); emit(); });
        }
      });
      sessions.set(tab.id, entry);
      entry.rpc.ready.then(async () => {
        const state = await entry.rpc.request({ type: "get_state" });
        entry.busy = state.isSettled !== true;
        const revision = entry.revision;
        const stats = await readStats();
        if (stats && !entry.busy && revision === entry.revision) entry.accounting = window.OMP_TASK_USAGE.baseline(stats);
        emit();
      }).catch(error => { entry.error = String(error.message ?? error); emit(); });
      return entry;
    }

    const unsubscribe = bridge.onUpdate(value => {
      snapshot = value;
      if (tauri) for (const tab of value.sessions ?? []) {
        const entry = sessions.get(tab.id) ?? attach(tab);
        entry.tab = tab;
        if (entry.file !== tab.sessionFile || entry.profile !== tab.profile) {
          entry.file = tab.sessionFile; entry.profile = tab.profile;
          entry.accounting = window.OMP_TASK_USAGE.baseline(null);
          entry.stats = null; entry.tasks = []; entry.revision++;
          const revision = entry.revision;
          entry.rpc.request({ type: "get_session_stats" }).then(stats => {
            if (closed || entry.revision !== revision || entry.file !== tab.sessionFile || entry.profile !== tab.profile) return;
            entry.stats = stats;
            if (tab.runState === "idle") entry.accounting = window.OMP_TASK_USAGE.baseline(counters(stats));
            emit();
          }).catch(() => {});
        }
      }
      const ids = new Set((value.sessions ?? []).map(tab => tab.id));
      for (const [id, entry] of sessions) if (!ids.has(id)) {
        entry.rpc.close();
        sessions.delete(id);
      }
      emit();
    });

    async function pin(sessionId, provider, credentialId) {
      const entry = sessions.get(sessionId);
      if (!entry || entry.control || entry.busy || entry.tab.runState !== "idle") throw new Error("Wait until the session is idle before changing account");
      if (!Number.isSafeInteger(credentialId) || credentialId <= 0) throw new Error("Invalid account identifier");
      entry.control = true;
      try {
        const state = await entry.rpc.request({ type: "get_state" });
        if (state.model?.provider !== provider || state.isSettled !== true || state.isStreaming || state.hasPendingAsyncWork || state.queuedMessageCount > 0) throw new Error("Session or provider changed; refresh accounts");
        if (snapshot?.activeSessionId !== sessionId || snapshot.liveVoice?.active || snapshot.dictation?.active) throw new Error("Return to this idle chat and stop voice before changing account");
        const accounts = await entry.rpc.request({ type: "get_logout_accounts", providerId: provider });
        const list = Array.isArray(accounts) ? accounts : accounts?.accounts;
        if (!list?.some(account => account.credentialId === credentialId && account.type === "oauth")) throw new Error("Account is no longer available");
        const revision = entry.revision;
        const confirm = await entry.rpc.request({ type: "get_state" });
        if (revision !== entry.revision || confirm.isSettled !== true || confirm.model?.provider !== provider || confirm.isStreaming || confirm.hasPendingAsyncWork || confirm.queuedMessageCount > 0 || snapshot?.activeSessionId !== sessionId || snapshot.liveVoice?.active || snapshot.dictation?.active) throw new Error("Session became busy; account was not changed");
        entry.output = [];
        await entry.rpc.request({ type: "prompt", message: `/session pin OAuth credential #${credentialId}` });
        const output = entry.output.join("\n");
        if (!/^Pinned .+ to this session for .+\.$/m.test(output)) throw new Error(output || "Account change was not confirmed by omp");
        entry.pin = credentialId;
        emit();
        return output;
      } finally { entry.output = null; entry.control = false; }
    }

    return {
      subscribe(callback) { subscribers.add(callback); return () => subscribers.delete(callback); },
      snapshot: () => snapshot,
      session: id => sessions.get(id),
      async accounts(id, provider) {
        const entry = sessions.get(id);
        if (!entry) return [];
        const data = await entry.rpc.request({ type: "get_logout_accounts", providerId: provider });
        return Array.isArray(data) ? data : data?.accounts ?? [];
      },
      pin,
      close() { closed = true; unsubscribe(); sessions.forEach(entry => entry.rpc.close()); sessions.clear(); subscribers.clear(); },
    };
  }
  window.OMP_QUOTA_SERVICE = { create };
})();
