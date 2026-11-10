//! Fork additions: the Work panel's transports and the font picker's list.
//!
//! * [`cli`]: one `glab api …` / `gh api …` call. Only those two programs and
//!   only their `api` subcommand run, with no shell; the CLI keeps its own
//!   login, so no token crosses into the app.
//! * [`http`]: one HTTPS request for an API-token connection (Linear, a
//!   GitLab/GitHub token). The webview names the *environment variable* that
//!   holds the token; Rust reads it and builds the header, so the secret never
//!   reaches JavaScript, the config file or a log.
//! * [`fonts`]: installed font families, each flagged when it lacks the
//!   Vietnamese letters the UI needs.

use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::child_path::{child_path_dirs, locate_program};
use crate::child_run::{collect, WaitError};
use crate::supervisor::ProcessSupervisor;

const OUTPUT_LIMIT: usize = 4 * 1024 * 1024;
const ERROR_LIMIT: usize = 16 * 1024;
const TIMEOUT: Duration = Duration::from_secs(30);

/// Check the request shape before anything runs (trust boundary: the webview).
pub fn check_cli(tool: &str, args: &[String]) -> Result<(), String> {
    if tool != "glab" && tool != "gh" {
        return Err(format!("unsupported CLI \"{tool}\" (only glab and gh)"));
    }
    if args.first().map(String::as_str) != Some("api") {
        return Err("only the `api` subcommand may run".into());
    }
    Ok(())
}

pub fn cli(tool: &str, args: &[String], stdin: Option<String>) -> Result<String, String> {
    check_cli(tool, args)?;
    let program = locate_program(&child_path_dirs(), tool).map_err(|_| {
        format!("{tool} not found on PATH. Install it and sign in ({tool} auth login).")
    })?;
    let mut cmd = Command::new(&program.binary);
    cmd.env("PATH", &program.path)
        .env("NO_COLOR", "1")
        .env("GLAB_NO_PROMPT", "1")
        .env("GH_PROMPT_DISABLED", "1")
        .args(args)
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    ProcessSupervisor::prepare(&mut cmd);
    let mut child =
        crate::spawn_gate::spawn(&mut cmd).map_err(|e| format!("could not start {tool}: {e}"))?;
    let supervisor = ProcessSupervisor::attach(&child);
    let done = collect(
        &mut child,
        &supervisor,
        OUTPUT_LIMIT,
        ERROR_LIMIT,
        Instant::now() + TIMEOUT,
        |c| {
            if let (Some(body), Some(mut pipe)) = (stdin, c.stdin.take()) {
                use std::io::Write;
                pipe.write_all(body.as_bytes())
                    .map_err(|e| format!("stdin: {e}"))?;
            }
            Ok(())
        },
    )
    .map_err(|e| match e {
        WaitError::Overflow => format!("{tool} output exceeded its size limit"),
        WaitError::TimedOut => format!("{tool} request timed out"),
        WaitError::Failed(e) => format!("{tool}: {e}"),
    })?;
    let out = String::from_utf8_lossy(&done.stdout).into_owned();
    if !done.status.success() {
        let err =
            crate::widgets::redact::redact_secrets(String::from_utf8_lossy(&done.stderr).trim())
                .into_owned();
        // `api` prints the error body on stdout; keep whichever says something.
        let msg = if err.is_empty() {
            out.trim().to_string()
        } else {
            err
        };
        return Err(format!(
            "{tool} failed: {}",
            crate::text::prefix_within(&msg, 1024)
        ));
    }
    Ok(out)
}

pub fn check_http(url: &str, method: &str, auth: &str, token_env: &str) -> Result<(), String> {
    let local = url.starts_with("http://127.0.0.1") || url.starts_with("http://localhost");
    if !url.starts_with("https://") && !local {
        return Err("API URL must be https:// (or http://localhost)".into());
    }
    if !matches!(method, "GET" | "POST" | "PUT" | "PATCH") {
        return Err(format!("method {method} not allowed"));
    }
    if !matches!(auth, "bearer" | "private-token" | "plain") {
        return Err(format!("unknown auth style {auth}"));
    }
    let valid = !token_env.is_empty()
        && token_env
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
        && !token_env.starts_with(|c: char| c.is_ascii_digit());
    if !valid {
        return Err("token variable must look like MY_TOKEN".into());
    }
    Ok(())
}

