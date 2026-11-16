/* app/tab-idle.js — when a background tab's omp process may be stopped to
   free its memory (docs/architecture/session-model.md, "Idle tabs").
   Pure: live.js passes the tab's saved snapshot and asks. A tab is
   suspendable only when nothing in it can be lost or is still running, and
   its conversation file exists so `--resume` brings it back. Dependency-free
   IIFE; live.js reads window.OMP_TAB_IDLE inside function bodies only. */
(function () {
  "use strict";

  /** Background time before a tab's omp is stopped. */
  const SUSPEND_AFTER_MS = 10 * 60 * 1000;

  /**
   * `t`: { isActive, respawning, suspending, suspended, sessionFile,
   *        backgroundedAt, now, snap, subagentsLive }
   *  - `snap`: the tab's saved snapshot (live.js `sessionSnapshots`), null when
   *    the tab was never shown since boot: its frames were never read, so
   *    nothing says whether a turn is running.
   *  - `subagentsLive`: a subagent of the tab is pending or running.
   */
  function suspendable(t) {
    if (t.isActive || t.respawning || t.suspending || t.suspended) return false;
    if (!t.sessionFile) return false;
    const s = t.snap;
    if (!s) return false;
    if (s.agentRunning || s.isStreaming || s.asyncPending) return false;
    if ((s.queue?.length ?? 0) > 0 || s.queueSending) return false;
    if (t.subagentsLive) return false;
    if (s.goal) return false;
    if (s.liveVoice?.active || s.dictation?.active) return false;
    if (s.messages?.some(m => m.kind === "ask" && !m.answered && !m.cancelled)) return false; // an approval omp is blocked on
    if (t.backgroundedAt == null || t.now - t.backgroundedAt < SUSPEND_AFTER_MS) return false;
    return true;
  }

  window.OMP_TAB_IDLE = { SUSPEND_AFTER_MS, suspendable };
})();
