#!/usr/bin/env node
// Regression script for src/app/local-stt.js and local-stt routing in src/live.js.
// Run: node tests/test-local-stt.mjs  (or: npm run test:local-stt)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
async function check(label, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`FAILED: ${label}`);
    throw err;
  }
  passed++;
}

function loadLocalStt() {
  const win = {};
  new Function("window", readFileSync(join(root, "src/app/local-stt.js"), "utf8"))(win);
  return win.OMP_LOCAL_STT;
}

const L = loadLocalStt();

await check("pure helpers: engine, model selection, vocabulary, auto-stop", () => {
  assert.equal(L.isLocalEngine(null), false);
  assert.equal(L.isLocalEngine({ config: { engine: "omp" } }), false);
  assert.equal(L.isLocalEngine({ config: { engine: "local" } }), true);

  const st = {
    config: { engine: "local", model: "whisper-large-v3-turbo" },
    models: [
      { id: "qwen3-asr-0.6b", name: "Qwen3-ASR 0.6B", downloaded: true },
      { id: "whisper-large-v3-turbo", name: "Whisper large-v3-turbo", downloaded: false },
    ],
  };
  assert.equal(L.selectedModel(st).id, "whisper-large-v3-turbo");
  assert.deepEqual(L.parseVocabulary("  Tauri, Rust, Tauri \n qwen3 , , omp-desktop "), ["Tauri", "Rust", "qwen3", "omp-desktop"]);
  assert.equal(L.formatVocabulary(["Tauri", "Rust"]), "Tauri, Rust");
  assert.equal(L.localAutoStopMs(0, false), 0);
  assert.equal(L.localAutoStopMs(1.5, false), 1500);
  assert.equal(L.localAutoStopMs(0, true, 2), 2000);
  assert.equal(L.localAutoStopMs(3, true, 2), 3000);
});

await check("canStartLocalDictation checks uv, runtime, vad, and selected model", () => {
  assert.equal(L.canStartLocalDictation(null).ok, false);
  assert.match(L.canStartLocalDictation({ cacheAvailable: false }).reason, /cache/i);
  assert.match(L.canStartLocalDictation({ cacheAvailable: true, uvInstalled: false }).reason, /uv/i);
  assert.match(L.canStartLocalDictation({ cacheAvailable: true, uvInstalled: true, runtimeInstalled: false, vadDownloaded: true }).reason, /runtime/i);
  assert.match(L.canStartLocalDictation({
    cacheAvailable: true,
    uvInstalled: true,
    runtimeInstalled: true,
    vadDownloaded: true,
    config: { model: "qwen3-asr-0.6b" },
    models: [{ id: "qwen3-asr-0.6b", name: "Qwen3-ASR 0.6B", downloaded: false }],
  }).reason, /Qwen3-ASR 0\.6B/);
  assert.equal(L.canStartLocalDictation({
    cacheAvailable: true,
    uvInstalled: true,
    runtimeInstalled: true,
    vadDownloaded: true,
    config: { model: "qwen3-asr-0.6b" },
    models: [{ id: "qwen3-asr-0.6b", name: "Qwen3-ASR 0.6B", downloaded: true }],
  }).ok, true);
});

await check("reduceInstallEvent tracks progress and clears on clean completion", () => {
  let state = L.reduceInstallEvent(null, { kind: "model", id: "qwen3-asr-0.6b", downloaded: 250_000_000, total: 500_000_000, message: "Downloading…", done: false });
  assert.equal(state.percent, 50);
  assert.match(L.formatInstallLabel(state), /250 \/ 500 MB/);
  state = L.reduceInstallEvent(state, { kind: "model", id: "qwen3-asr-0.6b", done: true, error: null });
  assert.equal(state, null);
  const failed = L.reduceInstallEvent(null, { kind: "runtime", id: "runtime", done: true, error: "network down" });
  assert.equal(failed.error, "network down");
});

