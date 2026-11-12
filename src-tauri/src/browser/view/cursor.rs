//! The mouse cursor the shown page asks for at a point, so the panel's
//! canvas can show a hand over a link and an I-beam over text. The
//! screencast carries no cursor, so the page is asked: one
//! `Runtime.evaluate` per settled pointer position.
//!
//! The answer comes from the page's own world and is not trusted: only a
//! CSS cursor keyword of [`CURSORS`] is passed on, anything else is
//! `default`.

use serde_json::{json, Value};

use super::View;

/// The CSS cursor keywords the panel may show.
const CURSORS: [&str; 35] = [
    "default",
    "pointer",
    "text",
    "vertical-text",
    "crosshair",
    "move",
    "grab",
    "grabbing",
    "help",
    "wait",
    "progress",
    "not-allowed",
    "no-drop",
    "copy",
    "alias",
    "cell",
    "context-menu",
    "all-scroll",
    "zoom-in",
    "zoom-out",
    "col-resize",
    "row-resize",
    "n-resize",
    "s-resize",
    "e-resize",
    "w-resize",
    "ne-resize",
    "nw-resize",
    "se-resize",
    "sw-resize",
    "ew-resize",
    "ns-resize",
    "nesw-resize",
    "nwse-resize",
    "none",
];

/// Reads the computed cursor of the element under `(X, Y)`, through open
/// shadow roots. A `url(...)` cursor falls back to its keyword. `auto` is
/// resolved the way a browser does: an I-beam over editable or selectable
/// text, the arrow elsewhere.
const SCRIPT: &str = r#"(() => {
  let e = document.elementFromPoint(X, Y);
  for (let inner; e && e.shadowRoot && (inner = e.shadowRoot.elementFromPoint(X, Y)) && inner !== e;) e = inner;
  if (!e) return "default";
  const style = getComputedStyle(e);
  const cursor = style.cursor.split(",").pop().trim();
  if (cursor !== "auto") return cursor;
  if (e.isContentEditable) return "text";
  if (style.userSelect === "none") return "default";
  for (const n of e.childNodes) if (n.nodeType === 3 && n.data.trim()) return "text";
  return "default";
})()"#;

fn expression(x: f64, y: f64) -> Result<String, String> {
    if !x.is_finite() || !y.is_finite() {
        return Err("invalid point".into());
    }
    Ok(SCRIPT
        .replace('X', &x.to_string())
        .replace('Y', &y.to_string()))
}

/// The listed keyword `value` names, or `default`.
fn keyword(value: &Value) -> &'static str {
    value
        .as_str()
        .and_then(|name| CURSORS.into_iter().find(|known| *known == name))
        .unwrap_or(CURSORS[0])
}

impl View {
    /// The cursor the shown page wants at `(x, y)` (page CSS pixels).
    pub fn cursor_at(&self, x: f64, y: f64) -> Result<&'static str, String> {
        let result = self.core.call_active(
            "Runtime.evaluate",
            json!({ "expression": expression(x, y)?, "returnByValue": true }),
        )?;
        Ok(keyword(&result["result"]["value"]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_listed_keywords_pass() {
        assert_eq!(keyword(&json!("pointer")), "pointer");
        assert_eq!(keyword(&json!("nwse-resize")), "nwse-resize");
        for other in [
            json!("auto"),
            json!("url(x), pointer"),
            json!("pointer; color: red"),
            json!(3),
            Value::Null,
        ] {
            assert_eq!(keyword(&other), "default", "{other}");
        }
    }

    #[test]
    fn the_point_is_numbers_only() {
        let script = expression(12.5, -3.0).unwrap();
        assert!(script.contains("elementFromPoint(12.5, -3)"));
        assert!(!script.contains('X') && !script.contains('Y'));
        assert!(expression(f64::NAN, 0.0).is_err());
        assert!(expression(0.0, f64::INFINITY).is_err());
    }
}
