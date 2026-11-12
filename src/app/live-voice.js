// Voice history belongs to the tab's current coding conversation, not an omp call.
// Local actions bracket RPC frames so replayed frames cannot start a call.
(function () {
  const LIMITS = Object.freeze({ transcripts: 100, text: 8192 });
  // `resumable`: this call connected (or resumed a paused one), so an
  // unexpected end pauses it; a call that never connected ends in error.
  const EMPTY = Object.freeze({
    active: false, paused: false, phase: "idle", muted: false, input: 0, output: 0,
    transcripts: Object.freeze([]), error: null, turnOffset: 0, discardTranscripts: false, resumable: false,
  });
  const CONNECTED_PHASES = new Set(["listening", "working", "speaking", "muted"]);
  const PHASES = new Set(["connecting", "listening", "working", "speaking", "muted", "error"]);
  const level = n => typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
  // RMS amplitude from omp, not sample peaks: this cannot detect clipping.
  function meterLevel(amplitude) {
    const rms = level(amplitude);
    const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    return {
      value: Math.max(-60, db),
      text: rms === 0 ? "−∞ dBFS" : db < -60 ? "<−60 dBFS" : `${Math.round(db)} dBFS`,
    };
  }
  function bounded(text) {
    if (text.length <= LIMITS.text) return text;
    let end = LIMITS.text;
    const last = text.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end--;
    return text.slice(0, end);
  }
  function ended(state, error, paused = false) {
    const message = typeof error === "string" && error ? error : null;
    return { ...state, active: false, paused, phase: paused ? "paused" : message ? "error" : "idle", muted: false, input: 0, output: 0, error: message };
  }
  function apply(state, event) {
    if (!event || typeof event.type !== "string") return state;
    switch (event.type) {
      case "start": {
        if (state.active) return state;
        // Native role-local turn numbers start over on every call. Shift each
        // call beyond all retained turns so existing role+turn keys stay stable.
        const turnOffset = state.transcripts.length ? Math.max(...state.transcripts.map(t => t.turn)) + 1 : 0;
        return { ...state, active: true, paused: false, phase: "connecting", muted: false, input: 0, output: 0,
          error: null, turnOffset, discardTranscripts: false, resumable: state.paused };
      }
      case "stop":
        if (!state.active) return state.paused ? ended(state, null) : state;
        return state.phase === "stopping" ? state : { ...state, phase: "stopping", input: 0, output: 0, error: null };
      case "stop_success":
        return state.phase === "stopping" ? ended(state, null, !!event.paused && !state.discardTranscripts) : state;
      case "stop_failure":
        return state.phase === "stopping" ? { ...state, phase: "error", error: event.error || "Could not stop live voice" } : state;
      case "start_failure":
        return state.active && state.phase !== "stopping" ? ended(state, event.error || "Could not start live voice", !!event.paused) : state;
      case "forget":
        // An in-process conversation change can leave a recorder stopping.
        // Keep it visible, but do not attribute its remaining frames to the new conversation.
        return state.active ? { ...state, transcripts: [], turnOffset: 0, discardTranscripts: true }
          : { ...EMPTY, transcripts: [] };
      case "mute_success":
        return state.active && state.phase !== "stopping" && typeof event.muted === "boolean"
          ? { ...state, muted: event.muted, error: null, input: event.muted ? 0 : state.input }
          : state;
      case "mute_failure":
        return state.active && state.phase !== "stopping" ? { ...state, error: event.error || "Could not change microphone mute" } : state;
      case "process_exit":
        return state.active ? ended(state, event.error || state.error || "The omp process ended during live voice", true) : state;
      case "live_end":
        // During an explicit stop omp can report a transport error caused by
        // cancellation. Stop's reply, not that error, decides the outcome.
        // omp sends this end before its failed `live_start` reply (a missing
        // Codex login), so a never-connected call must not read as paused.
        if (!state.active || state.phase === "stopping") return state;
        return ended(state, event.error, state.resumable);
      case "live_phase":
        if (!state.active || state.phase === "stopping" || !PHASES.has(event.phase)) return state;
        return { ...state, phase: event.phase, muted: event.phase === "muted" || state.muted,
          input: event.phase === "muted" ? 0 : state.input, resumable: state.resumable || CONNECTED_PHASES.has(event.phase) };
      case "live_levels": {
        if (!state.active || state.phase === "stopping") return state;
        const input = state.muted ? 0 : level(event.input);
        const output = level(event.output);
        return input === state.input && output === state.output ? state : { ...state, input, output };
      }
      case "live_transcript": {
        if (state.discardTranscripts || (event.role !== "user" && event.role !== "assistant") ||
            !Number.isSafeInteger(event.turn) || event.turn < 0 || !Number.isSafeInteger(event.turn + state.turnOffset) ||
            typeof event.text !== "string" || typeof event.final !== "boolean") return state;
        const entry = { role: event.role, turn: event.turn + state.turnOffset, text: bounded(event.text), final: event.final };
        const i = state.transcripts.findIndex(t => t.role === entry.role && t.turn === entry.turn);
        // Once the call ends only a final for an existing partial can land;
        // stale replayed frames cannot create new captions in an inactive tab.
        if (!state.active && (!entry.final || i === -1)) return state;
        if (i !== -1) {
          const old = state.transcripts[i];
          if (!state.active && old.final) return state;
          // A replayed partial must never overwrite a final transcript.
          if (old.final && !entry.final) return state;
          if (old.text === entry.text && old.final === entry.final) return state;
          const transcripts = state.transcripts.slice();
          transcripts[i] = entry;
          return { ...state, transcripts, resumable: state.resumable || state.active };
        }
        const transcripts = [...state.transcripts, entry].slice(-LIMITS.transcripts);
        return { ...state, transcripts, resumable: state.resumable || state.active };
      }
      case "dismiss":
        // The user closed the error line. A call that is over leaves its
        // error phase; one still open (a failed stop, a failed mute) keeps it.
        if (!state.error) return state;
        return { ...state, error: null, phase: state.active ? state.phase : state.paused ? "paused" : "idle" };
      default:
        return state;
    }
  }
  // Dictation is a separate, draft-only capture. Preview frames replace the
  // full preview; the capture id prevents journal replay crossing sessions.
  // `download` (`{ id, bytes }`) exists only while a starting capture waits
  // for omp to fetch its model: omp sends no frame for that, Rust reads the
  // bytes off the disk (`stt_download_progress`).
  const DICTATION_EMPTY = Object.freeze({ active: false, phase: "idle", captureId: null, text: "", error: null });
  function applyDictation(state, event) {
    const next = stepDictation(state, event);
    if (next.phase === "starting" || !next.download) return next;
    const { download: _gone, ...rest } = next;
    return rest;
  }
  function stepDictation(state, event) {
    if (!event || typeof event.type !== "string") return state;
    if (event.type === "start") {
      return state.active || !event.captureId ? state : { ...DICTATION_EMPTY, active: true, phase: "starting", captureId: event.captureId };
    }
    // The user closed the error line: an ended capture is forgotten, one
    // still open (a failed stop) only loses the message.
    if (event.type === "dismiss") return !state.error ? state : state.active ? { ...state, error: null } : DICTATION_EMPTY;
    if (!state.active) return state;
    if ((event.type.startsWith("dictation_") || event.type === "download") && event.captureId !== state.captureId) return state;
    switch (event.type) {
      case "download":
        if (state.phase !== "starting" || !(event.bytes > 0) || typeof event.id !== "string") return state;
        return state.download?.id === event.id && state.download.bytes === event.bytes ? state : { ...state, download: { id: event.id, bytes: event.bytes } };
      case "dictation_state":
        if (!["starting", "recording", "transcribing"].includes(event.state) || state.phase === "stopping") return state;
        return { ...state, phase: event.state };
      case "dictation_transcript":
        return typeof event.text === "string" && event.text !== state.text ? { ...state, text: event.text } : state;
      case "stop":
        return state.phase === "stopping" ? state : { ...state, phase: "stopping", error: null };
      case "stop_failure":
        return { ...state, phase: "error", error: event.error || "Could not stop voice to text" };
      case "start_failure":
      case "process_exit":
      case "dictation_end": {
        const error = typeof event.error === "string" && event.error ? event.error : null;
        return { ...state, active: false, phase: error ? "error" : "idle", text: typeof event.text === "string" ? event.text : state.text, error };
      }
      default:
        return state;
    }
  }
  // "Stop after a pause" (`seconds`, 0 = off): how long after the last text
  // change a recording capture stops by itself, or null for no timer. omp
  // sends new text only for sound it takes as speech, so no new text stands
  // in for silence. Nothing is armed before the first words: a capture you
  // have not spoken into yet waits for you.
  function autoStopDelay(dictation, seconds) {
    if (!dictation?.active || dictation.phase !== "recording" || !dictation.text) return null;
    return typeof seconds === "number" && seconds > 0 ? Math.round(seconds * 1000) : null;
  }
  // Names and hints of omp's dictation models (its `stt/models.ts`), by the
  // id `modelRoles.dictation` stores. Rust's `stt_models.rs` decides which
  // models are listed and whether each is downloaded. `mb` is a download
  // size that was measured (turbo: its two q4 files on Hugging Face, 334 MB
  // and 425 MB; omp's own hint says ~600 MB); the other sizes are omp's.
  const DICTATION_MODELS = Object.freeze({
    "local/whisper-large-v3-turbo": { name: "Whisper large v3 turbo", hint: "99 languages; the most accurate here for Vietnamese · ~760 MB", mb: 760 },
    "local/whisper-small": { name: "Whisper small", hint: "99 languages; lighter and quicker, more mistakes · ~190 MB" },
    "local/whisper-base": { name: "Whisper base", hint: "99 languages; the quickest and the least accurate · ~60 MB" },
    "local/parakeet-tdt-0.6b-v3": { name: "Parakeet TDT 0.6b v3", hint: "25 European languages, no Vietnamese · ~680 MB" },
    "local/nemotron-streaming-en-0.6b": { name: "Nemotron streaming", hint: "English only · ~630 MB" },
  });
  // What omp runs while `modelRoles.dictation` is unset.
  const DICTATION_DEFAULT = "local/parakeet-tdt-0.6b-v3";
  // The entry of `omp setup speech --check` for the model in use.
  const DICTATION_CHECK = "Speech-to-Text model";
  // The dictation models as Settings lists them: Rust's list (`sttModels`)
  // with a name and hint, which one `role` (`modelRoles.dictation`, "" =
  // unset) puts in use, and `downloaded`, where omp's own check (`models`)
  // answers for the model in use. A role value outside the list (a cloud
  // model, a later omp's) gets a row too, so the list always shows what is
  // set; its `downloaded` is null, because omp's check then reports some
  // on-device model, not that one.
  function modelRows({ sttModels = [], models = [] } = {}, role = "") {
    const inUse = role || DICTATION_DEFAULT;
    const check = models.find(m => m.name === DICTATION_CHECK);
    const rows = sttModels.map(m => ({
      id: m.id,
      name: DICTATION_MODELS[m.id]?.name ?? m.id,
      hint: DICTATION_MODELS[m.id]?.hint ?? "",
      inUse: m.id === inUse,
      downloaded: m.id === inUse && check ? check.ready : m.downloaded,
    }));
    if (!rows.some(r => r.inUse)) rows.unshift({ id: inUse, name: inUse, hint: "", inUse: true, downloaded: null });
    return rows;
  }
  // Whether a Download brings Kokoro along: `omp setup speech` installs
  // every missing speech model, not only the dictation model. True unless
  // omp's check says Kokoro is there, so an unread check still warns.
  const bundlesKokoro = ({ models = [] } = {}) => !models.some(m => m.name === "Text-to-Speech model" && m.ready);
  // The row a download belongs to: the one this page is starting (`busy`),
  // else the model in use while a download `running` elsewhere (started
  // before the page was opened) goes on; `omp setup speech` only ever
  // downloads the model in use.
  const downloadingId = (rows, busy, running) => busy ?? (running ? rows.find(r => r.inUse)?.id ?? null : null);
  // A starting capture's model download as the panel words it: the model's
  // name, the megabytes on disk and, where the size is known, the total.
  function downloadLine(download) {
    if (!download) return null;
    const model = DICTATION_MODELS[download.id];
    return { name: model?.name ?? download.id, mb: Math.floor(download.bytes / 1e6), totalMb: model?.mb ?? null };
  }
  const DICTATION = Object.freeze({ EMPTY: DICTATION_EMPTY, apply: applyDictation, autoStopDelay, MODELS: DICTATION_MODELS, modelRows, bundlesKokoro, downloadingId, downloadLine });
  // Hands-free conversation (Settings › Composer › Voice): a capture the
  // user starts while it is on stops after a pause and sends, the reply is
  // read aloud, and the microphone opens again once that has ended.
  // `armedTab` is the tab whose capture was started that way. A pause is
  // what ends the user's turn, so "off" falls back to HANDS_FREE_PAUSE.
  const HANDS_FREE_PAUSE = 2;
  function handsFreePause(seconds) {
    return typeof seconds === "number" && seconds > 0 ? seconds : HANDS_FREE_PAUSE;
  }
  /** What the end of a reply does to the microphone: "listen" opens it,
   *  "wait" keeps the turn for when Settings closes (nothing records behind
   *  it), "drop" forgets it (not armed here, or something else is going on). */
  function handsFreeNext({ enabled, armedTab, sessionId, streaming, dictating, calling, settingsOpen }) {
    if (!enabled || !armedTab || armedTab !== sessionId || streaming || dictating || calling) return "drop";
    return settingsOpen ? "wait" : "listen";
  }
  const HANDS_FREE = Object.freeze({ PAUSE: HANDS_FREE_PAUSE, pause: handsFreePause, next: handsFreeNext });
  // omp's live voice runs only on its Codex login (`openai-codex`): whether
  // the tab's profile has one, from `get_login_providers`; null = unknown.
  function codexLogin(providers) {
    if (!Array.isArray(providers)) return null;
    return providers.some(p => p?.id === "openai-codex" && p.authenticated === true);
  }
  const CODEX_MISSING = "Live conversation (Codex only): log in with /login → ChatGPT Plus/Pro (Codex Subscription)";
  // The composer's live-conversation button: its label (also the tooltip) and
  // whether it is clickable. Without a Codex login no call can start, but a
  // running one stays stoppable; an unknown login does not block.
  function liveButton(live, dictating, login) {
    const calling = !!live?.active;
    if (!calling && login === false) return { label: CODEX_MISSING, disabled: true };
    const action = calling ? (live.phase === "connecting" ? "Cancel live conversation" : "Stop live conversation")
      : live?.paused ? "Resume live conversation" : "Start live conversation";
    return { label: `${action} (Codex only)`, disabled: !!dictating || (calling && live.phase === "stopping") };
  }
  window.OMP_LIVE_VOICE = { EMPTY, LIMITS, CONNECTED_PHASES, apply, DICTATION, HANDS_FREE, meterLevel, codexLogin, liveButton, CODEX_MISSING };
})();