function loadBridgeWithLocalStt({ status, statusError = null, statusPromise = null }) {
  const listeners = new Map();
  const invokes = [];
  const doc = {
    documentElement: { classList: { add() {} } },
    readyState: "complete",
    addEventListener() {},
    querySelectorAll: () => [],
  };
  const win = {
    document: doc,
    location: { search: "" },
    localStorage: { getItem: () => null, setItem() {} },
    OMP_PLATFORM: { defaultBridgeHint: () => "Ctrl+K", paletteTipFor: k => k },
    timeNow: () => "12:00",
    truncateText: s => s,
    adaptAgentMessages: () => [],
    __TAURI__: {
      core: {
        invoke: async (cmd, args) => {
          invokes.push({ cmd, args });
          if (cmd === "local_stt_status") {
            if (statusPromise) return statusPromise;
            if (statusError) throw new Error(statusError);
            return status;
          }
          if (cmd === "local_stt_start") return null;
          if (cmd === "local_stt_stop") return "xin chào từ qwen3";
          if (cmd === "list_profiles") return { profiles: [{ id: "default", name: "Default" }], startup: "default" };
          if (cmd === "approval_mode_get") return { default: "auto", projects: {} };
          if (cmd === "open_tabs_load") return { tabs: [], skipped: [], active: 0 };
          if (cmd === "start_session") return "tab-1";
          if (cmd === "replay_events") return { events: [], dropped: false };
          if (cmd === "session_status") return null;
          if (cmd === "send_command") return null;
          if (cmd === "set_close_guard") return null;
          return null;
        },
      },
      event: {
        listen: async (event, cb) => {
          listeners.set(event, cb);
          return () => listeners.delete(event);
        },
      },
      window: {
        getCurrentWindow: () => ({
          isMaximized: async () => false,
          onResized: async () => () => {},
          minimize: async () => {},
          toggleMaximize: async () => {},
          close: async () => {},
        }),
      },
    },
  };
  const files = [
    "src/app/constants.js",
    "src/app/slash-commands.js",
    "src/app/prompt-history.js",
    "src/app/subagents.js",
    "src/app/project-nav.js",
    "src/app/session-ui.js",
    "src/app/live-voice.js",
    "src/app/local-stt.js",
    "src/app/message-queue.js",
    "src/app/ask-dialog.js",
    "src/app/approval-mode.js",
    "src/app/approval.js",
    "src/app/turn-status.js",
    "src/app/session-prefs.js",
    "src/app/transcript-merge.js",
    "src/app/session-title.js",
    "src/app/stream-delta.js",
    "src/app/goal.js",
    "src/app/extension-widgets.js",
    "src/design/tweaks/use-tweaks.js",
    "src/live.js",
  ];
  const timeout = (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; };
  for (const f of files) {
    const src = readFileSync(join(root, f), "utf8");
    if (f === "src/live.js") {
      new Function("window", "document", "setTimeout", "clearTimeout", src)(win, doc, timeout, clearTimeout);
    } else {
      new Function("window", "document", src)(win, doc);
    }
  }
  const emit = (event, payload) => listeners.get(event)?.({ payload });
  return { bridge: win.OMP_BRIDGE, invokes, emit };
}

await check("live.js routes local dictation through local_stt commands and survives omp exit", async () => {
  const readyStatus = {
    config: { engine: "local", model: "qwen3-asr-0.6b", backend: "auto", language: "vi", vocabulary: [], contextPrompt: "" },
    uvInstalled: true,
    runtimeInstalled: true,
    vadDownloaded: true,
    cacheAvailable: true,
    models: [{ id: "qwen3-asr-0.6b", name: "Qwen3-ASR 0.6B", downloaded: true }],
  };
  const { bridge, invokes, emit } = loadBridgeWithLocalStt({ status: readyStatus });
  await bridge.openSession("/tmp/proj");
  await bridge.localSttStatus();

  const started = await bridge.dictationStart({ autoStopMs: 2000, sendOnAutoStop: true });
  assert.equal(started.ok, true);
  const startCall = invokes.find(c => c.cmd === "local_stt_start");
  assert.ok(startCall, "local_stt_start invoked instead of omp dictation_start");
  assert.equal(startCall.args.autoStopMs, 2000);
  const captureId = startCall.args.captureId;

  emit("local-stt://state", { captureId, state: "recording" });
  assert.equal(bridge.getState().dictation.phase, "recording");

  // omp process exit on active tab must NOT cancel local STT
  emit("agent://exit/tab-1", "omp crashed");
  assert.equal(bridge.getState().dictation.active, true);

  emit("local-stt://transcript", { captureId, text: "xin chào" });
  assert.equal(bridge.getState().dictation.text, "xin chào");

  emit("local-stt://end", { captureId, text: "xin chào qwen3", error: null, autoStopped: true });
  assert.equal(bridge.getState().dictation.active, false);
  let snap;
  bridge.onUpdate(s => { snap = s; })();
  assert.equal(snap.dictationCompleted.length, 1);
  assert.equal(snap.dictationCompleted[0].text, "xin chào qwen3");
  assert.equal(snap.dictationCompleted[0].send, true);
  bridge.ackDictation([captureId]);

  // Manual stop without send
  const s2 = await bridge.dictationStart({ autoStopMs: 0, sendOnAutoStop: true });
  assert.equal(s2.ok, true);
  const cid2 = invokes.filter(c => c.cmd === "local_stt_start").at(-1).args.captureId;
  emit("local-stt://state", { captureId: cid2, state: "recording" });
  const stopped = await bridge.dictationStop({ send: false });
  assert.equal(stopped.ok, true);
  assert.ok(invokes.some(c => c.cmd === "local_stt_stop" && c.args.captureId === cid2));
  bridge.onUpdate(s => { snap = s; })();
  assert.equal(snap.dictationCompleted.at(-1).send, false);
});

