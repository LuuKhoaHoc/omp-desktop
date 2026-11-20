/* ═════════════════════════════════════════════════════════════════════
   design/settings/rows-worktree.jsx — custom Settings rows of the
   Worktrees group (window.OMP_SETTINGS_ROWS), all in Rust's
   `worktrees.json` (src-tauri/src/worktree_ops.rs):
     worktreeRoot    where new worktrees go; empty = the app's data folder
                     (`<app data>/worktrees`). Typed (`~/` allowed) or
                     picked with the folder dialog.
     worktreeKeep    how many app worktrees cleanup keeps (0 = never
                     delete); older ones not open in a tab are snapshotted,
                     removed, and restored when a chat in them reopens.
     worktreePrefix  the prefix "Create branch here" suggests.
   ═════════════════════════════════════════════════════════════════════ */

/** The worktree settings, re-read when a row mounts; `save(patch)`. */
function _SRW_useSettings(bridge) {
  const [settings, setSettings] = React.useState(null);
  const [error, setError] = React.useState(null);
  React.useEffect(() => {
    let live = true;
    bridge.worktreeSettings().then(res => {
      if (!live) return;
      if (res.ok) setSettings(res.value); else setError(res.error);
    });
    return () => { live = false; };
  }, [bridge]);
  const save = async patch => {
    if (!settings) return;
    const res = await bridge.setWorktreeSettings({ ...settings, ...patch });
    if (res.ok) { setSettings(res.value); setError(null); } else setError(res.error);
  };
  return { settings, error, save };
}

function _SRW_Error({ error }) {
  const shown = window.OMP_GIT_ERROR.present(error);
  return <div className="st-row-error">
    <div>{OMP_TR(shown.message)}</div>
    <details><summary>{OMP_TR("Show technical details")}</summary><pre>{shown.detail}</pre></details>
  </div>;
}

/** A text input that commits on blur / Enter and reverts on Escape. */
function _SRW_Input({ value, label, placeholder, disabled, onCommit, type = "text" }) {
  const [draft, setDraft] = React.useState(value ?? "");
  React.useEffect(() => { setDraft(value ?? ""); }, [value]);
  return (
    <input className="st-rem-input mono" type={type} value={draft} aria-label={OMP_TR(label)}
      placeholder={placeholder} disabled={disabled} spellCheck={false}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { if (draft !== String(value ?? "")) onCommit(draft); }}
      onKeyDown={e => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") { setDraft(value ?? ""); e.currentTarget.blur(); }
      }} />
  );
}

function _SRW_Root({ row, ctx, query }) {
  const { SettingsRow: Row, SettingsButton: Button } = window;
  const { settings, error, save } = _SRW_useSettings(ctx.bridge);
  const browse = async () => {
    const res = await ctx.bridge.pickFolder();
    if (res.ok && res.value) save({ root: res.value });
  };
  return (
    <>
      <Row label={row.label} desc={row.desc} query={query} stack
        resettable={!!settings?.root} onReset={() => save({ root: "" })}>
        <div className="st-btns st-worktree-root">
          <_SRW_Input value={settings?.root} label={row.label} disabled={!settings}
            placeholder={OMP_TR("default: the app's data folder")} onCommit={v => save({ root: v })} />
          <Button disabled={!settings} onClick={browse}>{OMP_TR("Browse…")}</Button>
        </div>
      </Row>
      {error && <_SRW_Error error={error} />}
    </>
  );
}

function _SRW_Keep({ row, ctx, query }) {
  const { SettingsRow: Row } = window;
  const { settings, error, save } = _SRW_useSettings(ctx.bridge);
  return (
    <>
      <Row label={row.label} desc={row.desc} query={query}
        resettable={!!settings && settings.keep !== 15} onReset={() => save({ keep: 15 })}>
        <_SRW_Input type="number" value={settings?.keep} label={row.label} disabled={!settings}
          onCommit={v => save({ keep: Math.max(0, Math.round(Number(v) || 0)) })} />
      </Row>
      {error && <_SRW_Error error={error} />}
    </>
  );
}

function _SRW_Prefix({ row, ctx, query }) {
  const { SettingsRow: Row } = window;
  const { settings, error, save } = _SRW_useSettings(ctx.bridge);
  return (
    <>
      <Row label={row.label} desc={row.desc} query={query}
        resettable={!!settings && settings.branchPrefix !== "omp/"} onReset={() => save({ branchPrefix: "omp/" })}>
        <_SRW_Input value={settings?.branchPrefix} label={row.label} disabled={!settings}
          onCommit={v => save({ branchPrefix: v })} />
      </Row>
      {error && <_SRW_Error error={error} />}
    </>
  );
}

Object.assign(window.OMP_SETTINGS_ROWS = window.OMP_SETTINGS_ROWS || {}, {
  worktreeRoot: _SRW_Root,
  worktreeKeep: _SRW_Keep,
  worktreePrefix: _SRW_Prefix,
});
