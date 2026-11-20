/* git/commit-bar.jsx — the docked Changes tab's last mile: what is staged,
   the commit message, and the three actions that turn it into a review —
   commit, push, pull request. Every mutation is one explicit click; nothing
   here commits, pushes or opens a pull request on its own (the ship loop's
   hard rule, docs/plans/2026-11-20-001-feat-t3code-experience-parity-plan.md
   R6). The full-window git browser does not render it: staging and reading
   diffs stay there, shipping happens in the dock.

   Data: `ship` comes from app/use-git-browser.jsx (useGitBrowser with
   `ship: true`) — staged paths, remotes, busy, the last result and the three
   async actions; `repo` is StatusView.repo (name, branch, head, ahead).
   Enablement is app/ship-bar.js `state()` (the same rules tests pin) and the
   default text is app/ship-text.js; both are read at render time, so neither
   needs a load-order promise. Titles carry the reason copy of every disabled
   button, and one line under the row repeats the first of them: no disabled
   action is ever a dead end without an explanation. */

const { Icon: _CB_Icon } = window;

// `state()` shape when app/ship-bar.js is not loaded (a test bed, or a build
// that predates it): everything disabled, nothing claimed about why.
const _CB_NO_STATE = { commit: false, push: false, pullRequest: false, reasons: {} };

function _cbState(args) {
  const bar = window.OMP_SHIP_BAR;
  return bar ? bar.state(args) : _CB_NO_STATE;
}

/** One of app/ship-text.js's defaults; "" when it is not loaded. */
function _cbText(kind, files) {
  const fn = window.OMP_SHIP_TEXT?.[kind];
  return typeof fn === "function" ? String(fn(files) ?? "") : "";
}

/** Distinct, sorted staged paths — a rename can list one twice. */
function _cbPaths(files) {
  const unique = window.OMP_SHIP_TEXT?.uniqueSorted;
  return unique ? unique(files) : [...new Set(files ?? [])].sort();
}

/** A remote's name, from either shape the hook may hand over. */
function _cbName(remote) {
  return typeof remote === "string" ? remote : String(remote?.name ?? "");
}

/** The remote a bar opens with: the only one, else none. With several, a
 *  picked default would be an implicit choice — a user who clicks Push
 *  without reading the picker ships somewhere they never named (plan U1.2),
 *  so the select starts empty and says so. */
function _cbDefaultRemote(remotes) {
  const names = remotes.map(_cbName);
  return names.length === 1 ? names[0] : "";
}

/** The ship-bar reason codes as sentences (`reasons` in app/ship-bar.js). */
const _CB_REASONS = {
  busy: "An action is already running.",
  detached: "A branch is required.",
  "nothing-staged": "Nothing is staged.",
  "message-required": "Write a commit message first.",
  "no-remote": "This repository has no remote.",
  "remote-required": "Choose a remote first.",
  "unsupported-host": "Only GitHub and GitLab are supported.",
  "not-pushed": "Push the branch before opening a pull request.",
};

/** The URL in a result line, for the pull request's link. */
function _cbUrl(text) {
  const hit = /https?:\/\/\S+/.exec(text);
  return hit ? hit[0].replace(/[),.;]+$/, "") : "";
}

/** Open a URL the way the rest of the app does: the bridge's navigation guard,
 *  never an anchor (the webview must not navigate). */
function _cbOpen(url) {
  const bridge = window.OMP_BRIDGE;
  if (!bridge?.openExternalUrl) return;
  Promise.resolve(bridge.openExternalUrl(url)).then(
    res => { if (!res?.ok) console.error("[ship] open failed:", res?.error); },
    err => console.error("[ship] open failed:", err),
  );
}

/** A failed action's sentence, with the raw text kept for the disclosure. */
function _cbPresent(raw) {
  const present = window.OMP_GIT_ERROR?.present;
  if (present) return present(raw);
  const text = String(raw ?? "");
  return { message: text, detail: text };
}

/** Two rows that grow with the text on a webview without `field-sizing`
 *  (the CSS is the whole of it elsewhere). Same fallback as work-panel.jsx's
 *  title box. */
function _cbAutoGrow(ref, value) {
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof CSS === "undefined" || CSS.supports?.("field-sizing", "content")) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
}

const _CB_SHOWN_PATHS = 4;

