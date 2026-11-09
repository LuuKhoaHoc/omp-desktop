/* ═════════════════════════════════════════════════════════════════════
   design/work-forms.jsx — the Work panel's connection and view forms
   (fork). A connection is how to reach a platform (no secret: a token is
   the NAME of an environment variable); a view is what to show from it
   (app/work-views.js). Both test themselves against the server first.
   ═════════════════════════════════════════════════════════════════════ */

const { Icon: _WPF_Icon } = window;
// _WPF_Combo / _WPF_Multi / _wpfUseChoices: design/work-pickers.jsx (loads first).

function _WPF_Seg({ label, value, options, onPick }) {
  return (
    <div className="wp-seg" role="radiogroup" aria-label={label}>
      {options.map(([id, l, disabled]) => (
        <button type="button" key={id} role="radio" aria-checked={value === id} disabled={!!disabled}
          className={value === id ? "on" : ""} onClick={() => onPick(id)}>{l}</button>
      ))}
    </div>
  );
}

function _WPF_Foot({ problems, test, onTest, onCancel, onDelete }) {
  return (
    <>
      {problems.length > 0 && <ul className="wp-problems">{problems.map(m => <li key={m}>{m}</li>)}</ul>}
      {test?.ok && <div className="wp-note ok"><_WPF_Icon name="check" size={12} /> {test.ok}</div>}
      {test?.err && <div className="wp-note err"><_WPF_Icon name="warn" size={12} /> {test.err}</div>}
      <div className="wp-form-actions">
        {onDelete && <button type="button" className="btn ghost danger-text" onClick={onDelete}>Remove</button>}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn outlined" disabled={!!problems.length || test?.busy} onClick={onTest}>{test?.busy ? "Testing…" : "Test"}</button>
        <button type="submit" className="btn primary" disabled={!!problems.length}>Save</button>
      </div>
    </>
  );
}

function _wpfTester(setTest, fn) {
  return async () => {
    setTest({ busy: true });
    try { setTest({ ok: await fn() }); } catch (e) { setTest({ err: String(e?.message ?? e) }); }
  };
}

// ── Connection: platform, transport, host, token variable ─────────────────
function _WP_ConnectionForm({ initial, onSave, onCancel, onDelete }) {
  const W = window.OMP_WORK;
  const [c, setC] = React.useState(initial ?? { id: `c${Date.now().toString(36)}`, name: "", platform: "gitlab", via: "cli", host: "", tokenEnv: "" });
  const [test, setTest] = React.useState(null);
  const set = (k, v) => { setC(o => ({ ...o, [k]: v })); setTest(null); };
  const p = W.PLATFORMS[c.platform];
  const problems = W.validate(c);
  const ways = W.transports(c.platform);
  React.useEffect(() => { if (!ways.find(w => w.id === c.via && !w.disabled)) set("via", ways.find(w => !w.disabled).id); }, [c.platform]); // eslint-disable-line
  const runTest = _wpfTester(setTest, async () => `Signed in as ${await W.client(c, window._wpRun).whoami()}.`);
  return (
    <form className="wp-form" onSubmit={e => { e.preventDefault(); if (!problems.length) onSave(c); }}>
      <div className="wp-form-title">{initial ? "Edit connection" : "New connection"}</div>
      <label className="wp-field"><span>Name</span>
        <input value={c.name} placeholder="Company GitLab" onChange={e => set("name", e.target.value)} autoFocus /></label>
      <div className="wp-field"><span>Platform</span>
        <_WPF_Seg label="platform" value={c.platform} options={Object.entries(W.PLATFORMS).map(([id, x]) => [id, x.label])} onPick={v => set("platform", v)} />
        <small>{p.hint}</small>
      </div>
      <div className="wp-field"><span>Connect with</span>
        <_WPF_Seg label="transport" value={c.via} options={ways.map(w => [w.id, w.label, w.disabled])} onPick={v => set("via", v)} />
      </div>
      {c.platform !== "linear" && (
        <label className="wp-field"><span>Host <em>optional</em></span>
          <input value={c.host} placeholder={c.platform === "github" ? "api.github.com" : "gitlab.com"} onChange={e => set("host", e.target.value.trim())} /></label>
      )}
      {c.via === "token" && (
        <label className="wp-field"><span>Token variable</span>
          <input className="mono" value={c.tokenEnv} placeholder={c.platform === "linear" ? "LINEAR_API_KEY" : c.platform === "github" ? "GITHUB_TOKEN" : "GITLAB_TOKEN"}
            onChange={e => set("tokenEnv", e.target.value.trim().toUpperCase())} />
          <small>The name of an environment variable the app starts with. The token itself is never saved here.</small></label>
      )}
      <small className="wp-form-hint">What to show (projects, groups, merge requests, pipelines) is set per view, after saving.</small>
      <_WPF_Foot problems={problems} test={test} onTest={runTest} onCancel={onCancel} onDelete={onDelete} />
    </form>
  );
}