await check("live.js refuses local dictation when selected model is not downloaded", async () => {
  const missingModel = {
    config: { engine: "local", model: "qwen3-asr-0.6b", backend: "auto", language: "", vocabulary: [], contextPrompt: "" },
    uvInstalled: true,
    runtimeInstalled: true,
    vadDownloaded: true,
    cacheAvailable: true,
    models: [{ id: "qwen3-asr-0.6b", name: "Qwen3-ASR 0.6B", downloaded: false }],
  };
  const { bridge, invokes } = loadBridgeWithLocalStt({ status: missingModel });
  await bridge.openSession("/tmp/proj");
  await bridge.localSttStatus();
  const res = await bridge.dictationStart();
  assert.equal(res.ok, false);
  assert.match(res.error, /not downloaded/i);
  assert.equal(invokes.some(c => c.cmd === "local_stt_start"), false);
});

await check("live.js fails closed when local_stt_status errors and deduplicates rapid concurrent starts", async () => {
  const failed = loadBridgeWithLocalStt({ status: null, statusError: "ipc down" });
  await failed.bridge.openSession("/tmp/proj");
  const errRes = await failed.bridge.dictationStart();
  assert.equal(errRes.ok, false);
  assert.match(errRes.error, /ipc down/);
  assert.equal(failed.invokes.some(c => c.cmd === "send_command" && c.args?.command?.type === "dictation_start"), false);

  const readyStatus = {
    config: { engine: "local", model: "qwen3-asr-0.6b", backend: "auto", language: "vi", vocabulary: [], contextPrompt: "" },
    uvInstalled: true,
    runtimeInstalled: true,
    vadDownloaded: true,
    cacheAvailable: true,
    models: [{ id: "qwen3-asr-0.6b", name: "Qwen3-ASR 0.6B", downloaded: true }],
  };
  const rapid = loadBridgeWithLocalStt({ status: readyStatus });
  await rapid.bridge.openSession("/tmp/proj");
  const [r1, r2] = await Promise.all([rapid.bridge.dictationStart(), rapid.bridge.dictationStart()]);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(rapid.invokes.filter(c => c.cmd === "local_stt_start").length, 1);
});

await check("live.js cancels pre-await local dictation start if tab switches before status resolves", async () => {
  let resolveStatus;
  const delayedStatus = new Promise(resolve => { resolveStatus = resolve; });
  const readyStatus = {
    config: { engine: "local", model: "qwen3-asr-0.6b", backend: "auto", language: "vi", vocabulary: [], contextPrompt: "" },
    uvInstalled: true,
    runtimeInstalled: true,
    vadDownloaded: true,
    cacheAvailable: true,
    models: [{ id: "qwen3-asr-0.6b", name: "Qwen3-ASR 0.6B", downloaded: true }],
  };
  const h = loadBridgeWithLocalStt({ status: readyStatus, statusPromise: delayedStatus });
  const tab1 = await h.bridge.openSession("/tmp/proj-a");
  const tab2 = await h.bridge.openSession("/tmp/proj-b");
  await h.bridge.activateSession(tab1);

  const starting = h.bridge.dictationStart();
  const switching = h.bridge.activateSession(tab2);
  resolveStatus(readyStatus);

  const [startRes] = await Promise.all([starting, switching]);
  assert.equal(startRes.ok, false);
  assert.equal(h.invokes.some(c => c.cmd === "local_stt_start"), false);
  let snap;
  h.bridge.onUpdate(s => { snap = s; })();
  assert.equal(snap.activeSessionId, tab2);
  assert.equal(snap.dictation.active, false);
});

console.log(`test-local-stt: ${passed} checks passed`);
