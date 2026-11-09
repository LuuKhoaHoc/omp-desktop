/* ═════════════════════════════════════════════════════════════════════
   app/work-adapters.js — the Work panel's platforms (fork). Pure: each
   adapter turns an intent (list / get / save / move / comment) into
   transport calls and parses the reply into one Ticket shape, so the panel
   never knows which tracker it is talking to. The transport is injected
   (`run(req)` → raw text): in the app it is Rust (`work_cli` / `work_http`,
   src-tauri/src/work.rs); in tests a fake.

   Adapters take a view resolved onto its connection (app/work-views.js):
     { platform: "gitlab"|"github"|"linear", via: "cli"|"token", host?,
       tokenEnv?, project?, team?, columns?, scope?, who?, members? }
   GitLab `scope: "group"` reads `project` as a group path and lists the
   issues of every project under it (one tracker spread over many repos);
   a ticket's id is then "<project_id>:<iid>". GitLab `who`: "mine"
   (assigned to me), "team" (assigned to any of `members`, one request per
   username: the API ANDs a username list) or "all".
   `columns`: labels that act as board columns (GitLab / GitHub), e.g.
   "STATUS::TODO, STATUS::DOING". Empty: the board is Open / Closed.
   Linear's columns are its workflow states.

   Ticket: { id, key, title, body, state: "open"|"closed", stateName,
             column, labels[], assignees[], url, updatedAt, raw }
   ═════════════════════════════════════════════════════════════════════ */
