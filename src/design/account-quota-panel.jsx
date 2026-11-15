function AccountQuotaPanel({ onClose }) {
  const scrimRef = React.useRef(null);
  useModalLayer(scrimRef);
  return ReactDOM.createPortal(
    <div ref={scrimRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={OMP_TR("Accounts & quota")}
      className="bridge-scrim account-quota-scrim" onClick={onClose}
      onKeyDown={e => { e.stopPropagation(); if (e.key === "Escape") onClose(); }}>
      <div className="stats-panel" onClick={e => e.stopPropagation()}>
        <div className="stats-head">
          <window.Icon name="layers" size={13} />
          <span>{OMP_TR("Accounts & quota")}</span>
          <button className="btn icon ghost account-quota-close" onClick={onClose} title={OMP_TR("close")}>
            <window.Icon name="close" size={11} />
          </button>
        </div>
        <div className="stats-body"><window.AccountQuotaSection /></div>
      </div>
    </div>, document.body
  );
}
window.AccountQuotaPanel = AccountQuotaPanel;
