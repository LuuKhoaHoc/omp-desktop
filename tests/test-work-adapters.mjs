#!/usr/bin/env node
// Regression script for src/app/work-adapters.js (fork) — the Work panel's
// platform adapters: request shapes per transport, parsing into one Ticket
// shape, board columns, label moves, and the stale-edit guard.
// Run: node tests/test-work-adapters.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const win = {};
// eslint-disable-next-line no-new-func
new Function("window", readFileSync(join(root, "src/app/work-adapters.js"), "utf8"))(win);
const W = win.OMP_WORK;

let passed = 0;
async function check(label, fn) {
  try { await fn(); } catch (err) { console.error(`FAILED: ${label}`); throw err; }
  passed++;
}

const gl = { id: "a", name: "work", platform: "gitlab", via: "cli", host: "git.example.com", project: "grp/app", columns: "STATUS::TODO, STATUS::DOING" };
const glIssue = { iid: 7, title: "Fix", description: "body", state: "opened", labels: ["bug", "STATUS::DOING"], assignees: [{ username: "ni" }], web_url: "u", updated_at: "t1" };

await check("gitlab cli: list request uses glab api with --hostname and an encoded project", () => {
  const [req] = W.PLATFORMS.gitlab.list(gl);
  assert.equal(req.kind, "cli");
  assert.equal(req.tool, "glab");
  assert.deepEqual(req.args.slice(0, 3), ["api", "--hostname", "git.example.com"]);
  assert.ok(req.args[3].startsWith("projects/grp%2Fapp/issues?"));
});

await check("gitlab token: https base, PRIVATE-TOKEN auth, env name only", () => {
  const req = W.PLATFORMS.gitlab.get({ ...gl, via: "token", tokenEnv: "GL_TOKEN" }, "7");
  assert.equal(req.url, "https://git.example.com/api/v4/projects/grp%2Fapp/issues/7");
  assert.equal(req.auth, "private-token");
  assert.equal(req.tokenEnv, "GL_TOKEN");
});

await check("gitlab parse: one Ticket shape, column from labels", () => {
  const t = W.PLATFORMS.gitlab.parse(gl, glIssue);
  assert.equal(t.key, "#7");
  assert.equal(t.state, "open");
  assert.equal(t.column, "STATUS::DOING");
  assert.deepEqual(t.assignees, ["ni"]);
  assert.equal(W.PLATFORMS.gitlab.parse(gl, { ...glIssue, state: "closed" }).column, "Closed");
  assert.equal(W.PLATFORMS.gitlab.parse(gl, { ...glIssue, labels: ["bug"] }).column, "Open");
});

await check("board columns: Open, configured labels, Closed", () => {
  assert.deepEqual(W.boardColumns(gl), ["Open", "STATUS::TODO", "STATUS::DOING", "Closed"]);
  assert.deepEqual(W.boardColumns({ ...gl, columns: "" }), ["Open", "Closed"]);
});

await check("move: swaps column labels, keeps others; Closed closes", () => {
  const t = W.PLATFORMS.gitlab.parse(gl, glIssue);
  assert.deepEqual(W.moveEdit(gl, t, "STATUS::TODO"), { state: "open", labels: ["bug", "STATUS::TODO"] });
  assert.deepEqual(W.moveEdit(gl, t, "Open"), { state: "open", labels: ["bug"] });
  assert.deepEqual(W.moveEdit(gl, t, "Closed"), { state: "closed" });
  const req = W.PLATFORMS.gitlab.move(gl, t, "STATUS::TODO");
  assert.ok(req.args.includes("-X") && req.args.includes("PUT"));
  assert.ok(req.args.includes("labels=bug,STATUS::TODO"));
});

await check("gitlab group scope: lists the group, edits by project_id:iid, key names the repo", () => {
  const g = { ...gl, scope: "group", project: "co/erp", who: "mine" };
  const [req] = W.PLATFORMS.gitlab.list(g);
  assert.ok(req.args[3].startsWith("groups/co%2Ferp/issues?"));
  assert.ok(req.args[3].includes("&scope=assigned_to_me"));
  const t = W.PLATFORMS.gitlab.parse(g, { ...glIssue, project_id: 87, iid: 36, references: { full: "co/erp/kho#36" } });
  assert.equal(t.id, "87:36");
  assert.equal(t.key, "kho#36");
  assert.equal(W.PLATFORMS.gitlab.get(g, t.id).args[3], "projects/87/issues/36");
  assert.equal(W.PLATFORMS.gitlab.comment(g, t, "hi").args.find(a => a.startsWith("projects/")), "projects/87/issues/36/notes");
  assert.ok(W.PLATFORMS.gitlab.move(g, t, "STATUS::TODO").args.includes("projects/87/issues/36"));
  assert.ok(!W.PLATFORMS.gitlab.list(gl)[0].args[3].includes("scope="));
});

await check("github cli: labels go as labels[] fields; PRs filtered from the list", async () => {
  const gh = { name: "gh", platform: "github", via: "cli", project: "me/repo" };
  const t = W.PLATFORMS.github.parse(gh, { number: 3, title: "x", body: "", state: "open", labels: [{ name: "a" }], assignees: [], html_url: "h", updated_at: "t" });
  const req = W.PLATFORMS.github.save(gh, t, { labels: ["a", "b"] });
  assert.equal(req.tool, "gh");
  assert.deepEqual(req.args.filter((a, i) => req.args[i - 1] === "-f"), ["labels[]=a", "labels[]=b"]);
  const c = W.client(gh, async () => JSON.stringify([{ number: 1, title: "i", state: "open", labels: [] }, { number: 2, title: "pr", state: "open", labels: [], pull_request: {} }]));
  const list = await c.list();
  assert.deepEqual(list.map(x => x.key), ["#1"]);
});

