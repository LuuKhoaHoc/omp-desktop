//! What the panel's context menu can act on at a point of the shown page:
//! the link under it, whether text is selected, whether the point is in an
//! editable field. One `Runtime.evaluate` per right click.
//!
//! The answer comes from the page's own world and is not trusted: the link
//! is kept only as a bounded http(s) URL, the rest are booleans.

use serde::Serialize;
use serde_json::{json, Value};

use super::View;

const MAX_LINK: usize = 8192;

/// Walks up from the element under `(X, Y)`, through open shadow roots, to
/// the first link; `editable` is a text field or editable content there.
const SCRIPT: &str = r#"((X, Y) => {
  let e = document.elementFromPoint(X, Y);
  for (let inner; e && e.shadowRoot && (inner = e.shadowRoot.elementFromPoint(X, Y)) && inner !== e;) e = inner;
  let link = null;
  for (let n = e; n && !link; n = n.parentNode || n.host) {
    if (n.nodeType === 1 && n.matches("a[href], area[href]")) link = n.href;
  }
  const field = e && (e.tagName === "TEXTAREA" || (e.tagName === "INPUT" && typeof e.selectionStart === "number"));
  const a = document.activeElement;
  let picked = String(getSelection() || "").length > 0;
  try { if (a && typeof a.selectionStart === "number") picked = picked || a.selectionEnd > a.selectionStart; } catch {}
  return { link: typeof link === "string" ? link : null, selection: picked, editable: Boolean(e && (field || e.isContentEditable)) };
})"#;

/// What is at a point of the shown page.
#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct PageContext {
    pub link: Option<String>,
    pub selection: bool,
    pub editable: bool,
}

fn expression(x: f64, y: f64) -> Result<String, String> {
    if !x.is_finite() || !y.is_finite() {
        return Err("invalid point".into());
    }
    Ok(format!("{SCRIPT}({x}, {y})"))
}

/// The page's answer, bounded: a link only when it is a web URL.
fn parse(value: &Value) -> PageContext {
    let link = value["link"].as_str().filter(|url| {
        url.len() <= MAX_LINK && (url.starts_with("http://") || url.starts_with("https://"))
    });
    PageContext {
        link: link.map(str::to_owned),
        selection: value["selection"] == true,
        editable: value["editable"] == true,
    }
}

impl View {
    /// What the shown page has at `(x, y)` (page CSS pixels).
    pub fn context_at(&self, x: f64, y: f64) -> Result<PageContext, String> {
        let result = self.core.call_active(
            "Runtime.evaluate",
            json!({ "expression": expression(x, y)?, "returnByValue": true }),
        )?;
        Ok(parse(&result["result"]["value"]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_web_links_and_booleans_pass() {
        assert_eq!(
            parse(&json!({ "link": "https://a.test/x", "selection": true, "editable": false })),
            PageContext {
                link: Some("https://a.test/x".into()),
                selection: true,
                editable: false
            }
        );
        let nothing = PageContext {
            link: None,
            selection: false,
            editable: false,
        };
        for other in [
            json!({ "link": "javascript:alert(1)", "selection": "yes", "editable": 1 }),
            json!({ "link": format!("https://a.test/{}", "x".repeat(MAX_LINK)) }),
            json!({ "link": 3 }),
            json!("text"),
            Value::Null,
        ] {
            assert_eq!(parse(&other), nothing, "{other}");
        }
    }

    #[test]
    fn the_point_is_numbers_only() {
        let script = expression(12.5, -3.0).unwrap();
        assert!(script.ends_with("})(12.5, -3)"), "{script}");
        assert!(expression(f64::NAN, 0.0).is_err());
    }
}
