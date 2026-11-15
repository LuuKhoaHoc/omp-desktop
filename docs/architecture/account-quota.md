# Account quota and task usage

The sidebar footer opens two separate dialogs: Usage retains historical statistics and `task-usage-section.jsx`; Accounts & quota (`account-quota-panel.jsx`) hosts only account quota, native pins and routing controls. Opening Usage does not fetch account quota. `use-account-quota.jsx` owns one `OMP_QUOTA_SERVICE` for the app lifetime. It observes all registered tabs through an independent, correlated RPC listener; it does not alter `live.js`'s transcript handler.

## Quota reads

The Rust `account_quota` command resolves a registered profile before running `omp usage --json --no-extensions` off the IPC thread. `child_run::collect` bounds output and execution time; spawning uses the trusted omp resolver, spawn gate and process supervisor. Only typed, allowlisted identity, window, amount, status and error fields reach the webview. Raw metadata and credentials are discarded. Missing quota remains unavailable. Fetch and reset timestamps are epoch milliseconds.

## Accounting

A task begins at an observed user message and ends at `session_settled`, not at an internal tool turn. Deltas require an authoritative idle baseline. Historic or interrupted tasks without that baseline are not reconstructed. Session totals are omp's native active-ledger statistics, not a lifetime billing ledger; compaction or reset can invalidate a delta. Reported model cost is not subscription spend. Shared-account quota changes are not attributed to a task.

## Account selection

Manual selection uses the current provider's native OAuth summaries and the exact `/session pin OAuth credential #<id>` selector. It requires an idle, settled active chat, rechecks identity and state, serializes controls, and accepts success only after native command output confirms the pin. A pin is a preference, not proof of the account serving every future request. Native hard-unavailability rotation can bypass it; explicit pins override ordinary quota ranking. No unpin RPC is assumed.

The optional profile policy writes `retry.usageAwareFallback` and a 10% `retry.usageReservePct`, then reads them back. Enabling is refused with native `retry.modelFallback` enabled; Desktop does not enable or rewrite fallback chains or reserve-policy arrays. Native omp owns account ranking and retry, including cache affinity. This is not a highest-balance scheduler.


Policy reads and writes use the selected tab's Rust-owned project folder, so project overrides are included. A project chat is required for routing controls. Both dialogs make the app root inert while open; closing restores the opener's focus.
Opening either dialog never mutates account affinity or retry configuration. No model generation is used for quota reads. Providers absent from omp's usage support remain unavailable; project extensions are not loaded merely to inspect quota.
