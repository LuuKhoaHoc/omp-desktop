#!/usr/bin/env node
// Regression tests for src/app/work-gantt.js.

import assert from "node:assert/strict";
import G from "../src/app/work-gantt.js";

let passed = 0;
function check(label, fn) {
  try { fn(); } catch (err) { console.error(`FAILED: ${label}`); throw err; }
  passed++;
}

const day = 24 * 60 * 60 * 1000;
const date = value => new Date(value);

check("parseDates uses created and due dates", () => {
  const result = G.parseDates({ raw: { created_at: "2026-01-01T00:00:00Z", due_date: "2026-01-10T00:00:00Z" } });
  assert.equal(result.start.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(result.end.toISOString(), "2026-01-10T00:00:00.000Z");
  assert.equal(result.hasDueDate, true);
});

check("parseDates without due date spans created through updated date", () => {
  const result = G.parseDates({ raw: { createdAt: "2026-02-01T00:00:00Z" }, updatedAt: "2026-02-08T00:00:00Z" });
  assert.equal(result.start.toISOString(), "2026-02-01T00:00:00.000Z");
  assert.equal(result.end.toISOString(), "2026-02-08T00:00:00.000Z");
  assert.equal(result.hasDueDate, false);
});

check("parseDates uses closed date when available", () => {
  const result = G.parseDates({ raw: { created_at: "2026-03-01T00:00:00Z", closed_at: "2026-03-12T00:00:00Z" }, updatedAt: "2026-03-14T00:00:00Z" });
  assert.equal(result.start.toISOString(), "2026-03-01T00:00:00.000Z");
  assert.equal(result.end.toISOString(), "2026-03-12T00:00:00.000Z");
});

check("parseDates expands too-short spans to three days", () => {
  const result = G.parseDates({ raw: { created_at: "2026-04-01T00:00:00Z", due_date: "2026-04-02T00:00:00Z" } });
  assert.equal(result.end.getTime() - result.start.getTime(), 3 * day);
});

check("parseDates backs start up a week when created is after due", () => {
  const result = G.parseDates({ raw: { created_at: "2026-05-10T00:00:00Z", due_date: "2026-05-01T00:00:00Z" } });
  assert.equal(result.start.toISOString(), "2026-04-24T00:00:00.000Z");
  assert.equal(result.end.toISOString(), "2026-05-01T00:00:00.000Z");
});

check("timeBounds includes tickets and applies day padding", () => {
  const tickets = [
    { raw: { created_at: "2026-06-01T00:00:00Z", due_date: "2026-06-10T00:00:00Z" } },
    { raw: { created_at: "2026-06-20T00:00:00Z", closed_at: "2026-06-25T00:00:00Z" } },
  ];
  const bounds = G.timeBounds(tickets, 2);
  assert.equal(bounds.minDate.toISOString(), "2026-05-30T00:00:00.000Z");
  assert.equal(bounds.maxDate.toISOString(), "2026-06-27T00:00:00.000Z");
});

check("generateTicks covers day, week, and month zooms", () => {
  const min = date("2026-01-05T12:00:00Z"), max = date("2026-03-03T00:00:00Z");
  const days = G.generateTicks(min, max, "day");
  const weeks = G.generateTicks(min, max, "week");
  const months = G.generateTicks(min, max, "month");
  assert.ok(days.length > weeks.length && weeks.length > months.length);
  assert.equal(days[0].date.getHours(), 0);
  assert.equal(weeks[0].date.getDay(), 1);
  assert.equal(months[0].date.getDate(), 1);
  assert.ok(days.every(t => t.date instanceof Date && typeof t.label === "string" && typeof t.isMajor === "boolean"));
});

check("primaryHeaders groups day zoom into clipped calendar months", () => {
  const min = date("2026-01-15T12:00:00Z"), max = date("2026-03-03T00:00:00Z");
  const headers = G.primaryHeaders(min, max, "day");
  assert.equal(headers.length, 3);
  assert.deepEqual(headers.map(header => header.label), ["January 2026", "February 2026", "March 2026"]);
  assert.deepEqual(headers.map(header => [header.start.toISOString(), header.end.toISOString()]), [
    [min.toISOString(), "2026-02-01T00:00:00.000Z"],
    ["2026-02-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z"],
    ["2026-03-01T00:00:00.000Z", max.toISOString()],
  ]);
  assert.ok(headers.every(header => header.date instanceof Date && header.start instanceof Date && header.end instanceof Date));
});

check("primaryHeaders groups month zoom into calendar years", () => {
  const headers = G.primaryHeaders(date("2025-10-01T00:00:00Z"), date("2027-02-01T00:00:00Z"), "month");
  assert.deepEqual(headers.map(header => header.label), ["2025", "2026", "2027"]);
});

check("ticketPosition maps ticket dates and clamps outside the range", () => {
  const min = date("2026-01-01T00:00:00Z"), max = date("2026-01-11T00:00:00Z");
  assert.deepEqual(G.ticketPosition({ start: date("2026-01-03T00:00:00Z"), end: date("2026-01-07T00:00:00Z") }, min, max, 100), { left: 20, width: 40 });
  assert.deepEqual(G.ticketPosition({ start: date("2025-12-31T00:00:00Z"), end: date("2026-01-02T00:00:00Z") }, min, max, 100), { left: 0, width: 10 });
  assert.deepEqual(G.ticketPosition({ start: date("2026-01-12T00:00:00Z"), end: date("2026-01-14T00:00:00Z") }, min, max, 100), { left: 100, width: 0 });
});

check("groupBy yields column buckets or one flat group", () => {
  const tickets = [{ id: 1, column: "Todo" }, { id: 2, column: "Doing" }, { id: 3, column: "Todo" }];
  assert.deepEqual(G.groupBy(tickets, "column"), [
    { key: "Todo", tickets: [tickets[0], tickets[2]] },
    { key: "Doing", tickets: [tickets[1]] },
  ]);
  assert.deepEqual(G.groupBy(tickets, "none"), [{ key: "", tickets }]);
});

check("groupBy orders known columns and appends unexpected columns", () => {
  const tickets = [
    { id: 1, column: "Doing" },
    { id: 2, column: "Unexpected" },
    { id: 3, column: "Todo" },
    { id: 4, column: "Open" },
    { id: 5, column: "Other" },
  ];
  assert.deepEqual(G.groupBy(tickets, "column", ["Open", "Todo", "Doing", "Review", "Closed"]).map(group => group.key), [
    "Open", "Todo", "Doing", "Unexpected", "Other",
  ]);
});

console.log(`test-work-gantt: ${passed} checks passed`);
