//! Interactive pages in the chat (fork): an agent's ```` ```html ```` or
//! ```` ```svg ```` block runs as a live page inside a chat card.
//!
//! The page cannot run in the app's own origin, which exposes the IPC: the
//! webview hands the page's HTML to [`PageStore::register`] and loads the
//! returned URL in an `<iframe sandbox="allow-scripts">` (no
//! `allow-same-origin`, so the page gets an opaque origin). This module
//! serves it from its own `omp-page:` scheme with a CSP that allows inline
//! script and style and nothing on the network.
//!
//! Why the page cannot reach the app's commands:
//! - Tauri injects its IPC script (with the per-launch invoke key every
//!   command needs) into the main frame only (`for_main_frame_only: true`),
//!   never into a subframe, so the page has no `__TAURI_INTERNALS__` and no key.
//! - The page CSP has `connect-src 'none'`, so it cannot even fetch `ipc://`.
//! - Ids are 128-bit random and never appear in chat text, so nothing can
//!   load a page at the top level, where the custom scheme would count as an
//!   app-local URL (`navigation_guard` only lets this scheme through for that
//!   reason: an unguessable id).
//!
//! The page talks back only through `postMessage` to the chat card, which
//! checks the message's source window and asks the user before anything
//! reaches the agent.
use std::collections::VecDeque;
use std::sync::Mutex;

/// The custom scheme pages are served from.
pub const SCHEME: &str = "omp-page";
/// One page at most (an agent block is far smaller; this caps a runaway).
const PAGE_LIMIT: usize = 2 * 1024 * 1024;
/// All stored pages together; the oldest are dropped past this.
const STORE_LIMIT: usize = 32 * 1024 * 1024;

/// Inline script and style, data/blob images and fonts, nothing else: no
/// network (`connect-src`, no remote `src`), no forms posting anywhere, no
/// nested frames, no `<base>`.
pub const PAGE_CSP: &str = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; frame-src 'none'; base-uri 'none'";

/// The pages registered this run, oldest first.
#[derive(Default)]
pub struct PageStore {
    pages: Mutex<VecDeque<(String, String)>>,
}

impl PageStore {
    /// Stores a page and returns its id.
    ///
    /// # Errors
    /// The page is larger than 2 MB, or no random id could be made.
    pub fn register(&self, html: String) -> Result<String, String> {
        if html.len() > PAGE_LIMIT {
            return Err("page larger than 2 MB".into());
        }
        let id = crate::remote::rand::random_b64(16)?;
        let mut pages = self.pages.lock().map_err(|_| "page store poisoned")?;
        pages.push_back((id.clone(), html)); // the id is also returned to the webview
        let mut total: usize = pages.iter().map(|(_, h)| h.len()).sum();
        while total > STORE_LIMIT && pages.len() > 1 {
            if let Some((_, h)) = pages.pop_front() {
                total -= h.len();
            }
        }
        Ok(id)
    }

    /// The page with this id, if still stored.
    pub fn get(&self, id: &str) -> Option<String> {
        let pages = self.pages.lock().ok()?;
        pages.iter().find(|(k, _)| k == id).map(|(_, h)| h.clone()) // served bytes
    }
}

/// Status, content type and body for a request path (`/<id>`).
pub fn respond(store: &PageStore, path: &str) -> (u16, &'static str, Vec<u8>) {
    let id = path.trim_start_matches('/');
    store.get(id).map_or_else(
        || (404, "text/plain; charset=utf-8", b"page expired".to_vec()),
        |html| (200, "text/html; charset=utf-8", html.into_bytes()),
    )
}

/// The protocol handler: serves a stored page with [`PAGE_CSP`].
pub fn handle(
    store: &PageStore,
    request: &tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let (status, kind, body) = respond(store, request.uri().path());
    tauri::http::Response::builder()
        .status(status)
        .header("Content-Type", kind)
        .header("Content-Security-Policy", PAGE_CSP)
        .header("X-Content-Type-Options", "nosniff")
        .header("Referrer-Policy", "no-referrer")
        .header("Cache-Control", "no-store")
        .body(body)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serves_a_registered_page_and_404s_anything_else() {
        let store = PageStore::default();
        let id = store.register("<b>hi</b>".into()).unwrap();
        assert_eq!(id.len(), 22, "128-bit id");
        assert_ne!(id, store.register("<b>hi</b>".into()).unwrap());
        let (status, kind, body) = respond(&store, &format!("/{id}"));
        assert_eq!(
            (status, kind, body.as_slice()),
            (200, "text/html; charset=utf-8", &b"<b>hi</b>"[..])
        );
        assert_eq!(respond(&store, "/nope").0, 404);
        assert_eq!(respond(&store, "/").0, 404);
    }

    #[test]
    fn refuses_a_huge_page_and_drops_the_oldest_past_the_store_limit() {
        let store = PageStore::default();
        assert!(store.register("x".repeat(PAGE_LIMIT + 1)).is_err());
        let first = store.register("a".repeat(PAGE_LIMIT)).unwrap();
        let ids: Vec<_> = (0..16)
            .map(|_| store.register("b".repeat(PAGE_LIMIT)).unwrap())
            .collect();
        assert!(store.get(&first).is_none(), "oldest dropped");
        assert!(store.get(ids.last().unwrap()).is_some());
    }

    #[test]
    fn the_page_csp_allows_inline_code_and_no_network() {
        for d in [
            "connect-src 'none'",
            "default-src 'none'",
            "form-action 'none'",
            "frame-src 'none'",
            "base-uri 'none'",
        ] {
            assert!(PAGE_CSP.contains(d), "{d}");
        }
        assert!(!PAGE_CSP.contains("http"), "no remote source");
    }
}