(function () {
  const OPEN = "Open", CLOSED = "Closed";

  function columnsOf(conn) {
    return String(conn.columns ?? "").split(",").map(s => s.trim()).filter(Boolean);
  }
  // The board column a ticket sits in: closed → Closed; else the first
  // configured column label it carries; else Open.
  function columnFor(conn, state, labels) {
    if (state === "closed") return CLOSED;
    const cols = columnsOf(conn);
    return cols.find(c => labels.includes(c)) ?? OPEN;
  }
  function boardColumns(conn) { return [OPEN, ...columnsOf(conn), CLOSED]; }

  // ── GitLab ──────────────────────────────────────────────────────────────
  const gitlab = {
    label: "GitLab",
    hint: "gitlab.com or self-hosted. CLI: glab (signed in). Token: a personal access token with api scope.",
    fields: ["host", "project"],
    group: conn => conn.scope === "group",
    listPath(conn, filter = "") {
      return `${gitlab.group(conn) ? "groups" : "projects"}/${encodeURIComponent(conn.project)}/issues?state=all&per_page=100&order_by=updated_at${filter}`;
    },
    // One issue: by the group-mode "<project_id>:<iid>" id, or in the project.
    path(conn, id, rest = "") {
      const [pid, iid] = gitlab.group(conn) ? String(id).split(":") : [encodeURIComponent(conn.project), id];
      return `projects/${pid}/issues/${iid}${rest}`;
    },
    req(conn, method, path, fields) {
      if (conn.via === "cli") {
        const args = ["api"];
        if (conn.host) args.push("--hostname", conn.host);
        if (method !== "GET") args.push("-X", method);
        args.push(path);
        for (const [k, v] of Object.entries(fields ?? {})) args.push("-f", `${k}=${v}`);
        return { kind: "cli", tool: "glab", args };
      }
      const base = `https://${conn.host || "gitlab.com"}/api/v4/`;
      return { kind: "http", url: base + path, method, auth: "private-token", tokenEnv: conn.tokenEnv,
        body: fields ? JSON.stringify(fields) : null };
    },
    parse(conn, it) {
      const labels = it.labels ?? [];
      const state = it.state === "closed" ? "closed" : "open";
      const group = gitlab.group(conn);
      // Group mode: tag the repo, e.g. "kho#36" for ".../erp/kho#36".
      const key = group && it.references?.full ? it.references.full.split("/").pop() : `#${it.iid}`;
      return {
        id: group ? `${it.project_id}:${it.iid}` : String(it.iid), key, title: it.title ?? "", body: it.description ?? "",
        state, stateName: state, column: columnFor(conn, state, labels), labels,
        assignees: (it.assignees ?? []).map(a => a.username), url: it.web_url, updatedAt: it.updated_at, raw: it,
      };
    },
    list(conn) {
      if (conn.who === "mine") return [gitlab.req(conn, "GET", gitlab.listPath(conn, "&scope=assigned_to_me"))];
      if (conn.who === "team") return members(conn).map(u => gitlab.req(conn, "GET", gitlab.listPath(conn, `&scope=all&assignee_username=${encodeURIComponent(u)}`)));
      return [gitlab.req(conn, "GET", gitlab.listPath(conn))];
    },
    whoami: conn => gitlab.req(conn, "GET", "user"),
    me: v => v.username,
    get: (conn, id) => gitlab.req(conn, "GET", gitlab.path(conn, id)),
    save(conn, t, edit) {
      const f = {};
      if (edit.title != null && edit.title !== t.title) f.title = edit.title;
      if (edit.body != null && edit.body !== t.body) f.description = edit.body;
      if (edit.labels) f.labels = edit.labels.join(",");
      if (edit.state && edit.state !== t.state) f.state_event = edit.state === "closed" ? "close" : "reopen";
      return Object.keys(f).length ? gitlab.req(conn, "PUT", gitlab.path(conn, t.id), f) : null;
    },
    move(conn, t, column) { return gitlab.save(conn, t, moveEdit(conn, t, column)); },
    comment: (conn, t, body) => gitlab.req(conn, "POST", gitlab.path(conn, t.id, "/notes"), { body }),
  };

  // ── GitHub ──────────────────────────────────────────────────────────────
  const github = {
    label: "GitHub",
    hint: "github.com repository issues. CLI: gh (signed in). Token: fine-grained token with Issues read/write.",
    fields: ["project"],
    path(conn, rest = "") { return `repos/${conn.project}/issues${rest}`; },
    req(conn, method, path, fields) {
      if (conn.via === "cli") {
        const args = ["api"];
        if (method !== "GET") args.push("-X", method);
        args.push(path);
        for (const [k, v] of Object.entries(fields ?? {})) {
          // `labels` must arrive as an array: one -f labels[]=x per label.
          if (Array.isArray(v)) { if (!v.length) args.push("-f", `${k}[]`); for (const x of v) args.push("-f", `${k}[]=${x}`); }
          else args.push("-f", `${k}=${v}`);
        }
        return { kind: "cli", tool: "gh", args };
      }
      return { kind: "http", url: `https://${conn.host || "api.github.com"}/${path}`, method, auth: "bearer",
        tokenEnv: conn.tokenEnv, body: fields ? JSON.stringify(fields) : null };
    },
    parse(conn, it) {
      const labels = (it.labels ?? []).map(l => (typeof l === "string" ? l : l.name));
      const state = it.state === "closed" ? "closed" : "open";
      return {
        id: String(it.number), key: `#${it.number}`, title: it.title ?? "", body: it.body ?? "",
        state, stateName: state, column: columnFor(conn, state, labels), labels,
        assignees: (it.assignees ?? []).map(a => a.login), url: it.html_url, updatedAt: it.updated_at, raw: it,
      };
    },
    list: conn => [github.req(conn, "GET", github.path(conn, "?state=all&per_page=100&sort=updated"))],
    whoami: conn => github.req(conn, "GET", "user"),
    me: v => v.login,
    get: (conn, id) => github.req(conn, "GET", github.path(conn, `/${id}`)),
    save(conn, t, edit) {
      const f = {};
      if (edit.title != null && edit.title !== t.title) f.title = edit.title;
      if (edit.body != null && edit.body !== t.body) f.body = edit.body;
      if (edit.labels) f.labels = edit.labels;
      if (edit.state && edit.state !== t.state) f.state = edit.state;
      return Object.keys(f).length ? github.req(conn, "PATCH", github.path(conn, `/${t.id}`), f) : null;
    },
    move(conn, t, column) { return github.save(conn, t, moveEdit(conn, t, column)); },
    comment: (conn, t, body) => github.req(conn, "POST", github.path(conn, `/${t.id}/comments`), { body }),
  };

  // Moving between label columns: drop every column label, add the target
  // one; Closed closes, Open reopens with no column label.
  function moveEdit(conn, t, column) {
    const cols = columnsOf(conn);
    const kept = t.labels.filter(l => !cols.includes(l));
    if (column === CLOSED) return { state: "closed" };
    return { state: "open", labels: column === OPEN ? kept : [...kept, column] };
  }

  // ── Linear (GraphQL, token only) ────────────────────────────────────────
  const LINEAR_URL = "https://api.linear.app/graphql";
  const LINEAR_FIELDS = "id identifier title description url updatedAt state { id name type } labels { nodes { name } } assignee { name }";
  const linear = {
    label: "Linear",
    hint: "Personal API key (Settings → Security & access → API). Team: its key, e.g. ENG.",
    fields: ["team"],
    gql(conn, query, variables) {
      return { kind: "http", url: LINEAR_URL, method: "POST", auth: "plain", tokenEnv: conn.tokenEnv,
        body: JSON.stringify({ query, variables }) };
    },
    parse(conn, it) {
      const type = it.state?.type;
      const state = type === "completed" || type === "canceled" ? "closed" : "open";
      return {
        id: it.id, key: it.identifier, title: it.title ?? "", body: it.description ?? "",
        state, stateName: it.state?.name ?? "", column: it.state?.name ?? OPEN,
        labels: (it.labels?.nodes ?? []).map(l => l.name), assignees: it.assignee ? [it.assignee.name] : [],
        url: it.url, updatedAt: it.updatedAt, raw: it,
      };
    },
    list: conn => [
      linear.gql(conn, `query($team: String!) { issues(first: 100, orderBy: updatedAt, filter: { team: { key: { eq: $team } } }) { nodes { ${LINEAR_FIELDS} } }
        workflowStates(filter: { team: { key: { eq: $team } } }) { nodes { id name type position } } }`, { team: conn.team }),
    ],
    whoami: conn => linear.gql(conn, "{ viewer { name } }", {}),
    me: v => v.data?.viewer?.name,
    get: (conn, id) => linear.gql(conn, `query($id: String!) { issue(id: $id) { ${LINEAR_FIELDS} } }`, { id }),
    save(conn, t, edit) {
      const input = {};
      if (edit.title != null && edit.title !== t.title) input.title = edit.title;
      if (edit.body != null && edit.body !== t.body) input.description = edit.body;
      if (edit.stateId) input.stateId = edit.stateId;
      if (!Object.keys(input).length) return null;
      return linear.gql(conn, `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { ${LINEAR_FIELDS} } } }`,
        { id: t.id, input });
    },
    move(conn, t, column, ctx) {
      const st = (ctx?.states ?? []).find(s => s.name === column);
      return st ? linear.save(conn, t, { stateId: st.id }) : null;
    },
    comment: (conn, t, body) => linear.gql(conn, `mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }`,
      { input: { issueId: t.id, body } }),
  };

  const PLATFORMS = { gitlab, github, linear };

  /** Transports a platform offers. MCP is listed so the choice is visible,
   *  disabled until the app has an MCP client. */
  function transports(platform) {
    if (platform === "linear") return [{ id: "token", label: "API token" }, { id: "mcp", label: "MCP (soon)", disabled: true }];
    return [{ id: "cli", label: platform === "github" ? "gh CLI" : "glab CLI" },
      { id: "token", label: "API token" }, { id: "mcp", label: "MCP (soon)", disabled: true }];
  }

  /** Usernames of a view's team: comma/space separated, "@" optional. */
  function members(v) {
    return [...new Set(String(v.members ?? "").split(/[\s,]+/).map(s => s.replace(/^@/, "")).filter(Boolean))];
  }

  /** Problems with a connection, in words, before anything runs. What it
   *  tracks (project, team key, columns) is the view's: work-views.js. */
  function validate(conn) {
    const p = PLATFORMS[conn.platform];
    const out = [];
    if (!p) return ["Choose a platform."];
    if (!conn.name?.trim()) out.push("Give the connection a name.");
    if (conn.via === "mcp") out.push("MCP is not available yet: use the CLI or a token.");
    if (conn.via === "token" && !/^[A-Z_][A-Z0-9_]*$/.test(conn.tokenEnv ?? "")) out.push("Token variable must look like GITLAB_TOKEN (the token itself stays in your environment).");
    if (conn.host && !/^[a-z0-9.-]+(:\d+)?$/i.test(conn.host)) out.push("Host is a bare name like gitlab.example.com.");
    return out;
  }

  function parseJson(text) {
    const v = JSON.parse(text);
    if (v && Array.isArray(v.errors) && v.errors.length) throw new Error(v.errors.map(e => e.message).join("; "));
    return v;
  }

  /** Bind a connection to a transport: async methods returning Tickets. */
  function client(conn, run) {
    const p = PLATFORMS[conn.platform];
    if (!p) throw new Error(`unknown platform ${conn.platform}`);
    const ctx = { states: [] };
    const one = text => {
      const v = parseJson(text);
      const it = conn.platform === "linear" ? (v.data?.issue ?? v.data?.issueUpdate?.issue) : v;
      return it ? p.parse(conn, it) : null;
    };
    return {
      ctx,
      async list() {
        const replies = await Promise.all(p.list(conn).map(async req => parseJson(await run(req))));
        if (conn.platform === "linear") {
          const v = replies[0];
          ctx.states = (v.data?.workflowStates?.nodes ?? []).slice().sort((a, b) => a.position - b.position);
          return (v.data?.issues?.nodes ?? []).map(it => p.parse(conn, it));
        }
        // GitHub lists pull requests as issues too: keep issues only.
        const seen = new Map();
        for (const v of replies) for (const it of Array.isArray(v) ? v : []) if (!it.pull_request) { const t = p.parse(conn, it); seen.set(t.id, t); }
        const out = [...seen.values()];
        // Several requests (a team): newest first across them.
        if (replies.length > 1) out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
        return out;
      },
      /** The signed-in user's name: the connection test. */
      async whoami() { return p.me(parseJson(await run(p.whoami(conn)))) ?? "?"; },
      columns() { return conn.platform === "linear" ? ctx.states.map(s => s.name) : boardColumns(conn); },
      async get(id) { return one(await run(p.get(conn, id))); },
      /** Save edits. Refuses when the ticket changed on the server since it
       *  was opened (`updatedAt`), so nobody's edit is overwritten blind. */
      async save(t, edit) {
        const fresh = await this.get(t.id);
        if (fresh && t.updatedAt && fresh.updatedAt !== t.updatedAt) {
          const err = new Error("This ticket changed on the server since you opened it. Reload it, then edit again.");
          err.conflict = fresh; throw err;
        }
        const req = p.save(conn, t, edit);
        if (!req) return t;
        const out = one(await run(req));
        return out ?? (await this.get(t.id));
      },
      async move(t, column) {
        const req = p.move(conn, t, column, ctx);
        if (!req) return t;
        const out = one(await run(req));
        return out ?? (await this.get(t.id));
      },
      async comment(t, body) { parseJson(await run(p.comment(conn, t, body))); },
    };
  }

  const api = { PLATFORMS, OPEN, CLOSED, transports, validate, members, client, boardColumns, columnFor, moveEdit, parseJson };
  if (typeof window !== "undefined") window.OMP_WORK = api;
  if (typeof module !== "undefined") module.exports = api;
})();
