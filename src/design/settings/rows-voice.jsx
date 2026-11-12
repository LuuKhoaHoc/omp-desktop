/* ═════════════════════════════════════════════════════════════════════
   design/settings/rows-voice.jsx — custom Settings rows of Voice
   (window.OMP_SETTINGS_ROWS):
     ttsEngine    the engine and voice that read replies aloud (tweaks
                  `ttsEngine`, `ttsVoice`), whether the engine is installed
                  (Rust tts_status), Install (tts_install) and Test
     sttSettings  omp's voice to text and live voice settings of
                  ctx.goal.profileId (Rust speech_config_get/set) and the
                  dictation models: which is in use (`modelRoles.dictation`,
                  model_config), which are downloaded, Use / Download
   An install's progress and failure come from the bridge
   (`ttsInstallState`), which keeps them while this page is closed.
   Helpers: app/tts.js (OMP_TTS). docs/architecture/read-aloud.md.
   ═════════════════════════════════════════════════════════════════════ */

/** What "Test" says, in the voice's language. */
const _SRV_sample = voice => (voice.startsWith("vi-")
  ? "Xin chào, đây là giọng đọc các câu trả lời trong OMP Desktop."
  : "Hello, this is the voice that reads replies in OMP Desktop.");

/** `engine`'s install for `profile`: `{ progress, error }` (live.js
 *  `ttsInstallState`), `progress` the running one's latest line, or null. */
function _SRV_useInstall(bridge, engine, profile) {
  const [state, setState] = React.useState(() => bridge?.ttsInstallState(engine, profile) ?? { progress: null, error: null });
  React.useEffect(() => {
    if (!bridge) return undefined;
    const read = () => setState(bridge.ttsInstallState(engine, profile));
    read();
    return bridge.onTtsInstall(read);
  }, [bridge, engine, profile]);
  return state;
}

function _SRV_Engine({ row, ctx, query, modified, onReset }) {
  const { SettingsRow: Row, SettingsButton: Button, PathPicker, Icon } = window;
  const T = window.OMP_TTS;
  const { bridge, t, setTweak, readAloud } = ctx;
  const profile = ctx.goal?.profileId ?? null;
  const [status, setStatus] = React.useState(null);
  const [error, setError] = React.useState(null);
  const engine = T.engine(t.ttsEngine);
  const inst = _SRV_useInstall(bridge, engine.id, profile);
  const installing = !!inst.progress;
  // Read again when an install ends: it may have been started before this
  // page was opened.
  React.useEffect(() => {
    if (!bridge || installing) return undefined;
    let live = true;
    bridge.ttsStatus(profile).then(res => {
      if (!live) return;
      if (res.ok) setStatus(res.value); else setError(res.error);
    });
    return () => { live = false; };
  }, [bridge, profile, installing]);

  const voice = T.voice(engine.id, t.ttsVoice);
  const mine = status?.find(s => s.id === engine.id) ?? null;
  const install = () => {
    setError(null);
    bridge.ttsInstall(engine.id, profile);
  };
  const failure = error || inst.error || readAloud?.error;
  const state = installing ? (inst.progress.message || OMP_TR("installing… this can take a few minutes"))
    : !mine ? (failure ? OMP_TR("unavailable") : OMP_TR("reading…"))
    : mine.installed ? `${OMP_TR("installed")} · \`${mine.detail}\``
    : `${OMP_TR("not installed")} · ${mine.detail}`;
  return (
    <>
      <Row label={row.label} desc={`${OMP_TR(row.desc)} ${state}`} query={query} modified={modified} onReset={onReset}>
        <PathPicker name={OMP_TR("Speech engine")} label={engine.name} rows={T.engineRows(engine.id)}
          save={id => setTweak({ ttsEngine: id, ttsVoice: T.voice(id, null) })} />
        <PathPicker name={OMP_TR("Voice")} label={T.voiceName(engine.id, voice)} title={voice} rows={T.voiceRows(engine.id, voice)}
          save={id => setTweak("ttsVoice", id)} />
        <div className="st-btns">
          {mine && !mine.installed && (
            <Button accent onClick={install} disabled={installing}>{OMP_TR("Install")}</Button>
          )}
          {mine?.installed && (readAloud?.speaking
            ? <Button onClick={readAloud.stop}><Icon name="stop" size={11} />{OMP_TR("Stop")}</Button>
            : <Button onClick={() => readAloud?.speak(_SRV_sample(voice))}><Icon name="play" size={11} />{OMP_TR("Test")}</Button>)}
        </div>
      </Row>
      {installing && inst.progress.percent != null && <progress className="st-progress" max="100" value={inst.progress.percent} aria-label={engine.name} />}
      {failure && <div className="st-row-error">{failure}</div>}
    </>
  );
}

