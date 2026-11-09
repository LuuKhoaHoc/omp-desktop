/* ui/markdown.jsx — Markdown renderer using marked + highlight.js
   when available; falls back to plain text with HTML escaping. */

const { copyCodeBlockClick: _MdCopyClick } = window;

// Clicks in rendered markdown, delegated on its container: the code blocks'
// copy buttons, then links — `MarkdownLinkContext` carries a handler
// (app-live.jsx: the browser panel's localhost links), null for none.
const MarkdownLinkContext = React.createContext(null);
function useMarkdownClick() {
  const onLink = React.useContext(MarkdownLinkContext);
  return React.useCallback((e) => { _MdCopyClick(e); onLink?.(e); }, [onLink]);
}

const escapeText = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Fork: with `pages`, ```html / ```svg blocks become ChatPage cards
// (design/chat/chat-page.jsx). The text is cut at those blocks; every other
// run still goes through marked (and marked-setup.js's escaping) as before.
function _mdPageParts(text) {
  const P = window.OMP_PAGES;
  if (!P || !window.marked) return null;
  let tokens;
  try { tokens = window.marked.lexer(text); } catch (_) { return null; }
  if (!tokens.some(t => t.type === 'code' && P.pageInfo(t.lang))) return null;
  const parts = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    run.links = tokens.links;
    parts.push({ html: window.marked.parser(run) });
    run = [];
  };
  for (const t of tokens) {
    const info = t.type === 'code' ? P.pageInfo(t.lang) : null;
    if (!info) { run.push(t); continue; }
    flush();
    const one = [t];
    one.links = tokens.links;
    parts.push({ page: { source: t.text, ...info, codeHtml: window.marked.parser(one) } });
  }
  flush();
  return parts;
}

// ── Markdown renderer — uses marked + highlight.js when available ─────────
const MarkdownContent = ({ text, streaming, pages }) => {
  const parts = React.useMemo(() => {
    if (!pages || !text) return null;
    try { return _mdPageParts(text); } catch (_) { return null; }
  }, [text, pages]);
  const html = React.useMemo(() => {
    if (!text) return '';
    if (!window.marked) {
      // marked not loaded — render plain text with escaped HTML
      return '<p>' + escapeText(text)
        .replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
    }
    try { return window.marked.parse(text); }
    catch (_) { return '<pre>' + escapeText(text) + '</pre>'; }
  }, [text]);

  const onClick = useMarkdownClick();
  if (parts) {
    const { ChatPage } = window;
    return (
      <div className={`md-content selectable${streaming ? ' md-streaming' : ''}`} onClick={onClick}>
        {parts.map((p, i) => p.page
          ? <ChatPage key={i} {...p.page} streaming={streaming && i === parts.length - 1} />
          : <div key={i} className="md-run" dangerouslySetInnerHTML={{ __html: p.html }} />)}
      </div>
    );
  }
  return (
    <div
      className={`md-content selectable${streaming ? ' md-streaming' : ''}`}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};


Object.assign(window, { MarkdownContent, MarkdownLinkContext, useMarkdownClick });