pub fn http(
    url: &str,
    method: &str,
    auth: &str,
    token_env: &str,
    body: Option<String>,
) -> Result<String, String> {
    check_http(url, method, auth, token_env)?;
    let token = std::env::var(token_env)
        .ok()
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| format!("{token_env} is not set in the app's environment"))?;
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::blocking::Client::builder()
        .timeout(TIMEOUT)
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    let m = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut req = client
        .request(m, url)
        .header("Accept", "application/json")
        .header("User-Agent", "omp-desktop-work");
    req = match auth {
        "bearer" => req.header("Authorization", format!("Bearer {token}")),
        "private-token" => req.header("PRIVATE-TOKEN", token),
        _ => req.header("Authorization", token),
    };
    if let Some(b) = body {
        req = req.header("Content-Type", "application/json").body(b);
    }
    let resp = req
        .send()
        .map_err(|e| format!("request failed: {}", e.without_url()))?;
    let status = resp.status();
    let text = resp.text().map_err(|e| format!("read body: {e}"))?;
    if !status.is_success() {
        return Err(format!(
            "HTTP {}: {}",
            status.as_u16(),
            crate::text::prefix_within(&text, 600)
        ));
    }
    Ok(text)
}

#[derive(Debug, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct FontFamily {
    pub family: String,
    pub monospace: bool,
    /// Has every letter in [`VI_PROBE`].
    pub vietnamese: bool,
}

/// Letters a Latin-only font usually misses (stacked tone marks, đ, ơ/ư).
pub const VI_PROBE: &str = "ắằẳẵặấầẩẫậđơượựỡữễ";

pub fn fonts() -> Vec<FontFamily> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    let mut out: std::collections::BTreeMap<String, FontFamily> = std::collections::BTreeMap::new();
    for face in db.faces() {
        let Some((family, _)) = face.families.first() else {
            continue;
        };
        if family.starts_with('.') || out.contains_key(family) {
            continue;
        }
        let vietnamese = db
            .with_face_data(face.id, |data, index| {
                ttf_parser::Face::parse(data, index)
                    .is_ok_and(|f| VI_PROBE.chars().all(|c| f.glyph_index(c).is_some()))
            })
            .unwrap_or(false);
        out.insert(
            family.clone(),
            FontFamily {
                family: family.clone(),
                monospace: face.monospaced,
                vietnamese,
            },
        );
    }
    out.into_values().collect()
}

const INSIGHT_FILE_LIMIT: u64 = 2 * 1024 * 1024;
const INSIGHT_DIAGRAM_LIMIT: usize = 60;

fn read_json(path: &std::path::Path) -> Option<serde_json::Value> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > INSIGHT_FILE_LIMIT {
        return None;
    }
    let text = std::fs::read_to_string(path).ok()?;
    Some(
        serde_json::from_str(&text)
            .unwrap_or_else(|e| serde_json::json!({ "error": format!("{}: {e}", path.display()) })),
    )
}

/// The kind of a diagram file, by extension: the format each diagram skill
/// writes (Mermaid, an SVG or PNG export, an HTML page, an Excalidraw scene).
fn diagram_kind(path: &std::path::Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "mmd" | "mermaid" => "mermaid",
        "svg" => "svg",
        "png" => "png",
        "html" | "htm" => "html",
        "excalidraw" => "excalidraw",
        _ => return None,
    })
}

/// `diagrams/*`: every file of a known kind, sorted, at most 60, 2 MB each.
/// Text kinds come as `source`, a PNG as base64 `data`; an unreadable or
/// oversized file is an `error` entry, so the panel can say why it is missing.
fn diagrams(dir: &std::path::Path) -> Vec<serde_json::Value> {
    use base64::Engine;
    let Ok(rd) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<_> = rd
        .flatten()
        .map(|e| e.path())
        .filter_map(|p| Some((diagram_kind(&p)?, p)))
        .collect();
    files.sort_by(|a, b| a.1.cmp(&b.1));
    files
        .into_iter()
        .take(INSIGHT_DIAGRAM_LIMIT)
        .filter_map(|(kind, p)| {
            let meta = std::fs::metadata(&p).ok()?;
            if !meta.is_file() {
                return None;
            }
            let file = p.file_name()?.to_string_lossy().into_owned();
            if meta.len() > INSIGHT_FILE_LIMIT {
                return Some(
                    serde_json::json!({ "file": file, "kind": kind, "error": "larger than 2 MB" }),
                );
            }
            let entry = if kind == "png" {
                std::fs::read(&p).map(|b| {
                    serde_json::json!({ "file": file, "kind": kind,
                    "data": base64::engine::general_purpose::STANDARD.encode(b) })
                })
            } else {
                std::fs::read_to_string(&p).map(
                    |source| serde_json::json!({ "file": file, "kind": kind, "source": source }),
                )
            };
            Some(entry.unwrap_or_else(
                |e| serde_json::json!({ "file": file, "kind": kind, "error": e.to_string() }),
            ))
        })
        .collect()
}

