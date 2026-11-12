# Read aloud and voice settings

Settings → Voice. Two things live there: the app reading replies aloud (its own feature), and a front for omp's voice to text / live voice settings.

## Why the app speaks, not omp

omp speaks replies only in its terminal UI (`modes/controllers/event-controller.ts` feeds its vocalizer). `omp --mode rpc-ui` never reads `speech.enabled`, so the setting does nothing in a tab of this app. omp's vocalizer also only runs the on-device Kokoro model, which speaks English. Reading aloud is therefore built here, and `speech_config.rs` leaves omp's `speech.*` settings out on purpose.

## Flow

1. `app/use-read-aloud.jsx` watches `{ sessionId, streaming }` of the shown tab. `OMP_TTS.shouldSpeak` is true for the render where the same tab's run went from streaming to not streaming; a tab switch is not an end.
2. `OMP_TTS.replyText(messages)` takes the text blocks of the last assistant entry since the last user entry (nothing when that entry still streams or failed). `speakable` drops fenced code, images, URLs, HTML tags and markdown marks; `chunks` cuts the rest into whole sentences, a first piece of about one sentence (≤ 80 characters) so speech starts early, then pieces up to 240.
3. Each piece goes to Rust: `tts_speak { engine, voice, speed, text, profile }` → `{ mime, data }` (the audio file in base64). The hook decodes it with `AudioContext.decodeAudioData` and plays it through a buffer source; up to two pieces ahead are requested while one plays (measured: Edge TTS answers in 1–6 s regardless of length, so one piece ahead leaves audible gaps). No `<audio>` element and no URL, so the CSP is unchanged.
4. A new run, a tab switch, turning the setting off, unmount or `stop` cancels: the playing source stops and results still in flight are dropped.

The composer shows `ReadAloudPanel` (`design/live-voice.jsx`) while speaking, with `stop`, and the reason a piece failed with the same × as the other voice panels.

## Engines (`src-tauri/src/tts.rs`)

The webview names an engine by id; Rust owns the program, its arguments and the files.

