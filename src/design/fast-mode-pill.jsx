/* fast-mode-pill.jsx — the composer's fast mode pill: omp's fast mode (the
   priority service tier of the model's provider) for the tab, on or off.
   `mode` is `{ enabled, active }` as omp reports it (live.js, get_state
   and the `set_fast_mode` reply), null before the first report. A click is
   `set_fast_mode`; omp's refusal (a model with no priority tier) shows
   above the pill for a few seconds. composer.jsx renders this by its
   global name, keyed by tab: a tab switch remounts it with no note. */

const { Icon: _FM_Icon } = window;

const _FM_NOTE_MS = 5000;

function FastModePill({ mode, onSet }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  // A reply that lands after the tab was left belongs to no pill.
  const live = React.useRef(true);
  React.useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);
  React.useEffect(() => {
    if (!error) return undefined;
    const timer = setTimeout(() => setError(""), _FM_NOTE_MS);
    return () => clearTimeout(timer);
  }, [error]);

  const on = mode?.enabled === true;
  // On, but the provider serves this model on its standard tier.
  const idle = on && !mode.active;
  const toggle = () => {
    if (busy) return;
    setBusy(true);
    setError("");
    onSet(!on).then(
      () => { if (live.current) setBusy(false); },
      e => { if (live.current) { setBusy(false); setError(e?.message ?? String(e)); } },
    );
  };

  return (
    <div className="thinking-menu">
      <button className={`composer-pill fast-pill${on ? " on" : ""}${idle ? " idle" : ""}`} onClick={toggle}
        disabled={!mode} aria-pressed={on} aria-busy={busy || undefined}
        title={idle
          ? OMP_TR("fast mode is on, but this model is not served on a priority tier right now")
          : OMP_TR("fast mode: the provider's priority tier for this model (faster replies, priced higher)")}>
        <_FM_Icon name="bolt" size={13} color={on ? "var(--amber)" : "var(--fg-3)"} />
        <span>{OMP_TR("Fast")}</span>
      </button>
      {error && (
        <div className="thinking-pop" role="alert">
          <div className="thinking-pop-note error">{error}</div>
        </div>
      )}
    </div>
  );
}

window.FastModePill = FastModePill;
