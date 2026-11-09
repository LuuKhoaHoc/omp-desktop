# Insights panel (fork)

The Insights panel (`Ctrl+Shift+Y`, flask icon in the toolbar) draws what an
agent writes into the open project's `.omp/insights/` folder. Rust reads only
the fixed names below (`insights_read`, `src-tauri/src/work.rs`), each file at
most 2 MB, at most 60 charts. The panel re-reads every 4 s, so files appear
while the agent works. Bad JSON shows as an error card instead of breaking the
panel.

```
.omp/insights/
  doc-analysis.json
  testcases.json
  charts/*.json        sorted by file name
```

## doc-analysis.json

```json
{
  "title": "Payroll spec v2",
  "source": "docs/payroll-spec-v2.pdf",
  "summary": "One paragraph.",
  "sections": [{ "heading": "Main flow", "points": ["...", "..."] }],
  "requirements": [{ "id": "REQ-01", "text": "...", "priority": "High" }]
}
```

## testcases.json

```json
{
  "cases": [
    {
      "id": "TC-01",
      "title": "Create a period from a locked timesheet",
      "requirement": "REQ-01",
      "priority": "High",
      "type": "functional",
      "preconditions": "Timesheet for October is locked",
      "steps": [
        { "action": "Open Payroll → Periods → Create", "expected": "The form opens" },
        "A plain string step works too"
      ],
      "expected": "Optional overall expectation",
      "status": "untested"
    }
  ]
}
```

`status` is one of `untested` (default), `pass`, `fail`, `blocked`.
`priority` colours `High`/`P0`/`P1`/`Critical` red and `Medium`/`P2` amber.

## charts/*.json

```json
{
  "type": "bar",
  "title": "Tickets per module",
  "unit": "tickets",
  "labels": ["hr", "sale", "finance"],
  "series": [{ "name": "open", "data": [12, 7, 3] }]
}
```

`type`: `bar` (grouped when there are several series), `stacked`, `line`
(the axis zooms to the data), `pie` (first series only). Charts are inline SVG
in the theme's colours; there is no chart library.

## Asking the agent

The empty state's "Draft the request" button puts a prompt in the composer.
Any prompt works as long as it names this folder and these formats, e.g.:

> Read the attached spec, then write `.omp/insights/doc-analysis.json`,
> `testcases.json` and `charts/*.json` in the formats of `docs/insights.md`.
