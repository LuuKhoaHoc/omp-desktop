import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInNewContext(fs.readFileSync(new URL("../src/app/quota-rpc.js", import.meta.url), "utf8"), {
  window, setTimeout, clearTimeout,
});
const handlers = new Map();
const sent = [];
const tauri = {
  event: { async listen(name, callback) {
    handlers.set(name, callback);
    return () => handlers.delete(name);
  } },
  core: { async invoke(name, args) { sent.push({ name, args }); } },
};
const frames = [];
const client = window.OMP_QUOTA_RPC.create("tab-a", tauri, frame => frames.push(frame));
await client.ready;
const pending = client.request({ type: "get_session_stats" });
await new Promise(resolve => setImmediate(resolve));
assert.equal(sent[0].name, "send_command");
assert.equal(sent[0].args.sessionId, "tab-a");
const command = JSON.parse(sent[0].args.json);
assert.equal(command.type, "get_session_stats");
const emit = (seq, frame) => handlers.get("agent://line/tab-a")({ payload: { seq, text: JSON.stringify(frame) } });
emit(1, { type: "response", id: "unrelated", success: true, data: 99 });
emit(2, { type: "response", id: command.id, success: true, data: { cost: 0.12 } });
assert.equal((await pending).cost, 0.12);
emit(2, { type: "session_settled" });
assert.equal(frames.length, 2, "duplicate envelopes must not settle accounting twice");
const failed = client.request({ type: "get_state" });
await new Promise(resolve => setImmediate(resolve));
const second = JSON.parse(sent[1].args.json);
emit(3, { type: "response", id: second.id, success: false, error: "native refusal" });
await assert.rejects(failed, /native refusal/);
const disconnected = client.request({ type: "get_state" });
await new Promise(resolve => setImmediate(resolve));
handlers.get("agent://exit/tab-a")({ payload: "" });
await assert.rejects(disconnected, /disconnected/);
client.close();
await new Promise(resolve => setImmediate(resolve));
assert.equal(handlers.size, 0);
console.log("quota RPC: correlated replies, dedupe, native refusal, exit and cleanup pass");
