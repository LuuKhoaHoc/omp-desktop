/* ═════════════════════════════════════════════════════════════════════
   app/work-views.js — the Work panel's saved views (fork). Pure.

   A connection says how to reach a platform (work-adapters.js); a view
   says what to show from it, so one sign-in serves issues spread over a
   group, the merge requests of another and a project's pipelines:
     { id, connId, name, kind: "issues"|"mrs"|"pipelines",
       project, scope: "project"|"group", who, members, columns, team,
       branch }
   `who` — issues: mine | team | all; MRs: mine | review | team | all.
   `members`: the team's usernames. `team`: a Linear team key. `branch`:
   pipelines of one ref only. Merge requests and pipelines are GitLab's.
   ═════════════════════════════════════════════════════════════════════ */
(function () {
  const KINDS = { issues: "Issues", mrs: "Merge requests", pipelines: "Pipelines" };
  const WHO = {
    issues: [["mine", "Assigned to me"], ["team", "Team"], ["all", "All"]],
    mrs: [["mine", "Mine"], ["review", "To review"], ["team", "Team"], ["all", "All"]],
    pipelines: [],
  };

  const kinds = platform => (platform === "gitlab" ? ["issues", "mrs", "pipelines"] : ["issues"]);
  const whoOptions = (kind, platform) => (platform === "gitlab" ? WHO[kind] ?? [] : []);

  /** Before views existed a connection held one issue tracker: split each
   *  into the connection and its Issues view. `views` already stored: as is. */
  function migrate(conns, views) {
    if (Array.isArray(views)) return { conns, views };
    const out = { conns: [], views: [] };
    for (const c of conns) {
      const { project, team, columns, scope, mine, ...conn } = c;
      out.conns.push(conn);
      out.views.push({ id: `v${c.id}`, connId: c.id, name: c.name, kind: "issues", project: project ?? "",
        team: team ?? "", columns: columns ?? "", scope: scope ?? "project", who: mine ? "mine" : "all", members: "", branch: "" });
    }
    return out;
  }

  /** The object the adapters take: connection fields, then the view's. */
  function resolve(view, conns) {
    const conn = conns.find(c => c.id === view?.connId);
    return conn ? { ...conn, ...view } : null;
  }

  function validateView(view, conn) {
    if (!conn) return ["Choose a connection."];
    const out = [];
    const members = window.OMP_WORK.members(view);
    if (!view.name?.trim()) out.push("Give the view a name.");
    if (!kinds(conn.platform).includes(view.kind)) out.push(`${KINDS[view.kind] ?? view.kind} are not available for this platform.`);
    if (conn.platform === "linear") { if (!view.team?.trim()) out.push("Team key, e.g. ENG."); return out; }
    if (!view.project?.trim()) out.push(conn.platform === "github" ? "Repository: owner/name." : view.scope === "group" ? "Group: its path, e.g. company/erp." : "Project: group/name or its numeric id.");
    if (conn.platform === "github" && view.project && !/^[\w.-]+\/[\w.-]+$/.test(view.project)) out.push("Repository must be owner/name.");
    if (view.kind === "pipelines" && view.scope === "group") out.push("Pipelines need one project: GitLab lists them per project.");
    if (view.who === "team" && whoOptions(view.kind, conn.platform).length && !members.length) out.push("List the team's usernames.");
    if (members.some(u => !/^[\w.-]+$/.test(u))) out.push("Usernames are letters, digits, '.', '_' or '-'.");
    return out;
  }

  // ── Choices for the view form, read from the platform ────────────────────
  // Each kind → [{ value, label?, hint? }]. Typing stays allowed: these only
  // spare remembering paths, usernames, labels and branch names.
  const enc = encodeURIComponent;
  const P = () => window.OMP_WORK.PLATFORMS;
  const uniq = rows => { const m = new Map(); for (const r of rows) if (r?.value && !m.has(r.value)) m.set(r.value, r); return [...m.values()]; };
  const person = u => u && { value: u.username ?? u.login, label: u.name && u.name !== (u.username ?? u.login) ? u.name : undefined };

  /** Requests for one kind of choice, or null when it does not apply.
   *  `where`: GitLab "groups" | "projects" for the view's scope. */
  function choiceRequests(kind, v) {
    const gl = P().gitlab, gh = P().github;
    const where = v.scope === "group" ? "groups" : "projects";
    const at = `${where}/${enc(v.project ?? "")}`;
    if (v.platform === "gitlab") {
      if (kind === "places") return [gl.req(v, "GET", v.scope === "group" ? "groups?per_page=100&order_by=path" : "projects?membership=true&simple=true&per_page=100&order_by=last_activity_at")];
      if (!v.project) return null;
      if (kind === "people") return [gl.req(v, "GET", `${at}/members/all?per_page=100`)];
      if (kind === "labels") return [gl.req(v, "GET", `${at}/labels?per_page=100`)];
      if (kind === "branches") return v.scope === "group" ? null : [gl.req(v, "GET", `${at}/repository/branches?per_page=100`)];
      return null;
    }
    if (v.platform === "github") {
      if (kind === "places") return [gh.req(v, "GET", "user/repos?per_page=100&sort=updated")];
      if (!/^[\w.-]+\/[\w.-]+$/.test(v.project ?? "")) return null;
      if (kind === "people") return [gh.req(v, "GET", `repos/${v.project}/assignees?per_page=100`)];
      if (kind === "labels") return [gh.req(v, "GET", `repos/${v.project}/labels?per_page=100`)];
      return null;
    }
    if (v.platform === "linear" && kind === "places") return [P().linear.gql(v, "{ teams(first: 100) { nodes { key name } } }", {})];
    return null;
  }

  function parseChoices(kind, v, reply) {
    if (v.platform === "linear") return (reply.data?.teams?.nodes ?? []).map(t => ({ value: t.key, label: t.name }));
    const rows = Array.isArray(reply) ? reply : [];
    if (kind === "places") return rows.map(x => ({ value: x.full_path ?? x.path_with_namespace ?? x.full_name, label: x.name }));
    if (kind === "people") return uniq(rows.filter(u => u.state !== "blocked" && !u.bot && u.type !== "Bot").map(person));
    if (kind === "labels") return rows.map(l => ({ value: l.name, hint: l.description || undefined }));
    return rows.map(b => ({ value: b.name, hint: b.default ? "default" : undefined }));
  }

  /** People seen on a GitLab group's recent issues and merge requests: the
   *  fallback when the group's member list is not readable (403 below the
   *  Maintainer role on some instances). */
  async function gitlabActivePeople(v, get) {
    const gl = P().gitlab, at = `groups/${enc(v.project)}`;
    const [issues, mrs] = await Promise.all([
      get(gl.req(v, "GET", `${at}/issues?state=all&per_page=100&order_by=updated_at`)).catch(() => []),
      get(gl.req(v, "GET", `${at}/merge_requests?state=all&scope=all&per_page=100&order_by=updated_at`)).catch(() => []),
    ]);
    const users = [...issues.flatMap(i => [...(i.assignees ?? []), i.author]), ...mrs.flatMap(m => [m.author, ...(m.reviewers ?? [])])];
    return uniq(users.filter(Boolean).map(person)).sort((a, b) => a.value.localeCompare(b.value));
  }

  /** Choices of one kind for a resolved view; [] when none apply. */
  async function loadChoices(kind, v, run) {
    const reqs = choiceRequests(kind, v);
    if (!reqs) return [];
    const get = async r => window.OMP_WORK.parseJson(await run(r));
    try { return parseChoices(kind, v, await get(reqs[0])); }
    catch (e) {
      if (kind === "people" && v.platform === "gitlab" && v.scope === "group") return gitlabActivePeople(v, get);
      throw e;
    }
  }

  // ── Board columns ───────────────────────────────────────────────────────
  /** How the board names and tones a column: a "status" scope is dropped
   *  ("STATUS - ON HOLD" → "On Hold"), and the name picks the dot's tone. */
  function columnMeta(col) {
    const raw = String(col ?? "");
    const cleaned = raw.replace(/^(?:status\s*(?:-|::|:|\/)\s*)/i, "").trim() || raw;
    const label = cleaned === cleaned.toUpperCase() && cleaned.length > 3
      ? cleaned.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
      : cleaned;
    const low = raw.toLowerCase();
    const tone = /block|reject|fail|hold|stuck/.test(low) ? "blocked"
      : /done|close|resolv|merg|complete|ship/.test(low) ? "done"
      : /assign|progress|doing|active|review|test|qa|wip/.test(low) ? "active"
      : "idle";
    return { label, tone };
  }

  /** The scope of a scoped label, as written ("status::doing" → "status",
   *  "STATUS - ON HOLD" → "STATUS", "workflow/ready" → "workflow"); "" for
   *  a plain one. A bare hyphen is part of a name ("front-end"). */
  function labelScope(label) {
    const m = /^(.+?)(?:\s*::\s*|\s*:\s*|\s+-\s+|\s*\/\s*)\S/.exec(String(label ?? ""));
    return m ? m[1].trim() : "";
  }
  const FLOW_SCOPES = ["status", "state", "stage", "workflow", "column", "board"];

  /** The labels that would finish a board in one step: those sharing the
   *  scope of a column already picked, or, with no scoped column yet, a
   *  workflow scope the tracker holds at least two labels of. `labels` are
   *  the tracker's choices (`{ value }`), `chosen` the picked columns.
   *  `{ scope, labels }` (the scope as its first label writes it, the
   *  labels in the tracker's order, without the picked ones), or `null`. */
  function columnSuggestion(labels, chosen) {
    const values = labels.map(o => o.value);
    const low = v => labelScope(v).toLowerCase();
    const want = chosen.map(low).find(Boolean)
      ?? FLOW_SCOPES.find(s => values.filter(v => low(v) === s).length > 1);
    if (!want) return null;
    const rest = values.filter(v => low(v) === want && !chosen.includes(v));
    return rest.length ? { scope: labelScope(rest[0]), labels: rest } : null;
  }

  const api = { KINDS, kinds, whoOptions, migrate, resolve, validateView, choiceRequests, parseChoices, loadChoices, columnMeta, columnSuggestion };
  if (typeof window !== "undefined") window.OMP_WORK_VIEWS = api;
  if (typeof module !== "undefined") module.exports = api;
})();
