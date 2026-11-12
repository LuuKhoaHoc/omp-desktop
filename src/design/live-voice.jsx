/* Live voice controls and captions for the active tab. */
// A panel's error line, with the × that clears it (and the panel with it,
// when the error was all it showed).
function VoiceError({ text, onDismiss }) {
  return <div className="live-voice-error" role="alert">
    <span>{text}</span>
    <button className="btn icon ghost" onClick={onDismiss} title={OMP_TR("dismiss")} aria-label={OMP_TR("dismiss")}>
      <window.Icon name="close" size={10} />
    </button>
  </div>;
}
function LiveVoicePanel({ voice, error, onAction, onDismiss, dictationActive, codexLogin = null }) {
  const active = !!voice?.active;
  const paused = !!voice?.paused;
  const phase = voice?.phase ?? "idle";
  const transcripts = voice?.transcripts ?? [];
  const captionsRef = React.useRef(null);
  React.useLayoutEffect(() => {
    const captions = captionsRef.current;
    if (captions) captions.scrollTop = captions.scrollHeight;
  }, [voice?.transcripts]);
  if (!active && !paused && !voice?.error && !error && !transcripts.length) return null;

  const input = window.OMP_LIVE_VOICE.meterLevel(voice?.input);
  const output = window.OMP_LIVE_VOICE.meterLevel(voice?.output);
  const resume = window.OMP_LIVE_VOICE.liveButton(voice, dictationActive, codexLogin);
  return (
    <section className="live-voice" aria-label={OMP_TR("Live voice")}>
      <div className="live-voice-head">
        <span className="live-voice-title">{OMP_TR("live voice")}</span>
        <span className="live-voice-phase" role="status">{OMP_TR(phase)}</span>
        {active && <>
          <label>{OMP_TR("mic")} <meter min="-60" max="0" high="-6" optimum="-20" value={input.value} aria-label={OMP_TR("Microphone level")} aria-valuetext={`${input.text} RMS`} /></label>
          <label>{OMP_TR("speaker")} <meter min="-60" max="0" high="-6" optimum="-20" value={output.value} aria-label={OMP_TR("Speaker level")} aria-valuetext={`${output.text} RMS`} /></label>
        </>}
        <span className="live-voice-spacer" />
        {active ? <>
          <button className="btn outlined" onClick={() => onAction(voice.muted ? "unmute" : "mute")}
            disabled={phase === "connecting" || phase === "stopping"}
            aria-pressed={!!voice.muted}>{voice.muted ? OMP_TR("unmute") : OMP_TR("mute")}</button>
          <button className="btn outlined" onClick={() => onAction("pause")}
            disabled={phase === "connecting" || phase === "stopping"} aria-label={OMP_TR("Pause live conversation")}>{OMP_TR("pause")}</button>
          <button className="btn outlined" onClick={() => onAction("stop")}
            disabled={phase === "stopping"} aria-label={phase === "connecting" ? OMP_TR("Cancel live conversation") : OMP_TR("End live conversation")}>{phase === "connecting" ? OMP_TR("cancel") : OMP_TR("end")}</button>
        </> : paused ? <>
          <button className="btn outlined" onClick={() => onAction("resume")}
            disabled={resume.disabled} aria-label={OMP_TR("Resume live conversation")} title={resume.label}>{OMP_TR("resume")}</button>
          <button className="btn outlined" onClick={() => onAction("stop")}
            aria-label={OMP_TR("End live conversation")}>{OMP_TR("end")}</button>
        </> : null}
      </div>
      {(error || voice?.error) && <VoiceError text={OMP_TR(error || voice.error)} onDismiss={onDismiss} />}
      {transcripts.length > 0 && <ol ref={captionsRef} className="live-voice-captions" aria-label={OMP_TR("Live voice captions")}>
        {transcripts.map(item => <li key={`${item.role}-${item.turn}`}>
          <span className="live-voice-role">{item.role === "user" ? "you" : "assistant"}</span>
          <span>{item.text}</span>{!item.final && <span className="live-voice-interim">…</span>}
        </li>)}
      </ol>}
    </section>
  );
}
// Each mode stays in place while active so its button can stop or cancel it.
// Live conversation is omp's Codex call: greyed out without a Codex login.
function VoiceModeButton({ live, dictation, codexLogin = null, onLiveAction, onDictationAction }) {
  const dictating = !!dictation?.active;
  const calling = !!live?.active;
  const paused = !!live?.paused;
  const dictationBusy = dictating && (dictation.phase === "starting" || dictation.phase === "stopping");
  const liveBusy = calling && (live.phase === "connecting" || live.phase === "stopping");
  const dictationLabel = dictating ? (dictation.phase === "starting" ? "Cancel voice to text" : "Stop voice to text") : "Start voice to text";
  const liveButton = window.OMP_LIVE_VOICE.liveButton(live, dictating, codexLogin);
  return <>
    <button className={`btn ghost composer-tool voice-mode-btn${dictating ? " live-voice-mic-on" : ""}`}
      title={dictationLabel} aria-label={dictationLabel} aria-pressed={dictating} aria-busy={dictationBusy}
      disabled={calling || (dictating && dictation.phase === "stopping")}
      onClick={() => onDictationAction(dictating ? "stop" : "start")}>
      <window.Icon name="voice" size={13} /><span className="composer-tool-label" aria-hidden="true">{dictating ? "Stop" : "Dictate"}</span>
    </button>
    <button className={`btn ghost composer-tool voice-mode-btn${calling ? " live-voice-mic-on" : ""}`}
      title={liveButton.label} aria-label={liveButton.label} aria-pressed={calling} aria-busy={liveBusy}
      disabled={liveButton.disabled}
      onClick={() => onLiveAction(calling ? "stop" : paused ? "resume" : "start")}>
      <window.Icon name="conversation" size={13} /><span className="composer-tool-label" aria-hidden="true">{calling ? "End call" : "Talk"}</span>
    </button>
  </>;
}

