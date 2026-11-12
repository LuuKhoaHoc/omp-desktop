/* ═════════════════════════════════════════════════════════════════════
   design/work-view-menu.jsx — Work panel shared pills and popovers
   (fork): non-breaking ticket key pill, assignee avatar badge, view
   switcher popover, and quick assignee filter popover.
   ═════════════════════════════════════════════════════════════════════ */

const { Icon: _WPV_Icon } = window;

const _wpKindIcon = kind => (kind === "mrs" ? "merge" : kind === "pipelines" ? "radar" : "tag");
function _wpvKindLabel(kind) {
  if (kind === "mrs") return OMP_TR("Merge requests");
  if (kind === "pipelines") return OMP_TR("Pipelines");
  return OMP_TR("Issues");
}
/** Splits "long-repo-slug#26" or "repo!1144" into { repo, num } so #26 never drops. */
function _wpSplitKey(key) {
  const s = String(key ?? "");
  const m = /^(.*?)([#!]\d+)$/.exec(s);
  if (m && m[1]) return { repo: m[1], num: m[2] };
  return { repo: "", num: s };
}

function _WP_Key({ k, full }) {
  const { repo, num } = _wpSplitKey(k);
  return (
    <span className="wp-key-pill mono" title={full || k}>
      {repo && <span className="wp-key-repo">{repo}</span>}
      <span className="wp-key-num">{num}</span>
    </span>
  );
}

function _WP_Assignee({ name }) {
  const initials = String(name ?? "").slice(0, 2);
  return (
    <span className="wp-assignee" title={name}>
      <span className="wp-avatar" aria-hidden="true">{initials}</span>
      <span className="wp-who">{name}</span>
    </span>
  );
}

/** Places a fixed menu directly under `trigger` without overflowing the viewport. */
function _wpvPlace(trigger, width) {
  const r = trigger.getBoundingClientRect();
  const maxW = Math.min(width, window.innerWidth - 16);
  const left = Math.max(8, Math.min(r.left, window.innerWidth - maxW - 8));
  const top = Math.min(r.bottom + 6, window.innerHeight - 160);
  return { top: `${Math.round(top)}px`, left: `${Math.round(left)}px`, width: `${Math.round(maxW)}px` };
}

function _wpUsePopover(width) {
  const [place, setPlace] = React.useState(null);
  const open = place !== null;
  const triggerRef = React.useRef(null);
  const popRef = React.useRef(null);
  const rootRef = React.useRef(null);
  rootRef.current = { contains: n => triggerRef.current?.contains(n) || popRef.current?.contains(n) };
  const close = React.useCallback((refocus = true) => {
    setPlace(null);
    if (refocus) triggerRef.current?.focus();
  }, []);
  window.usePopoverDismiss(open, rootRef, () => close(false), close);
  React.useEffect(() => {
    if (!open) return;
    const onResize = () => setPlace(null);
    window.addEventListener("resize", onResize);
    const raf = requestAnimationFrame(() => popRef.current?.querySelector('.wp-pop-item.on, .wp-pop-item')?.focus());
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); };
  }, [open]);
  const toggle = () => (open ? close(false) : triggerRef.current && setPlace(_wpvPlace(triggerRef.current, width)));
  return { place, open, triggerRef, popRef, close, toggle };
}

