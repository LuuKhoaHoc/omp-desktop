---
title: 'feat: Account quota and task usage'
type: feat
status: active
date: 2026-11-14
---

# feat: Account quota and task usage

## Summary

Add per-account quota to Desktop's existing Usage surface, show consumption for a user request and its session, and provide manual account selection plus opt-in quota-aware selection. No credentials enter the webview. The user approved native omp routing with a 10% reserve, retaining cache affinity and without enabling model/provider fallback. Highest-quota Desktop routing is not selected and will not be implemented.

## Requirements

- R1. List accounts in each registered Desktop profile, grouped by provider. Show every reported quota window, remaining amount or fraction, reset time, fetch time, and provider error. Keep accounts without usage and disabled credentials visible. Never treat missing usage as zero or unlimited.
- R2. Manual selection applies to the current tab's provider and uses omp's native session account pin, not logout, credential edits, or a profile switch. Confirm the native outcome before marking a selection successful. Refuse unavailable accounts and changes while requests, queues, voice, or background work can still use the session.
- R3. A task means one user-submitted request through settled completion, not one internal model/tool turn. Show reported input/output/cache tokens and cost for that request and the cumulative session. Label cost as provider/model-reported accounting, not a subscription charge. Never estimate a subscription percentage from token counts.
- R4. Optionally record a before/after quota observation for the same account, window, and reset epoch. Mark it as observed account consumption, which can include other clients. Do not attribute the entire difference to this task, combine windows, or show a negative spend across resets.
- R5. Automatic account routing is opt-in and restricted to the current provider and accounts visible to the current profile. The approval chooses native cache-aware routing or highest comparable quota at a safe task boundary. Do not silently change provider/model or consume saved resets.
- R6. Errors, unsupported providers, stale quota, ambiguous account identity, reset boundaries, and disabled credentials have explicit states. Refresh is bounded, coalesced, and visibility-aware. No billed generation is used to discover quota.

## Scope Boundaries

- Desktop integration only; no modification of the installed omp executable or upstream repository.
- No new credential store, auth export/import, billing dashboards, login scraping, account reset redemption, or automatic provider/model changes.
- Existing profile isolation and startup behavior remain unchanged. The UI can browse another registered profile but cannot pin its credential into the current tab.
- Existing unrelated changes in the shared checkout remain untouched. No commit, push, build installation, or live account-policy mutation during discovery.
- Provider quota is only available where omp or a trusted installed provider extension supplies it. Unsupported accounts remain listed without invented balances.

## Context & Research

### Relevant Code and Patterns

- `src-tauri/src/stats.rs`: existing profile-scoped usage dashboard through `omp stats --json`.
- `src-tauri/src/omp_cli.rs`: existing one-shot command runner; new quota runs need the bounded `child_run` process path rather than copying its unbounded output behavior.
- `src-tauri/src/profiles.rs` and `lib.rs`: resolve owned profile IDs before any CLI spawn and run blocking work outside IPC's main thread.
- `src/live.js`: native RPC transport, per-tab snapshots, request handling, command output, queue state, and settled lifecycle. `get_session_stats` is currently requested but its response is ignored.
- `src/design/usage-stats-panel.jsx`: existing Usage dialog. Preserve its historical usage view; introduce quota and current-task sections as separate components.
- `src/app/slash-commands.js`: builtin commands must use RPC `prompt`, not `steer` or `follow_up`.
- `docs/architecture/session-model.md`, `turn-status.md`, `i18n.md`, `frontend-load-order.md`: profile ownership, settled state, translations, and script dependencies. Read the remaining matching documents before implementation.

### Verified Runtime Contracts

Installed omp is 18.20.0. On 2026-11-14 both commands exited successfully:

- `omp usage --json --no-extensions`: `generatedAt`, `reports`, `accountsWithoutUsage`, `disabledCredentials`, `capacity`. Each report carries provider, fetch time, metadata, and individual limits with scope/window/amount/status. The probe found 3 reports, 1 unreported account and 1 disabled credential; these counts are evidence from this machine, not product defaults.
- `omp usage accounts --json --no-extensions`: OAuth identity keys without tokens. Identity keys can be null. This output alone does not provide a credential ID for pinning.