// `handsFree` (`{ armed, reads, end() }`): hands-free conversation is on for
// this tab, so the panel stays between captures and says what it waits for,
// and whether the reply is read aloud first (Settings › Voice decides that;
// hands-free never turns it on by itself).
function DictationPanel({ dictation, error, onAction, onDismiss, handsFree = null }) {
  const armed = !!handsFree?.armed;
  if (!dictation?.active && !dictation?.error && !error && !armed) return null;
  const phase = dictation?.phase ?? "idle";
  // omp fetches a model that is not on disk before the microphone opens.
  const fetching = dictation?.active && phase === "starting" ? window.OMP_LIVE_VOICE.DICTATION.downloadLine(dictation.download) : null;
  const activePhase = fetching
    ? `${OMP_TR("downloading the voice to text model (first use)")} · ${fetching.name} · ${fetching.totalMb ? `${fetching.mb} / ~${fetching.totalMb} MB` : `${fetching.mb} MB`}`
    : phase === "stopping" ? "transcribing" : phase;
  return <section className="live-voice" aria-label={OMP_TR("Voice to text")}>
    <div className="live-voice-head">
      <span className="live-voice-title">{armed ? OMP_TR("hands-free") : OMP_TR("voice to text")}</span>
      <span className="live-voice-phase" role="status">{dictation?.active ? activePhase : !armed ? phase : handsFree.reads ? OMP_TR("listens again after the reply") : OMP_TR("listens again after the reply; read aloud is off")}</span>
      <span className="live-voice-spacer" />
      {armed && !dictation?.active && <button className="btn outlined" onClick={handsFree.end}>{OMP_TR("end")}</button>}
      {dictation?.active && <button className="btn outlined" onClick={() => onAction("stop")} disabled={phase === "stopping"}>
        {phase === "starting" ? "cancel" : "stop"}
      </button>}
    </div>
    {(error || dictation?.error) && <VoiceError text={error || dictation.error} onDismiss={onDismiss} />}
    {dictation?.active && dictation.text && <div className="dictation-preview" aria-label={OMP_TR("Dictation preview")}>{dictation.text}</div>}
  </section>;
}

// Shown while a reply is read aloud (app/use-read-aloud.jsx), and for the
// reason the last one could not be.
function ReadAloudPanel({ readAloud }) {
  if (!readAloud?.speaking && !readAloud?.error) return null;
  return <section className="live-voice" aria-label={OMP_TR("Read aloud")}>
    {readAloud.speaking && <div className="live-voice-head">
      <span className="live-voice-title">{OMP_TR("read aloud")}</span>
      <span className="live-voice-phase" role="status">{OMP_TR("speaking")}</span>
      <span className="live-voice-spacer" />
      <button className="btn outlined" onClick={readAloud.stop}>{OMP_TR("stop")}</button>
    </div>}
    {readAloud.error && <VoiceError text={readAloud.error} onDismiss={readAloud.dismiss} />}
  </section>;
}

Object.assign(window, { LiveVoicePanel, VoiceModeButton, DictationPanel, ReadAloudPanel });