/** Drawer/dialog modal semantics: auto-focus, focus restore, Esc close, and Tab trap. */
function _wpUseDialog(panelRef, open, onClose, { inertRoot = false } = {}) {
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  window.useModalFocus(panelRef, open && !inertRoot);
  React.useEffect(() => {
    if (!open || !inertRoot) return undefined;
    const prev = document.activeElement;
    const root = document.getElementById("root");
    if (root) root.inert = true;
    const raf = requestAnimationFrame(() => panelRef.current?.focus());
    return () => {
      cancelAnimationFrame(raf);
      if (root) root.inert = false;
      if (prev?.isConnected) prev.focus({ preventScroll: true });
    };
  }, [open, inertRoot, panelRef]);
  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = e => {
      const panel = panelRef.current;
      if (!panel) return;
      const focus = document.activeElement;
      if (focus && !panel.contains(focus) && focus.closest?.(".bridge-scrim")) return;
      if (e.key === "Escape" && !e.isComposing && !e.defaultPrevented) {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const focusables = [...panel.querySelectorAll(
          'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
        )].filter(el => el.offsetParent !== null || el.getClientRects().length > 0);
        e.preventDefault();
        if (!focusables.length) { panel.focus(); return; }
        const i = focusables.indexOf(focus);
        const next = i < 0 ? (e.shiftKey ? focusables.length - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + focusables.length) % focusables.length;
        focusables[next].focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, panelRef]);
}
function _WP_ViewMenu({ view, views, conns, onSelect, onEditView, onNewView, onAddConn }) {
  const V = window.OMP_WORK_VIEWS, W = window.OMP_WORK;
  const { place, open, triggerRef, popRef, close, toggle } = _wpUsePopover(290);

  return (
    <>
      <button ref={triggerRef} type="button" className="wp-view-trigger" aria-haspopup="menu"
        aria-expanded={open} title={`${view.name || OMP_TR("Untitled view")} (${_wpvKindLabel(view.kind)})`} onClick={toggle}>
        <_WPV_Icon name={_wpKindIcon(view.kind)} size={13} />
        <span className="wp-view-name">{view.name || OMP_TR("Untitled view")}</span>
        <span className="wp-view-kind">{_wpvKindLabel(view.kind)}</span>
        <span className="wp-view-chev"><_WPV_Icon name="chev" size={11} /></span>
      </button>
      {open && (
        <div ref={popRef} className="wp-view-pop" role="menu" aria-label={OMP_TR("Saved views")} style={place}
          onKeyDown={e => window.menuKeyNav(e, popRef.current, '.wp-pop-item', () => close(true))}>
          {conns.map(c => {
            const list = views.filter(v => v.connId === c.id);
            if (!list.length) return null;
            return (
              <React.Fragment key={c.id}>
                <div className="wp-pop-group">
                  <span>{c.name}</span>
                  <span className="wp-pop-plat">{W.PLATFORMS[c.platform]?.label}</span>
                </div>
                {list.map(v => (
                  <button key={v.id} type="button" role="menuitemradio" aria-checked={v.id === view.id}
                    className={`wp-pop-item${v.id === view.id ? " on" : ""}`}
                    onClick={() => { close(false); onSelect(v.id); }}>
                    <_WPV_Icon name={_wpKindIcon(v.kind)} size={13} />
                    <span className="wp-pop-label">{v.name || OMP_TR("Untitled view")}</span>
                    <span className="wp-pop-meta">{_wpvKindLabel(v.kind)}</span>
                    {v.id === view.id && <_WPV_Icon name="check" size={12} />}
                  </button>
                ))}
              </React.Fragment>
            );
          })}
          <div className="wp-pop-sep" />
          <button type="button" role="menuitem" className="wp-pop-item" onClick={() => { close(false); onEditView(); }}>
            <_WPV_Icon name="edit" size={13} /><span className="wp-pop-label">{OMP_TR("Edit current view…")}</span>
          </button>
          <button type="button" role="menuitem" className="wp-pop-item" onClick={() => { close(false); onNewView(); }}>
            <_WPV_Icon name="plus" size={13} /><span className="wp-pop-label">{OMP_TR("New view…")}</span>
          </button>
          <button type="button" role="menuitem" className="wp-pop-item" onClick={() => { close(false); onAddConn(); }}>
            <_WPV_Icon name="link" size={13} /><span className="wp-pop-label">{OMP_TR("Add connection…")}</span>
          </button>
        </div>
      )}
    </>
  );
}

