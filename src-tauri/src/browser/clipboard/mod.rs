//! Copying out of the page: headless Chromium keeps a clipboard of its own,
//! so what the page puts there is reported by `bridge.js` (in the annotate
//! overlay's isolated world) and written to the system clipboard here.
//!
//! The report counts only for the shown page and right after a gesture the
//! panel sent (a key press, a mouse release): the agent's clicks and a
//! page's own timers never reach the user's clipboard. `page.js` runs in
//! the page's world and announces `navigator.clipboard` writes, which fire
//! no copy event; Chromium refuses those in headless mode unless the
//! sanitized-write permission is granted, as a windowed browser grants it
//! to a page the user is acting on.

#[cfg(test)]
mod tests;

use std::time::Duration;

use serde_json::{json, Value};

use super::annotate::WORLD;
use super::lock;
use super::view::Core;

const BRIDGE: &str = include_str!("bridge.js");
const PAGE: &str = include_str!("page.js");
pub(in crate::browser) const BINDING: &str = "__ompClipboard";

/// How long after a panel gesture a copy counts as the user's: a page may
/// fetch what its Copy button copies before it writes it.
const COPY_AFTER_GESTURE: Duration = Duration::from_secs(5);

/// The most text a copy carries to the system clipboard.
const MAX_TEXT: usize = 4 * 1024 * 1024;

/// The text of a binding call, or `None` for one that is empty or too long.
fn copied_text(params: &Value) -> Option<&str> {
    params["payload"]
        .as_str()
        .filter(|text| !text.is_empty() && text.len() <= MAX_TEXT)
}

impl Core {
    /// Report `session`'s copies from now on, in every document it loads.
    /// Sent after the overlay's `Runtime.enable`; not waited for and never
    /// fatal: without it the page works, copying does not.
    pub(in crate::browser) fn install_copy_bridge(&self, session: &str) {
        // Browser-wide, so it is repeated per page session: cheap, and a
        // page opened later needs no bookkeeping.
        self.notify(
            None,
            "Browser.grantPermissions",
            json!({ "permissions": ["clipboardSanitizedWrite"] }),
        );
        self.notify(
            Some(session),
            "Runtime.addBinding",
            json!({ "name": BINDING, "executionContextName": WORLD }),
        );
        for (source, world) in [(BRIDGE, Some(WORLD)), (PAGE, None)] {
            let mut params = json!({ "source": source, "runImmediately": true });
            if let Some(world) = world {
                params["worldName"] = Value::from(world);
            }
            self.notify(
                Some(session),
                "Page.addScriptToEvaluateOnNewDocument",
                params,
            );
        }
    }

    /// The reader thread's share of a copy: checked, then handed to the
    /// emitter, which does not block.
    pub(in crate::browser) fn on_copy(&self, session: Option<&str>, params: &Value) {
        let (Some(session), Some(text)) = (session, copied_text(params)) else {
            return;
        };
        if self.is_closed() || !self.panel_acted_within(COPY_AFTER_GESTURE) {
            return;
        }
        let shown = lock(&self.inner)
            .active
            .as_ref()
            .is_some_and(|a| a.session == session);
        if shown {
            self.emit_copied(text);
        }
    }
}

/// Put `text` on the system clipboard.
pub(in crate::browser) fn write_system(text: &str) -> Result<(), String> {
    let failed = |e: arboard::Error| format!("clipboard: {e}");
    // X11 and Wayland have no clipboard of their own: the owner serves the
    // text for as long as it lives, so the handle is kept for good.
    #[cfg(target_os = "linux")]
    {
        use std::sync::Mutex;
        static KEPT: Mutex<Option<arboard::Clipboard>> = Mutex::new(None);
        let mut kept = lock(&KEPT);
        if kept.is_none() {
            *kept = Some(arboard::Clipboard::new().map_err(failed)?);
        }
        kept.as_mut()
            .map_or(Ok(()), |clipboard| clipboard.set_text(text))
            .map_err(failed)
    }
    #[cfg(not(target_os = "linux"))]
    {
        arboard::Clipboard::new()
            .and_then(|mut clipboard| clipboard.set_text(text))
            .map_err(failed)
    }
}