await check("linear: GraphQL list fills workflow-state columns in order; move uses the state id", async () => {
  const ln = { name: "l", platform: "linear", via: "token", team: "ENG", tokenEnv: "LINEAR_API_KEY" };
  const calls = [];
  const c = W.client(ln, async req => {
    calls.push(req);
    return JSON.stringify({ data: {
      issues: { nodes: [{ id: "u1", identifier: "ENG-1", title: "t", description: "d", url: "x", updatedAt: "t", state: { id: "s1", name: "Todo", type: "unstarted" }, labels: { nodes: [] }, assignee: null }] },
      workflowStates: { nodes: [{ id: "s2", name: "Done", type: "completed", position: 3 }, { id: "s1", name: "Todo", type: "unstarted", position: 1 }] },
    } });
  });
  const list = await c.list();
  assert.equal(list[0].key, "ENG-1");
  assert.equal(list[0].column, "Todo");
  assert.deepEqual(c.columns(), ["Todo", "Done"]);
  assert.equal(calls[0].url, "https://api.linear.app/graphql");
  const req = W.PLATFORMS.linear.move(ln, list[0], "Done", c.ctx);
  assert.equal(JSON.parse(req.body).variables.input.stateId, "s2");
});

await check("graphql errors surface as an Error", async () => {
  const c = W.client({ platform: "linear", team: "X", tokenEnv: "K" }, async () => JSON.stringify({ errors: [{ message: "bad team" }] }));
  await assert.rejects(c.list(), /bad team/);
});

await check("save refuses a ticket changed on the server since it was opened", async () => {
  const fresh = { ...glIssue, updated_at: "t2" };
  const c = W.client(gl, async () => JSON.stringify(fresh));
  const t = W.PLATFORMS.gitlab.parse(gl, glIssue);
  await assert.rejects(c.save(t, { title: "New" }), err => err.conflict?.updatedAt === "t2");
});

await check("save with no change sends nothing", async () => {
  let n = 0;
  const c = W.client(gl, async () => { n++; return JSON.stringify(glIssue); });
  const t = W.PLATFORMS.gitlab.parse(gl, glIssue);
  await c.save(t, { title: "Fix", body: "body" });
  assert.equal(n, 1, "only the freshness check ran");
});

await check("validate explains what is missing", () => {
  assert.deepEqual(W.validate(gl), []);
  assert.ok(W.validate({ ...gl, via: "token", tokenEnv: "lower" }).some(m => /Token variable/.test(m)));
  assert.ok(W.validate({ ...gl, via: "mcp" }).some(m => /MCP/.test(m)));
  assert.deepEqual(W.validate({ platform: "github", name: "g", via: "cli" }), []);
  assert.ok(W.validate({ ...gl, host: "https://x" }).some(m => /bare name/.test(m)));
  assert.deepEqual(W.validate({ platform: "linear", name: "l", via: "token", tokenEnv: "K" }), []); // team key: the view's
});

await check("transports: MCP listed but disabled; Linear has no CLI", () => {
  assert.ok(W.transports("gitlab").find(t => t.id === "mcp").disabled);
  assert.deepEqual(W.transports("linear").map(t => t.id), ["token", "mcp"]);
});

await check("gitlab notes: discussions request, system notes dropped, diff file:line, resolved state", async () => {
  const seen = [];
  const run = async req => { seen.push(req); return JSON.stringify([
    { id: "d2", notes: [{ id: 3, body: "late", author: { username: "b" }, created_at: "2026-02", updated_at: "2026-02", system: false }] },
    { id: "d1", notes: [
      { id: 1, body: "nit", author: { username: "a", name: "A" }, created_at: "2026-01", updated_at: "2026-01b", resolvable: true, resolved: true,
        position: { new_path: "src/x.js", new_line: 12 } },
      { id: 2, body: "done", author: { username: "c" }, created_at: "2026-01c", updated_at: "2026-01c", resolvable: true, resolved: true }] },
    { id: "d3", notes: [{ id: 4, body: "added ~bug label", system: true, created_at: "2026-03" }] },
    { id: "d4", notes: [{ id: 5, body: "?", author: { username: "a" }, created_at: "2026-04", resolvable: true, resolved: false }] },
  ]); };
  const c = W.client(gl, run);
  assert.equal(c.hasNotes, true);
  const th = await c.notes({ id: "7" });
  assert.deepEqual(seen[0].args, ["api", "--hostname", "git.example.com", "projects/grp%2Fapp/issues/7/discussions?per_page=100"]);
  assert.deepEqual(th.map(t => t.id), ["d1", "d2", "d4"]);
  assert.equal(th[0].file, "src/x.js:12");
  assert.deepEqual([th[0].resolvable, th[0].resolved, th[0].notes[0].edited, th[0].notes.length], [true, true, true, 2]);
  assert.deepEqual([th[1].resolvable, th[1].file], [false, null]);
  assert.deepEqual([th[2].resolvable, th[2].resolved], [true, false]);
  assert.deepEqual(W.parseDiscussions(null), []);
  assert.equal(W.client({ ...gl, platform: "linear" }, run).hasNotes, false);
});

console.log(`test-work-adapters: ${passed} checks passed`);
