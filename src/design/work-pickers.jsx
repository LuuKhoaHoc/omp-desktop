/* ═════════════════════════════════════════════════════════════════════
   design/work-pickers.jsx — pickers for the Work panel's view form (fork).
   Choices come from the platform (app/work-views.js loadChoices), so a
   group path, a username, a label or a branch is picked, not remembered;
   free text stays allowed for anything the list does not hold.

   _WPF_Combo: one value (project/group/repo/team, branch).
   _WPF_Multi: an ordered set (team usernames, board columns) as chips.
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

function _WPF_Multi({ values, onChange, choices, placeholder, hint, ordered }) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const [q, setQ] = React.useState("");
  const listRef = React.useRef(null);
  const items = choices.list.filter(o => !values.includes(o.value) && _wpfMatch(o, q)).slice(0, 200);
  window.useActiveRowIntoView(listRef, active, open);
  const add = v => { if (v && !values.includes(v)) onChange([...values, v]); setQ(""); setActive(0); };
  const enter = Object.assign(add, { free: () => q.trim() && add(q.trim()) });
  const drop = v => onChange(values.filter(x => x !== v));
  const shift = (i, d) => { const n = [...values]; [n[i], n[i + d]] = [n[i + d], n[i]]; onChange(n); };
  const nameOf = v => choices.list.find(o => o.value === v)?.label;
  return (
    <div className="wp-pick">
      <div className="wp-chips" onMouseDown={e => { if (e.target === e.currentTarget) { e.preventDefault(); e.currentTarget.querySelector("input")?.focus(); } }}>
        {values.map((v, i) => (
          <span key={v} className="wp-chip" title={nameOf(v) ?? v}>
            {ordered && i > 0 && <button type="button" aria-label={OMP_TR("move {name} left", { name: v })} onClick={() => shift(i, -1)}>‹</button>}
            <span>{v}</span>
            {ordered && i < values.length - 1 && <button type="button" aria-label={OMP_TR("move {name} right", { name: v })} onClick={() => shift(i, 1)}>›</button>}
            <button type="button" aria-label={OMP_TR("remove {name}", { name: v })} onClick={() => drop(v)}>×</button>
          </span>
        ))}
        <input value={q} placeholder={values.length ? OMP_TR("Add…") : placeholder} role="combobox" aria-expanded={open}
          onChange={e => { setQ(e.target.value); setOpen(true); setActive(0); }}
          onKeyDown={e => {
            if (e.key === "Backspace" && !q && values.length) { drop(values[values.length - 1]); return; }
            if (e.key === "," ) { e.preventDefault(); enter.free(); return; }
            _wpfKeys(e, { open, setOpen, items, active, setActive, onEnter: enter });
          }} />
      </div>
      {open && items.length > 0 && <_WPF_Options items={items} active={active} onPick={add} listRef={listRef} />}
      <_WPF_Status choices={choices} empty={hint} />
    </div>
  );
}

Object.assign(window, { _WPF_Combo, _WPF_Multi, _wpfUseChoices });
