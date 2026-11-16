#!/usr/bin/env node
// Regression script for src/app/tab-idle.js — which background tab's omp may
// be stopped: only a tab with nothing running, queued, pending or unsaved in
// it, a conversation file to resume, and a background time past the limit.
// Run: node tests/test-tab-idle.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const win = {};
// eslint-disable-next-line no-new-func
new Function("window", readFileSync(join(root, "src/app/tab-idle.js"), "utf8"))(win);
const { suspendable, SUSPEND_AFTER_MS } = win.OMP_TAB_IDLE;

const NOW = 1_000_000_000;
const LONG_AGO = NOW - SUSPEND_AFTER_MS - 1;
// A background tab that has gone quiet long enough: every check passes.
const base = () => ({
  isActive: false,
  respawning: false,
  suspending: false,
  suspended: false,
  sessionFile: "/home/u/.omp/agent/sessions/x.jsonl",
  backgroundedAt: LONG_AGO,
  now: NOW,
  subagentsLive: false,
  snap: { agentRunning: false, isStreaming: false, asyncPending: false, queue: [], queueSending: false, goal: null, liveVoice: null, dictation: null },
});
const with_ = (patch) => ({ ...base(), ...patch });
const withSnap = (patch) => with_({ snap: { ...base().snap, ...patch } });

let passed = 0;
function check(label, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`FAILED: ${label}`);
    throw err;
  }
  passed++;
}

check("a quiet background tab past the limit may be stopped", () => {
  assert.equal(suspendable(base()), true);
});

check("a tab waiting on an unanswered approval or ask is not stopped", () => {
  const open = { kind: "ask", answered: false, cancelled: false };
  assert.equal(suspendable(withSnap({ messages: [open] })), false);
  assert.equal(suspendable(withSnap({ messages: [{ ...open, answered: true }] })), true);
  assert.equal(suspendable(withSnap({ messages: [{ ...open, cancelled: true }] })), true);
});

check("the limit is ten minutes and inclusive at the boundary", () => {
  assert.equal(SUSPEND_AFTER_MS, 10 * 60 * 1000);
  assert.equal(suspendable(with_({ backgroundedAt: NOW - SUSPEND_AFTER_MS })), true);
  assert.equal(suspendable(with_({ backgroundedAt: NOW - SUSPEND_AFTER_MS + 1 })), false);
});

check("the active tab is never stopped", () => {
  assert.equal(suspendable(with_({ isActive: true })), false);
});

check("a tab being respawned, suspended or suspending is left alone", () => {
  assert.equal(suspendable(with_({ respawning: true })), false);
  assert.equal(suspendable(with_({ suspending: true })), false);
  assert.equal(suspendable(with_({ suspended: true })), false);
});

check("a tab with no conversation file has nothing to resume from", () => {
  assert.equal(suspendable(with_({ sessionFile: null })), false);
  assert.equal(suspendable(with_({ sessionFile: "" })), false);
});

check("a tab never shown since boot is not known to be idle", () => {
  assert.equal(suspendable(with_({ snap: null })), false);
});

check("a turn running, streaming or with a background job blocks the stop", () => {
  assert.equal(suspendable(withSnap({ agentRunning: true })), false);
  assert.equal(suspendable(withSnap({ isStreaming: true })), false);
  assert.equal(suspendable(withSnap({ asyncPending: true })), false);
});

check("queued messages or a queue being sent block the stop", () => {
  assert.equal(suspendable(withSnap({ queue: [{ text: "later" }] })), false);
  assert.equal(suspendable(withSnap({ queueSending: true })), false);
});

check("a live subagent, a goal, live voice or dictation block the stop", () => {
  assert.equal(suspendable(with_({ subagentsLive: true })), false);
  assert.equal(suspendable(withSnap({ goal: { status: "paused" } })), false);
  assert.equal(suspendable(withSnap({ liveVoice: { active: true } })), false);
  assert.equal(suspendable(withSnap({ dictation: { active: true } })), false);
});

check("a tab with no background time recorded is not stopped", () => {
  assert.equal(suspendable(with_({ backgroundedAt: null })), false);
  assert.equal(suspendable(with_({ backgroundedAt: undefined })), false);
});

console.log(`test-tab-idle: ${passed} checks passed`);