const _SRV_LANGUAGES = [
  ["en", "English"], ["vi", "Tiếng Việt"], ["zh", "中文"], ["ja", "日本語"], ["ko", "한국어"],
  ["fr", "Français"], ["de", "Deutsch"], ["es", "Español"],
];

/** Menu rows of `choices` (`[value, name, hint?]`); a `current` value that
 *  is none of them is listed too, so the menu always shows what is set. */
function _SRV_rows(choices, current) {
  const rows = choices.map(([value, name, hint = ""]) => ({ name, hint, path: value, value, checked: value === current }));
  if (!rows.some(r => r.checked)) rows.push({ name: current, hint: "", path: current, value: current, checked: true });
  return rows;
}

/** omp's voice settings of `profile`, the dictation model, and `set` /
 *  `pickModel` / `install`; `busy` is the id of the model whose download
 *  this page is starting, `progress` the running download's latest line,
 *  `installError` why the last download failed, `error` any other failure. */
function _SRV_useSpeech(bridge, profile) {
  const [config, setConfig] = React.useState(null);
  const [model, setModel] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(null);
  const inst = _SRV_useInstall(bridge, "kokoro", profile);
  const load = React.useCallback(async () => {
    const [speech, models] = await Promise.all([bridge.speechConfig(profile), bridge.modelConfig(profile)]);
    if (speech.ok) setConfig(speech.value); else setError(speech.error);
    if (models.ok) setModel(models.value.roles?.dictation ?? "");
    return speech.ok;
  }, [bridge, profile]);
  React.useEffect(() => { if (bridge) load(); }, [bridge, load]);
  const set = async (key, value) => {
    const res = await bridge.setSpeechConfig(profile, key, value);
    if (!res.ok) { setError(res.error); return; }
    setError(null);
    setConfig(c => (c ? { ...c, settings: res.value } : c));
  };
  const pickModel = async id => {
    const res = await bridge.setModelConfig(profile, "roles", "dictation", id || null);
    if (!res.ok) { setError(res.error); return false; }
    setError(null);
    setModel(res.value?.dictation ?? "");
    await load(); // omp's check names the model now chosen
    return true;
  };
  // `omp setup speech` downloads the model the role names, so a model is
  // put in use before its download.
  const install = async (id, inUse) => {
    setBusy(id);
    setError(null);
    if (inUse || await pickModel(id)) {
      await bridge.ttsInstall("kokoro", profile);
      await load();
    }
    setBusy(null);
  };
  // A download this page did not start (it was opened meanwhile) has ended:
  // read the models again.
  const running = !!inst.progress;
  const sawRun = React.useRef(false);
  React.useEffect(() => {
    if (running) { sawRun.current = true; return; }
    if (!sawRun.current) return;
    sawRun.current = false;
    if (busy == null) load();
  }, [running]);
  return { config, model, error, busy, progress: inst.progress, installError: inst.error, set, pickModel, install };
}

