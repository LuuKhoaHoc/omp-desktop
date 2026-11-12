# Follow the system theme

Settings → Appearance → "Follow the system theme" (tweak `systemTheme`, on by default). While on, the app's colours come from the Omarchy theme in use and its unpicked font roles from the system.

## Source (`src-tauri/src/system_theme.rs`)

`system_theme` (no arguments) → `{ name, light, colors, fontMono }`:

- Omarchy keeps the theme in use under `<XDG_CONFIG_HOME or ~/.config>/omarchy/current/`: `theme.name`, and `theme/colors.toml` with flat `key = "#rrggbb"` lines plus `mode = "dark" | "light"`. The reader keeps a line only when the key is lowercase letters/underscores and the value a `#rgb`/`#rrggbb` colour, so nothing else can reach a style. No file: `name: null`, `colors: {}`.
- `fontMono`: the first family of `fc-match -f '%{family}' monospace` (what Omarchy's font menu sets through fontconfig), run through `spawn_gate`; `null` without fontconfig.

## Mapping (`src/app/system-theme.js`, `OMP_SYSTEM_THEME`)

- `usable(sys)`: `background`, `foreground` and `accent` are present. Otherwise nothing is applied.
- `baseTheme(sys, picked)`: the theme class that stays. The system palette replaces colours only, so the picked theme keeps its structure (Kiln's tiles, Night's composer); a light palette uses `daylight`, a dark one over a light pick uses `kiln`.
- `tokens(sys)`: Omarchy's names onto the theme tokens of `design/styles.css`: `background` → `--bg-window`, `darker_background` → `--bg-app`, `dark_background` → `--bg-input`, `bright_foreground` → `--fg`, `foreground` → `--fg-2`, `accent` → the four accent tokens (`OMP_ACCENT.accentTokens`), `red/green/yellow/cyan/magenta` → `--rose/--lime/--amber/--cyan/--magenta`, plus syntax and diff colours. Raised surfaces (`--bg-surface/-elevated/-hover/-active`), lines and the dimmer text steps (`--fg-3..5`) are neutral: the background stepped toward white (black when light), and a grey as bright as the text stepped toward the background. Omarchy's `lighter_background`, `selection`, `dark_foreground` and `muted` are terminal colours, and they or a mix with the theme's text colour tint every panel and label with the theme's hue (Tokyo Night's `muted` on its background is also only about 2:1). `--kiln-bubble` replaces Kiln's accent-tinted user bubble (`layout/kiln.css` falls back to the tint without it) for the same reason.
- `fonts(sys, tweaks)`: a role with no picked family follows the system: the interface `system-ui` (WebKitGTK resolves it from the desktop's font setting), code `fontMono`. A family picked under Fonts wins.

## Applying (`app/use-bridge-snapshot.jsx`)

`useSystemTheme(bridge, enabled)` reads at mount and on every window `focus` (switching the theme in Omarchy's menu takes the focus and returns it), keeps the last read in `localStorage` (`omp-desktop:system-theme`) so a start paints it at once, and keeps the same object when a re-read changes nothing. `useThemeEffect(t, sys)` clears the previous palette's inline tokens, sets the base theme class, then the palette on `<html>`; the `accent` tweak is not applied while a palette is.

Limits: no file watcher (a change shows on the next focus); only Omarchy's `colors.toml` is a colour source; surfaces that copy token values once (an open terminal's xterm theme) keep them until they are rebuilt.

Tests: `tests/test-system-theme.mjs`, `system_theme.rs` unit tests.
