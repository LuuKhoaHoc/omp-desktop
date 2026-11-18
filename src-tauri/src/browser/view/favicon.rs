//! Favicon discovery, fetch through Chromium and validation.
//!
//! A page's icon is fetched through Chromium's network stack via
//! `Network.loadNetworkResource` (so cookies, proxy and auth apply),
//! read via `IO.read`, bounded at 32 KiB and validated by magic bytes.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde_json::json;
use tauri::Url;

use super::checked_url;
use super::core::Core;

/// Maximum allowed favicon size in bytes (32 KiB).
pub const MAX_FAVICON_SIZE: usize = 32 * 1024;
const READ_CHUNK_SIZE: usize = 8192;

/// Sniff the magic bytes and return the verified image MIME type.
/// Accepts only PNG, ICO, JPEG, GIF, and WebP. SVG and HTML are rejected.
pub fn sniff_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("image/png")
    } else if bytes.len() >= 4 && bytes[..4] == [0x00, 0x00, 0x01, 0x00] {
        Some("image/x-icon")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

/// Validate that a discovered icon URL is safe: valid `http:` or `https:`,
/// passes `checked_url`.
pub fn validate_icon_url(raw: &str) -> Option<&str> {
    let checked = checked_url(raw).ok()?;
    let parsed = Url::parse(checked).ok()?;
    if parsed.scheme() == "http" || parsed.scheme() == "https" {
        Some(checked)
    } else {
        None
    }
}

/// Discover and fetch the favicon for the active page session.
/// Returns a `data:<mime>;base64,<payload>` string on success, or `None` on any failure.
pub fn fetch_favicon(core: &Core, session: &str, frame_id: &str) -> Option<String> {
    let eval_res = core
        .call(
            Some(session),
            "Runtime.evaluate",
            json!({
                "expression": "(document.querySelector('link[rel~=\"icon\"]') || {}).href || (location.origin + '/favicon.ico')",
                "returnByValue": true,
            }),
        )
        .ok()?;

    let raw_url = eval_res["result"]["value"].as_str()?;
    let icon_url = validate_icon_url(raw_url)?;

    let load_res = core
        .call(
            Some(session),
            "Network.loadNetworkResource",
            json!({
                "frameId": frame_id,
                "url": icon_url,
                "options": {
                    "disableCache": false,
                    "includeCredentials": false,
                }
            }),
        )
        .ok()?;

    let resource = &load_res["resource"];
    if !resource["success"].as_bool().unwrap_or(false) {
        return None;
    }
    let stream_handle = resource["stream"].as_str()?;

    let mut bytes = Vec::new();
    let mut ok = true;
    loop {
        let Ok(read_res) = core.call(
            Some(session),
            "IO.read",
            json!({
                "handle": stream_handle,
                "size": READ_CHUNK_SIZE,
            }),
        ) else {
            ok = false;
            break;
        };

        let data_str = read_res["data"].as_str().unwrap_or_default();
        let is_base64 = read_res["base64Encoded"].as_bool().unwrap_or(false);
        let chunk = if is_base64 {
            if let Ok(c) = STANDARD.decode(data_str.as_bytes()) {
                c
            } else {
                ok = false;
                break;
            }
        } else {
            data_str.as_bytes().to_vec()
        };

        bytes.extend_from_slice(&chunk);
        if bytes.len() > MAX_FAVICON_SIZE {
            ok = false;
            break;
        }
        if read_res["eof"].as_bool().unwrap_or(false) {
            break;
        }
    }

    let _ = core.call(
        Some(session),
        "IO.close",
        json!({ "handle": stream_handle }),
    );

    if !ok || bytes.is_empty() || bytes.len() > MAX_FAVICON_SIZE {
        return None;
    }

    let mime = sniff_mime(&bytes)?;
    let b64 = STANDARD.encode(&bytes);
    Some(format!("data:{mime};base64,{b64}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sniff_mime_identifies_allowed_formats() {
        assert_eq!(
            sniff_mime(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00]),
            Some("image/png")
        );
        assert_eq!(
            sniff_mime(&[0x00, 0x00, 0x01, 0x00, 0x01, 0x00]),
            Some("image/x-icon")
        );
        assert_eq!(
            sniff_mime(&[0xFF, 0xD8, 0xFF, 0xE0, 0x00]),
            Some("image/jpeg")
        );
        assert_eq!(sniff_mime(b"GIF87a..."), Some("image/gif"));
        assert_eq!(sniff_mime(b"GIF89a..."), Some("image/gif"));
        assert_eq!(sniff_mime(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
    }

    #[test]
    fn sniff_mime_rejects_svg_html_and_arbitrary_data() {
        assert_eq!(
            sniff_mime(b"<svg xmlns=\"http://www.w3.org/2000/svg\">"),
            None
        );
        assert_eq!(sniff_mime(b"<!DOCTYPE html><html>"), None);
        assert_eq!(sniff_mime(b"malicious script or binary"), None);
        assert_eq!(sniff_mime(&[]), None);
    }

    #[test]
    fn validate_icon_url_enforces_http_and_https() {
        assert_eq!(
            validate_icon_url("http://example.com/fav.ico"),
            Some("http://example.com/fav.ico")
        );
        assert_eq!(
            validate_icon_url("https://example.com/icon.png"),
            Some("https://example.com/icon.png")
        );
        assert_eq!(validate_icon_url("javascript:alert(1)"), None);
        assert_eq!(validate_icon_url("data:image/png;base64,123"), None);
        assert_eq!(validate_icon_url("file:///etc/passwd"), None);
        assert_eq!(validate_icon_url("about:blank"), None);
        assert_eq!(validate_icon_url(""), None);
    }
}
