# Insights panel (fork)

The Insights panel (`Ctrl+Shift+Y`, flask icon in the toolbar) draws what an
agent writes into the open project's `.omp/insights/` folder. Rust reads only
the fixed names below (`insights_read`, `src-tauri/src/work.rs`), each file at
most 2 MB, at most 60 diagrams. The panel re-reads every 4 s, so files appear
while the agent works. Bad JSON shows as an error card instead of breaking the
panel.

```
.omp/insights/
  doc-analysis.json
  testcases.json
  diagrams/*           .mmd/.mermaid, .svg, .png, .html, .excalidraw; sorted by name
```

## diagrams/*

One diagram per file; the extension says how it is drawn:

| File | Written by (skill) | Shown as |
|---|---|---|
| `.mmd`, `.mermaid` | `mermaidjs-v11` | rendered by the vendored Mermaid, themed to the app |
| `.svg` | `diagram-design`, `tech-graph` | `<img>` (data URL): scripts and links inside never run |
| `.png` | `tech-graph`, any export | `<img>` |
| `.html` | `architecture-diagram`, `preview` | `<iframe sandbox="">` (no scripts, no forms, own origin), white page |
| `.excalidraw` | `excalidraw` | static SVG from the scene (`app/excalidraw-svg.js`): clean shapes, not the hand-drawn strokes; images are skipped |

Title: `%% title: …` (Mermaid) or `<title>` (SVG/HTML), else the file name.
A file over 2 MB or one that fails to parse shows its error (and its source).

```
%% title: Invoice request flow
flowchart LR
  A[Sale creates request] --> B{Accountant approves?}
  B -- yes --> C[Issue e-invoice]
  B -- no --> D[Back to Sale]
```

Each card has zoom (−/+, `Ctrl`+wheel, the label between them toggles Fit / 100%),
drag to pan, **Expand** (covers the window, `Esc` closes), **Source** and
**Copy** for text files, and **SVG** (copy the rendered Mermaid as SVG). Above
the cards, a filter appears once there are more than three, and **New diagram**
lists the skills above: picking one drafts a prompt into the composer naming
the skill and the file it should leave here. An HTML page drawn with
JavaScript (or a CDN script) shows blank: ask the skill for static output.

The Mermaid renderer is the vendored `src/mermaid.min.js` (`mermaid@12.3.0`,
verbatim `dist/mermaid.min.js` from npm, SHA-256
`336df803d87a38b70a01e736e666c8f7601d2ce42f5e47c8fafe5d721074b9a3`), loaded
only when the panel first draws a Mermaid diagram, at Mermaid's `strict`
security level (labels sanitised, no click callbacks or scripts).

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

## Asking the agent

The empty state's "Draft the request" button puts a prompt in the composer.
Any prompt works as long as it names this folder and these formats, e.g.:

> Read the attached spec, then draw its flows into `.omp/insights/diagrams/`
> and write `doc-analysis.json` and `testcases.json` in the formats of
> `docs/insights.md`.

For one diagram with a particular skill, use **New diagram** instead.