|id|program|voices|install (`tts_install`)|output|
|---|---|---|---|---|
|`edge`|`edge-tts`, found in `child_path_dirs()`|Microsoft Edge's online voices; the menu offers `vi-VN-HoaiMyNeural`, `vi-VN-NamMinhNeural` and four multilingual ones|`uv tool install edge-tts` (needs `uv`)|mp3|
|`kokoro`|`omp say` (the tab profile's omp)|omp's 12 English Kokoro voices|`omp setup speech`, which also downloads the voice to text model the profile has chosen|wav|

- Edge TTS is online and unofficial: the text of each piece is sent to the service Edge's own Read aloud uses. The Settings description says so.
- `tts_speak` writes the text to a private file under `<app cache>/tts`, runs the engine with `--file`/`--write-media` (edge) or `--file`/`--out` (omp say), reads the audio file back and removes both. Text never travels in argv.
- Checks before a spawn: engine id is one of the two; voice is ASCII letters, digits, `-`, `_`, at most 64 bytes, never starting with `-`; text is non-blank and at most 8 KiB; speed is clamped to 0.5–2.5 (edge takes it as `--rate=+25%`, one argument).
- Every run goes through `spawn_gate::spawn` under `ProcessSupervisor` and `child_run`: 120 s for a piece and 5 min for the edge install (`collect`, stdout capped), 2 h for `omp setup speech` (`collect_streamed`, no stdout cap); the tree is killed on the way out. A failure's message is the last three non-blank lines of stderr.
- `omp setup speech` rewrites one status line (`\r<stage> (N%)\x1b[K`) per download event: megabytes over a large model, which a stdout cap takes for a runaway (the 256 KiB cap killed every download after about a minute). `progress_lines.rs` cuts that stream into lines, drops escapes and repeats, and `tts_install` emits each change as `tts://install` `{ engine, message, percent }`. One `omp setup speech` runs at a time (`tts.rs` `KokoroInstall`).
- The webview keeps installs in `OMP_TTS.installTracker` (one in `live.js`, not in the Settings page): `ttsInstall` joins a run under way, `ttsInstallState(engine, profile)` is `{ progress, error }` (the latest line of a running install; why the last one failed) and `onTtsInstall` subscribes. A Settings page opened during a download shows it, and the row shows the line, a bar when it carries a percent, and the failure under the row it belongs to. A Kokoro install belongs to the profile it was started for (`live.js` `_ttsInstallOwner`): another profile's page shows neither its progress nor its failure, and its own Download is refused until that run ends, as Rust would refuse it.
- `tts_status` reports `{ id, installed, detail }` per engine: edge by locating the program, Kokoro from `omp setup speech --check --json` (`speech_config::tts_model`).

Tweaks (desktop-owned, `TWEAK_DEFAULTS`): `ttsEnabled` (off), `ttsEngine` (`edge`), `ttsVoice` (`vi-VN-HoaiMyNeural`), `ttsSpeed` (1). A stored engine or voice that no longer exists falls back through `OMP_TTS.engine` / `OMP_TTS.voice`. Changing the engine resets the voice to that engine's first.

## Hands-free conversation

Tweak `handsFree` (Settings → Composer → Voice, off). It turns omp's dictation into a turn-taking loop without a Codex login; nothing new runs in Rust.

- **Arming.** `app-live.jsx` keeps `handsFreeTab`: the tab whose capture the user started (`requestDictationAction("start")`) while the setting is on. The user's own stop, `end` on the panel, a failed start, a dictation error, showing another tab or turning the setting off clears it.
- **The user's turn ends on a pause.** While armed, the auto-stop timer uses `OMP_LIVE_VOICE.HANDS_FREE.pause(dictationAutoStop)` (2 s when that setting is off) and stops with `send: true` whatever `dictationSend` says; the composer sends the draft as for any send-on-stop.
- **Reading is the user's setting.** Hands-free never reads by itself: the reply is read only when `ttsEnabled` is on (with Edge TTS that sends the text to Microsoft, which is why the loop must not switch it on). With it off the microphone reopens as soon as the run ends, and the panel says so.
- **The microphone reopens when the reply is over.** `useReadAloud` counts `turn`: a run of the shown tab ended and its reply was read to the end, had nothing to read, failed to synthesize, or reading is off. A reading cut short (`stop`, a new run, a tab switch) does not count. On each `turn`, `HANDS_FREE.next(...)` decides: `listen` (armed tab shown, no run, no capture, no live conversation), `wait` (the same behind Settings: the turn is kept and the microphone opens when Settings closes) or `drop`. So the microphone never hears the app's own voice.
- **Panel.** `DictationPanel` takes `handsFree` (`{ armed, reads, end }`): its title reads `hands-free`, and between captures it stays with `listens again after the reply` (plus `read aloud is off` when it is) and an `end` button.

It needs omp's voice to text working (`stt.enabled`, a downloaded dictation model); a failed start shows omp's reason and disarms. The pause timer counts from the last new words, and omp delivers words while recording for every dictation model: its models decode whole waveforms, so `stt/endpointer.ts` cuts the stream at 600 ms of silence and commits each piece as it ends (omp v18.18.7 source; not yet run here with a model installed).

## omp's voice settings (`src-tauri/src/speech_config.rs`)

`speech_config_get(profile)` → `{ settings, models, modelsError, sttModels }`:

- `settings`: `stt.enabled`, `stt.language`, `live.voice`, parsed from one `omp config list` run (text form: its `--json` form has no enum choices). A line is `  key = value (kind)`, an enum's kind being its choices joined by `|`.
- `models`: `omp setup speech --check --json`. It exits 1 while a model is missing and still prints the report, so the report decides. A failure to read it becomes `modelsError`; the settings still show.
- `sttModels` (`src-tauri/src/stt_models.rs`): `[{ id: "local/<key>", downloaded }]` for the five models of omp's `stt/models.ts`. omp's check above reports only the model in use, so the others are looked up in omp's cache folder (`<agent dir>/cache/tiny-models/<Hugging Face repo>`, or under `<XDG_CACHE_HOME>/omp[/profiles/<id>]` when that folder exists and `PI_CODING_AGENT_DIR` does not apply) by the rule of omp's `isSttModelCached`: every file of a sherpa model, or `config.json` plus an `encoder*.onnx` and a `decoder*.onnx` under `onnx/` for a Whisper. Display only; a model a later omp adds is not listed.

`speech_config_set(profile, key, value)` runs `omp config set` for one of those three keys and returns the settings re-read. omp refuses a value an enum does not have; values are bounded and may not start with `-`. A running tab picks the change up without a restart, as with `goal_config.rs`.

The dictation model is omp's `modelRoles.dictation` (`local/<model>`), written through the existing `model_config_set`. Parakeet, omp's default, has no Vietnamese; the Whisper models do, with `stt.language` set to `vi`. Settings lists the models (`OMP_LIVE_VOICE.DICTATION.modelRows`: name and hint from `DICTATION.MODELS`, the model in use, and `downloaded`, where omp's check wins for the model in use), one row each: `Use` on a downloaded model sets the role; `Download` sets the role first and then runs `omp setup speech` (`tts_install("kokoro")`), because that command downloads the model the role names. omp has no command that downloads a dictation model alone: `omp setup speech` also installs Kokoro while it is missing, so the button reads `Download + Kokoro` until omp's check reports Kokoro ready (`DICTATION.bundlesKokoro`; an unread check counts as missing). The only other download is omp's own at a capture's start (`dictation_start` fetches a missing model, then opens the microphone).

A role value that is none of the listed models (a cloud transcription model, a model of a later omp) still gets a row, marked in use, with no download state and no button: omp's check then reports whichever on-device model it would fall back to, which says nothing about that role.

A capture started while its model is not on disk waits in `starting` until omp has fetched the model, and omp's RPC mode sends no frame meanwhile (`stt-controller.ts` `#ensureDeps` passes no progress callback). `live.js` `_watchDictationDownload` therefore asks Rust every 1.5 s while the capture is `starting`: `stt_download_progress(profile, sinceMs)` → `stt_models::arriving`, the model of the list with the most bytes in files written since the capture began (its folder and `onnx/`, temporary files included; what an abandoned download left is older and not counted). The reading is `dictation.download` (`DICTATION.apply` `download` event; dropped as soon as the phase leaves `starting`) and the panel shows `downloading the voice to text model (first use) · <name> · <MB> [/ ~<total> MB]`. The total is known only where it was measured (`DICTATION.MODELS[id].mb`). The download belongs to that tab's omp process: closing the tab or reloading the webview ends it, and the next capture starts the unfinished file again.

## Tests

- `tests/test-tts.mjs`: fallbacks, menu rows, `speakable`, `chunks`, `replyText`, `shouldSpeak`, the install tracker (one run per engine, progress, the kept failure).
- `tts.rs` / `speech_config.rs` / `stt_models.rs` / `progress_lines.rs` / `child_run.rs` unit tests: engine ids, voice and text checks, each engine's arguments, the edge rate, failure text, `omp config list` and model report parsing, which cache files make a model downloaded, the XDG cache folder, the arriving model's bytes, status lines cut from a rewritten line, a reporting run that prints megabytes, one Kokoro install at a time.
- `tests/test-live-voice.mjs`: the model rows (model in use, omp's check over the folder scan, a role outside the list).
- Playback (`AudioContext`) and the real engines are not covered by the suite.
