/* ═════════════════════════════════════════════════════════════════════
   design/work-pickers.jsx — pickers for the Work panel's view form (fork).
   Choices come from the platform (app/work-views.js loadChoices), so a
   group path, a username, a label or a branch is picked, not remembered;
   free text stays allowed for anything the list does not hold.

   _WPF_Combo: one value (project/group/repo/team, branch).
   _WPF_Multi: a set (team usernames) as chips.
   _WPF_Columns: the board's label columns, an ordered list between the
   fixed Open and Closed rows; a row moves by drag, its buttons or Alt+↑/↓.
   _wpfUseChoices: the choices of one kind for the form's current view,
   loaded after a short pause and cached per connection, scope and place.
   ═════════════════════════════════════════════════════════════════════ */

const _wpfChoiceCache = new Map();

function _wpfUseChoices(kind, target) {
  const key = target ? JSON.stringify([kind, target.id, target.connId, target.platform, target.host, target.scope, target.project]) : null;
  const [state, setState] = React.useState({ list: [], loading: false, error: null });
  React.useEffect(() => {
    if (!key || !window.OMP_WORK_VIEWS.choiceRequests(kind, target)) { setState({ list: [], loading: false, error: null }); return; }
    let live = true;
    const t = setTimeout(() => {
      let p = _wpfChoiceCache.get(key);
      if (!p) { p = window.OMP_WORK_VIEWS.loadChoices(kind, target, window._wpRun); _wpfChoiceCache.set(key, p); }
      setState(s => ({ ...s, loading: true, error: null }));
      p.then(list => live && setState({ list, loading: false, error: null }),
        e => { _wpfChoiceCache.delete(key); if (live) setState({ list: [], loading: false, error: String(e?.message ?? e) }); });
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [key]); // eslint-disable-line
  return state;
}

const _wpfMatch = (o, q) => !q || `${o.value} ${o.label ?? ""}`.toLowerCase().includes(q.toLowerCase());

function _WPF_Options({ items, active, onPick, listRef }) {
  // Opening near the bottom of the form: scroll the form so the list shows.
  React.useEffect(() => { listRef.current?.scrollIntoView({ block: "nearest" }); }, []); // eslint-disable-line
  return (
    <ul className="wp-pick-list" role="listbox" ref={listRef}>
      {items.map((o, i) => (
        <li key={o.value} role="option" aria-selected={i === active} className={i === active ? "on" : ""}
          onMouseDown={e => { e.preventDefault(); onPick(o.value); }}>
          <span className="wp-pick-value">{o.value}</span>
          {(o.label || o.hint) && <span className="wp-pick-label" title={o.label ?? o.hint}>{o.label ?? o.hint}</span>}
        </li>
      ))}
    </ul>
  );
}

function _WPF_Status({ choices, empty }) {
  if (choices.loading) return <small>{OMP_TR("Loading choices…")}</small>;
  if (choices.error) return <small className="danger-text">{OMP_TR("Couldn't load choices, type it instead: {err}", { err: choices.error })}</small>;
  return empty ? <small>{empty}</small> : null;
}

/** Keys shared by both pickers: ↑/↓ move, Enter picks, Escape closes. */
function _wpfKeys(e, { open, setOpen, items, active, setActive, onEnter }) {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault(); setOpen(true);
    const n = items.length; if (!n) return;
    setActive(a => (e.key === "ArrowDown" ? (a + 1) % n : (a - 1 + n) % n));
  } else if (e.key === "Enter") {
    if (open && items[active]) { e.preventDefault(); onEnter(items[active].value); }
    else if (onEnter.free) { e.preventDefault(); onEnter.free(); }
  } else if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
}

function _WPF_Combo({ value, onChange, choices, placeholder, mono, hint }) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const [q, setQ] = React.useState(null); // null: not filtering, show everything
  const listRef = React.useRef(null);
  const items = choices.list.filter(o => _wpfMatch(o, q ?? "")).slice(0, 200);
  window.useActiveRowIntoView(listRef, active, open);
  const pick = v => { onChange(v); setQ(null); setOpen(false); };
  return (
    <div className="wp-pick">
      <input className={mono ? "mono" : ""} value={value} placeholder={placeholder} role="combobox" aria-expanded={open}
        onFocus={() => { setQ(null); setOpen(true); setActive(0); }} onBlur={() => setOpen(false)}
        onChange={e => { onChange(e.target.value.trim()); setQ(e.target.value); setOpen(true); setActive(0); }}
        onKeyDown={e => _wpfKeys(e, { open, setOpen, items, active, setActive, onEnter: pick })} />
      {open && items.length > 0 && <_WPF_Options items={items} active={active} onPick={pick} listRef={listRef} />}
      <_WPF_Status choices={choices} empty={hint} />
    </div>
  );
}

/** Typing into a picker that adds to `values`: the query, the open list of
 *  choices not picked yet, and the keys (Enter or a comma adds free text). */
function _wpfUseAdder(values, onChange, choices) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const [q, setQ] = React.useState("");
  const listRef = React.useRef(null);
  const items = choices.list.filter(o => !values.includes(o.value) && _wpfMatch(o, q)).slice(0, 200);
  window.useActiveRowIntoView(listRef, active, open);
  const add = v => { if (v && !values.includes(v)) onChange([...values, v]); setQ(""); setActive(0); };
  const enter = Object.assign(add, { free: () => q.trim() && add(q.trim()) });
  const onKeyDown = e => {
    if (e.key === ",") { e.preventDefault(); enter.free(); return; }
    _wpfKeys(e, { open, setOpen, items, active, setActive, onEnter: enter });
  };
  const input = {
    value: q, role: "combobox", "aria-expanded": open, onKeyDown,
    onChange: e => { setQ(e.target.value); setOpen(true); setActive(0); },
  };
  const list = open && items.length > 0 && <_WPF_Options items={items} active={active} onPick={add} listRef={listRef} />;
  return { q, setOpen, input, list };
}

