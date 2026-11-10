/* ═════════════════════════════════════════════════════════════════════
   design/settings/rows-models.jsx — custom Settings rows of Agent →
   Models (window.OMP_SETTINGS_ROWS):
     modelRoles   the model of each omp role (`modelRoles`)
     agentModels  the model of each subagent (`task.agentModelOverrides`)
   Both read and write omp's config of ctx.goal.profileId (the active tab's
   profile) through Rust's model_config_get/set; one entry per write. The
   model menus list the active tab's models (ctx.models, omp's
   get_available_models); the helpers are app/model-roles.js.
   ═════════════════════════════════════════════════════════════════════ */

/** Both records of `profileId`, `set(scope, name, value|null)` and the
 *  reason the last read or write failed. */
function _SRM_useModelConfig(bridge, profileId) {
  const [config, setConfig] = React.useState(null);
  const [error, setError] = React.useState(null);
  React.useEffect(() => {
    if (!bridge) return undefined;
    let live = true;
    setConfig(null);
    bridge.modelConfig(profileId).then(res => {
      if (!live) return;
      if (res.ok) { setConfig(res.value); setError(null); } else setError(res.error);
    });
    return () => { live = false; };
  }, [bridge, profileId]);
  const set = React.useCallback(async (scope, name, value) => {
    const res = await bridge.setModelConfig(profileId, scope, name, value);
    if (!res.ok) { setError(res.error); return; }
    setError(null);
    setConfig(c => (c ? { ...c, [scope]: res.value } : c));
  }, [bridge, profileId]);
  return { config, error, set };
}

/** One role or subagent: model menu, thinking menu, reset to unset. */
function _SRM_Entry({ label, desc, query, models, selector, unsetLabel, onSet }) {
  const { SettingsRow: Row, PathPicker } = window;
  const R = window.OMP_MODEL_ROLES;
  const { model, thinking } = R.split(selector);
  return (
    <Row label={label} desc={desc} query={query} resettable={!!selector} onReset={() => onSet(null)}>
      <PathPicker name={`${label} model`} label={model ? R.modelLabel(models, model) : unsetLabel} title={selector || undefined}
        rows={R.modelRows(models, model)} disabled={!models?.length && !model}
        save={v => onSet(R.join(v, thinking))} />
      <PathPicker name={`${label} thinking`} label={thinking || "default"} title="Thinking level"
        rows={R.thinkingRows(thinking)} disabled={!model}
        save={v => onSet(R.join(model, v))} />
    </Row>
  );
}

function _SRM_status(mc) {
  if (mc.config) return null;
  return <span className="st-ro">{mc.error ? "unavailable" : "reading…"}</span>;
}

function _SRM_ModelRoles({ row, ctx, query }) {
  const { SettingsRow: Row } = window;
  const mc = _SRM_useModelConfig(ctx.bridge, ctx.goal?.profileId ?? null);
  const roles = mc.config?.roles ?? {};
  return (
    <>
      <Row label={row.label} desc={row.desc} query={query}>{_SRM_status(mc)}</Row>
      {mc.config && window.OMP_MODEL_ROLES.ROLES.map(r => (
        <_SRM_Entry key={r.id} label={`${r.name} (${r.id})`} desc={r.desc} query={query} models={ctx.models}
          selector={roles[r.id] ?? ""} unsetLabel={r.id === "default" ? "omp's pick" : "same as default"}
          onSet={v => mc.set("roles", r.id, v)} />
      ))}
      {mc.error && <div className="st-row-error">{mc.error}</div>}
    </>
  );
}

function _SRM_AgentModels({ row, ctx, query }) {
  const { SettingsRow: Row } = window;
  const mc = _SRM_useModelConfig(ctx.bridge, ctx.goal?.profileId ?? null);
  const agents = mc.config?.agents ?? {};
  return (
    <>
      <Row label={row.label} desc={row.desc} query={query}>{_SRM_status(mc)}</Row>
      {mc.config && window.OMP_MODEL_ROLES.agentNames(mc.config).map(name => (
        <_SRM_Entry key={name} label={name} query={query} models={ctx.models}
          selector={agents[name] ?? ""} unsetLabel="agent's own / Subtask"
          onSet={v => mc.set("agents", name, v)} />
      ))}
      {mc.error && <div className="st-row-error">{mc.error}</div>}
    </>
  );
}

Object.assign(window.OMP_SETTINGS_ROWS = window.OMP_SETTINGS_ROWS || {}, {
  modelRoles: _SRM_ModelRoles,
  agentModels: _SRM_AgentModels,
});