Tagged upstream v18.20.0 source confirms:

- `rpc-types.ts` provides `get_session_stats`, `get_logout_accounts`, `prompt`, and `get_state`, but no structured account-pin RPC command.
- `slash-commands/builtin-session.ts` implements `/session pin <selector>` in text-mode builtins, refuses streaming, and calls `pinCurrentProviderOAuthAccount`.
- `helpers/session-pin.ts` supports the exact label `OAuth credential #<id>`; use that stable identity instead of list position or an ambiguous email. Resolve IDs through omp's account summaries and validate provider/profile ownership before use.
- `rpc-mode.ts` executes builtins through `prompt` and emits `command_output`. A successful prompt acknowledgement alone does not prove a pin succeeded.
- `session/settings.ts` defines `retry.usageAwareFallback`, `retry.usageReservePct`, and `retry.usageReservePolicy`. Native routing may fall back to configured models; a Desktop control must not silently enable that broader behavior.
- `ai/src/auth/types.ts` documents explicit pins as sticky despite reserve/ranking; hard unavailability may route around them. It exposes SDK release but not an RPC unpin command. Do not label a Desktop toggle as restoring native routing unless release is actually verified.
- `SessionStats` includes input/output/reasoning/cache tokens, premium requests, and cost. Determine parent/subagent/helper accounting from the native ledger before defining the task aggregate; avoid double counting.

Sources: https://github.com/can1357/oh-my-pi/tree/v18.20.0 and Context7 `/can1357/oh-my-pi`.

### Minimum Version Compatibility

The tagged v18.13.2 source already contains the usage JSON fields listed above, `usage accounts`, `/session pin`, the stable `OAuth credential #<id>` selector, `get_logout_accounts`, and all three native usage-aware retry settings. These contracts do not require raising the existing 18.13.2 floor. This checks availability at the supported floor, not the first release of each command. Recheck any additional field or command introduced during implementation; raise `MIN_OMP_VERSION` and add a changelog entry if that contract requires a later release.

### Institutional Learnings

- Profile IDs must resolve through the owned profile store; unknown `--profile` values create directories.
- A background tab's replay differs from the active tab's live events. Persist accounting identity and task boundaries per tab, and reconcile from authoritative entries/stats after restore or dropped replay.
- Never add a timestamp to desktop-created transcript entries.
- Shared memory search was attempted but returned HTTP 530. CodeGraph reported this checkout unindexed. Source inspection was used; JavaScript/Rust LSP servers are not configured here.

## Key Technical Decisions

- Keep credentials in omp. Rust forwards only typed account/quota summaries with allowlisted fields; strip raw provider responses and secret-bearing metadata before IPC.
- Reuse Usage as the entry point. Use compact rows because comparing accounts and quota windows is the main action, not decorative cards. Reuse Desktop theme, typography and focus states. Design dials: energy 1, rhythm 1, motion 1.
- Resolve account identity with provider plus organization/workspace plus user/account identity. Same email across organizations must not merge quota or select another seat.
- Compare quota only for the selected model's applicable meter/window. Rank by limiting remaining headroom among comparable windows, never across incompatible premium-request, currency, credit, or token meters. Unknown compatibility is ineligible for automatic selection.
- Preserve reported quota values and timestamps. Polling does not create an exact task-specific quota bill.
- Serialize account-control commands and verify native output. Do not silently interpret a transport acknowledgement as success. The final implementation must prove that selectors cannot be interpreted as ordinary model prompts.
- Strict highest-quota mode, if approved, selects before a new settled task and pins its account for that task. It does not rebalance an in-flight request, interrupt child agents, or promise recovery from every mid-task hard limit. Turning it off stops future Desktop selections; it does not claim to clear the last native explicit pin.
- Native cache-aware mode is the recommended threshold policy: expose `retry.usageAwareFallback`, `retry.usageReservePct`, and `retry.usageReservePolicy`, then leave credential selection, rotation and retry to omp. It prefers eligible same-provider accounts before configured model fallbacks; it does not promise to select the numerically fullest account. Display existing fallback scope and require an explicit user decision before enabling broader model/provider changes. Configuration writes require explicit UI action, profile scoping and readback; do not overwrite existing policy arrays or fallback chains. Manual pinning is a separate idle-only operation, and the UI must disclose that explicit pins override normal reserve/ranking.

