/* browser-menu.jsx — the browser page's context menu (docs/architecture/browser.md).
   `menu` is use-browser.jsx's: where the right click was in the view and
   what Rust found there; the rows are OMP_BROWSER.contextMenu. It closes on
   a press outside, Esc, or a pick. Focus stays on the page's input sink:
   the rows are picked by pointer. */

const { OMP_BROWSER: _BM } = window;

function BrowserMenu({ menu, state, onPick, onClose }) {
  OMP_I18N.useLocale();
  const ref = React.useRef(null);
  window.usePopoverDismiss(true, ref, onClose);
  return (
    <div className="browser-menu" role="menu" aria-label={OMP_TR("page menu")} ref={ref}
      style={_BM.contextMenuPlace(menu)} onContextMenu={(e) => e.preventDefault()}>
      {_BM.contextMenu(menu.at, state).map((row, i) => (row.divider
        ? <div key={`d${i}`} className="browser-menu-divider" role="separator" />
        : (
          <button key={row.id} type="button" className="browser-menu-item" role="menuitem"
            disabled={row.disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(row.id)}>
            {OMP_TR(row.label)}
          </button>
        )))}
    </div>
  );
}

Object.assign(window, { BrowserMenu });
