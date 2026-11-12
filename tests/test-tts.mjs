#!/usr/bin/env node
// Regression script for src/app/tts.js. Run: node tests/test-tts.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const win = {};
// eslint-disable-next-line no-new-func
new Function("window", readFileSync(join(root, "src/app/tts.js"), "utf8"))(win);
const T = win.OMP_TTS;
let passed = 0;
function check(label, fn) {
  try { fn(); } catch (err) { console.error(`FAILED: ${label}`); throw err; }
  passed++;
}

check("a stored engine or voice that no longer exists falls back", () => {
  assert.equal(T.engine("piper").id, "edge");
  assert.equal(T.voice("edge", "af_heart"), "vi-VN-HoaiMyNeural");
  assert.equal(T.voice("kokoro", "vi-VN-HoaiMyNeural"), "af_heart");
  assert.equal(T.voice("edge", "vi-VN-NamMinhNeural"), "vi-VN-NamMinhNeural");
  assert.equal(T.voiceName("edge", "vi-VN-NamMinhNeural"), "Nam Minh");
});
check("every voice id passes Rust's shape check", () => {
  for (const e of T.ENGINES) for (const v of e.voices) assert.match(v.id, /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
});
check("menus tick exactly the chosen row", () => {
  assert.deepEqual(T.engineRows("kokoro").filter(r => r.checked).map(r => r.value), ["kokoro"]);
  assert.deepEqual(T.voiceRows("edge", "nope").filter(r => r.checked).map(r => r.value), ["vi-VN-HoaiMyNeural"]);
});

check("code blocks are skipped, a longer fence holds a shorter one", () => {
  const md = "Sửa xong.\n```js\nconst a = 1;\n```\nChạy lại test.\n````md\n```\nx\n```\n````\nHết.";
  assert.equal(T.speakable(md), "Sửa xong.\nChạy lại test.\nHết.");
});
check("an unclosed fence drops the rest", () => {
  assert.equal(T.speakable("Đây:\n```\nrm -rf /\nvẫn là code"), "Đây:");
});
check("markup goes, link text and inline code stay", () => {
  assert.equal(T.speakable("## Kết quả\n- **Xong** `npm test` ở [đây](https://x.dev/a_b).\n1. _một_ bước\n> ghi chú ![img](a.png)"),
    "Kết quả\nXong npm test ở đây.\nmột bước\nghi chú");
});
check("bare URLs and HTML tags are not read", () => {
  assert.equal(T.speakable("Xem https://example.com/a?b=1 nhé <br> rồi <b>thử</b>."), "Xem nhé rồi thử.");
});
check("identifiers keep their underscores", () => {
  assert.equal(T.speakable("gọi tts_speak và speech_config_get"), "gọi tts_speak và speech_config_get");
});
check("a table reads as rows of cells", () => {
  assert.equal(T.speakable("| Việc | Trạng thái |\n|---|:--:|\n| test | qua |\n---"), "Việc, Trạng thái\ntest, qua");
});

check("the first piece is short, later ones fill up to the limit", () => {
  const text = "Câu một ngắn. Câu hai cũng ngắn. Câu ba đây. Câu bốn nữa.";
  assert.deepEqual(T.chunks(text, 40, 20), ["Câu một ngắn.", "Câu hai cũng ngắn. Câu ba đây.", "Câu bốn nữa."]);
});
check("no piece exceeds the limit and no text is lost", () => {
  const long = `${"từ ".repeat(300)}hết. Xong!`;
  const parts = T.chunks(long);
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(p.length <= T.CHUNK_MAX, `${p.length}`);
  assert.equal(parts.join(" ").replace(/\s+/g, " "), long.replace(/\s+/g, " "));
});
check("a word longer than the limit is cut, not dropped", () => {
  assert.deepEqual(T.chunks("abcdefghij", 4, 4), ["abcd", "efgh", "ij"]);
});
check("nothing to say gives no pieces", () => {
  assert.deepEqual(T.chunks(""), []);
  assert.deepEqual(T.chunks(T.speakable("```\ncode only\n```")), []);
});

const text = (t, extra) => ({ kind: "assistant", streaming: false, blocks: [{ type: "text", text: t }], ...extra });
check("the reply is the last assistant text since the user's message", () => {
  const msgs = [{ kind: "user" }, text("đang làm"), { kind: "tool" }, text("xong rồi"), { kind: "note" }];
  assert.equal(T.replyText(msgs), "xong rồi");
});
check("an older turn's reply is never read again", () => {
  assert.equal(T.replyText([text("cũ"), { kind: "user" }, { kind: "tool" }]), "");
});
check("a streaming or failed reply is not read", () => {
  assert.equal(T.replyText([{ kind: "user" }, text("dở", { streaming: true })]), "");
  assert.equal(T.replyText([{ kind: "user" }, text("lỗi", { failure: { message: "x" } })]), "");
});
check("a reply with only non-text blocks falls back to the one before", () => {
  const msgs = [{ kind: "user" }, text("giải thích"), { kind: "assistant", streaming: false, blocks: [{ type: "plan", text: "p" }] }];
  assert.equal(T.replyText(msgs), "giải thích");
});

check("only the end of the shown tab's run speaks", () => {
  const a = (streaming, sessionId = "a") => ({ sessionId, streaming });
  assert.equal(T.shouldSpeak(a(true), a(false)), true);
  assert.equal(T.shouldSpeak(a(false), a(false)), false);
  assert.equal(T.shouldSpeak(a(false), a(true)), false);
  assert.equal(T.shouldSpeak(a(true, "a"), a(false, "b")), false);
  assert.equal(T.shouldSpeak(null, a(false)), false);
  assert.equal(T.shouldSpeak(a(true, ""), a(false, "")), false);
});

// One run per engine, its progress, and the failure kept for a page that
// opens after the run ended.
{
  const tracker = T.installTracker();
  let changes = 0;
  const off = tracker.subscribe(() => { changes++; });
  let finish;
  let runs = 0;
  const run = () => { runs++; return new Promise(resolve => { finish = resolve; }); };
  const first = tracker.start("kokoro", "work", run);
  const joined = tracker.start("kokoro", "work", run);
  const starting = tracker.state("kokoro", "work");
  tracker.report("kokoro", { message: "Downloading Whisper model (37%)", percent: 37 });
  tracker.report("edge", { message: "not running", percent: 1 });
  const reported = tracker.state("kokoro", "work");
  const elsewhere = tracker.state("kokoro", "");
  const refused = await tracker.start("kokoro", "", run);
  const refusedState = tracker.state("kokoro", "");
  finish({ ok: false, error: "omp setup speech timed out" });
  const result = await first;
  const failed = tracker.state("kokoro", "work");
  const changesAtEnd = changes;
  const second = tracker.start("kokoro", "work", () => Promise.resolve({ ok: true, value: [] }));
  const restarted = tracker.state("kokoro", "work");
  await second;
  off();
  tracker.start("edge", "", () => Promise.resolve({ ok: true, value: [] }));
  check("an engine installs once at a time, and its progress and failure outlive the page", () => {
    assert.equal(joined, first, "a second click joins the run");
    assert.equal(runs, 1);
    assert.deepEqual(starting, { progress: { message: "", percent: null }, error: null });
    assert.deepEqual(reported, { progress: { message: "Downloading Whisper model (37%)", percent: 37 }, error: null });
    assert.deepEqual(tracker.state("edge", "").error, null, "a line for an engine that is not installing is dropped");
    assert.deepEqual(elsewhere, { progress: null, error: null }, "another profile's page does not show this download");
    assert.equal(refused.ok, false, "and cannot start the engine's install beside it");
    assert.deepEqual(refusedState, { progress: null, error: refused.error });
    assert.deepEqual(result, { ok: false, error: "omp setup speech timed out" });
    assert.deepEqual(failed, { progress: null, error: "omp setup speech timed out" });
    assert.equal(changesAtEnd, 4, "start, one line, the refusal, end");
    assert.deepEqual(restarted, { progress: { message: "", percent: null }, error: null }, "a new run clears the last failure");
    assert.deepEqual(tracker.state("kokoro", "work"), { progress: null, error: null });
    assert.equal(changes, 6, "nothing after the unsubscribe");
  });
}

console.log(`test-tts: ${passed} checks passed`);