/// One JSON file per document: the single legacy file (`legacy`, at the
/// folder root) first, then `<sub>/*.json` sorted, at most 60. Each entry is
/// `{ file, data }` with `file` relative to the insights folder (what
/// `insights_delete` takes back); bad JSON comes as `data.error`.
fn json_files(dir: &std::path::Path, legacy: &str, sub: &str) -> Vec<serde_json::Value> {
    let mut out: Vec<_> = read_json(&dir.join(legacy))
        .map(|data| serde_json::json!({ "file": legacy, "data": data }))
        .into_iter()
        .collect();
    let mut files: Vec<_> = std::fs::read_dir(dir.join(sub))
        .map(|rd| rd.flatten().map(|e| e.path()).collect())
        .unwrap_or_default();
    files.retain(|p| {
        p.extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("json"))
    });
    files.sort();
    out.extend(
        files
            .into_iter()
            .take(INSIGHT_DIAGRAM_LIMIT)
            .filter_map(|p| {
                let name = p.file_name()?.to_str()?;
                Some(serde_json::json!({ "file": format!("{sub}/{name}"), "data": read_json(&p)? }))
            }),
    );
    out
}

fn insights_dir(project: &str) -> Result<std::path::PathBuf, String> {
    let root = std::path::Path::new(project);
    if !root.is_absolute() || !root.is_dir() {
        return Err("project folder not found".into());
    }
    Ok(root.join(".omp").join("insights"))
}

/// The Insights panel's data: `<project>/.omp/insights/` → documents
/// (`doc-analysis.json`, `docs/*.json`), test case sets (`testcases.json`,
/// `testcases/*.json`) and `diagrams/*` (see `diagrams`). Fixed places only,
/// so the webview cannot read elsewhere. A missing folder is not an error:
/// `exists: false` lets the panel show how to fill it.
pub fn insights(project: &str) -> Result<serde_json::Value, String> {
    let dir = insights_dir(project)?;
    if !dir.is_dir() {
        return Ok(serde_json::json!({ "exists": false, "dir": dir }));
    }
    Ok(serde_json::json!({
        "exists": true,
        "dir": dir,
        "diagrams": diagrams(&dir.join("diagrams")),
        "docs": json_files(&dir, "doc-analysis.json", "docs"),
        "testcases": json_files(&dir, "testcases.json", "testcases"),
    }))
}