window.CommitBar = function CommitBar({ ship, repo }) {
  window.OMP_I18N.useLocale();
  const s = ship ?? {};
  const staged = Array.isArray(s.staged) ? s.staged : [];
  const remotes = Array.isArray(s.remotes) ? s.remotes : [];
  const busy = Boolean(s.busy);
  const result = s.result ?? null;

  const paths = _cbPaths(staged);
  const stagedKey = paths.join("\u0000");
  const remotesKey = remotes.map(_cbName).join("\u0000");

  // The message and the request text are seeded from the staged set, and a
  // seed never overwrites an edit: `touched` flips on the first keystroke.
  const [message, setMessage] = React.useState(() => _cbText("subject", paths));
  const touched = React.useRef(false);
  const [prOpen, setPrOpen] = React.useState(false);
  const [prTitle, setPrTitle] = React.useState(() => _cbText("prTitle", paths));
  const [prBody, setPrBody] = React.useState(() => _cbText("prBody", paths));
  const [draft, setDraft] = React.useState(false);
  const prTouched = React.useRef(false);
  const [remote, setRemote] = React.useState(() => _cbDefaultRemote(remotes));

  const messageRef = React.useRef(null);
  const prBodyRef = React.useRef(null);
  _cbAutoGrow(messageRef, message);
  _cbAutoGrow(prBodyRef, prBody);

  // A second click while the first is in flight would commit twice.
  const inFlight = React.useRef(false);

  // A change in the staged set re-seeds the text the user has not edited.
  React.useEffect(() => {
    if (!touched.current) setMessage(_cbText("subject", paths));
    if (!prTouched.current) {
      setPrTitle(_cbText("prTitle", paths));
      setPrBody(_cbText("prBody", paths));
    }
    // `stagedKey` is the staged set; `paths` is derived from it.
  }, [stagedKey]);

  // A remote that disappeared (fetched away, or the first list arriving)
  // falls back to the default.
  React.useEffect(() => {
    if (!remotes.map(_cbName).includes(remote)) setRemote(_cbDefaultRemote(remotes));
  }, [remotesKey]);

  // A new result: a created request collapses its form, and a landed commit
  // spends its message — a failure leaves both exactly as they were.
  React.useEffect(() => {
    if (!result) return;
    if (!result.ok) return;
    if (result.kind === "pullRequest") setPrOpen(false);
    if (result.kind === "commit") {
      touched.current = false;
      setMessage("");
    }
    // Keyed on the result's content: the hook may hand over a new object on
    // every render.
  }, [result ? `${result.kind}\0${result.ok ? 1 : 0}\0${result.text}` : ""]);

  if (!repo) return null;

  const detached = !repo.branch;
  const view = detached ? _CB_NO_STATE : _cbState({
    staged: paths,
    message: message.trim(),
    remotes,
    remote,
    branch: repo.branch,
    // `ahead` is null without an upstream: no published commit yet.
    pushed: repo.ahead === 0,
    busy,
  });
  const reasons = view.reasons ?? {};
  const reasonCopy = code => {
    const text = _CB_REASONS[code];
    return text ? OMP_TR(text) : null;
  };

  // The first reason in flow order, minus the two the bar already says out
  // loud: "nothing-staged" is the staged line's own sentence, "busy" is the
  // working… label beside the buttons.
  const alreadySaid = code => code === "nothing-staged" || code === "busy";
  const flowCode = [reasons.commit, reasons.push, reasons.pullRequest].find(code => code && !alreadySaid(code));
  const flowNote = flowCode ? reasonCopy(flowCode) : null;
  const prNote = prOpen && !prTitle.trim() && view.pullRequest ? OMP_TR("Write a title for the pull request.") : null;
  const note = (prOpen && prNote) || flowNote;

  const guarded = async run => {
    if (inFlight.current) return;
    inFlight.current = true;
    try { await run(); } finally { inFlight.current = false; }
  };
  const onCommit = () => guarded(() => s.commit?.(message.trim()));
  const onPush = () => guarded(() => s.push?.(remote));
  const onCreatePr = () => guarded(() => s.createPr?.(prTitle.trim(), prBody.trim(), draft));

  const shown = paths.slice(0, _CB_SHOWN_PATHS);
  const hidden = paths.length - shown.length;

  let resultNode = null;
  if (result && result.ok) {
    const text = String(result.text ?? "");
    const url = _cbUrl(text);
    // The hook hands over the bare value per kind: the short sha, a
    // `branch → remote`, `#number url`. The sentence around it is ours.
    let label = url ? text.replace(url, "").trim() : text;
    if (result.kind === "commit") label = label ? OMP_TR("Committed {text}", { text: label }) : "";
    else if (result.kind === "push") label = label ? OMP_TR("Pushed {text}", { text: label }) : "";
    else if (!label && url) label = OMP_TR("pull request");
    resultNode = (label || url) ? (
      <>
        <span className="gitb-ship-ok">{label}</span>
        {url ? (
          <button type="button" className="gitb-ship-link" title={url} onClick={() => _cbOpen(url)}>
            {url} <_CB_Icon name="external" size={9} />
          </button>
        ) : null}
      </>
    ) : null;
  } else if (result) {
    const shownError = _cbPresent(result.text);
    resultNode = (
      <>
        <span className="gitb-ship-bad">{OMP_TR(shownError.message)}</span>
        <details className="gitb-ship-detail">
          <summary>{OMP_TR("Show technical details")}</summary>
          <pre>{shownError.detail}</pre>
        </details>
      </>
    );
  }

  return (
    <footer className="gitb-ship" aria-label={OMP_TR("ship changes")} aria-busy={busy || undefined}>
      <div className="gitb-ship-staged">
        {paths.length === 0 ? (
          <span className="gitb-ship-quiet">{OMP_TR("Nothing is staged yet. Stage files in the tree first.")}</span>
        ) : (
          <>
            <span className="gitb-ship-count">{OMP_TR("{n} staged", { n: paths.length })}</span>
            <span className="gitb-ship-paths">
              {shown.map(path => <code key={path} className="gitb-ship-path" title={path}>{path}</code>)}
              {hidden > 0 && <span className="gitb-ship-more">{OMP_TR("+{n} more", { n: hidden })}</span>}
            </span>
          </>
        )}
      </div>

      {detached ? (
        <div className="gitb-ship-detached">
          <_CB_Icon name="branch" size={12} color="var(--amber)" />
          <div>
            <div>{OMP_TR("A branch is required to commit, push or open a pull request.")}</div>
            <div className="gitb-ship-hint">{OMP_TR("Switch to a branch from the status bar, then come back here.")}</div>
          </div>
        </div>
      ) : (
        <>
          {/* While the request form is open the message block steps aside: a
              320px dock has no room for both, and the commit message has done
              its job by this point. Its text stays in state untouched. */}
          {!prOpen && (
            <div className="gitb-ship-msg">
              <textarea className="gitb-ship-input" rows={2} value={message} ref={messageRef}
                aria-label={OMP_TR("commit message")} placeholder={OMP_TR("commit message")}
                onChange={e => { touched.current = true; setMessage(e.target.value); }} />
              <div className="gitb-ship-hint">{OMP_TR("Git hooks may run when you commit.")}</div>
            </div>
          )}

          <div className="gitb-ship-actions">
            {/* One primary action at a time: while a request is being written
                it is the form's Create, so Commit steps back to secondary. */}
            <button type="button" className={`btn gitb-ship-btn${prOpen ? "" : " primary"}`} disabled={!view.commit}
              title={reasonCopy(reasons.commit) ?? undefined} onClick={onCommit}>
              {OMP_TR("Commit")}
            </button>
            {remotes.length > 1 && (
              <select className="gitb-ship-remote" value={remote} aria-label={OMP_TR("remote")}
                onChange={e => setRemote(e.target.value)}>
                {/* Visible empty state: nothing is picked yet, and Push says
                    why. Once a remote is chosen this row is the label, not a
                    way back to no choice. */}
                <option value="" disabled>{OMP_TR("Choose a remote…")}</option>
                {remotes.map(r => {
                  const name = _cbName(r);
                  return <option key={name} value={name}>{name}</option>;
                })}
              </select>
            )}
            <button type="button" className="btn gitb-ship-btn" disabled={!view.push}
              title={reasonCopy(reasons.push) ?? undefined} onClick={onPush}>
              {OMP_TR("Push")}
            </button>
            <button type="button" className="btn gitb-ship-btn" disabled={!view.pullRequest}
              title={reasonCopy(reasons.pullRequest) ?? undefined} aria-expanded={prOpen}
              onClick={() => setPrOpen(open => !open)}>
              {OMP_TR("Create pull request")}
            </button>
            {busy && <span className="gitb-ship-hint">{OMP_TR("working…")}</span>}
          </div>

          {/* Always rendered, with a reserved height: the result replaces the
              reason line (never both, so the row stays one line), and neither
              ever pushes the panes. Above the request form, which is the one
              part that can outgrow a short dock. */}
          <div className="gitb-ship-status" role="status" aria-live="polite">
            {resultNode ?? (note ? <span className="gitb-ship-hint">{note}</span> : null)}
          </div>

          {prOpen && (
            <div className="gitb-ship-pr">
              <input className="gitb-ship-input" value={prTitle}
                aria-label={OMP_TR("pull request title")} placeholder={OMP_TR("pull request title")}
                onChange={e => { prTouched.current = true; setPrTitle(e.target.value); }} />
              <textarea className="gitb-ship-input gitb-ship-body" rows={3} value={prBody} ref={prBodyRef}
                aria-label={OMP_TR("pull request body")} placeholder={OMP_TR("pull request body")}
                onChange={e => { prTouched.current = true; setPrBody(e.target.value); }} />
              {/* Pinned to the bottom of a scrolling bar: in a 320px dock the
                  form does not fit, and a Create button below the fold is a
                  dead end. */}
              <div className="gitb-ship-pr-actions">
                <label className="gitb-ship-check">
                  <input type="checkbox" checked={draft} onChange={e => setDraft(e.target.checked)} />
                  {OMP_TR("Draft")}
                </label>
                <button type="button" className="btn primary gitb-ship-btn"
                  disabled={!view.pullRequest || !prTitle.trim()}
                  title={reasonCopy(reasons.pullRequest) ?? undefined} onClick={onCreatePr}>
                  {OMP_TR("Create")}
                </button>
                <button type="button" className="btn gitb-ship-btn" onClick={() => setPrOpen(false)}>
                  {OMP_TR("Cancel")}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </footer>
  );
};
