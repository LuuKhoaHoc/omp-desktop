/* browser-start.jsx — start page shown on a blank tab
   (omnibox with search/URL/file classification, and shortcut tiles). */

const {
  Icon: _BS_Icon,
  OMP_BROWSER_START: _BS,
  OMP_BRIDGE: _BS_BRIDGE,
} = window;

function BrowserStart({ ui, onOpenTool }) {
  OMP_I18N.useLocale();
  const [query, setQuery] = React.useState("");
  const [suggestions, setSuggestions] = React.useState([]);
  const [selectedIdx, setSelectedIdx] = React.useState(-1);
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    if (!query.startsWith("@")) {
      setSuggestions([]);
      setSelectedIdx(-1);
      return undefined;
    }
    let gone = false;
    const term = query.slice(1).trim();
    const timer = setTimeout(() => {
      const bridge = ui.bridge || _BS_BRIDGE;
      bridge?.listFiles?.(term, 8).then((files) => {
        if (!gone && Array.isArray(files)) {
          setSuggestions(files);
          setSelectedIdx(-1);
        }
      }).catch(() => {
        if (!gone) setSuggestions([]);
      });
    }, 120);
    return () => { gone = true; clearTimeout(timer); };
  }, [query, ui.bridge]);

  const handlePick = (classified) => {
    const toolHandler = onOpenTool || ui.openTool;
    _BS.pickResult(classified, {
      navigate: ui.navigate,
      openTool: toolHandler,
      openFile: (target) => {
        if (ui.openFile) ui.openFile(target);
        else ui.navigate?.(target);
      },
    });
  };

  const submit = (text) => {
    const raw = text.trim();
    if (!raw) return;
    const classified = _BS.classify(raw);
    handlePick(classified);
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      if (suggestions.length > 0) {
        e.preventDefault();
        setSelectedIdx((prev) => (prev + 1) % suggestions.length);
      }
    } else if (e.key === "ArrowUp") {
      if (suggestions.length > 0) {
        e.preventDefault();
        setSelectedIdx((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIdx >= 0 && selectedIdx < suggestions.length) {
        submit("@" + suggestions[selectedIdx]);
      } else {
        submit(query);
      }
    } else if (e.key === "Escape") {
      if (suggestions.length > 0) {
        e.preventDefault();
        setSuggestions([]);
      }
    }
  };

  const tiles = _BS.tiles();

  return (
    <div className="browser-start">
      <div className="browser-start-hero">
        <div className="browser-start-badge" aria-hidden="true">
          <_BS_Icon name="web" size={24} />
        </div>
        <h2 className="browser-start-title">{OMP_TR("Browser")}</h2>
        <p className="browser-start-subtitle">{OMP_TR("Search or enter address")}</p>
        <div className="browser-start-search-wrap">
          <div className="browser-start-search-box">
            <_BS_Icon name="search" size={14} />
            <input
              ref={inputRef}
              type="text"
              className="browser-start-search-input"
              value={query}
              placeholder={OMP_TR("Type @ to mention files, enter a URL or search the web")}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
            />
            {query && (
              <button
                type="button"
                className="browser-start-clear"
                title={OMP_TR("clear")}
                aria-label={OMP_TR("clear")}
                onClick={() => {
                  setQuery("");
                  setSuggestions([]);
                  inputRef.current?.focus();
                }}
              >
                <_BS_Icon name="close" size={10} />
              </button>
            )}
          </div>
          {suggestions.length > 0 && (
            <div className="browser-start-suggestions" role="listbox">
              {suggestions.map((file, idx) => (
                <button
                  key={file}
                  type="button"
                  role="option"
                  aria-selected={idx === selectedIdx}
                  className={`browser-start-suggestion-item${idx === selectedIdx ? " selected" : ""}`}
                  onClick={() => submit("@" + file)}
                >
                  <_BS_Icon name="file" size={12} />
                  <span className="mono">{file}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="browser-start-tiles">
          {tiles.map((tile) => (
            <button
              key={tile.id}
              type="button"
              className="browser-start-tile"
              onClick={() => handlePick({ kind: "tool", target: tile.id })}
            >
              <span className="browser-start-tile-icon" aria-hidden="true">
                <_BS_Icon name={tile.icon} size={15} />
              </span>
              <span className="browser-start-tile-label">{OMP_TR(tile.label)}</span>
              <span className="browser-start-tile-desc">{OMP_TR(tile.desc)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { BrowserStart });
