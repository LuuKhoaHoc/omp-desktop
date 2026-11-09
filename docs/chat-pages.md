# Interactive pages in the chat (fork)

An assistant's ```` ```html ```` or ```` ```svg ```` code block can run as a
live page right in the reply, the way OpenChamber, ChatGPT (MCP Apps) and
Claude show charts, mockups and forms in the chat.

- ```` ```html ```` / ```` ```svg ````: shown as code with a **Run** button.
- ```` ```html page ```` (or `live`): runs as soon as the block has finished
  streaming. Use this when the agent means the page to be used, not read.

The card has **Reload**, **Expand** (covers the window, `Esc` closes) and
**Code** (back to the source). The page gets the app's colours as CSS
variables (`--omp-bg`, `--omp-surface`, `--omp-fg`, `--omp-fg-2`,
`--omp-muted`, `--omp-accent`, `--omp-line`, `--omp-font`, `--omp-mono`) and
quiet defaults for buttons, inputs and tables that its own CSS overrides.
Its height follows its content (up to 70% of the window).

The agent learns about this without a skill call: every omp the desktop
starts gets a short note appended to its system prompt
(`--append-system-prompt`, `agent/spawn.rs` `DESKTOP_PROMPT_ARG`); the
`omp-desktop-chat-pages` skill holds the longer guide.

## Answering the agent

A page sends an answer by any of:

- a `<form>` submit: the fields become a JSON object (`name → value`, a
  repeated name becomes a list);
- a click on an element with `data-omp-send="text"`;
- `omp.submit(anyJson)` or `omp.send("text")` from its script.

The card then shows what the page wants to send, with **Send**, **Put in
composer** and **Dismiss**. Nothing reaches the agent without that click.
Mid-turn, Send queues it as a follow-up. A structured answer arrives as

    My answer in the page "<title>":
    ```json
    { "plan": "pro", "note": "…" }
    ```

Example the agent can write:

    ```html page
    <title>Pick a plan</title>
    <form>
      <label><input type="radio" name="plan" value="basic" checked> Basic</label>
      <label><input type="radio" name="plan" value="pro"> Pro</label>
      <button type="submit">Choose</button>
    </form>
    ```

## Isolation

The page never runs in the app's origin, which holds the IPC:

- The card wraps the source (`app/chat-pages.js` `wrapPage`), hands it to
  Rust (`page_register`, `src-tauri/src/chat_pages.rs`) and gets a random
  128-bit id; the iframe loads `omp-page://localhost/<id>`
  (`http://omp-page.localhost/<id>` on Windows), served with its own CSP:
  inline script and style, `data:`/`blob:` images and fonts, and nothing
  else (`connect-src 'none'`, `form-action 'none'`, `frame-src 'none'`).
- `<iframe sandbox="allow-scripts allow-forms">`: no `allow-same-origin`
  (opaque origin, no storage, no access to the parent document), no popups,
  no top navigation.
- Tauri injects its IPC script into the main frame only, so the page has no
  `__TAURI_INTERNALS__` and no invoke key; its CSP blocks `ipc:` anyway.
- The only channel back is `postMessage`; the card accepts messages only
  from its own iframe's window and only the shapes `readMessage` allows
  (a height, an answer of at most 20 000 characters).
- `navigation_guard` lets `omp-page:` load (it cannot tell an iframe from the
  top level); an unknown id is a 404, and links in chat never point there.
- The app CSP's `frame-src` allows only that scheme.

Checked in a harness with the page CSP and the sandbox: `__TAURI__`,
`__TAURI_INTERNALS__` and `ipc` undefined, parent document, storage, top
navigation and `fetch` all blocked.

Limits: pages are kept in memory for the run (32 MB, oldest dropped), so a
page from before an app restart re-registers when the card runs again; no
network, so CDN libraries do not load (inline them); `<svg>` with scripts runs
like HTML (same sandbox).