## Implementation Units

### U1. Typed quota backend

**Goal:** Fetch and normalize safe quota/account summaries for owned profiles.

**Requirements:** R1, R6.

**Dependencies:** Approved scope.

**Files:** New `src-tauri/src/account_quota.rs` (split by concern if needed); modify `src-tauri/src/lib.rs`; reuse `profiles`, `agent::spawn`, `child_run`, and `spawn_gate`.

**Approach:** Run the installed omp usage command off-thread, with a deadline and output caps. Determine trusted extension-provider behavior without running project-owned extensions just to open a dashboard. Preserve report errors and unknown quota. Coalesce concurrent refreshes and return typed, allowlisted payloads. Resolve owned profiles before spawning.

**Verification:** Rust unit tests for normalization, malformed output, missing/unknown amounts, disabled accounts, multi-org identities, argument ordering, and bounded child failures. One real quota command readback without secret output.

### U2. Session accounting and account controls

**Goal:** Track task/session consumption and execute safe manual pins.

**Requirements:** R2, R3, R4, R6.

**Dependencies:** U1.

**Files:** New `src/app/account-quota.js` and `src/app/task-usage.js`; modify `src/live.js`, `src-tauri/src/agent/mod.rs` only if an additional native command is needed; new focused JS regression files.

**Approach:** Retain authoritative session stats and task boundaries per tab. Capture cost/token baselines at a submitted user request and finalize on settled completion, not every tool turn. Reconcile resume/replay without inventing historic tasks. Resolve current-provider account summaries, map quota identity conservatively, serialize pin commands and read native command output. Validate exact stable selectors and refuse busy/stale tab state. Quota differences require matching account/window/reset and carry the shared-account warning.

**Verification:** Deterministic regression cases for multi-turn tasks, failed/aborted requests, tab switches, dropped/replayed frames, duplicate stats, reset transitions, ambiguous identity, pin refusal, successful pin acknowledgement, and no accidental model invocation. Verify native stats parent/child ledger behavior before claiming totals include child work.

### U3. Approved automatic policy

**Goal:** Add the selected quota-aware routing policy without changing unrelated account/model behavior.

**Requirements:** R5, R6.

**Dependencies:** U1, U2, policy approval.

**Files:** `src/app/account-quota.js`, `src/live.js`, plus a focused Rust policy configuration module only if native configuration is chosen.

**Approach:** For highest-quota mode, refresh before the next eligible task, choose a compatible fresh account, verify the pin, then submit once. Keep the current account on stale/unknown data and show why. Cancel stale decisions after a tab/profile/model change. Manual selection disables Desktop automatic selection for that tab. For native mode, expose omp's existing safe account routing and reserve policy with exact scope; do not enable cross-provider fallback as a side effect.

**Verification:** Cases for threshold behavior, unknown quota, incompatible meters, exhausted accounts, same-account selection, in-flight task/child/voice guards, refresh errors, tab/profile/model races, and single task submission. Verify on a disposable test session before changing any live account affinity.

### U4. Quota and task Usage UI

**Goal:** Show the comparison and switching controls in the existing Desktop surface.

**Requirements:** R1 through R6.

**Dependencies:** U1 through U3.

**Files:** New focused components under `src/design/` for account quota and task usage; modify `src/design/usage-stats-panel.jsx`, `src/app-live.jsx`, `src/index.html`, matching layout CSS, `src/app/i18n-zh.js`; register regression scripts in `package.json`.

