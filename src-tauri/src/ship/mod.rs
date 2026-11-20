//! Session-bound building blocks for the commit → push → pull-request workflow.

use serde::Serialize;

pub mod commit;
pub mod pr;
pub mod push;

pub use commit::commit_staged;
pub use pr::create_pr;
// The injected-directory seam is intentionally available to crate tests.
#[allow(unused_imports)]
pub use pr::create_pr_with;
pub use push::{push, remotes};

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    pub sha: String,
    pub message: String,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    pub name: String,
    pub url: String,
    pub provider: String,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushInfo {
    pub branch: String,
    pub remote: String,
    pub upstream: String,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrInfo {
    pub number: u64,
    pub url: String,
    pub existing: bool,
}

pub(super) fn provider_of(url: &gix::Url) -> &'static str {
    if !matches!(url.scheme, gix::url::Scheme::Https | gix::url::Scheme::Ssh)
        || url
            .port
            .is_some_and(|port| Some(port) != url.scheme.default_port())
    {
        return "other";
    }
    match url.host() {
        Some(host) if host.eq_ignore_ascii_case("github.com") => "github",
        Some(host) if host.to_ascii_lowercase().contains("gitlab") => "gitlab",
        _ => "other",
    }
}
