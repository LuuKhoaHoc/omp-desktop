/* ═════════════════════════════════════════════════════════════════════
   app/model-roles.js — pure helpers of Settings → Agent → Models
   (window.OMP_MODEL_ROLES): the omp roles and bundled subagents listed
   there, and the `provider/model[:thinking]` selector both omp records
   (`modelRoles`, `task.agentModelOverrides`) store. The records are read
   and written by src-tauri/src/model_config.rs.
   ═════════════════════════════════════════════════════════════════════ */
(function () {
  // omp's chat roles (its `/model` role table, `section: "chat"`). The kind
  // roles (image, web, speech, dictation) take non-chat models and stay in
  // omp's own `/model` menu.
  const ROLES = [
    { id: "default", name: "Default", desc: "The main model of new tabs." },
    { id: "smol", name: "Fast", desc: "Lightweight work: titles, summaries, quick lookups." },
    { id: "slow", name: "Thinking", desc: "Thorough analysis when omp asks for deep reasoning." },
    { id: "plan", name: "Architect", desc: "Plan mode." },
    { id: "task", name: "Subtask", desc: "Subagents with no model of their own below." },
    { id: "advisor", name: "Advisor", desc: "The second opinion omp's advisor asks." },
    { id: "vision", name: "Vision", desc: "Reading images when the main model cannot." },
    { id: "commit", name: "Commit", desc: "`omp commit` messages and changelogs." },
    { id: "tiny", name: "Tiny", desc: "Very small background calls." },
    { id: "memory", name: "Memory", desc: "Memory extraction and recall." },
  ];

  // shortcut: omp's bundled agents as of 18.18 (`omp agents unpack`); a
  // newer bundled one shows once it has an override or an unpacked file.
  const BUNDLED_AGENTS = ["reviewer", "scout", "seance", "security-reviewer", "sonic", "task"];

  // omp's thinking selectors (`off` … `max`, plus its per-turn `auto`).
  const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "auto"];

  /** `"provider/model:high"` → `{ model: "provider/model", thinking: "high" }`;
   *  only a known level counts as a suffix (`openrouter/x:free` keeps it). */
  function split(selector) {
    const s = String(selector ?? "");
    const at = s.lastIndexOf(":");
    if (at > 0 && THINKING.includes(s.slice(at + 1))) return { model: s.slice(0, at), thinking: s.slice(at + 1) };
    return { model: s, thinking: "" };
  }

  /** The selector for `model` at `thinking` (`""` = the model's default). */
  function join(model, thinking) {
    return thinking ? `${model}:${thinking}` : model;
  }

  /** Subagent names to list: bundled, the user's agent files and any name
   *  that already has an override, sorted, once each. */
  function agentNames(config) {
    const names = new Set([...BUNDLED_AGENTS, ...(config?.customAgents ?? []), ...Object.keys(config?.agents ?? {})]);
    return [...names].sort();
  }

  /** PathPicker rows of the tab's models (`{ id, name, provider }`) with
   *  `model` (`provider/id`) checked. A configured model the tab does not
   *  list (another profile's login, a removed model) stays first, so the
   *  menu always shows what is set. */
  function modelRows(models, model) {
    const rows = (models ?? []).map(m => {
      const value = `${m.provider}/${m.id}`;
      return { name: m.name || m.id, hint: m.provider, path: value, value, checked: value === model };
    });
    if (model && !rows.some(r => r.checked)) rows.unshift({ name: model, hint: "not listed", path: model, value: model, checked: true });
    return rows;
  }

  /** The label of a model selector in the tab's list, else the selector. */
  function modelLabel(models, model) {
    if (!model) return "";
    const hit = (models ?? []).find(m => `${m.provider}/${m.id}` === model);
    return hit ? `${hit.name || hit.id} · ${hit.provider}` : model;
  }

  /** PathPicker rows of the thinking levels, `""` = the model's default. */
  function thinkingRows(thinking) {
    return [{ name: "default", hint: "", path: "", value: "", checked: !thinking },
      ...THINKING.map(t => ({ name: t, hint: "", path: "", value: t, checked: t === thinking }))];
  }

  window.OMP_MODEL_ROLES = { ROLES, BUNDLED_AGENTS, THINKING, split, join, agentNames, modelRows, modelLabel, thinkingRows };
})();
