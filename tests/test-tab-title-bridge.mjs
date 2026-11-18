#!/usr/bin/env node
// Bridge regressions for tab titles around tab switches (live.js):
// a background tab gets its first automatic title when its turn ends, not
// when it is next shown; a background `session_info_update` renames the tab
// at once; the replay on activation keeps that title, swallows the outcome
// note, and publishes one snapshot instead of one per replayed frame.
// Run: node tests/test-tab-title-bridge.mjs  (or: npm run test:tab-title-bridge)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = (path) => readFileSync(fileURLToPath(new URL(`../src/${path}`, import.meta.url)), "utf8");
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

function harness({ autoName = true } = {}) {
  // Several listeners per event name, as in Tauri: the active tab's stream
  // listener and the background title watcher share `agent://line/{id}`.
  const listeners = new Map();
  const journal = new Map();
  const commands = [];
  const w = {
    OMP_SLASH: { LOCAL_COMMANDS: [] },
    OMP_SUBAGENTS: {
      emptySubagents: () => ({}), subscriptionLevelFor: () => "progress",
      listAgents: () => [], isLive: () => false,
    },
    OMP_EXT_WIDGETS: { EMPTY: {} },
    OMP_SESSION_PREFS: {
      fromTweaks: () => ({ autoCompaction: true, autoRetry: true, autoName }),
      closeGuardArmed: () => false,
    },
    OMP_TWEAKS_STORE: { read: () => ({}) },
    OMP_APPROVAL_MODE: { isMode: () => true },
    DEFAULT_PROFILE_ID: "default",
    INTENT_FRAMING: () => "",
    timeNow: () => "00:00",
  };
  for (const path of [
    "app/project-nav.js", "app/message-queue.js", "app/goal.js", "app/prompt-history.js",
    "app/session-title.js", "app/turn-status.js", "app/live-voice.js",
    "app/transcript-merge.js", "adapter.js", "app/pr-automation.js",
    "app/coalesce.js", "app/tab-idle.js",
  ]) new Function("window", source(path))(w); // eslint-disable-line no-new-func
  const timeout = (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; };
  new Function("window", "setTimeout", "clearTimeout", source("live.js"))(w, timeout, clearTimeout); // eslint-disable-line no-new-func

  function emit(id, frame) {
    const entries = journal.get(id) ?? [];
    const envelope = { seq: entries.length + 1, text: JSON.stringify(frame) };
    entries.push(envelope);
    journal.set(id, entries);
    for (const cb of [...(listeners.get(`agent://line/${id}`) ?? [])]) cb({ payload: envelope });
  }
  w.__TAURI__ = {
    core: {
      async invoke(command, args) {
        if (command === "start_session") return "write";
        if (command === "start_git_watch") return { branch: "develop", root: "/repo" };
        if (command === "list_profiles") return { profiles: [{ id: "default", name: "default" }] };
        if (command === "replay_events") {
          return { dropped: false, events: (journal.get(args.sessionId) ?? []).filter(e => e.seq > args.afterSeq) };
        }
        if (command === "send_command") {
          const cmd = { ...JSON.parse(args.json), sessionId: args.sessionId };
          commands.push(cmd);
          if (cmd.type === "negotiate_protocol" || cmd.type === "set_ask_dialog") {
            queueMicrotask(() => emit(cmd.sessionId, { type: "response", command: cmd.type, id: cmd.id, success: true, data: null }));
          }
        }
        return null;
      },
    },
    event: {
      async listen(name, callback) {
        const set = listeners.get(name) ?? new Set();
        set.add(callback);
        listeners.set(name, set);
        return () => listeners.get(name)?.delete(callback);
      },
    },
  };
  const bridge = w.OMP_BRIDGE;
  const snapshots = [];
  bridge.onUpdate(s => snapshots.push(s));
  const renames = id => commands.filter(c => c.sessionId === id && c.type === "prompt" && c.message === "/rename");
  const tab = id => snapshots.at(-1).sessions.find(s => s.id === id);
  return { bridge, emit, commands, snapshots, renames, tab };
}

const reply = { type: "agent_end", yielded: true, messages: [
  { role: "user", content: "hi" },
  { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "hello" }] },
] };

let passed = 0;
async function check(label, fn) {
  try { await fn(); } catch (err) { console.error(`FAILED: ${label}`); throw err; }
  passed++;
}

await check("a background tab is titled when its first turn ends, and keeps that title when shown", async () => {
  const h = harness();
  const a = await h.bridge.openSession("/p/erp-admin");
  await flush();
  const b = await h.bridge.openSession("/p/other");
  await flush();
  assert.equal(h.snapshots.at(-1).activeSessionId, b);
  assert.equal(h.tab(a).name, "erp-admin");

  h.emit(a, { type: "agent_start" });
  h.emit(a, reply);
  await flush();
  assert.equal(h.renames(a).length, 1, "the first /rename goes to the background tab");
  assert.equal(h.renames(b).length, 0, "never to the shown tab");

  h.emit(a, { type: "session_info_update", title: "Implement Issue 74" });
  h.emit(a, { type: "command_output", text: "Session renamed to Implement Issue 74." });
  assert.equal(h.tab(a).name, "Implement Issue 74", "renamed while still in the background");
  assert.equal(h.snapshots.at(-1).activeSessionId, b);

  const from = h.snapshots.length;
  await h.bridge.activateSession(a);
  await flush();
  const during = h.snapshots.slice(from);
  assert.ok(during.every(s => s.sessions.find(t => t.id === a).name === "Implement Issue 74"),
    "no snapshot during the switch shows another title");
  assert.equal(h.renames(a).length, 1, "activation does not send a second /rename");
  const notes = h.bridge.getState().messages.filter(m => JSON.stringify(m).includes("Session renamed to"));
  assert.equal(notes.length, 0, "the outcome note is swallowed on replay");
});

await check("the replay on activation publishes one snapshot, not one per frame", async () => {
  const h = harness();
  const a = await h.bridge.openSession("/p/erp-admin");
  await flush();
  await h.bridge.openSession("/p/other");
  await flush();
  for (let i = 0; i < 20; i++) h.emit(a, { type: "session_info_update", title: `title ${i}` });
  const from = h.snapshots.length;
  await h.bridge.activateSession(a);
  await flush();
  const titles = h.snapshots.slice(from).map(s => s.sessions.find(t => t.id === a).name);
  assert.ok(titles.length < 20, `${titles.length} snapshots for 20 replayed frames`);
  assert.ok(titles.every(t => t === "title 19"), `titles seen: ${[...new Set(titles)].join(", ")}`);
});

await check("no background /rename while naming is off, after a failed turn, or for the shown tab", async () => {
  const off = harness({ autoName: false });
  const a = await off.bridge.openSession("/p/erp-admin");
  await flush();
  await off.bridge.openSession("/p/other");
  await flush();
  off.emit(a, reply);
  await flush();
  assert.equal(off.renames(a).length, 0, "Name tabs automatically is off");

  const h = harness();
  const c = await h.bridge.openSession("/p/erp-admin");
  await flush();
  const d = await h.bridge.openSession("/p/other");
  await flush();
  h.emit(c, { type: "agent_end", yielded: true, messages: [{ role: "assistant", stopReason: "error" }] });
  await flush();
  assert.equal(h.renames(c).length, 0, "a failed turn spends nothing");
  h.emit(d, reply);
  await flush();
  assert.equal(h.commands.filter(x => x.type === "prompt" && x.message === "/rename" && x.sessionId === d).length, 0,
    "the shown tab renames through get_state, not the watcher");
});

console.log(`ok — test-tab-title-bridge.mjs (${passed} checks)`);
