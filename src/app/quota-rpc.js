(function () {
  let nextId = 0;

  // Own listeners keep quota requests independent of the active chat's replay cursor.
  function create(sessionId, tauri, onFrame) {
    const pending = new Map();
    let closed = false;
    let lastSeq = 0;
    const ready = Promise.all([
      tauri.event.listen(`agent://line/${sessionId}`, ({ payload }) => {
        if (closed || !payload || typeof payload.text !== "string") return;
        if (Number.isFinite(payload.seq)) {
          if (payload.seq <= lastSeq) return;
          lastSeq = payload.seq;
        }
        let frame;
        try { frame = JSON.parse(payload.text); } catch (_) { return; }
        const request = frame.type === "response" && pending.get(frame.id);
        if (request) {
          pending.delete(frame.id);
          clearTimeout(request.timer);
          if (frame.success) request.resolve(frame.data);
          else request.reject(new Error(frame.error || "Account request failed"));
        }
        onFrame(frame);
      }),
      tauri.event.listen(`agent://exit/${sessionId}`, () => {
        lastSeq = 0;
        onFrame({ type: "quota_disconnected" });
        for (const request of pending.values()) {
          clearTimeout(request.timer);
          request.reject(new Error("Session disconnected"));
        }
        pending.clear();
      }),
    ]);

    async function request(command) {
      await ready;
      if (closed) throw new Error("Session disconnected");
      const id = `quota-${++nextId}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("Account request timed out"));
        }, 15000);
        pending.set(id, { resolve, reject, timer });
        tauri.core.invoke("send_command", {
          sessionId, json: JSON.stringify({ ...command, id }),
        }).catch(error => {
          const entry = pending.get(id);
          if (!entry) return;
          pending.delete(id);
          clearTimeout(timer);
          reject(new Error(String(error)));
        });
      });
    }

    function close() {
      closed = true;
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("Session disconnected"));
      }
      pending.clear();
      ready.then(stops => stops.forEach(stop => stop()), () => {});
    }

    return { ready, request, close };
  }

  window.OMP_QUOTA_RPC = { create };
})();
