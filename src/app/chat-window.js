/* app/chat-window.js: how many trailing transcript rows the chat view mounts.
   A long tab (up to MINIMAP_MAX rows) used to build and lay out every row on
   each tab switch; the view now mounts the newest TAIL_START and grows the
   window as the reader nears the top. Pure; chat/chat-view.jsx owns the DOM. */
(function () {
  const TAIL_START = 60;     // rows mounted when a tab opens
  const TAIL_STEP = 40;      // rows added per growth
  const NEAR_TOP_PX = 600;   // scrollTop under this grows the window
  const REVEAL_MARGIN = 5;   // extra rows kept above a revealed row

  // First mounted index for a transcript of `len` rows and a window of `tail`.
  function startIndex(len, tail) {
    return Math.max(0, len - tail);
  }

  // Window after the reader came near the top: unchanged when every row is
  // already mounted.
  function grow(tail, len) {
    return startIndex(len, tail) === 0 ? tail : tail + TAIL_STEP;
  }

  // Window that mounts row `idx` (a jump to a message that is not mounted).
  function revealing(tail, len, idx) {
    return Math.max(tail, len - idx + REVEAL_MARGIN);
  }

  window.OMP_CHAT_WINDOW = { TAIL_START, TAIL_STEP, NEAR_TOP_PX, startIndex, grow, revealing };
})();
