/* ═════════════════════════════════════════════════════════════════════
   design/settings/rows-local-stt.jsx — Desktop-native local STT rows
   (Qwen3-ASR 0.6B / Whisper large-v3-turbo + Silero VAD via transcribe-cpp).
   Used inside Settings → Voice (`rows-voice.jsx` `_SRV_Dictation`).
   ═════════════════════════════════════════════════════════════════════ */

function _SRL_useLocalStt(bridge) {
  const [snap, setSnap] = React.useState(() => bridge?.localSttState?.() ?? { status: null, install: null });
  const [busy, setBusy] = React.useState(null);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    if (!bridge?.onLocalStt) return undefined;
    setSnap(bridge.localSttState());
    const unsub = bridge.onLocalStt(setSnap);
    bridge.localSttStatus().then(res => {
      if (!res?.ok && res?.error) setError(res.error);
    });
    return unsub;
  }, [bridge]);

  const setConfig = async (patch) => {
    setError(null);
    const res = await bridge.localSttSetConfig(patch);
    if (!res?.ok) setError(res?.error || "Could not update local speech settings.");
  };

  const installRuntime = async () => {
    setBusy("runtime");
    setError(null);
    const res = await bridge.localSttInstallRuntime();
    if (!res?.ok) setError(res?.error || "Could not install local speech runtime.");
    setBusy(null);
  };

  const installModel = async (id, useAfter = false) => {
    setBusy(id);
    setError(null);
    const res = await bridge.localSttInstallModel(id);
    if (!res?.ok) {
      setError(res?.error || "Could not download model.");
    } else if (useAfter) {
      await setConfig({ model: id });
    }
    setBusy(null);
  };

  const deleteModel = async (id) => {
    setBusy(id);
    setError(null);
    const res = await bridge.localSttDeleteModel(id);
    if (!res?.ok) setError(res?.error || "Could not remove cached model.");
    setBusy(null);
  };

  return {
    status: snap.status,
    install: snap.install,
    busy,
    error,
    setConfig,
    installRuntime,
    installModel,
    deleteModel,
  };
}

function _SRL_TextRow({ label, desc, value, placeholder, disabled, onCommit, query }) {
  const { SettingsRow: Row } = window;
  const [draft, setDraft] = React.useState(value ?? "");
  React.useEffect(() => { setDraft(value ?? ""); }, [value]);
  const commit = () => {
    if (draft !== (value ?? "")) onCommit(draft);
  };
  return (
    <Row label={label} desc={desc} query={query} stack>
      <input
        className="st-rem-input"
        type="text"
        value={draft}
        aria-label={OMP_TR(label)}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        style={{ width: "100%" }}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === "Enter") { e.currentTarget.blur(); }
          if (e.key === "Escape") { setDraft(value ?? ""); e.currentTarget.blur(); }
        }}
      />
    </Row>
  );
}

