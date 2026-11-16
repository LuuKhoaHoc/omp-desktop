/* app/coalesce.js — trailing-edge coalescer for the streaming notify
   (live.js `message_update`). A delta frame changes the active tab's
   messages and asks for a snapshot; token deltas can arrive faster than a
   frame, so `schedule()` queues one run per window instead of one per
   frame, and `cancel()` drops the queued run when a full notify has already
   delivered its state. Pure: the timers are injectable (tests/test-coalesce.mjs).
   Dependency-free IIFE; live.js reads window.OMP_COALESCE at its top-level
   init, so this must load before live.js. */
(function () {
  "use strict";

  /** `fn` runs once, `ms` after the first `schedule()` of a window. */
  function createCoalescer(fn, ms = 16, timers = { set: setTimeout, clear: clearTimeout }) {
    let handle = null;
    return {
      schedule() {
        if (handle !== null) return;
        handle = timers.set(() => {
          handle = null;
          fn();
        }, ms);
      },
      cancel() {
        if (handle === null) return;
        timers.clear(handle);
        handle = null;
      },
    };
  }

  window.OMP_COALESCE = { createCoalescer };
})();
