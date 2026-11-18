/* browser-more-menu.jsx — the browser toolbar's "..." menu */

const { OMP_BROWSER_BAR: _BMM_BAR } = window;

function BrowserMoreMenu({ state, onPick, onClose }) {
  OMP_I18N.useLocale();
  const ref = React.useRef(null);
  window.usePopoverDismiss(true, ref, onClose);

  return (
    <div
      className="browser-menu browser-more-menu"
      role="menu"
      aria-label={OMP_TR("more options")}
      ref={ref}
      onContextMenu={(e) => e.preventDefault()}
    >
      {_BMM_BAR.moreMenu(state).map((row) => (
        <button
          key={row.id}
          type="button"
          className="browser-menu-item"
          role="menuitem"
          disabled={row.disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onClose();
            onPick(row.id);
          }}
        >
          {OMP_TR(row.label)}
        </button>
      ))}
    </div>
  );
}

Object.assign(window, { BrowserMoreMenu });