/// Deletes one file the panel listed: `doc-analysis.json`, `testcases.json`,
/// `docs/<name>.json`, `testcases/<name>.json` or `diagrams/<name>` of a
/// diagram kind. Anything else (another folder, `..`, a hidden name, a
/// symlink or a directory) is refused, so the webview cannot delete outside.
pub fn insights_delete(project: &str, file: &str) -> Result<(), String> {
    let dir = insights_dir(project)?;
    let ok_name = |n: &str| !n.is_empty() && !n.starts_with('.') && !n.contains(['/', '\\', '\0']);
    let allowed = match file.split_once('/') {
        None => file == "doc-analysis.json" || file == "testcases.json",
        Some(("docs" | "testcases", name)) => {
            ok_name(name)
                && std::path::Path::new(name)
                    .extension()
                    .is_some_and(|e| e.eq_ignore_ascii_case("json"))
        }
        Some(("diagrams", name)) => {
            ok_name(name) && diagram_kind(std::path::Path::new(name)).is_some()
        }
        Some(_) => false,
    };
    if !allowed {
        return Err(format!("refusing to delete {file}"));
    }
    let path = dir.join(file);
    let meta = std::fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err(format!("{file} is not a file"));
    }
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cli_allows_only_glab_and_gh_api() {
        let api = vec!["api".to_string(), "user".to_string()];
        assert!(check_cli("glab", &api).is_ok());
        assert!(check_cli("gh", &api).is_ok());
        assert!(check_cli("bash", &api).is_err());
        assert!(check_cli("gh", &["auth".into(), "token".into()]).is_err());
        assert!(check_cli("gh", &[]).is_err());
    }

    #[test]
    fn http_checks_scheme_method_auth_and_env_name() {
        assert!(check_http(
            "https://api.linear.app/graphql",
            "POST",
            "plain",
            "LINEAR_API_KEY"
        )
        .is_ok());
        assert!(check_http("http://localhost:8080/api", "GET", "bearer", "T").is_ok());
        assert!(check_http("http://example.com", "GET", "bearer", "T").is_err());
        assert!(check_http("https://x", "DELETE", "bearer", "T").is_err());
        assert!(check_http("https://x", "GET", "cookie", "T").is_err());
        assert!(check_http("https://x", "GET", "bearer", "lower").is_err());
        assert!(check_http("https://x", "GET", "bearer", "1TOKEN").is_err());
        assert!(check_http("https://x", "GET", "bearer", "").is_err());
    }

    #[test]
    fn insights_reads_fixed_files_only() {
        let tmp = std::env::temp_dir().join(format!("omp-insights-{}", std::process::id()));
        std::fs::create_dir_all(tmp.join(".omp/insights")).unwrap();
        std::fs::write(tmp.join(".omp/insights/testcases.json"), r#"{"cases":[]}"#).unwrap();
        let dg = tmp.join(".omp/insights/diagrams");
        std::fs::create_dir_all(&dg).unwrap();
        std::fs::write(dg.join("b.mermaid"), "sequenceDiagram\n A->>B: hi").unwrap();
        std::fs::write(dg.join("a.mmd"), "flowchart LR\n A-->B").unwrap();
        std::fs::write(dg.join("c.txt"), "x").unwrap();
        std::fs::write(dg.join("d.PNG"), [137u8, 80, 78, 71]).unwrap();
        std::fs::write(dg.join("e.excalidraw"), r#"{"elements":[]}"#).unwrap();
        std::fs::write(dg.join("f.svg"), vec![b' '; 2 * 1024 * 1024 + 1]).unwrap();
        let v = insights(tmp.to_str().unwrap()).unwrap();
        let d = v["diagrams"].as_array().unwrap();
        let kinds: Vec<_> = d.iter().map(|e| e["kind"].as_str().unwrap()).collect();
        assert_eq!(kinds, ["mermaid", "mermaid", "png", "excalidraw", "svg"]);
        assert_eq!(d[0]["file"], "a.mmd");
        assert_eq!(d[0]["source"], "flowchart LR\n A-->B");
        assert_eq!(d[1]["file"], "b.mermaid");
        assert_eq!(d[2]["data"], "iVBORw==");
        assert_eq!(d[3]["source"], r#"{"elements":[]}"#);
        assert_eq!(d[4]["error"], "larger than 2 MB");
        assert!(d[4]["source"].is_null());
        assert_eq!(v["exists"], true);
        assert!(v["charts"].is_null());
        assert_eq!(v["docs"], serde_json::json!([]));
        assert_eq!(
            v["testcases"],
            serde_json::json!([{ "file": "testcases.json", "data": { "cases": [] } }])
        );
        let ins = tmp.join(".omp/insights");
        std::fs::create_dir_all(ins.join("docs")).unwrap();
        std::fs::write(ins.join("docs/b.json"), r#"{"title":"B"}"#).unwrap();
        std::fs::write(ins.join("docs/a.json"), "{bad").unwrap();
        std::fs::write(ins.join("docs/z.txt"), "x").unwrap();
        std::fs::write(ins.join("doc-analysis.json"), r#"{"title":"Old"}"#).unwrap();
        let docs = insights(tmp.to_str().unwrap()).unwrap()["docs"].clone();
        let files: Vec<_> = docs
            .as_array()
            .unwrap()
            .iter()
            .map(|d| d["file"].as_str().unwrap().to_owned())
            .collect();
        assert_eq!(files, ["doc-analysis.json", "docs/a.json", "docs/b.json"]);
        assert!(docs[1]["data"]["error"].is_string());
        let p = tmp.to_str().unwrap();
        for bad in [
            "docs/../doc-analysis.json",
            "docs/z.txt",
            "../x.json",
            "docs/.h.json",
            "diagrams/c.txt",
            "other/a.json",
            "docs",
            "diagrams/sub/a.mmd",
        ] {
            assert!(insights_delete(p, bad).is_err(), "{bad}");
        }
        assert!(insights_delete(p, "docs/missing.json").is_err());
        insights_delete(p, "docs/b.json").unwrap();
        insights_delete(p, "doc-analysis.json").unwrap();
        insights_delete(p, "diagrams/a.mmd").unwrap();
        assert!(
            !ins.join("docs/b.json").exists()
                && !ins.join("doc-analysis.json").exists()
                && !dg.join("a.mmd").exists()
        );
        assert!(ins.join("docs/z.txt").exists());
        assert_eq!(
            insights("relative/path").unwrap_err(),
            "project folder not found"
        );
        std::fs::remove_dir_all(&tmp).unwrap();
        let empty = std::env::temp_dir();
        assert_eq!(insights(empty.to_str().unwrap()).unwrap()["exists"], false);
    }

    #[test]
    fn font_list_is_sorted_and_unique() {
        let list = fonts();
        assert!(list.windows(2).all(|w| w[0].family < w[1].family));
    }
}
