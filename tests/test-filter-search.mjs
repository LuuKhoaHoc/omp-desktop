#!/usr/bin/env node
// Regression script for filter search behavior in Work and Insights panels.
// Imports real production modules and exercises filter state transformations.
// Run: node tests/test-filter-search.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Load production work-views.js
const win = {};
// eslint-disable-next-line no-new-func
new Function("window", readFileSync(join(root, "src/app/work-views.js"), "utf8"))(win);
new Function("window", readFileSync(join(root, "src/app/insights-filter.js"), "utf8"))(win);
const V = win.OMP_WORK_VIEWS;

let passed = 0;
function check(label, fn) {
  try { fn(); } catch (err) { console.error(`FAILED: ${label}`); throw err; }
  passed++;
}

// ── 1. Work Panel: Assignee / Author filter (production V.filterPeople) ────
const peopleItems = [
  { id: 1, assignees: ["alice", "bob"], author: "alice" },
  { id: 2, assignees: ["alice", "charlie"], author: "bob" },
  { id: 3, assignees: ["david"], author: "david" },
  { id: 4, assignees: [], author: "charlie" },
];

check("V.filterPeople: empty query keeps all people sorted by count", () => {
  const { filteredPeople, unassigned } = V.filterPeople(peopleItems, "issues", "");
  assert.equal(filteredPeople.length, 4);
  assert.equal(filteredPeople[0][0], "alice");
  assert.equal(filteredPeople[0][1], 2);
  assert.equal(unassigned, 1);
});

check("V.filterPeople: filters case-insensitively by query substring", () => {
  const { filteredPeople } = V.filterPeople(peopleItems, "issues", "Li");
  assert.deepEqual(filteredPeople.map(p => p[0]), ["alice", "charlie"]);
});

check("V.filterPeople: works for MR authors when kind is mrs", () => {
  const { filteredPeople } = V.filterPeople(peopleItems, "mrs", "bo");
  assert.deepEqual(filteredPeople.map(p => p[0]), ["bob"]);
});

check("V.filterPeople: returns empty array when query does not match", () => {
  const { filteredPeople } = V.filterPeople(peopleItems, "issues", "unknown");
  assert.equal(filteredPeople.length, 0);
});

// ── 2. Work Panel: Label filter (production V.filterLabels) ─────────────────
const labelItems = [
  { id: 1, labels: ["bug", "frontend", "STATUS - TODO"] },
  { id: 2, labels: ["backend", "database"] },
  { id: 3, labels: ["bug", "docs"] },
];

check("V.filterLabels: drops board column labels and tallies remaining", () => {
  const { filteredLabels } = V.filterLabels(labelItems, ["STATUS - TODO"], "");
  assert.ok(!filteredLabels.some(([name]) => name === "STATUS - TODO"));
  assert.equal(filteredLabels[0][0], "bug");
  assert.equal(filteredLabels[0][1], 2);
});

check("V.filterLabels: filters labels by substring match", () => {
  const { filteredLabels } = V.filterLabels(labelItems, ["STATUS - TODO"], "data");
  assert.deepEqual(filteredLabels.map(l => l[0]), ["database"]);
});

check("V.filterLabels: yields empty result on non-matching query", () => {
  const { filteredLabels } = V.filterLabels(labelItems, [], "xyz");
  assert.equal(filteredLabels.length, 0);
});

// ── 3. Work Panel: View menu search (production V.filterViews) ──────────────
const viewList = [
  { id: "v1", connId: "c1", name: "FE tickets", kind: "issues" },
  { id: "v2", connId: "c1", name: "Backend MRs", kind: "mrs" },
  { id: "v3", connId: "c1", name: "Deploy Pipelines", kind: "pipelines" },
  { id: "v4", connId: "c1", name: "Sprint 1 Issues", kind: "issues" },
  { id: "v5", connId: "c1", name: "Sprint 2 Issues", kind: "issues" },
  { id: "v6", connId: "c1", name: "QA Board", kind: "issues" },
];

check("V.filterViews: enables search only when views > 5", () => {
  assert.equal(V.filterViews(viewList, "").showSearch, true);
  assert.equal(V.filterViews(viewList.slice(0, 4), "").showSearch, false);
});

check("V.filterViews: matches query across name and kind", () => {
  const byName = V.filterViews(viewList, "sprint").filteredViews;
  assert.deepEqual(byName.map(v => v.id), ["v4", "v5"]);

  const byKind = V.filterViews(viewList, "pipelines").filteredViews;
  assert.deepEqual(byKind.map(v => v.id), ["v3"]);
});

// ── 4. Insights Panel: Document & Requirement content filter ───────────────
const sampleDoc = {
  title: "Auth Spec",
  sections: [
    { heading: "Token Lifecycle", points: ["Access token 15m", "Refresh token 30d"] },
    { heading: "Roles", points: ["Admin", "Auditor", "User"] }
  ],
  requirements: [
    { id: "AUTH-01", text: "Support PKCE exchange", priority: "critical" },
    { id: "AUTH-02", text: "TOTP 2FA authenticator", priority: "high" },
    { id: "AUDIT-01", text: "Store logs for 90 days", priority: "medium" }
  ]
};

const { filterDocContent: filterDoc, filterSources } = win.OMP_INSIGHTS_FILTER;

check("filterSources matches title and path and handles no matches", () => {
  const docs = [{ file: "auth.json", title: "Access" }, { file: "bill.json", title: "Billing" }, { file: "c.json", title: "C" }, { file: "d.json", title: "D" }];
  assert.deepEqual(filterSources(docs, d => d.title, "AUTH").visible.map(d => d.file), ["auth.json"]);
  assert.deepEqual(filterSources(docs, d => d.title, "bill").visible.map(d => d.file), ["bill.json"]);
  assert.deepEqual(filterSources(docs, d => d.title, "missing").visible, []);
});

check("filterDoc: matches section headings and points", () => {
  const byHeading = filterDoc(sampleDoc, "token");
  assert.equal(byHeading.sections.length, 1);
  assert.equal(byHeading.sections[0].heading, "Token Lifecycle");
  assert.equal(byHeading.noMatch, false);

  const byPoint = filterDoc(sampleDoc, "auditor");
  assert.equal(byPoint.sections.length, 1);
  assert.equal(byPoint.sections[0].heading, "Roles");
});

check("filterDoc: matches requirements by id, text, or priority", () => {
  assert.equal(filterDoc(sampleDoc, "AUTH-01").requirements.length, 1);
  assert.equal(filterDoc(sampleDoc, "pkce").requirements.length, 1);
  assert.equal(filterDoc(sampleDoc, "critical").requirements.length, 1);
  assert.equal(filterDoc(sampleDoc, "critical").requirements[0].id, "AUTH-01");
});

check("filterDoc: flags noMatch when both sections and requirements are empty", () => {
  const res = filterDoc(sampleDoc, "nonexistent");
  assert.equal(res.sections.length, 0);
  assert.equal(res.requirements.length, 0);
  assert.equal(res.noMatch, true);
});

console.log(`test-filter-search: ${passed} checks passed`);