**Approach:** Retain historical usage, add account/profile selection, quota rows, reset labels, refresh/error states, task/session accounting, and the approved switching controls. Show the current account only when native evidence identifies it; distinguish preferred pin from actual request account. Do not move the composer draft, change the model, or mutate another tab.

**Verification:** Open the actual UI in the visible browser panel. Check account rows, empty/unsupported/error/loading/stale states, refresh, profile selection, keyboard controls, narrow width, and both themes. Use clearly identified fixtures only for unreachable error states; do not present them as live quota proof.

### U5. Documentation and final verification

**Goal:** Leave usage semantics and routing limits documented.

**Requirements:** All.

**Dependencies:** U1 through U4.

**Files:** New `docs/architecture/account-quota.md`; update `AGENTS.md` feature map if appropriate, `CHANGELOG.md` Unreleased, and affected architecture docs.

**Verification:** Run the focused JS checks plus i18n/load-order/build checks. For Rust changes run formatting on touched files, `cargo test --locked`, and the repository's pedantic/nursery nightly clippy gate. Run the actual UI scenario once after integration. Report only observed results and any provider limitations. No commit/push/install without instruction.

## System-Wide Impact

- IPC adds safe quota reads; no API exposes credentials or arbitrary CLI arguments.
- Session command handling adds serialized account control and accounting snapshots while preserving prompt/queue semantics.
- Existing historical statistics remain profile-scoped and keep their current documented time range until independently verified otherwise.
- Browser/terminal lifecycle, approval mode, model roles and other checkout changes remain unchanged.

## Risks & Dependencies

| Risk | Mitigation |
| :--- | :--- |
| Native explicit pins resist reserve-based ranking | Show pin semantics; do not claim automatic unpin support. Choose the policy before implementation. |
| Provider quota does not identify the current model's meter | Display it, but exclude it from automatic selection until native model applicability is established. |
| Concurrent account use distorts before/after quota | Label observations and keep reported task token/cost accounting separate. |
| Native account-pin control returns prose | Serialize controls, match exact expected outcomes, reject ambiguous results, and prove the command path never falls through to generation. |
| Cached reports or resets make quota stale | Show timestamps and reset epochs; exclude stale or incomparable reports from routing. |
| Native auto routing can change models through fallback policy | Do not silently enable model/provider fallback; preserve existing configuration and expose scope. |
| Shared checkout has active unrelated edits | Read current targets and their diffs immediately before surgical edits; stop on unexpected concurrent changes. |

## Verification record

- Focused quota normalization, task usage, RPC and i18n regressions passed.
- Frontend release compilation and `cargo check --locked` passed after integration.
- Five Rust quota tests passed. Installed stable clippy passed with pedantic and nursery warnings denied; nightly could not run because this machine has no rustup dispatcher.
- Visible browser preview verified Usage rendering, disconnected error, modal root isolation and cleanup on close.
- Still active: real Tauri IPC quota rendering and disposable-session pin/policy verification have not been exercised. Do not treat browser preview as proof of these native paths. No live account pin or retry configuration was changed.
- Final full Rust suite: 1208 passed, 1 ignored. Native UI/account-control checks above remain unverified.
- Native follow-up: the current Wayland computer backend reports capture/input unavailable, zero displays, and only an unreadable OMP Desktop accessibility root. Native UI verification is blocked in this environment; no app restart, installation or live account mutation was attempted.
- User-requested separation: Accounts & quota now opens from its own sidebar button. Usage retains historical and task statistics, without quota controls. Final `npm test` passed after adding the separation regression: quota pretests, the full registered suite, and release frontend compilation. Visible compiled preview confirmed each dialog's content, one dialog at a time, inert-root cleanup and focus return. Native IPC/pin verification remains blocked as noted above.
- Added `tests/test-quota-surfaces.mjs` to assert Usage keeps task stats without account controls and the sidebar's Accounts & quota action mounts its dedicated panel.
