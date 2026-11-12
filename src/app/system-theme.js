// "Follow the system theme" (Settings → Appearance): Rust's `system_theme`
// (the Omarchy theme in use: its colours by Omarchy's names, light or
// dark, and fontconfig's monospace family) as this app's CSS tokens.
//
//   usable(sys)            the theme has the colours a palette needs
//   baseTheme(sys, picked) the theme class whose structure stays in use
//   tokens(sys)            { "--bg-window": "#…", … }, null when not usable
//   fonts(sys, tweaks)     { "--font-sans": …, "--font-mono": … } for the
//                          roles the user left unpicked
//
// Exposes `window.OMP_SYSTEM_THEME`; an IIFE (AGENTS.md "IIFE rule").
// app/use-bridge-snapshot.jsx (useThemeEffect) calls it at effect time and
// reads window.OMP_ACCENT then too.
(function () {
  const LIGHT_THEME = "daylight";
  const DARK_THEMES = ["kiln", "night", "aurora", "phosphor"];

  const rgb = hex => {
    const h = hex.length === 4 ? [...hex.slice(1)].map(c => c + c).join("") : hex.slice(1);
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  };
  const hex = parts => `#${parts.map(v => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
  /** `a` with `share` (0..1) of `b` mixed in. */
  const mix = (a, b, share) => {
    const x = rgb(a), y = rgb(b);
    return hex(x.map((v, i) => v + (y[i] - v) * share));
  };
  const alpha = (color, a) => `rgba(${rgb(color).join(", ")}, ${a})`;

  function usable(sys) {
    const c = sys?.colors;
    return !!(c && c.background && c.foreground && c.accent);
  }

  /** The system colours only replace a theme's palette, so the picked
   *  theme's structure stays unless its tone is the wrong one. */
  function baseTheme(sys, picked) {
    if (!usable(sys)) return picked;
    if (sys.light) return LIGHT_THEME;
    return DARK_THEMES.includes(picked) ? picked : DARK_THEMES[0];
  }

  function tokens(sys) {
    if (!usable(sys)) return null;
    const c = sys.colors;
    const bg = c.background, fg = c.foreground;
    // Away from the background: darker in a dark theme, a step toward the
    // text in a light one.
    const edge = sys.light ? fg : "#000000";
    const deep = c.dark_background ?? mix(bg, edge, sys.light ? 0.04 : 0.25);
    const tone = sys.light ? "#000000" : "#ffffff";
    const level = rgb(fg).reduce((sum, v) => sum + v, 0) / 3;
    const grey = hex([level, level, level]);
    const accent = c.accent;
    const red = c.red ?? accent, green = c.green ?? accent, yellow = c.yellow ?? accent;
    const cyan = c.cyan ?? accent, magenta = c.magenta ?? accent, blue = c.blue ?? accent;
    return {
      "--bg-app": c.darker_background ?? mix(deep, edge, sys.light ? 0.04 : 0.25),
      "--bg-window": bg,
      // Raised surfaces, lines and the dimmer text steps are neutral: the
      // background stepped toward white (black in a light theme), and a
      // grey as bright as the text stepped toward the background. Mixing
      // with the theme's own text colour, or using Omarchy's terminal
      // colours (`lighter_background`, `selection`, `dark_foreground`,
      // `muted`), tints every panel and label with the theme's hue.
      "--bg-surface": mix(bg, tone, 0.03),
      "--bg-elevated": mix(bg, tone, 0.055),
      "--bg-input": deep,
      "--bg-hover": mix(bg, tone, 0.07),
      "--bg-active": mix(bg, tone, 0.1),
      "--kiln-inset": deep,
      // Kiln tints the user's bubble with the accent; over a system
      // palette that is one more slab of its hue.
      "--kiln-bubble": mix(bg, tone, 0.055),

      "--line": mix(bg, tone, 0.09),
      "--line-soft": mix(bg, tone, 0.055),
      "--line-bright": mix(bg, tone, 0.16),

      "--fg": c.bright_foreground ?? fg,
      "--fg-2": fg,
      "--fg-3": mix(grey, bg, 0.25),
      "--fg-4": mix(grey, bg, 0.38),
      "--fg-5": mix(grey, bg, 0.46),

      ...window.OMP_ACCENT.accentTokens(accent),

      "--magenta": magenta,
      "--cyan": cyan,
      "--amber": yellow,
      "--lilac": c.bright_magenta ?? magenta,
      "--rose": red,
      "--lime": green,

      "--syntax-comment": c.dark_foreground ?? mix(fg, bg, 0.5),
      "--syntax-key": magenta,
      "--syntax-str": green,
      "--syntax-num": c.orange ?? yellow,
      "--syntax-fn": blue,
      "--syntax-tag": red,

      "--diff-add-bg": alpha(green, 0.1),
      "--diff-add-fg": green,
      "--diff-rm-bg": alpha(red, 0.08),
      "--diff-rm-fg": red,
    };
  }

  /** Font roles the user has not picked, while a system theme is in use:
   *  the interface takes the desktop's own font (`system-ui`), code
   *  fontconfig's monospace. A picked family (tweaks `fontUi`, `fontMono`)
   *  wins, so its role is left out. Without a usable theme nothing moves. */
  function fonts(sys, tweaks) {
    const out = {};
    if (!usable(sys)) return out;
    if (!tweaks.fontUi) {
      out["--font-sans"] = "system-ui, sans-serif";
      out["--font-display"] = "system-ui, sans-serif";
    }
    if (!tweaks.fontMono && sys.fontMono) out["--font-mono"] = `"${sys.fontMono}", ui-monospace, monospace`;
    return out;
  }

  /** True when two reads are the same look, so a refocus changes nothing. */
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  window.OMP_SYSTEM_THEME = { usable, baseTheme, tokens, fonts, same };
})();
