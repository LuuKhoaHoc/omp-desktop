/* composer-highlight.jsx — the composer's draft with its markdown syntax
   coloured while it is typed.

   The textarea stays the editor: caret, selection, IME, undo, paste and
   spell check are the webview's. Its own glyphs are transparent
   (layout/composer.css) and this layer, on top of it and closed to the
   pointer, shows the same text cut into runs by app/composer-markdown.js.
   A run's kind changes only its colour or decoration, never a glyph's
   advance, so each character sits where the textarea puts its caret.
   The layer is placed on the textarea's client box (a scrollbar narrows the
   textarea's lines, and the copy has to wrap at the same width) and follows
   its scroll position. */
const { spans: _CH_spans } = window.OMP_COMPOSER_MD;

function ComposerHighlight({ text }) {
  const ref = React.useRef(null);
  const runs = React.useMemo(() => _CH_spans(text), [text]);

  React.useLayoutEffect(() => {
    // The textarea beside the layer, from the DOM: a ref the composer holds
    // is attached only after this effect has run.
    const layer = ref.current;
    const ta = layer?.parentElement?.querySelector("textarea");
    if (!ta) return undefined;
    const sync = () => {
      layer.style.left = `${ta.offsetLeft + ta.clientLeft}px`;
      layer.style.top = `${ta.offsetTop + ta.clientTop}px`;
      layer.style.width = `${ta.clientWidth}px`;
      layer.style.height = `${ta.clientHeight}px`;
      layer.scrollTop = ta.scrollTop;
    };
    sync();
    // The content box: it changes when the textarea grows with the draft and
    // when a scrollbar appears, the two moments the copy must be re-fitted.
    const observer = new ResizeObserver(sync);
    observer.observe(ta);
    ta.addEventListener("scroll", sync, { passive: true });
    return () => {
      observer.disconnect();
      ta.removeEventListener("scroll", sync);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A textarea shows an empty last line after a final newline; a block only
  // does when something follows it.
  return (
    <div ref={ref} className="composer-hl" aria-hidden="true">
      {runs.map((r, i) => (r.kind ? <span key={i} className={`cmh-${r.kind}`}>{r.text}</span> : r.text))}
      {"\n"}
    </div>
  );
}

Object.assign(window, { ComposerHighlight });