function _WPF_Multi({ values, onChange, choices, placeholder, hint }) {
  const adder = _wpfUseAdder(values, onChange, choices);
  const drop = v => onChange(values.filter(x => x !== v));
  const nameOf = v => choices.list.find(o => o.value === v)?.label;
  return (
    <div className="wp-pick">
      <div className="wp-chips"
        onMouseDown={e => { if (e.target === e.currentTarget) { e.preventDefault(); e.currentTarget.querySelector("input")?.focus(); } }}>
        {values.map(v => (
          <span key={v} className="wp-chip" title={nameOf(v) ?? v}>
            <span>{v}</span>
            <button type="button" aria-label={OMP_TR("remove {name}", { name: v })} onClick={() => drop(v)}>×</button>
          </span>
        ))}
        <input {...adder.input} placeholder={values.length ? OMP_TR("Add…") : placeholder}
          onKeyDown={e => {
            if (e.key === "Backspace" && !adder.q && values.length) { drop(values[values.length - 1]); return; }
            adder.input.onKeyDown(e);
          }} />
      </div>
      {adder.list}
      <_WPF_Status choices={choices} empty={hint} />
    </div>
  );
}

function _WPF_Columns({ values, onChange, choices, placeholder }) {
  const W = window.OMP_WORK, V = window.OMP_WORK_VIEWS, D = window.OMP_DRAG_REORDER, Icon = window.Icon;
  const adder = _wpfUseAdder(values, onChange, choices);
  const rootRef = React.useRef(null);
  // After a move or a removal: the row (and the control in it) that takes
  // the focus once the list is drawn again; with no row left, the input.
  const refocus = React.useRef(null);
  React.useLayoutEffect(() => {
    const want = refocus.current;
    if (!want) return;
    refocus.current = null;
    const row = [...rootRef.current.querySelectorAll("[data-col]")].find(el => el.dataset.col === want.col);
    ((want.act && row?.querySelector(`[data-act="${want.act}"]:not(:disabled)`)) || row || rootRef.current.querySelector("input"))?.focus();
  });
  const shift = (v, d, act) => {
    const next = D.shiftList(values, v, d);
    if (!next) return;
    refocus.current = { col: v, act };
    onChange(next);
  };
  const drop = i => {
    refocus.current = { col: values[i + 1] ?? values[i - 1] };
    onChange(values.filter((_, k) => k !== i));
  };
  const canDrag = values.length > 1;
  const reorder = window.useDragReorder((_list, src, target, after) => {
    const next = D.reorderList(values, src, target, after);
    if (next) onChange(next);
  });
  const more = V.columnSuggestion(choices.list, values);
  const fixed = (name, note) => (
    <li className="wp-cols-row fixed">
      <span aria-hidden="true" />
      <span className={`wp-col-dot ${V.columnMeta(name).tone}`} aria-hidden="true" />
      <span className="wp-cols-text"><span className="wp-cols-name">{name}</span><span className="wp-cols-raw">{note}</span></span>
    </li>
  );
  const hint = !values.length ? OMP_TR("Add labels to put columns between Open and Closed.")
    : canDrag ? OMP_TR("Top to bottom here is left to right on the board. A ticket with several of these labels sits in the first. Drag a row, or press Alt+↑ / Alt+↓ on it, to reorder.")
    : null;
  return (
    <div className="wp-cols" ref={rootRef}>
      <ol className="wp-cols-list" data-reorder-scroll="" onPointerDown={canDrag ? reorder.onPointerDown : undefined}>
        {fixed(W.OPEN, OMP_TR("always first"))}
        {values.map((v, i) => {
          const meta = V.columnMeta(v);
          return (
            <li key={v} data-col={v} tabIndex={0} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Delete"
              className={`wp-cols-row${canDrag ? ` movable${reorder.dropClass("cols", v)}` : ""}`}
              {...(canDrag ? reorder.itemProps("cols", v, "y") : {})}
              onKeyDown={e => {
                if (e.target !== e.currentTarget) return;
                if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); shift(v, e.key === "ArrowUp" ? -1 : 1); }
                else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); drop(i); }
              }}>
              <span className={canDrag ? "wp-grip" : ""} aria-hidden="true" />
              <span className={`wp-col-dot ${meta.tone}`} aria-hidden="true" />
              <span className="wp-cols-text">
                <span className="wp-cols-name">{meta.label}</span>
                {meta.label !== v && <span className="wp-cols-raw" title={v}>{v}</span>}
              </span>
              <span className="wp-cols-acts" data-no-reorder="">
                <button type="button" className="btn icon ghost" data-act="up" disabled={i === 0}
                  aria-label={OMP_TR("move {name} up", { name: v })} title={OMP_TR("Move up")} onClick={() => shift(v, -1, "up")}>
                  <Icon name="arrowUp" size={12} /></button>
                <button type="button" className="btn icon ghost wp-flip" data-act="down" disabled={i === values.length - 1}
                  aria-label={OMP_TR("move {name} down", { name: v })} title={OMP_TR("Move down")} onClick={() => shift(v, 1, "down")}>
                  <Icon name="arrowUp" size={12} /></button>
                <button type="button" className="btn icon ghost" aria-label={OMP_TR("remove {name}", { name: v })} title={OMP_TR("Remove")}
                  onClick={() => drop(i)}><Icon name="close" size={11} /></button>
              </span>
            </li>
          );
        })}
        {fixed(W.CLOSED, OMP_TR("always last"))}
      </ol>
      <div className="wp-pick">
        <input {...adder.input} aria-label={OMP_TR("Add a column")} placeholder={values.length ? OMP_TR("Add a column…") : placeholder}
          onFocus={() => adder.setOpen(true)} onBlur={() => adder.setOpen(false)} />
        {adder.list}
      </div>
      {more && (
        <button type="button" className="btn ghost small wp-cols-more" title={more.labels.join(", ")}
          onClick={() => { refocus.current = { col: more.labels[0] }; onChange([...values, ...more.labels]); }}>
          <Icon name="plus" size={11} />
          {OMP_I18N.plural(more.labels.length, "Add {n} “{scope}” label", "Add {n} “{scope}” labels", { scope: more.scope })}
        </button>
      )}
      <_WPF_Status choices={choices} empty={hint} />
    </div>
  );
}

Object.assign(window, { _WPF_Combo, _WPF_Multi, _WPF_Columns, _wpfUseChoices });
