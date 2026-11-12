// Reading replies aloud (docs/architecture/read-aloud.md). When the shown
// tab's run ends and Settings › Voice › Read replies aloud is on, the last
// reply's text (OMP_TTS.replyText → speakable → chunks) is synthesized in
// Rust piece by piece, the next one while the current one plays, and played
// through one AudioContext. A new run, a tab switch, turning the setting
// off or `stop()` ends it. Returns `{ speaking, error, turn, speak(text),
// stop(), dismiss() }`; `speak` is also Settings' "Test". `turn` counts the
// shown tab's runs whose reply is over for the listener: read to its end,
// nothing to read, failed, or the setting is off (hands-free conversation
// opens the microphone on it). A reading that was cut short does not count.
function useReadAloud({ bridge, tweaks, sessionId, profileId, streaming, messages }) {
  const T = window.OMP_TTS;
  const [turn, setTurn] = React.useState(0);
  const [state, setState] = React.useState({ speaking: false, error: null });
  // The playback in flight: `{ cancelled, source }`.
  const runRef = React.useRef(null);
  const audioRef = React.useRef(null);

  const stop = React.useCallback(() => {
    const run = runRef.current;
    runRef.current = null;
    if (!run) return;
    run.cancelled = true;
    try { run.source?.stop(); } catch { /* not started yet */ }
    setState(s => (s.speaking ? { ...s, speaking: false } : s));
  }, []);
  const dismiss = React.useCallback(() => setState(s => (s.error ? { ...s, error: null } : s)), []);

  const engine = T.engine(tweaks.ttsEngine).id;
  const voice = T.voice(engine, tweaks.ttsVoice);
  const speed = tweaks.ttsSpeed;
  // Resolves true when the text is over (spoken, empty or failed), false
  // when something cut it short.
  const speak = React.useCallback(async (markdown) => {
    stop();
    const parts = T.chunks(T.speakable(markdown));
    if (!bridge || !parts.length) return true;
    const run = { cancelled: false, source: null };
    runRef.current = run;
    setState({ speaking: true, error: null });
    try {
      const audio = (audioRef.current ??= new AudioContext());
      if (audio.state === "suspended") await audio.resume();
      const fetchPart = async i => {
        const res = await bridge.ttsSpeak({ engine, voice, speed, text: parts[i], profile: profileId });
        if (!res.ok) throw new Error(res.error);
        const bytes = Uint8Array.from(atob(res.value.data), c => c.charCodeAt(0));
        return audio.decodeAudioData(bytes.buffer);
      };
      // Up to two pieces ahead are synthesized while one plays: an engine's
      // answer time varies by seconds, and a gap between pieces is heard.
      const fetched = [];
      const ensure = i => {
        if (i >= parts.length || fetched[i] || run.cancelled) return;
        fetched[i] = fetchPart(i);
        // Awaited on a later round; a stop before that must not leave its
        // failure unhandled.
        fetched[i].catch(() => {});
      };
      for (let i = 0; i < parts.length; i++) {
        for (let ahead = 0; ahead <= 2; ahead++) ensure(i + ahead);
        const buffer = await fetched[i];
        if (run.cancelled) return false;
        await new Promise(done => {
          const source = audio.createBufferSource();
          source.buffer = buffer;
          source.connect(audio.destination);
          source.onended = done;
          run.source = source;
          source.start();
        });
        if (run.cancelled) return false;
      }
    } catch (err) {
      if (run.cancelled) return false;
      setState({ speaking: false, error: String(err?.message ?? err) });
      return true;
    } finally {
      if (runRef.current === run) runRef.current = null;
    }
    setState(s => ({ ...s, speaking: false }));
    return true;
  }, [bridge, engine, voice, speed, profileId, stop]);

  // The run's end is seen as two renders of the same tab; the reply is
  // read from the render that reports the end.
  const seen = React.useRef(null);
  const reads = !!tweaks.ttsEnabled;
  React.useEffect(() => {
    const prev = seen.current;
    const next = { sessionId, streaming };
    seen.current = next;
    const ended = T.shouldSpeak(prev, next);
    if (!reads) {
      stop();
      if (ended) setTurn(n => n + 1);
      return;
    }
    if (ended) speak(T.replyText(messages)).then(over => { if (over) setTurn(n => n + 1); });
    else if (streaming || prev?.sessionId !== sessionId) stop();
  }, [sessionId, streaming, reads]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => stop, [stop]);

  return React.useMemo(() => ({ ...state, turn, speak, stop, dismiss }), [state, turn, speak, stop, dismiss]);
}

window.useReadAloud = useReadAloud;
