#!/usr/bin/env node
// Regression script for src/app/work-views.js and src/app/work-review.js
// (fork): saved views over connections, the pre-views migration, and the
// GitLab merge request / pipeline requests and parsing.
// Run: node tests/test-work-views.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const win = {};
for (const f of ["work-adapters", "work-views", "work-review"]) {
  // eslint-disable-next-line no-new-func
  new Function("window", readFileSync(join(root, `src/app/${f}.js`), "utf8"))(win);
}
globalThis.window = win;
const V = win.OMP_WORK_VIEWS, R = win.OMP_WORK_REVIEW, W = win.OMP_WORK;

let passed = 0;
async function check(label, fn) {
  try { await fn(); } catch (err) { console.error(`FAILED: ${label}`); throw err; }
  passed++;
}

const conn = { id: "c1", name: "co", platform: "gitlab", via: "cli", host: "git.example.com" };
const view = (o = {}) => ({ id: "v1", connId: "c1", name: "v", kind: "issues", project: "co/erp", scope: "group", who: "all", members: "", columns: "", team: "", branch: "", ...o });
const pathOf = r => r.args[3];

await check("migrate: a pre-views connection becomes a connection plus its Issues view", () => {
  const old = [{ id: "a", name: "T", platform: "gitlab", via: "cli", host: "h", project: "g/p", scope: "group", mine: true, columns: "X" }];
  const { conns, views } = V.migrate(old, null);
  assert.deepEqual(conns, [{ id: "a", name: "T", platform: "gitlab", via: "cli", host: "h" }]);
  assert.equal(views[0].connId, "a");
  assert.equal(views[0].kind, "issues");
  assert.equal(views[0].who, "mine");
  assert.equal(views[0].project, "g/p");
  assert.equal(views[0].columns, "X");
  const kept = [view()];
  assert.equal(V.migrate(old, kept).views, kept);
});

await check("resolve: view fields over the connection's; unknown connection is null", () => {
  const r = V.resolve(view(), [conn]);
  assert.equal(r.host, "git.example.com");
  assert.equal(r.project, "co/erp");
  assert.equal(V.resolve(view({ connId: "x" }), [conn]), null);
});

await check("validateView: kinds per platform, team needs usernames, pipelines need one project", () => {
  assert.deepEqual(V.validateView(view(), conn), []);
  assert.ok(V.validateView(view({ who: "team" }), conn).some(m => /usernames/.test(m)));
  assert.ok(V.validateView(view({ who: "team", members: "a; b" }), conn).some(m => /letters/.test(m)));
  assert.deepEqual(V.validateView(view({ who: "team", members: "@a, b c" }), conn), []);
  assert.ok(V.validateView(view({ kind: "pipelines" }), conn).some(m => /one project/.test(m)));
  assert.ok(V.validateView(view({ kind: "mrs" }), { ...conn, platform: "github" }).some(m => /not available/.test(m)));
  assert.deepEqual(V.kinds("linear"), ["issues"]);
});

await check("issues team: one request per username (GitLab ANDs a list), merged newest first", async () => {
  const v = V.resolve(view({ who: "team", members: "a, b" }), [conn]);
  const reqs = W.PLATFORMS.gitlab.list(v);
  assert.equal(reqs.length, 2);
  assert.ok(pathOf(reqs[0]).includes("&scope=all&assignee_username=a"));
  const it = (iid, at) => ({ iid, project_id: 1, title: "t", state: "opened", labels: [], assignees: [], updated_at: at, references: { full: "co/erp/kho#" + iid } });
  const replies = [[it(1, "2026-01-01"), it(2, "2026-01-03")], [it(2, "2026-01-03"), it(3, "2026-01-02")]];
  let i = 0;
  const list = await W.client(v, async () => JSON.stringify(replies[i++])).list();
  assert.deepEqual(list.map(t => t.key), ["kho#2", "kho#3", "kho#1"]);
});

await check("MR lists: mine, to review (needs me), team per author, all", () => {
  const p = who => R.mrLists(V.resolve(view({ kind: "mrs", who, members: "x y" }), [conn]), "me").map(pathOf);
  assert.ok(p("mine")[0].startsWith("groups/co%2Ferp/merge_requests?state=opened"));
  assert.ok(p("mine")[0].endsWith("&scope=created_by_me"));
  assert.ok(p("review")[0].endsWith("&scope=all&reviewer_username=me"));
  assert.deepEqual(p("team").map(s => s.split("author_username=")[1]), ["x", "y"]);
  assert.ok(p("all")[0].endsWith("&scope=all"));
});

await check("parseMr: repo key, status words and tone, head pipeline", () => {
  const m = R.parseMr({ iid: 5, project_id: 9, title: "T", description: "", state: "opened", author: { username: "a" }, reviewers: [{ username: "r" }],
    detailed_merge_status: "not_approved", sha: "abc", references: { full: "co/erp-admin!5" }, head_pipeline: { id: 77, status: "failed", web_url: "u" } });
  assert.equal(m.id, "9:5");
  assert.equal(m.key, "erp-admin!5");
  assert.equal(m.statusLabel, "needs approval");
  assert.equal(m.tone, "warn");
  assert.deepEqual(m.pipeline, { id: "9:77", status: "failed", tone: "bad", url: "u" });
  assert.equal(R.parseMr({ iid: 1, project_id: 1, state: "merged", detailed_merge_status: "not_open" }).statusLabel, "merged");
});

