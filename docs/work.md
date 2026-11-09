# Work panel (fork)

The Work panel (`Ctrl+Shift+I`, tag icon in the toolbar) lists, moves and edits
tickets from GitLab (gitlab.com or self-hosted), GitHub and Linear.

## Connections

Add one from the panel (or its connection menu → "+ Add connection"). A
connection is stored in the webview's `localStorage` (`omp.work.connections`)
and holds **no secret**:

| Field | Meaning |
|---|---|
| Platform | GitLab, GitHub or Linear |
| Connect with | `glab` / `gh` CLI (uses the CLI's own login), or an API token |
| Host | Optional. Self-hosted GitLab name, e.g. `gitlab.example.com` |
| Project / Repository / Team | `group/project` (or id), `owner/name`, Linear team key |
| Token variable | For a token: the *name* of an environment variable, e.g. `GITLAB_TOKEN` |
| Board columns | Optional labels used as columns between Open and Closed |

The token stays in your environment. Rust reads the variable when a request
runs (`work_http`, `src-tauri/src/work.rs`) and never returns it. The CLI
transport only runs `glab api …` / `gh api …`, with no shell. MCP is listed
but disabled until the app has an MCP client.

Start the app from an environment that has the variable, e.g. add it to
`~/.config/environment.d/*.conf` on Linux.

## Using it

- **Board / list** toggle in the panel header. Drag a card to another column,
  or focus it and press `Alt+←` / `Alt+→`. Moving changes the column label
  (GitLab/GitHub) or the workflow state (Linear); Closed closes the ticket.
- **Drawer**: click a ticket. Edit title, labels and the markdown body
  (Preview / Edit), close or reopen, comment (`Ctrl+Enter`). `Ctrl+S` saves.
- A save first re-reads the ticket. If it changed on the server since you
  opened it, nothing is written and "Load latest" shows the new version.
