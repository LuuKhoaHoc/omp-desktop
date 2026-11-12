/* design/chat/chat-page.jsx — an assistant's ```html / ```svg block as an
   interactive page (fork). Pure half and the security notes:
   app/chat-pages.js and src-tauri/src/chat_pages.rs.

   Shown as code first, unless the block says ```html page; "Run" starts it.
   The page runs in <iframe sandbox="allow-scripts allow-forms"> (no
   allow-same-origin, no popups, no top navigation) loaded from the
   `omp-page:` scheme, so it never shares the app's origin. Its only way out
   is postMessage: a height, whether it holds a form, or an answer. An answer
   reaches the agent only on a click in this card: its Send button under a
   form (one click: the card asks the page for the fields), or Send on the
   strip that shows what the page itself offered (its own button, a
   [data-omp-send] click, omp.submit: all of which a script can fake). */

const { Icon: _CP_Icon } = window;

// One stored page per wrapped source, across remounts (tab switches).
const _cpIds = new Map();
async function _cpRegister(html) {
  if (_cpIds.has(html)) return _cpIds.get(html);
  const id = await window.__TAURI__.core.invoke("page_register", { html });
  _cpIds.set(html, id);
  return id;
}

// Live send/insert handlers for page answers (app-live.jsx); null outside the chat.
const ChatPageContext = React.createContext(null);

function _cpTheme() {
  const css = getComputedStyle(document.documentElement);
  const v = n => css.getPropertyValue(n).trim();
  return {
    scheme: (css.colorScheme || "").includes("light") ? "light" : "dark",
    bg: v("--bg-window"), surface: v("--bg-elevated"), fg: v("--fg"), fg2: v("--fg-2"), muted: v("--fg-3"),
    accent: v("--accent"), line: v("--line-bright") || v("--line"), font: v("--font-sans"), mono: v("--font-mono"),
  };
}

function ChatPage({ source, kind, live, codeHtml, streaming }) {
  const P = window.OMP_PAGES;
  const actions = React.useContext(ChatPageContext);
  const [running, setRunning] = React.useState(live && !streaming);
  const [url, setUrl] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [height, setHeight] = React.useState(160);
  const [max, setMax] = React.useState(false);
  const [answer, setAnswer] = React.useState(null);
  const [sent, setSent] = React.useState(null);
  const [reload, setReload] = React.useState(0);
  const frame = React.useRef(null);
  // The page holds a form the card's Send button answers for: `{ label }`.
  const [form, setForm] = React.useState(null);
  // The card's own ask in flight: `{ id, until }`. Only the page's reply to
  // that id, in time, goes out without the confirmation strip.
  const asked = React.useRef(null);
  const title = P.pageTitle(source) || (kind === "svg" ? "SVG" : "Page");

  // A `page` block that finished streaming starts on its own.
  React.useEffect(() => { if (live && !streaming) setRunning(true); }, [live, streaming]);

  React.useEffect(() => {
    if (!running) return;
    let alive = true;
    setErr(null);
    _cpRegister(P.wrapPage(source, kind, _cpTheme(), { other: OMP_TR("Other"), otherPlaceholder: OMP_TR("Type your answer…") }))
      .then(id => alive && setUrl(P.pageUrl(id)), e => alive && setErr(String(e?.message ?? e)));
    return () => { alive = false; };
  }, [running, source, kind]);

  React.useEffect(() => {
    if (!running) return;
    const onMsg = e => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const m = P.readMessage(e.data);
      if (m?.type === "height") setHeight(Math.max(48, m.h));
      else if (m?.type === "form") setForm(m.on ? { label: m.label } : null);
      else if (m?.type === "declined") { if (P.isReply(m, asked.current)) asked.current = null; }
      else if (m?.type === "submit" && actions) {
        const mine = P.isReply(m, asked.current);
        if (mine) { asked.current = null; deliver("send", m); }
        else setAnswer(m);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [running, actions, title]);

  React.useEffect(() => {
    if (!max) return;
    const onKey = e => { if (e.key === "Escape") { e.stopPropagation(); setMax(false); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [max]);

  const deliver = (how, msg = answer) => {
    const text = P.answerText(title, msg);
    if (how === "send") actions.send(text); else actions.insert(text);
    setSent(how === "send" ? "Sent to the agent" : "Put in the composer");
    setAnswer(null);
  };
  // The card's own Send: the page answers that id with its form's fields,
  // or declines (a required field is empty, which the page points at).
  const ask = () => {
    const id = crypto.randomUUID();
    asked.current = { id, until: Date.now() + 2000 };
    frame.current?.contentWindow?.postMessage({ omp: "card", type: "collect", id }, "*");
  };

  return (
    <div className={`cp-card${max ? " max" : ""}`}>
      <div className="cp-head">
        <_CP_Icon name="grid" size={12} />
        <span className="cp-title" title={title}>{title}</span>
        <span className="cp-kind">{kind}</span>
        <span style={{ flex: 1 }} />
        {running && <button className="btn ghost small" title="Run again" onClick={() => { asked.current = null; setReload(r => r + 1); setAnswer(null); setSent(null); setForm(null); }}>Reload</button>}
        {running && <button className="btn ghost small" aria-pressed={max} title={max ? "Close (Esc)" : "Expand"} onClick={() => setMax(v => !v)}>{max ? "Close" : "Expand"}</button>}
        <button className="btn ghost small" disabled={streaming && !running} onClick={() => { setRunning(v => !v); setMax(false); }}>{running ? "Code" : "Run"}</button>
      </div>
      {/* codeHtml is marked's output for this one code token: escaped and highlighted by marked-setup.js */}
      {!running && <div className="cp-code" dangerouslySetInnerHTML={{ __html: codeHtml }} />}
      {running && err && <div className="wp-note err"><_CP_Icon name="warn" size={12} /> {err}</div>}
      {running && url && (
        <iframe key={reload} ref={frame} className="cp-frame" src={url} title={title}
          sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer"
          style={max ? undefined : { height }} />
      )}
      {answer && (
        <div className="cp-answer" role="alertdialog" aria-label="The page wants to answer">
          <div className="cp-answer-head">The page wants to send this to the agent:</div>
          <pre className="cp-answer-text mono">{P.answerText(title, answer)}</pre>
          <div className="cp-answer-actions">
            <button className="btn ghost small" onClick={() => setAnswer(null)}>Dismiss</button>
            <button className="btn ghost small" onClick={() => deliver("insert")}>Put in composer</button>
            <button className="btn primary small" onClick={() => deliver("send")}>Send</button>
          </div>
        </div>
      )}
      {running && url && !err && form && actions && !answer && !sent && (
        <div className="cp-submit"><button className="btn primary" onClick={ask}>{form.label || "Send"}</button></div>
      )}
      {sent && !answer && <div className="cp-sent"><_CP_Icon name="check" size={12} /> {sent}</div>}
    </div>
  );
}

Object.assign(window, { ChatPage, ChatPageContext });
