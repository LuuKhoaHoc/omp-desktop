# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Tauri 2 desktop shell; the UI is a web page in the system webview: WebKitGTK on Linux, WebView2 on Windows, WKWebView on macOS.)

## Users

Primary user: a developer who runs several `omp` coding agents in parallel, one tab per agent, for hours a day. They switch between tabs, read long transcripts (assistant prose, tool cards, diffs), answer approvals, and keep a terminal, git browser and browser panel beside the chat. Inferred from the session brief and not contested by the owner: the main machine is Linux (Omarchy, Hyprland, WebKitGTK).

## Product Purpose

A native desktop app for oh-my-pi (`omp`): every tab is its own `omp --mode rpc-ui` process, and the app shows what the agent is doing as it happens (streamed replies, tool calls, diffs, subagents, plans, cost). Success means coordinating several agents quickly and reading for long stretches without fatigue.

## Positioning

The desktop face of a terminal agent: one process per tab, the agent's tools, subagents, approvals, terminal, git and Chromium side by side, all local, nothing from a CDN.

## Operating Context

- Several tabs grouped by (profile, folder) in a tab bar and a project sidebar.
- Long reading sessions: assistant markdown, thinking, tool cards with streamed output and diffs.
- Side surfaces: right rail (context gauge, cost, throughput, agent radar, subagents, Changes, minimap, widgets), terminal panel, git browser, browser dock, Insights, Settings app tab.
- Keyboard first: a keymap registry with shortcuts for most actions.

## Capabilities and Constraints

- No bundler in dev: JSX is transpiled in-browser by Babel; release ships a precompiled `dist/`.
- Strict CSP: no inline scripts, no CDN, everything vendored; works offline.
- Themes live as CSS custom properties in `src/design/styles.css` (`aurora`, `phosphor`, `daylight`, `night`), selected by a tweak; accent can be overridden per user.
- CSS uses `color-mix(in oklab, …)` and container queries (WebView2 ≥ 105, WebKitGTK ≥ 2.40).
- Owner requirements for the 2026-11 redesign: a new theme becomes the default while the four existing themes stay selectable unchanged; the toolbar's tools are regrouped into positions that fit their use; every open/close and in/out interaction gets an enter and exit animation.

## Brand Commitments

- Name: OMP Desktop. No logo asset beyond the app icon.
- Owner direction for the new default theme: calm, a tool for long reading; few colours, one accent, hierarchy carried by type.

## Evidence on Hand

- `README.md` feature list and `screenshots/*.webp`.
- Real recorded `omp` sessions can be replayed through `scripts/omp-sim.mjs` for visual checks.
- No user metrics, testimonials or benchmarks exist; none may be invented.

## Product Principles

1. The transcript is the work surface; chrome defers to it.
2. State is legible at a glance: running, waiting on approval, failed, idle.
3. Keyboard and pointer reach every action; nothing is hover-only.
4. Motion explains change (what appeared, where it went), never decorates.
5. Nothing hidden by a redesign: restyle, regroup and animate, but keep every function.

## Accessibility & Inclusion

Text contrast at WCAG AA or better on every theme; visible focus rings; `prefers-reduced-motion` turns animations into instant state changes.
