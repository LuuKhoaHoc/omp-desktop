/* ═════════════════════════════════════════════════════════════════════
   app/work-review.js — GitLab merge requests and pipelines for the Work
   panel (fork). Pure like work-adapters.js, whose GitLab transport
   (`glab api` or a token over HTTPS) it reuses; `run` is injected.

   MR:       { id: "<project_id>:<iid>", key: "repo!iid", title, body, author,
               reviewers[], draft, conflicts, status, tone, source, target,
               sha, labels[], url, updatedAt, pipeline, raw }
   Pipeline: { id: "<project_id>:<id>", key: "#id", status, tone, ref, sha,
               source, user, url, updatedAt, raw }

   Writes: comment, approve / unapprove and merge, each pinned to the HEAD
   the user saw (`sha`), so a push in between makes GitLab refuse instead
   of acting on unseen commits; retry a pipeline. No auto-merge, no cancel.
   ═════════════════════════════════════════════════════════════════════ */
(function () {
  const enc = encodeURIComponent;
  const req = (v, method, path, fields) => window.OMP_WORK.PLATFORMS.gitlab.req(v, method, path, fields);
  const json = text => window.OMP_WORK.parseJson(text);
  const repoOf = (full, fallback) => String(full ?? "").split("/").pop() || fallback;
  const base = v => `${v.scope === "group" ? "groups" : "projects"}/${enc(v.project)}`;
  const mrPath = id => { const [p, i] = String(id).split(":"); return `projects/${p}/merge_requests/${i}`; };
  const pipePath = id => { const [p, i] = String(id).split(":"); return `projects/${p}/pipelines/${i}`; };

  // detailed_merge_status → words and a tone (ok / warn / bad / idle).
  const MERGE = {
    mergeable: ["ready", "ok"], ci_still_running: ["CI running", "warn"], ci_must_pass: ["CI must pass", "bad"],
    not_approved: ["needs approval", "warn"], conflict: ["conflict", "bad"], draft_status: ["draft", "idle"],
    discussions_not_resolved: ["open threads", "warn"], need_rebase: ["needs rebase", "bad"], checking: ["checking", "idle"],
    unchecked: ["checking", "idle"], blocked_status: ["blocked", "bad"], requested_changes: ["changes requested", "bad"],
    jira_association_missing: ["needs Jira key", "warn"], not_open: ["closed", "idle"],
  };
  const PIPE = { success: "ok", failed: "bad", canceled: "idle", skipped: "idle", manual: "idle",
    running: "warn", pending: "warn", created: "warn", preparing: "warn", waiting_for_resource: "warn", scheduled: "warn" };
  const pipeTone = s => PIPE[s] ?? "idle";

  function parseMr(it) {
    const status = it.detailed_merge_status ?? it.merge_status ?? "";
    const [label, tone] = it.state === "merged" ? ["merged", "ok"] : MERGE[status] ?? [status.replace(/_/g, " "), "idle"];
    const hp = it.head_pipeline;
    return {
      id: `${it.project_id}:${it.iid}`, key: repoOf(it.references?.full, `!${it.iid}`),
      title: it.title ?? "", body: it.description ?? "", state: it.state, author: it.author?.username ?? "",
      reviewers: (it.reviewers ?? []).map(r => r.username), draft: !!it.draft, conflicts: !!it.has_conflicts,
      status, statusLabel: label, tone, source: it.source_branch, target: it.target_branch, sha: it.sha,
      labels: it.labels ?? [], url: it.web_url, updatedAt: it.updated_at,
      pipeline: hp ? { id: `${hp.project_id ?? it.project_id}:${hp.id}`, status: hp.status, tone: pipeTone(hp.status), url: hp.web_url } : null,
      raw: it,
    };
  }

  function parsePipe(it) {
    const mr = /^refs\/merge-requests\/(\d+)\/head$/.exec(it.ref ?? "");
    return {
      id: `${it.project_id}:${it.id}`, key: `#${it.id}`, status: it.status, tone: pipeTone(it.status),
      ref: mr ? `!${mr[1]}` : it.ref ?? "", sha: String(it.sha ?? "").slice(0, 8), source: it.source ?? "",
      user: it.user?.username ?? "", url: it.web_url, updatedAt: it.updated_at, raw: it,
    };
  }

  const parseJob = it => ({ id: it.id, name: it.name, stage: it.stage, status: it.status, tone: pipeTone(it.status),
    duration: it.duration, url: it.web_url });

  /** Requests listing a view's MRs. `me`: the signed-in username ("To review"). */
  function mrLists(v, me) {
    const p = `${base(v)}/merge_requests?state=opened&per_page=100&order_by=updated_at`;
    if (v.who === "mine") return [req(v, "GET", `${p}&scope=created_by_me`)];
    if (v.who === "review") return [req(v, "GET", `${p}&scope=all&reviewer_username=${enc(me)}`)];
    if (v.who === "team") return window.OMP_WORK.members(v).map(u => req(v, "GET", `${p}&scope=all&author_username=${enc(u)}`));
    return [req(v, "GET", `${p}&scope=all`)];
  }
  const pipeList = v => req(v, "GET", `projects/${enc(v.project)}/pipelines?per_page=50&order_by=id&sort=desc${v.branch ? `&ref=${enc(v.branch)}` : ""}`);

  /** Stage order as the pipeline runs: first appearance by job id. */
  function stages(jobs) {
    const order = [];
    for (const j of [...jobs].sort((a, b) => a.id - b.id)) {
      let s = order.find(x => x.name === j.stage);
      if (!s) order.push((s = { name: j.stage, jobs: [] }));
      s.jobs.push(j);
    }
    return order;
  }

  function client(v, run) {
    let me = null;
    const get = async r => json(await run(r));
    return {
      async list() {
        if (v.kind === "pipelines") return (await get(pipeList(v))).map(parsePipe);
        if (v.who === "review" && !me) me = (await get(req(v, "GET", "user"))).username;
        const seen = new Map();
        for (const page of await Promise.all(mrLists(v, me).map(get))) for (const it of page) { const m = parseMr(it); seen.set(m.id, m); }
        return [...seen.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      },
      getMr: async id => parseMr(await get(req(v, "GET", mrPath(id)))),
      async approvals(id) {
        const a = await get(req(v, "GET", `${mrPath(id)}/approvals`));
        return { by: (a.approved_by ?? []).map(x => x.user?.username), left: a.approvals_left ?? 0,
          mine: !!a.user_has_approved, can: !!a.user_can_approve };
      },
      approve: async m => { await get(req(v, "POST", `${mrPath(m.id)}/approve`, { sha: m.sha })); },
      unapprove: async m => { await get(req(v, "POST", `${mrPath(m.id)}/unapprove`)); },
      merge: async m => parseMr(await get(req(v, "PUT", `${mrPath(m.id)}/merge`, { sha: m.sha }))),
      comment: async (m, body) => { await get(req(v, "POST", `${mrPath(m.id)}/notes`, { body })); },
      // shortcut: first 100 threads only, page on when an MR outgrows it.
      notes: async id => window.OMP_WORK.parseDiscussions(await get(req(v, "GET", `${mrPath(id)}/discussions?per_page=100`))),
      jobs: async id => (await get(req(v, "GET", `${pipePath(id)}/jobs?per_page=100`))).map(parseJob),
      retry: async id => parsePipe(await get(req(v, "POST", `${pipePath(id)}/retry`))),
    };
  }

  const api = { parseMr, parsePipe, parseJob, mrLists, pipeList, stages, client };
  if (typeof window !== "undefined") window.OMP_WORK_REVIEW = api;
  if (typeof module !== "undefined") module.exports = api;
})();