function _SRL_LocalStt({ local, query }) {
  const { SettingsRow: Row, SettingsButton: Button, PathPicker } = window;
  const L = window.OMP_LOCAL_STT;
  const st = local.status;
  const cfg = st?.config;
  const inst = local.install;
  const installing = (!!inst && !inst.done) || local.busy != null;

  if (!st || !cfg) {
    return (
      <>
        <Row label="Local speech runtime" desc="Qwen3-ASR 0.6B / Whisper large-v3-turbo with Silero VAD." query={query}>
          <span className="st-ro">{local.error ? OMP_TR("unavailable") : OMP_TR("reading…")}</span>
        </Row>
        {local.error && <div className="st-row-error">{local.error}</div>}
      </>
    );
  }

  const runtimeReady = st.runtimeInstalled && st.vadDownloaded;
  const runtimeBusy = local.busy === "runtime" || (inst && !inst.done && inst.kind === "runtime");
  const runtimeState = runtimeBusy
    ? (L.formatInstallLabel(inst) || OMP_TR("installing runtime…"))
    : !st.uvInstalled ? OMP_TR("uv not found on PATH (install uv first)")
    : runtimeReady ? OMP_TR("ready (transcribe-cpp + Silero VAD v6.2)")
    : OMP_TR("not installed");

  const backendOpt = L.BACKENDS.find(b => b.value === cfg.backend) ?? L.BACKENDS[0];
  const langEntry = L.LANGUAGES.find(l => l[0] === cfg.language);
  const langLabel = langEntry ? OMP_TR(langEntry[1]) : (cfg.language || OMP_TR("Auto-detect"));
  const workerNote = st.worker?.loadedModel
    ? ` · ${OMP_TR("warm")}: ${st.worker.loadedModel} (${st.worker.backend || cfg.backend})`
    : "";

  return (
    <>
      <Row
        label="Local speech runtime"
        desc={`${OMP_TR("Isolated uv environment with transcribe-cpp and Silero VAD v6.2.")} ${runtimeState}${workerNote}`}
        query={query}
      >
        <div className="st-btns">
          {!runtimeReady && (
            <Button accent disabled={!st.uvInstalled || installing} onClick={local.installRuntime}>
              {OMP_TR("Install runtime")}
            </Button>
          )}
          {runtimeReady && <span className="st-ro">{OMP_TR("ready")}</span>}
        </div>
      </Row>
      {runtimeBusy && inst?.percent != null && (
        <progress className="st-progress" max="100" value={inst.percent} aria-label={OMP_TR("Local speech runtime")} />
      )}

      {st.models.map(m => {
        const inUse = cfg.model === m.id;
        const modelBusy = local.busy === m.id || (inst && !inst.done && inst.kind === "model" && inst.id === m.id);
        const stateText = modelBusy
          ? (L.formatInstallLabel(inst) || OMP_TR("downloading…"))
          : m.downloaded ? OMP_TR("downloaded") : OMP_TR("not downloaded");
        return (
          <React.Fragment key={m.id}>
            <Row label={m.name} desc={`${m.hint} · ${stateText}`} query={query}>
              <div className="st-btns">
                {inUse && <span className="st-ro">{OMP_TR("in use")}</span>}
                {!m.downloaded ? (
                  <Button accent={inUse} disabled={!st.uvInstalled || installing} onClick={() => local.installModel(m.id, !inUse)}>
                    {OMP_TR("Download")}
                  </Button>
                ) : (
                  <>
                    {!inUse && (
                      <Button disabled={installing} onClick={() => local.setConfig({ model: m.id })}>
                        {OMP_TR("Use")}
                      </Button>
                    )}
                    <Button disabled={installing} onClick={() => local.deleteModel(m.id)}>
                      {OMP_TR("Delete")}
                    </Button>
                  </>
                )}
              </div>
            </Row>
            {modelBusy && inst?.percent != null && (
              <progress className="st-progress" max="100" value={inst.percent} aria-label={m.name} />
            )}
          </React.Fragment>
        );
      })}

      <Row
        label="Compute backend"
        desc="Auto tries Vulkan GPU first and falls back to CPU if unavailable."
        query={query}
      >
        <PathPicker
          name={OMP_TR("Compute backend")}
          label={OMP_TR(backendOpt.label)}
          rows={L.BACKENDS.map(b => ({ name: OMP_TR(b.label), path: b.value, value: b.value, checked: b.value === cfg.backend }))}
          save={v => local.setConfig({ backend: v })}
        />
      </Row>

      <Row
        label="Spoken language"
        desc="Hint passed to Qwen3-ASR / Whisper. Auto-detect handles mixed Vietnamese and English."
        query={query}
      >
        <PathPicker
          name={OMP_TR("Spoken language")}
          label={langLabel}
          rows={L.LANGUAGES.map(([value, name]) => ({ name: OMP_TR(name), path: value, value, checked: value === cfg.language }))}
          save={v => local.setConfig({ language: v })}
        />
      </Row>

      <_SRL_TextRow
        label="Custom vocabulary"
        desc="Comma-separated technical terms, library names, or proper nouns to bias recognition (e.g. Tauri, Rust, Qwen3, omp-desktop)."
        value={L.formatVocabulary(cfg.vocabulary)}
        placeholder="Tauri, Rust, TypeScript, Qwen3, omp-desktop"
        disabled={false}
        onCommit={text => local.setConfig({ vocabulary: L.parseVocabulary(text) })}
        query={query}
      />

      <_SRL_TextRow
        label="Context prompt"
        desc="Optional short hint describing the topic or style of speech."
        value={cfg.contextPrompt}
        placeholder={OMP_TR("e.g. Software engineering discussion in Vietnamese and English.")}
        disabled={false}
        onCommit={text => local.setConfig({ contextPrompt: text })}
        query={query}
      />

      {(local.error || inst?.error) && <div className="st-row-error">{local.error || inst.error}</div>}
    </>
  );
}

window._SRL_LocalStt = _SRL_LocalStt;
window._SRL_useLocalStt = _SRL_useLocalStt;