function _WP_AssigneeFilter({ items, kind, value, onChange }) {
  const { place, open, triggerRef, popRef, close, toggle } = _wpUsePopover(220);
  if (kind === "pipelines") return null;

  const counts = new Map();
  let unassigned = 0;
  for (const it of items) {
    const people = kind === "mrs" ? (it.author ? [it.author] : []) : (it.assignees ?? []);
    if (!people.length) unassigned++;
    for (const p of people) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const people = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (people.length === 0) return null;

  const label = value === "__none__" ? OMP_TR("Unassigned") : value ? value : (kind === "mrs" ? OMP_TR("Author") : OMP_TR("Assignee"));

  return (
    <>
      <button ref={triggerRef} type="button" className={`wp-filter-btn${value ? " on" : ""}`}
        aria-haspopup="menu" aria-expanded={open}
        title={kind === "mrs" ? OMP_TR("Filter by author") : OMP_TR("Filter by assignee")} onClick={toggle}>
        <_WPV_Icon name="agent" size={12} />
        <span className="wp-filter-lbl">{label}</span>
        <_WPV_Icon name="chev" size={10} />
      </button>
      {open && (
        <div ref={popRef} className="wp-filter-pop" role="menu" aria-label={OMP_TR("Filter by person")} style={place}
          onKeyDown={e => window.menuKeyNav(e, popRef.current, '[role="menuitem"]', () => close(true))}>
          <button type="button" role="menuitem" className={`wp-pop-item${!value ? " on" : ""}`}
            onClick={() => { close(false); onChange(""); }}>
            <span className="wp-pop-label">{OMP_TR("Everyone")}</span>
            <span className="wp-pop-meta">{items.length}</span>
          </button>
          {kind === "issues" && unassigned > 0 && (
            <button type="button" role="menuitem" className={`wp-pop-item${value === "__none__" ? " on" : ""}`}
              onClick={() => { close(false); onChange("__none__"); }}>
              <span className="wp-pop-label">{OMP_TR("Unassigned")}</span>
              <span className="wp-pop-meta">{unassigned}</span>
            </button>
          )}
          <div className="wp-pop-sep" />
          {people.map(([name, n]) => (
            <button key={name} type="button" role="menuitem" className={`wp-pop-item${value === name ? " on" : ""}`}
              onClick={() => { close(false); onChange(value === name ? "" : name); }}>
              <span className="wp-avatar" aria-hidden="true">{name.slice(0, 2)}</span>
              <span className="wp-pop-label">{name}</span>
              <span className="wp-pop-meta">{n}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function _WP_LabelFilter({ items, columns, kind, value, onChange }) {
  const { place, open, triggerRef, popRef, close, toggle } = _wpUsePopover(240);
  if (kind !== "issues") return null;

  const colSet = new Set(columns);
  const counts = new Map();
  for (const it of items) {
    for (const l of it.labels ?? []) {
      if (!colSet.has(l)) counts.set(l, (counts.get(l) ?? 0) + 1);
    }
  }
  const labels = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (labels.length === 0) return null;

  return (
    <>
      <button ref={triggerRef} type="button" className={`wp-filter-btn${value ? " on" : ""}`}
        aria-haspopup="menu" aria-expanded={open} title={OMP_TR("Filter by label")} onClick={toggle}>
        <_WPV_Icon name="tag" size={12} />
        <span className="wp-filter-lbl">{value || OMP_TR("Label")}</span>
        <_WPV_Icon name="chev" size={10} />
      </button>
      {open && (
        <div ref={popRef} className="wp-filter-pop" role="menu" aria-label={OMP_TR("Filter by label")} style={place}
          onKeyDown={e => window.menuKeyNav(e, popRef.current, '[role="menuitem"]', () => close(true))}>
          <button type="button" role="menuitem" className={`wp-pop-item${!value ? " on" : ""}`}
            onClick={() => { close(false); onChange(""); }}>
            <span className="wp-pop-label">{OMP_TR("All labels")}</span>
            <span className="wp-pop-meta">{items.length}</span>
          </button>
          <div className="wp-pop-sep" />
          {labels.map(([name, n]) => (
            <button key={name} type="button" role="menuitem" className={`wp-pop-item${value === name ? " on" : ""}`}
              onClick={() => { close(false); onChange(value === name ? "" : name); }}>
              <span className="wp-pop-label">{name}</span>
              <span className="wp-pop-meta">{n}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

Object.assign(window, { _WP_Key, _WP_Assignee, _WP_ViewMenu, _WP_AssigneeFilter, _WP_LabelFilter, _wpKindIcon, _wpUseDialog });