// ── View: kind, project or group, whose items, board columns, branch ──────
function _WP_ViewForm({ initial, conns, onSave, onCancel, onDelete, onEditConn }) {
  const V = window.OMP_WORK_VIEWS;
  const [v, setV] = React.useState(initial);
  const [test, setTest] = React.useState(null);
  const set = (k, val) => { setV(o => ({ ...o, [k]: val })); setTest(null); };
  const conn = conns.find(c => c.id === v.connId) ?? null;
  const platform = conn?.platform;
  const problems = V.validateView(v, conn);
  const who = V.whoOptions(v.kind, platform);
  const gitlab = platform === "gitlab";
  React.useEffect(() => {
    if (conn && !V.kinds(platform).includes(v.kind)) set("kind", "issues");
    if (who.length && !who.some(([id]) => id === v.who)) set("who", who[0][0]);
  }, [platform, v.kind]); // eslint-disable-line
  const runTest = _wpfTester(setTest, async () => {
    const r = V.resolve(v, conns);
    const n = (v.kind === "issues" ? await window.OMP_WORK.client(r, window._wpRun).list() : await window.OMP_WORK_REVIEW.client(r, window._wpRun).list()).length;
    return `${n} item${n === 1 ? "" : "s"} visible.`;
  });
  const where = platform === "github" ? "Repository" : v.scope === "group" ? "Group" : "Project";
  // Choices from the platform for the view as it stands (work-pickers.jsx).
  const target = React.useMemo(() => (conn ? { ...conn, ...v, id: conn.id } : null), [conn, v.scope, v.project]); // eslint-disable-line
  const places = window._wpfUseChoices("places", target);
  const people = window._wpfUseChoices(v.who === "team" ? "people" : "none", target);
  const labels = window._wpfUseChoices(v.kind === "issues" ? "labels" : "none", target);
  const branches = window._wpfUseChoices(v.kind === "pipelines" ? "branches" : "none", target);
  const list = s => window.OMP_WORK.members({ members: s });
  const cols = s => String(s ?? "").split(",").map(x => x.trim()).filter(Boolean);
  return (
    <form className="wp-form" onSubmit={e => { e.preventDefault(); if (!problems.length) onSave(v); }}>
      <div className="wp-form-title">{onDelete ? "Edit view" : "New view"}</div>
      <label className="wp-field"><span>Name</span>
        <input value={v.name} placeholder="FE team issues" onChange={e => set("name", e.target.value)} autoFocus /></label>
      <div className="wp-field"><span>Connection</span>
        <div className="wp-inline">
          <select className="wp-select" value={v.connId} onChange={e => set("connId", e.target.value)}>
            {conns.map(c => <option key={c.id} value={c.id}>{c.name} · {window.OMP_WORK.PLATFORMS[c.platform]?.label}</option>)}
          </select>
          {conn && <button type="button" className="btn ghost" onClick={() => onEditConn(conn)}>Edit connection</button>}
        </div></div>
      <div className="wp-field"><span>Show</span>
        <_WPF_Seg label="kind" value={v.kind} options={V.kinds(platform).map(k => [k, V.KINDS[k]])} onPick={k => set("kind", k)} />
      </div>
      {gitlab && v.kind !== "pipelines" && (
        <div className="wp-field"><span>From</span>
          <_WPF_Seg label="scope" value={v.scope} options={[["project", "One project"], ["group", "A group (many repos)"]]} onPick={s => set("scope", s)} />
          <small>A group gathers every project under it, each item tagged with its repo.</small>
        </div>
      )}
      {platform === "linear" ? (
        <div className="wp-field"><span>Team</span>
          <_WPF_Combo value={v.team} onChange={x => set("team", x)} choices={places} placeholder="Pick a team" /></div>
      ) : (
        <div className="wp-field"><span>{where}</span>
          <_WPF_Combo value={v.project} onChange={x => set("project", x)} choices={places}
            placeholder={`Pick or search ${platform === "github" ? "a repository" : v.scope === "group" ? "a group" : "a project"}`} /></div>
      )}
      {v.kind === "pipelines" && (
        <div className="wp-field"><span>Branch <em>optional</em></span>
          <_WPF_Combo value={v.branch} onChange={x => set("branch", x)} choices={branches} mono
            placeholder="Every branch" hint="Empty: every ref, merge request pipelines included." /></div>
      )}
      {who.length > 0 && (
        <div className="wp-field"><span>Whose</span>
          <_WPF_Seg label="whose" value={v.who} options={who} onPick={w => set("who", w)} />
        </div>
      )}
      {who.length > 0 && v.who === "team" && (
        <div className="wp-field"><span>Team members</span>
          <_WPF_Multi values={list(v.members)} onChange={a => set("members", a.join(", "))} choices={people} placeholder="Pick people"
            hint={v.kind === "mrs" ? "Merge requests these people opened." : "Issues assigned to any of them."} /></div>
      )}
      {v.kind === "issues" && platform !== "linear" && (
        <div className="wp-field"><span>Board columns <em>optional</em></span>
          <_WPF_Multi values={cols(v.columns)} onChange={a => set("columns", a.join(", "))} choices={labels} placeholder="Pick labels" ordered
            hint="Labels shown as columns between Open and Closed, in this order (‹ › to reorder)." /></div>
      )}
      <_WPF_Foot problems={problems} test={test} onTest={runTest} onCancel={onCancel} onDelete={onDelete} />
    </form>
  );
}

Object.assign(window, { _WP_ConnectionForm, _WP_ViewForm });
