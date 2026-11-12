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
defaults that make a plain form presentable without any CSS of its own
(`app/chat-pages.js` `DEFAULTS`): a `<form>` stacks its children, a
`<fieldset>` is a translucent card with its `<legend>` as the title, a
`<label>` holding a radio or checkbox is one option per row (tinted when
checked), a `<label>` holding a text field, `<textarea>` or `<select>` puts
its text above the field, and a submit button takes the accent. The class
`glass` gives any element the fieldset's card look. Every default has zero
specificity (`:where()`), so any rule of the page wins.
Its height follows its content (up to 70% of the window).

The agent learns about this without a skill call: every omp the desktop
starts gets a short note appended to its system prompt
(`--append-system-prompt`, `agent/spawn.rs` `DESKTOP_PROMPT_ARG`); the
`omp-desktop-chat-pages` skill holds the longer guide.

## Answering the agent

**A form: one click.** When the page holds exactly one `<form>` with at most
one submit button, the card shows its own **Send** button under the page;
the page's submit button, if it has one, is hidden and gives the card's
button its text. A click asks the page for that form's fields (the page
points at an empty required field instead and declines) and sends them at
once, as readable lines:

    My answer in the page "<title>":
    - 1. Which plan: Pro, billed yearly
    - Note: call me first

One line per filled field. The question is the field's `<legend>` (radio,
checkbox), its `<label>` text (text field, `<select>`), else its
placeholder or `name`; the answer is the ticked option's label (several
checkboxes of one group joined with `; `), the selected option's text, or
the typed value. A hidden input is `name: value`; passwords and files are
left out. So the message still makes sense once the page's source is no
longer in the agent's context. Radio groups and multi-option checkbox groups
(two or more checkboxes sharing a `name` or `<fieldset>`) automatically get an
**Other** row with a text input unless the group already defines one or sets
`data-omp-no-other`; selecting it requires non-blank text and sends the typed
text as that field's answer.

**Anything the page sends itself: confirmed first.** A submit event (the
page's own button when it has several, Enter in a field), a click on an
element with `data-omp-send="text"`, `omp.submit(anyJson)` or
`omp.send("text")`. A script can produce every one of these without the
user, so the card shows what would be sent, with **Send**, **Put in
composer** and **Dismiss**. `omp.submit` data arrives as a JSON block under
the same first line; a form submit as the lines above.

Nothing reaches the agent without a click on one of the card's own buttons.
Mid-turn, Send queues the answer as a follow-up.

What the one click does and does not promise: the click is the user's, the
text is the page's. The id in `collect` only ties an answer to that click;
it authenticates nothing, since the page's script receives it and can
answer with any text it likes (as it could by changing the form itself).
So the card's Send trusts the page for what it says the user picked, and
the sent message shows in the transcript right after. The confirmation
strip is the only path that shows the exact text before it goes out.

Example the agent can write (no submit button needed):

    ```html page
    <title>Pick a plan</title>
    <form>
      <fieldset>
        <legend>Which plan</legend>
        <label><input type="radio" name="plan" value="basic" checked> Basic</label>
        <label><input type="radio" name="plan" value="pro"> Pro</label>
      </fieldset>
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
- The only channel is `postMessage`. The card accepts messages only from
  its own iframe's window and only the shapes `readMessage` allows (a
  height, a form flag with a button label of at most 80 characters, a
  decline, an answer of at most 20 000 characters with at most 60 bounded
  lines), and sends the page one message, `collect` with a random id, on a
  click on its Send button. The submit that names that id, within two
  seconds, is taken as that click's answer (`isReply`); a decline, a reload
  or the deadline ends the ask, and every other submit goes to the
  confirmation strip. The id keeps a stray or late submit from riding on a
  click; it does not stop a page script that reads it (see above). A page
  with several forms gets no card button: each form's own submit goes
  through the strip.
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
