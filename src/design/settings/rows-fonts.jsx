/* ═════════════════════════════════════════════════════════════════════
   design/settings/rows-fonts.jsx — Settings → Appearance → Font (fork).
   Three pickers (UI, chat, code) over the fonts installed on this machine
   (Rust `list_fonts`, src-tauri/src/work.rs), each family flagged when it
   lacks Vietnamese letters. "" = the theme's own font. The choice lands in
   the tweaks fontUi / fontChat / fontMono, applied as CSS variables by
   app/use-bridge-snapshot.jsx (`useThemeEffect`).
   ═════════════════════════════════════════════════════════════════════ */

let _SRF_cache = null;
/** Installed families, fetched once per window. Outside Tauri: []. */
function _SRF_load() {
  if (!_SRF_cache) {
    _SRF_cache = window.__TAURI__
      ? window.__TAURI__.core.invoke("list_fonts").catch(() => [])
      : Promise.resolve([]);
  }
  return _SRF_cache;
}

const _SRF_ROLES = [
  { key: "fontUi", label: "Interface", desc: "Menus, tabs, sidebar, settings.", mono: false },
  { key: "fontChat", label: "Chat", desc: "Your messages and the agent's replies.", mono: false },
  { key: "fontMono", label: "Code and numbers", desc: "Code, diffs, paths, the terminal, rail numbers.", mono: true },
];

function _SRF_Picker({ role, value, fonts, onChange }) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const ref = React.useRef(null);
  window.usePopoverDismiss?.(open, ref, () => setOpen(false));
  const pick = (f) => { onChange(f); setOpen(false); setQ(""); };
  const shown = fonts
    .filter((f) => !q || f.family.toLowerCase().includes(q.toLowerCase()))
    // Monospace families first for the code role, then alphabetical.
    .sort((a, b) => (role.mono ? (b.monospace - a.monospace) : 0) || a.family.localeCompare(b.family))
    .slice(0, 200);
  const current = fonts.find((f) => f.family === value);
  return (
    <div className="font-pick" ref={ref}>
      <button type="button" className="font-pick-btn" aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((o) => !o)} style={value ? { fontFamily: `"${value}"` } : undefined}>
        <span className="font-pick-name">{value || "Theme default"}</span>
        {current && !current.vietnamese && <span className="font-pick-warn">no Vietnamese</span>}
        <window.Icon name="chev" size={12} />
      </button>
      {open && (
        <div className="font-pick-pop" role="listbox" aria-label={`${role.label} font`}>
          <input className="font-pick-q" autoFocus placeholder={`Search ${fonts.length} installed fonts`}
            value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && shown[0]) pick(shown[0].family); }} />
          <button type="button" role="option" aria-selected={!value} className={`font-pick-row${!value ? " on" : ""}`} onClick={() => pick("")}>
            Theme default <span className="font-pick-tag">Inter / JetBrains Mono</span>
          </button>
          {shown.map((f) => (
            <button type="button" role="option" aria-selected={f.family === value} key={f.family}
              className={`font-pick-row${f.family === value ? " on" : ""}`} onClick={() => pick(f.family)}>
              <span style={{ fontFamily: `"${f.family}"` }}>{f.family}</span>
              <span className={`font-pick-tag${f.vietnamese ? "" : " warn"}`}>
                {f.monospace ? "mono · " : ""}{f.vietnamese ? "Vietnamese ✓" : "no Vietnamese"}
              </span>
            </button>
          ))}
          {shown.length === 0 && <div className="font-pick-empty">No installed font matches.</div>}
        </div>
      )}
    </div>
  );
}

function _SRF_Fonts({ row, ctx, query, modified, onReset }) {
  const { SettingsRow: Row } = window;
  const [fonts, setFonts] = React.useState([]);
  React.useEffect(() => { let live = true; _SRF_load().then((f) => live && setFonts(f)); return () => { live = false; }; }, []);
  const { t, setTweak } = ctx;
  return (
    <Row label={row.label} desc={row.desc} query={query} modified={modified} onReset={onReset} stack>
      <div className="font-rows">
        {_SRF_ROLES.map((role) => (
          <div className="font-role" key={role.key}>
            <div>
              <div className="font-role-name">{role.label}</div>
              <div className="font-role-desc">{role.desc}</div>
            </div>
            <_SRF_Picker role={role} value={t[role.key] ?? ""} fonts={fonts} onChange={(v) => setTweak(role.key, v)} />
          </div>
        ))}
        <div className="font-preview">
          <div className="font-preview-chat">Dạy tui lại chương 2: quan hệ hai ngôi, ví dụ R = {"{(1,1), (2,4)}"}.</div>
          <div className="font-preview-mono">src/app/project-nav.js  +16 −2  0,03 s</div>
        </div>
      </div>
    </Row>
  );
}

Object.assign(window.OMP_SETTINGS_ROWS = window.OMP_SETTINGS_ROWS || {}, { fonts: _SRF_Fonts });
