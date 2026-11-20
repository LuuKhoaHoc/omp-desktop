use super::cli::{self, TempBody};
use super::PrInfo;
use std::path::{Path, PathBuf};

pub(super) fn github_pr(
    dirs: &[PathBuf],
    work_dir: &Path,
    branch: &str,
    repository: &str,
    title: &str,
    body: &str,
    draft: bool,
) -> Result<PrInfo, String> {
    let gh = crate::child_path::locate_program(dirs, "gh")?;
    let mut lookup = cli::cli(&gh, work_dir);
    lookup.args([
        "pr",
        "list",
        "--repo",
        repository,
        "--head",
        branch,
        "--state",
        "open",
        "--json",
        "number,url,state",
    ]);
    let listed = cli::run(&mut lookup, "gh", None)?;
    let pulls: serde_json::Value = serde_json::from_slice(&listed)
        .map_err(|_| "GitHub returned malformed pull-request JSON".to_string())?;
    if let Some(first) = pulls.as_array().and_then(|array| array.first()) {
        return Ok(PrInfo {
            number: first
                .get("number")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0),
            url: first
                .get("url")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            existing: true,
        });
    }
    let mut create = cli::cli(&gh, work_dir);
    create.args([
        "pr",
        "create",
        "--repo",
        repository,
        "--head",
        branch,
        "--title",
        title,
        "--body-file",
        "-",
    ]);
    if draft {
        create.arg("--draft");
    }
    let stdout = cli::run(&mut create, "gh", Some(body.as_bytes()))?;
    let url = String::from_utf8_lossy(&stdout).trim().to_owned();
    let number = url
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .and_then(|n| n.parse().ok())
        .unwrap_or(0);
    Ok(PrInfo {
        number,
        url,
        existing: false,
    })
}

pub(super) fn gitlab_pr(
    dirs: &[PathBuf],
    work_dir: &Path,
    branch: &str,
    title: &str,
    body: &str,
    draft: bool,
) -> Result<PrInfo, String> {
    let glab = crate::child_path::locate_program(dirs, "glab")?;
    let mut lookup = cli::cli(&glab, work_dir);
    lookup.args(["mr", "list", "--source-branch", branch, "--output", "json"]);
    let output = cli::run(&mut lookup, "glab", None)?;
    let listed: serde_json::Value = serde_json::from_slice(&output)
        .map_err(|_| "GitLab returned malformed merge-request JSON".to_string())?;
    if let Some(first) = listed.as_array().and_then(|a| a.first()) {
        return Ok(PrInfo {
            number: first
                .get("iid")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0),
            url: first
                .get("web_url")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            existing: true,
        });
    }
    let file = TempBody::new(body)?;
    let mut create = cli::cli(&glab, work_dir);
    create
        .args([
            "mr",
            "create",
            "--source-branch",
            branch,
            "--title",
            title,
            "--description-file",
        ])
        .arg(&file.0)
        .args(["--push=false", "--yes"]);
    if draft {
        create.arg("--draft");
    }
    let stdout = cli::run(&mut create, "glab", None)?;
    let text = String::from_utf8_lossy(&stdout);
    let url = text
        .split_whitespace()
        .find(|part| part.contains("/merge_requests/"))
        .ok_or_else(|| "glab did not return a merge-request URL".to_string())?
        .trim_end_matches('.')
        .to_owned();
    let number = text_after_mr(&url).unwrap_or(0);
    Ok(PrInfo {
        number,
        url,
        existing: false,
    })
}

fn text_after_mr(url: &str) -> Option<u64> {
    url.split("/merge_requests/")
        .nth(1)?
        .split(|c: char| !c.is_ascii_digit())
        .next()?
        .parse()
        .ok()
}

pub(super) fn github_repo(url: &gix::Url) -> Result<(String, String), String> {
    if !url
        .host()
        .is_some_and(|host| host.eq_ignore_ascii_case("github.com"))
        || !matches!(url.scheme, gix::url::Scheme::Https | gix::url::Scheme::Ssh)
        || url
            .port
            .is_some_and(|port| Some(port) != url.scheme.default_port())
    {
        return Err("pull requests need a GitHub or GitLab remote".into());
    }
    let path = std::str::from_utf8(url.path.as_ref())
        .map_err(|_| "GitHub remote path is not UTF-8".to_string())?;
    let path = path.strip_prefix('/').unwrap_or(path);
    let path = path.strip_suffix(".git").unwrap_or(path);
    let mut components = path.split('/');
    let owner = components.next().unwrap_or_default();
    let name = components.next().unwrap_or_default();
    if components.next().is_some()
        || owner.is_empty()
        || name.is_empty()
        || [owner, name].iter().any(|s| {
            !s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
                || *s == "."
                || *s == ".."
        })
    {
        return Err("GitHub remote must identify one owner and repository".into());
    }
    Ok((owner.to_owned(), name.to_owned()))
}