function _SRV_Model({ model, sp, kokoro, downloading, locked, query }) {
  const { SettingsRow: Row, SettingsButton: Button } = window;
  // A role value that is none of omp's on-device models: nothing to
  // download, and omp's local check says nothing about it.
  if (model.downloaded == null) {
    return (
      <Row label={model.name} desc="Set in omp's model roles; not one of the on-device models listed here." query={query}>
        <span className="st-ro">{OMP_TR("in use")}</span>
      </Row>
    );
  }
  const state = downloading ? (sp.progress?.message || OMP_TR("downloading… this can take several minutes"))
    : model.downloaded ? OMP_TR("downloaded") : OMP_TR("not downloaded");
  return (
    <>
      <Row label={model.name} desc={`${model.hint ? `${OMP_TR(model.hint)} · ` : ""}${state}`} query={query}>
        <div className="st-btns">
          {model.inUse && <span className="st-ro">{OMP_TR("in use")}</span>}
          {!model.downloaded ? (
            kokoro ? (
              <Button accent={model.inUse} disabled={locked} onClick={() => sp.install(model.id, model.inUse)}
                title="Puts this model in use and runs `omp setup speech`, which downloads it and Kokoro, omp's English reading voice (about 92 MB plus its runtime)">
                {OMP_TR("Download + Kokoro")}
              </Button>
            ) : (
              <Button accent={model.inUse} disabled={locked} onClick={() => sp.install(model.id, model.inUse)}
                title="Puts this model in use and runs `omp setup speech` to download it">
                {OMP_TR("Download")}
              </Button>
            )
          ) : !model.inUse && <Button disabled={locked} onClick={() => sp.pickModel(model.id)}>{OMP_TR("Use")}</Button>}
        </div>
      </Row>
      {downloading && sp.progress?.percent != null && <progress className="st-progress" max="100" value={sp.progress.percent} aria-label={model.name} />}
      {model.inUse && !downloading && sp.installError && <div className="st-row-error">{sp.installError}</div>}
    </>
  );
}

function _SRV_Dictation({ row, ctx, query }) {
  const { SettingsRow: Row, SettingsToggle: Toggle, PathPicker } = window;
  const sp = _SRV_useSpeech(ctx.bridge, ctx.goal?.profileId ?? null);
  const setting = key => sp.config?.settings.find(s => s.key === key) ?? null;
  const enabled = setting("stt.enabled");
  const language = setting("stt.language");
  const liveVoice = setting("live.voice");
  const D = window.OMP_LIVE_VOICE.DICTATION;
  const rows = sp.config && sp.model != null ? D.modelRows(sp.config, sp.model) : [];
  const kokoro = !!sp.config && D.bundlesKokoro(sp.config);
  const downloadingId = D.downloadingId(rows, sp.busy, !!sp.progress);
  return (
    <>
      <Row label={row.label} desc={row.desc} query={query}>
        {enabled
          ? <Toggle value={enabled.value === "true"} label="Voice to text" onChange={on => sp.set("stt.enabled", on)} />
          : <span className="st-ro">{sp.error ? OMP_TR("unavailable") : OMP_TR("reading…")}</span>}
      </Row>
      {language && (
        <Row label="Spoken language" desc="The language voice to text expects. Parakeet ignores it; the Whisper models follow it." query={query}>
          <PathPicker name={OMP_TR("Spoken language")} label={_SRV_LANGUAGES.find(l => l[0] === language.value)?.[1] ?? language.value}
            title={language.value} rows={_SRV_rows(_SRV_LANGUAGES, language.value)} save={v => sp.set("stt.language", v)} />
        </Row>
      )}
      {rows.length > 0 && (
        <Row label="Voice to text model" query={query} resettable={!!sp.model} onReset={() => sp.pickModel("")}
          desc="Runs on this device; pick one to use it, the others stay downloaded. omp has no download for one model alone: the button runs `omp setup speech`, which also installs Kokoro, omp's English reading voice, while that is missing (the button then says so). A model in use that is not downloaded yet is fetched by itself the first time the microphone starts.">
          <span className="st-ro">{rows.find(r => r.inUse)?.name}</span>
        </Row>
      )}
      {rows.map(m => (
        <_SRV_Model key={m.id} model={m} sp={sp} kokoro={kokoro} downloading={m.id === downloadingId} locked={downloadingId != null} query={query} />
      ))}
      {sp.config?.modelsError && <div className="st-row-error">{sp.config.modelsError}</div>}
      {liveVoice && (
        <Row label="Live conversation voice" desc="The voice omp's live conversation answers in (needs a Codex login)." query={query}>
          <PathPicker name={OMP_TR("Live conversation voice")} label={liveVoice.value}
            rows={_SRV_rows(liveVoice.options.map(o => [o, o]), liveVoice.value)} save={v => sp.set("live.voice", v)} />
        </Row>
      )}
      {sp.error && <div className="st-row-error">{sp.error}</div>}
    </>
  );
}

Object.assign(window.OMP_SETTINGS_ROWS = window.OMP_SETTINGS_ROWS || {}, {
  ttsEngine: _SRV_Engine,
  sttSettings: _SRV_Dictation,
});
