# Work panel (fork)

The Work panel (`Ctrl+Shift+I`, tag icon in the toolbar) lists, moves and edits
tickets from GitLab (gitlab.com or self-hosted), GitHub and Linear.

## Connections and views

A **connection** is how to reach a platform; a **view** is what to show from
it. One sign-in serves many views, so issues spread over a group, the merge
requests of another group and a project's pipelines all use one connection.
Both are stored in the webview's `localStorage` (`omp.work.connections`,
`omp.work.views`) and hold **no secret**. Connections saved before views
existed become a connection plus one Issues view on first load.

| Connection field | Meaning |
|---|---|
| Platform | GitLab, GitHub or Linear |
| Connect with | `glab` / `gh` CLI (uses the CLI's own login), or an API token |
| Host | Optional. Self-hosted GitLab name, e.g. `gitlab.example.com` |
| Token variable | For a token: the *name* of an environment variable, e.g. `GITLAB_TOKEN` |

| View field | Meaning |
|---|---|
| Show | Issues; on GitLab also Merge requests and Pipelines |
| From (GitLab) | One project, or a group: every project under it, each item tagged with its repo (`kho#36`, `erp-admin!1144`) |
| Project / Group / Repository / Team | `group/project` (or id), a group path, `owner/name`, Linear team key |
| Whose (GitLab) | Issues: assigned to me / team / all. MRs: mine / to review / team / all |
| Team usernames | For "team": issues assigned to, or MRs opened by, any of them (one request per person) |
| Board columns | Issues: labels used as columns between Open and Closed (drag or `‹ ›` to order) |
| Branch | Pipelines: one ref only (empty: every ref, merge requests included) |

Edit the open view from **Edit view** in the panel head (or "✎ Edit this view…"
in the view menu). Project, group, team members, board columns and branch are
pickers filled from the platform: your groups or projects, the place's
members, its labels, its branches. Typing stays allowed for anything not
listed. When a GitLab group's member list is not readable (403 below the
Maintainer role on some instances), the people offered are those on the
group's recent issues and merge requests.

GitLab lists pipelines per project only, so a Pipelines view needs one project;
an MR's own pipeline shows in its drawer.

The token stays in your environment. Rust reads the variable when a request
runs (`work_http`, `src-tauri/src/work.rs`) and never returns it. The CLI
transport only runs `glab api …` / `gh api …`, with no shell. MCP is listed
but disabled until the app has an MCP client.

Start the app from an environment that has the variable, e.g. add it to
`~/.config/environment.d/*.conf` on Linux.

## Merge requests and pipelines

The MR drawer shows branches, reviewers, approvals, the head pipeline and the
description, and can comment, approve or revoke, retry a failed pipeline and
merge. Merge asks first and sends the HEAD sha the drawer shows, so a push in
between makes GitLab refuse; it is enabled only when GitLab reports the MR
mergeable, and never sets auto-merge. The pipeline drawer lists jobs by stage
(a click opens the job log) and retries a failed or cancelled pipeline;
cancelling stays in the browser.

## Using it

- **View switcher** in the panel head opens a grouped menu of connections and
  views; **Board / list** toggles the layout. Drag a card to another column,
  or focus it and press `Alt+←` / `Alt+→`. Moving changes the column label
  (GitLab/GitHub) or the workflow state (Linear); Closed closes the ticket.
- **Quick filters**: search text plus **Assignee** / **Author**, **Label**,
  and **Closed** toggles narrow the active view without altering its saved query.
- **Drawer**: click a ticket. Edit title, labels and the markdown body
  (Preview / Edit), close or reopen, comment (`Ctrl+Enter`). `Ctrl+S` saves.
- A save first re-reads the ticket. If it changed on the server since you
  opened it, nothing is written and "Load latest" shows the new version.