await check("MR writes: approve and merge pin the seen sha; comment and retry hit the right paths", async () => {
  const sent = [];
  const c = R.client(V.resolve(view({ kind: "mrs" }), [conn]), async r => { sent.push(r.args); return JSON.stringify({ iid: 5, project_id: 9, id: 3, state: "merged" }); });
  const m = { id: "9:5", sha: "abc" };
  await c.approve(m);
  await c.merge(m);
  await c.comment(m, "hi");
  await c.retry("9:3");
  assert.deepEqual(sent[0].slice(3), ["-X", "POST", "projects/9/merge_requests/5/approve", "-f", "sha=abc"]);
  assert.deepEqual(sent[1].slice(3), ["-X", "PUT", "projects/9/merge_requests/5/merge", "-f", "sha=abc"]);
  assert.ok(sent[2].includes("projects/9/merge_requests/5/notes"));
  assert.ok(sent[3].includes("projects/9/pipelines/3/retry"));
  assert.ok(!sent.flat().some(a => /merge_when_pipeline_succeeds|auto_merge/.test(a)));
});

await check("pipelines: per project, optional branch, MR refs shortened, stages in run order", () => {
  const v = V.resolve(view({ kind: "pipelines", scope: "project", project: "co/app", branch: "develop" }), [conn]);
  assert.equal(pathOf(R.pipeList(v)), "projects/co%2Fapp/pipelines?per_page=50&order_by=id&sort=desc&ref=develop");
  const p = R.parsePipe({ id: 3, project_id: 9, status: "running", ref: "refs/merge-requests/12/head", sha: "0123456789" });
  assert.equal(p.ref, "!12");
  assert.equal(p.sha, "01234567");
  assert.equal(p.tone, "warn");
  const st = R.stages([{ id: 3, stage: "test" }, { id: 1, stage: "build" }, { id: 2, stage: "test" }]);
  assert.deepEqual(st.map(s => [s.name, s.jobs.map(j => j.id)]), [["build", [1]], ["test", [2, 3]]]);
});

await check("choices: requests per kind and scope, nothing without a place, parsed to { value, label }", () => {
  const g = { ...conn, scope: "group", project: "co/erp" };
  const p = (k, v) => V.choiceRequests(k, v)?.map(pathOf);
  assert.deepEqual(p("places", g), ["groups?per_page=100&order_by=path"]);
  assert.ok(p("places", { ...g, scope: "project" })[0].startsWith("projects?membership=true"));
  assert.deepEqual(p("people", g), ["groups/co%2Ferp/members/all?per_page=100"]);
  assert.deepEqual(p("labels", g), ["groups/co%2Ferp/labels?per_page=100"]);
  assert.equal(V.choiceRequests("branches", g), null);
  assert.deepEqual(p("branches", { ...g, scope: "project" }), ["projects/co%2Ferp/repository/branches?per_page=100"]);
  assert.equal(V.choiceRequests("people", { ...g, project: "" }), null);
  assert.equal(V.choiceRequests("people", { platform: "github", via: "cli", project: "bad" }), null);
  assert.deepEqual(V.parseChoices("people", g, [{ username: "a", name: "A" }, { username: "a", name: "A" }, { username: "b", name: "b" }, { username: "x", state: "blocked" }]),
    [{ value: "a", label: "A" }, { value: "b", label: undefined }]);
  assert.deepEqual(V.parseChoices("places", g, [{ full_path: "co/erp", name: "ERP" }]), [{ value: "co/erp", label: "ERP" }]);
  assert.deepEqual(V.parseChoices("places", { platform: "linear" }, { data: { teams: { nodes: [{ key: "ENG", name: "Eng" }] } } }), [{ value: "ENG", label: "Eng" }]);
});

await check("choices: a group's unreadable member list falls back to people on its issues and MRs", async () => {
  const g = { ...conn, scope: "group", project: "co/erp" };
  const run = async r => {
    const path = pathOf(r);
    if (path.includes("/members/")) throw new Error("403 Forbidden");
    if (path.includes("/issues")) return JSON.stringify([{ assignees: [{ username: "b", name: "B" }], author: { username: "a", name: "A" } }]);
    return JSON.stringify([{ author: { username: "b", name: "B" }, reviewers: [{ username: "c", name: "C" }] }]);
  };
  assert.deepEqual((await V.loadChoices("people", g, run)).map(o => o.value), ["a", "b", "c"]);
  await assert.rejects(V.loadChoices("labels", g, async () => { throw new Error("boom"); }), /boom/);
});

await check("formatIssueRef and formatIssueChatDraft build single-line refs and chat snippets", () => {
  const t = { id: "1:31", key: "#31", title: "Auth roles", url: "https://git.example.com/erp/phan-quyen-xac-thuc/-/issues/31", raw: { references: { full: "erp/phan-quyen-xac-thuc#31" } } };
  assert.equal(W.formatIssueRef(t), "phan-quyen-xac-thuc#31");
  assert.equal(W.formatIssueChatDraft(t), "phan-quyen-xac-thuc#31: Auth roles\nhttps://git.example.com/erp/phan-quyen-xac-thuc/-/issues/31");
  assert.equal(W.formatIssueRef({ id: "9", key: "repo#9" }), "repo#9");
  assert.equal(W.formatIssueRef({ id: "9" }), "#9");
  assert.equal(W.formatIssueChatDraft(null), "");
});

console.log(`test-work-views: ${passed} checks passed`);
