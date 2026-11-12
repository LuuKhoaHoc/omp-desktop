//! The desktop's own look, for Settings → Appearance → "Follow the system
//! theme": the colours of the Omarchy theme in use and fontconfig's
//! monospace family.
//!
//! Omarchy keeps the theme in use under `<config>/omarchy/current/`:
//! `theme.name`, and `theme/colors.toml` with one `key = "#rrggbb"` per
//! line plus `mode = "dark" | "light"`. The webview maps those names to
//! its tokens (`src/app/system-theme.js`); this module only reads them and
//! lets nothing but a hex colour through.

use std::{
    collections::BTreeMap,
    io::Read as _,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

use serde::Serialize;

use crate::child_path::{child_path_dirs, locate_program};
use crate::child_run::collect;
use crate::supervisor::ProcessSupervisor;

/// A theme file is a few hundred bytes; more than this is not one.
const COLORS_LIMIT: u64 = 64 * 1024;
const NAME_LIMIT: usize = 80;
/// `fc-match` answers in milliseconds with one line; the read runs on
/// every window focus, so it never waits long for it.
const FC_MATCH_TIMEOUT: Duration = Duration::from_secs(3);
const FC_MATCH_LIMIT: usize = 4 * 1024;

#[derive(Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SystemTheme {
    /// The Omarchy theme's name; `None` without one (then `colors` is empty).
    name: Option<String>,
    light: bool,
    /// Omarchy's colour names (`background`, `accent`, `red`, ...) to
    /// `#rgb` / `#rrggbb`.
    colors: BTreeMap<String, String>,
    /// What fontconfig resolves `monospace` to, as Omarchy's font menu sets.
    font_mono: Option<String>,
}

/// The system's look as far as this machine has one. Blocking: reads two
/// small files and runs `fc-match`.
pub fn read() -> SystemTheme {
    let mut theme = config_dir()
        .map(|dir| read_omarchy(&dir.join("omarchy").join("current")))
        .unwrap_or_default();
    theme.font_mono = monospace_family();
    theme
}

fn config_dir() -> Option<PathBuf> {
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .filter(|dir| dir.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
}

fn read_omarchy(current: &Path) -> SystemTheme {
    let Some(text) = read_capped(&current.join("theme").join("colors.toml")) else {
        return SystemTheme::default();
    };
    let (light, colors) = parse_colors(&text);
    let name = read_capped(&current.join("theme.name"))
        .map(|name| name.trim().chars().take(NAME_LIMIT).collect::<String>())
        .filter(|name| !name.is_empty());
    SystemTheme {
        name,
        light,
        colors,
        font_mono: None,
    }
}

fn read_capped(path: &Path) -> Option<String> {
    let mut text = String::new();
    std::fs::File::open(path)
        .ok()?
        .take(COLORS_LIMIT)
        .read_to_string(&mut text)
        .ok()?;
    Some(text)
}

/// `(light, colours)` of a `colors.toml`: flat `key = "value"` lines. A
/// line that is not a lowercase name with a hex colour is skipped, so the
/// webview only ever gets values it can put in a style.
fn parse_colors(text: &str) -> (bool, BTreeMap<String, String>) {
    let mut light = false;
    let mut colors = BTreeMap::new();
    for line in text.lines() {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim().trim_matches('"');
        if key == "mode" {
            light = value == "light";
        } else if is_name(key) && is_hex_color(value) {
            colors.insert(key.to_string(), value.to_ascii_lowercase());
        }
    }
    (light, colors)
}

fn is_name(key: &str) -> bool {
    !key.is_empty() && key.len() <= 40 && key.bytes().all(|b| b.is_ascii_lowercase() || b == b'_')
}

fn is_hex_color(value: &str) -> bool {
    value
        .strip_prefix('#')
        .is_some_and(|hex| matches!(hex.len(), 3 | 6) && hex.bytes().all(|b| b.is_ascii_hexdigit()))
}

/// `fc-match monospace`'s first family; `None` where there is no
/// fontconfig (Windows, macOS), it names nothing usable, or it does not
/// answer within [`FC_MATCH_TIMEOUT`].
fn monospace_family() -> Option<String> {
    let program = locate_program(&child_path_dirs(), "fc-match").ok()?;
    let mut cmd = Command::new(&program.binary);
    cmd.env("PATH", &program.path)
        .args(["-f", "%{family}", "monospace"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    ProcessSupervisor::prepare(&mut cmd);
    let deadline = Instant::now() + FC_MATCH_TIMEOUT;
    let mut child = crate::spawn_gate::spawn(&mut cmd).ok()?;
    let supervisor = ProcessSupervisor::attach(&child);
    let done = collect(&mut child, &supervisor, FC_MATCH_LIMIT, 0, deadline, |_| {
        Ok(())
    })
    .ok()?;
    if !done.status.success() {
        return None;
    }
    first_family(&String::from_utf8_lossy(&done.stdout))
}

/// fontconfig lists a family's aliases comma-separated
/// (`JetBrainsMono Nerd Font,JetBrainsMono NF`): the first is its name.
fn first_family(listed: &str) -> Option<String> {
    let family = listed.lines().next()?.split(',').next()?.trim();
    let usable = !family.is_empty()
        && family.len() <= NAME_LIMIT
        && !family
            .chars()
            .any(|c| c.is_control() || matches!(c, '"' | '\\' | ';'));
    usable.then(|| family.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colors_keep_hex_values_and_the_mode() {
        let (light, colors) = parse_colors(
            "mode = \"light\"\n\naccent = \"#7AA2F7\"\nbackground = \"#1a1b26\"\nshort = \"#abc\"\n",
        );
        assert!(light);
        assert_eq!(colors["accent"], "#7aa2f7");
        assert_eq!(colors["background"], "#1a1b26");
        assert_eq!(colors["short"], "#abc");
    }

    #[test]
    fn anything_that_is_not_a_named_hex_colour_is_dropped() {
        let (light, colors) = parse_colors(
            "accent = \"red; background: url(x)\"\nBad-Key = \"#ffffff\"\nlong = \"#1234567\"\n[section]\nplain\n",
        );
        assert!(!light);
        assert_eq!(colors, BTreeMap::new());
    }

    #[test]
    fn a_missing_theme_reads_as_nothing() {
        let dir =
            std::env::temp_dir().join(format!("omp-system-theme-none-{}", std::process::id()));
        assert_eq!(read_omarchy(&dir), SystemTheme::default());
    }

    #[test]
    fn an_omarchy_theme_is_read_from_its_current_folder() {
        let dir = std::env::temp_dir().join(format!("omp-system-theme-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("theme")).unwrap();
        std::fs::write(dir.join("theme.name"), "tokyo-night\n").unwrap();
        std::fs::write(
            dir.join("theme").join("colors.toml"),
            "mode = \"dark\"\naccent = \"#7aa2f7\"\n",
        )
        .unwrap();
        let theme = read_omarchy(&dir);
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(theme.name.as_deref(), Some("tokyo-night"));
        assert!(!theme.light);
        assert_eq!(theme.colors["accent"], "#7aa2f7");
    }

    #[test]
    fn the_first_alias_is_the_family() {
        assert_eq!(
            first_family("JetBrainsMono Nerd Font,JetBrainsMono NF\n").as_deref(),
            Some("JetBrainsMono Nerd Font")
        );
        assert_eq!(
            first_family("Maple Mono NF").as_deref(),
            Some("Maple Mono NF")
        );
        assert_eq!(first_family(""), None);
        assert_eq!(first_family("a\"; x"), None);
    }
}
