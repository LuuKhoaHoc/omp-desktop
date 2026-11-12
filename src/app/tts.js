// app/tts.js — pure helpers for reading replies aloud (window.OMP_TTS;
// docs/architecture/read-aloud.md). The audio itself is made in Rust
// (src-tauri/src/tts.rs) and played by app/use-read-aloud.jsx.
//   ENGINES                       the speech engines and the voices offered
//   engine(id) / voice(id, v)     a stored tweak made valid
//   engineRows / voiceRows        Settings menu rows (PathPicker)
//   speakable(markdown)           a reply as plain sentences: no code, no markup
//   chunks(text)                  that text in pieces of a few sentences
//   replyText(messages)           the text of the reply a finished turn ended with
//   shouldSpeak(prev, next)       a run of the shown tab just ended
//   installTracker()              the installs under way, their progress and
//                                 last failure (live.js keeps one)
(function () {
  // Voice ids are the engines' own (Rust passes them on after a shape
  // check). Edge's multilingual voices read Vietnamese and English alike.
  const ENGINES = [
    { id: "edge", name: "Edge TTS", hint: "online", voices: [
      { id: "vi-VN-HoaiMyNeural", name: "Hoài My", hint: "Vietnamese" },
      { id: "vi-VN-NamMinhNeural", name: "Nam Minh", hint: "Vietnamese" },
      { id: "en-US-AvaMultilingualNeural", name: "Ava", hint: "multilingual" },
      { id: "en-US-AndrewMultilingualNeural", name: "Andrew", hint: "multilingual" },
      { id: "en-US-EmmaMultilingualNeural", name: "Emma", hint: "multilingual" },
      { id: "en-US-BrianMultilingualNeural", name: "Brian", hint: "multilingual" },
    ] },
    { id: "kokoro", name: "Kokoro", hint: "on this device, English", voices: [
      "af_heart", "af_bella", "af_nicole", "af_aoede", "af_kore", "af_sarah",
      "am_michael", "am_fenrir", "am_puck", "bf_emma", "bm_george", "bm_fable",
    ].map(id => ({ id, name: id, hint: id[0] === "a" ? "American" : "British" })) },
  ];

  /** The engine `id` names, else the first. */
  const engine = (id) => ENGINES.find(e => e.id === id) ?? ENGINES[0];
  /** `voiceId` when the engine has it, else the engine's first voice. */
  function voice(engineId, voiceId) {
    const voices = engine(engineId).voices;
    return (voices.find(v => v.id === voiceId) ?? voices[0]).id;
  }
  const engineRows = (engineId) => ENGINES.map(e => ({ name: e.name, hint: e.hint, path: "", value: e.id, checked: e.id === engine(engineId).id }));
  function voiceRows(engineId, voiceId) {
    const chosen = voice(engineId, voiceId);
    return engine(engineId).voices.map(v => ({ name: v.name, hint: v.hint, path: v.id, value: v.id, checked: v.id === chosen }));
  }
  function voiceName(engineId, voiceId) {
    const id = voice(engineId, voiceId);
    return engine(engineId).voices.find(v => v.id === id).name;
  }

  const FENCE = /^ {0,3}(`{3,}|~{3,})/;

  /** `markdown` as text worth hearing: fenced code, images, URLs and markup
   *  go; link text, inline code and table cells stay. */
  function speakable(markdown) {
    const out = [];
    let fence = null;
    for (const raw of String(markdown ?? "").split(/\r?\n/)) {
      const mark = FENCE.exec(raw)?.[1];
      if (fence) {
        if (mark && mark[0] === fence[0] && mark.length >= fence.length && raw.trim() === mark) fence = null;
        continue;
      }
      if (mark) { fence = mark; continue; }
      let line = raw.trim();
      // Rules and a table's `|---|` line say nothing.
      if (/^([-*_] ?){3,}$/.test(line) || /^\|?[\s:|-]+\|[\s:|-]*$/.test(line)) continue;
      if (line.startsWith("|")) line = line.replace(/^\||\|$/g, "").split("|").map(c => c.trim()).filter(Boolean).join(", ");
      line = line
        .replace(/^(#{1,6}|>+|[-*+]|\d+[.)])\s+/, "")
        .replace(/^\[[ xX]\]\s+/, "")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/<?\b(?:https?|file):\/\/[^\s>)]+>?/g, "")
        .replace(/<\/?[a-zA-Z][^>]*>/g, "")
        .replace(/(\*\*|__|~~|`)/g, "")
        .replace(/(^|[\s(])[*_]([^*_\s][^*_]*)[*_](?=$|[\s).,;:!?])/g, "$1$2")
        .replace(/\s+/g, " ")
        .trim();
      if (line) out.push(line);
    }
    return out.join("\n");
  }

  const CHUNK_MAX = 240;
  /** The first piece is about one sentence, so speech starts soon after
   *  the turn ends (Edge TTS answers in 1–6 s whatever the length). */
  const FIRST_MAX = 80;

  /** `text` (speakable's output) in pieces to synthesize one by one: whole
   *  sentences up to `max` characters, a longer sentence cut at a space. */
  function chunks(text, max = CHUNK_MAX, first = FIRST_MAX) {
    const sentences = [];
    for (const line of String(text ?? "").split("\n")) {
      for (const s of line.match(/[^.!?…]+[.!?…]*["')\]]*\s*|[.!?…]+\s*/g) ?? []) {
        let rest = s.trim();
        while (rest.length > max) {
          const cut = rest.lastIndexOf(" ", max);
          const at = cut > 0 ? cut : max;
          sentences.push(rest.slice(0, at).trim());
          rest = rest.slice(at).trim();
        }
        if (rest) sentences.push(rest);
      }
    }
    const out = [];
    let cur = "";
    for (const s of sentences) {
      const limit = out.length === 0 ? Math.min(first, max) : max;
      if (cur && cur.length + 1 + s.length > limit) { out.push(cur); cur = s; } else cur = cur ? `${cur} ${s}` : s;
    }
    if (cur) out.push(cur);
    return out;
  }

  /** The text blocks of the last assistant entry since the last user entry
   *  ("" when the turn ended on something else, or that entry still
   *  streams or failed). */
  function replyText(messages) {
    for (let i = (messages?.length ?? 0) - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.kind === "user") return "";
      if (m?.kind !== "assistant") continue;
      if (m.streaming || m.failure) return "";
      const text = (m.blocks ?? []).filter(b => b?.type === "text" && typeof b.text === "string").map(b => b.text).join("\n\n");
      if (text.trim()) return text;
    }
    return "";
  }

  /** `prev`/`next` are `{ sessionId, streaming }` of two renders: true when
   *  the shown tab's run ended between them (a tab switch is not an end). */
  function shouldSpeak(prev, next) {
    return !!prev && !!next && prev.streaming === true && next.streaming === false
      && !!next.sessionId && prev.sessionId === next.sessionId;
  }

  const INSTALL_STARTING = Object.freeze({ message: "", percent: null });
  /** The engine installs under way, by engine id. live.js holds one for
   *  the app, not the Settings page, so a page opened later still shows a
   *  download that is running, and why the last one failed. `owner` is
   *  whose install it is (the profile, for an engine installed per
   *  profile): another owner sees neither its progress nor its failure,
   *  and cannot start a second run of the engine beside it. */
  function installTracker() {
    const runs = new Map(); // engine → { owner, result, progress }
    const errors = new Map(); // engine + owner → why that owner's last run failed
    const subs = new Set();
    const changed = () => { for (const cb of [...subs]) cb(); };
    const key = (engine, owner) => `${engine}\n${owner}`;
    return {
      /** Start `engine`'s install with `run` (a promise of `{ ok, value |
       *  error }`), or join the one `owner` has under way. */
      start(engine, owner, run) {
        const current = runs.get(engine);
        if (current?.owner === owner) return current.result;
        if (current) {
          const error = "Another profile's install of this engine is still running";
          errors.set(key(engine, owner), error);
          changed();
          return Promise.resolve({ ok: false, error });
        }
        errors.delete(key(engine, owner));
        const entry = { owner, progress: INSTALL_STARTING, result: null };
        entry.result = run().then(res => {
          runs.delete(engine);
          if (!res.ok) errors.set(key(engine, owner), res.error);
          changed();
          return res;
        });
        runs.set(engine, entry);
        changed();
        return entry.result;
      },
      /** A progress line of `engine`'s run (Rust `tts://install`). */
      report(engine, { message, percent }) {
        const entry = runs.get(engine);
        if (!entry) return;
        entry.progress = { message: String(message ?? ""), percent: percent ?? null };
        changed();
      },
      /** `{ progress, error }` for `owner`: its running install's latest
       *  line (`message` "" before the first), or null when it runs none;
       *  its last failure. */
      state(engine, owner) {
        const entry = runs.get(engine);
        return { progress: entry?.owner === owner ? entry.progress : null, error: errors.get(key(engine, owner)) ?? null };
      },
      subscribe(cb) {
        subs.add(cb);
        return () => { subs.delete(cb); };
      },
    };
  }

  window.OMP_TTS = { ENGINES, CHUNK_MAX, engine, voice, voiceName, engineRows, voiceRows, speakable, chunks, replyText, shouldSpeak, installTracker };
})();
