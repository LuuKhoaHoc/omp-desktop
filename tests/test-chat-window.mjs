#!/usr/bin/env node
// Regression script for src/app/chat-window.js (the chat view's tail window).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const win = {};
runInNewContext(readFileSync(join(root, "src/app/chat-window.js"), "utf8"), { window: win });
const { TAIL_START, TAIL_STEP, startIndex, grow, revealing } = win.OMP_CHAT_WINDOW;

assert.equal(startIndex(10, TAIL_START), 0, "short transcript mounts everything");
assert.equal(startIndex(157, TAIL_START), 97, "long transcript mounts the newest rows");
assert.equal(startIndex(157, 157), 0);
assert.equal(grow(TAIL_START, 157), TAIL_START + TAIL_STEP);
assert.equal(grow(TAIL_START, 30), TAIL_START, "fully mounted: no growth");
assert.equal(grow(157, 157), 157);
assert.equal(revealing(TAIL_START, 157, 140), TAIL_START, "already mounted row keeps the window");
assert.equal(revealing(TAIL_START, 157, 20), 142, "an old row grows the window past it");
assert.equal(startIndex(157, revealing(TAIL_START, 157, 20)), 15, "revealed row is mounted");
console.log("test-chat-window: ok");
