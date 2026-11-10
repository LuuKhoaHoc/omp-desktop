//! Which model each omp role and each subagent uses (Settings → Agent →
//! Models).
//!
//! Two omp settings, both records of `name → "provider/model[:thinking]"`:
//! `modelRoles` (the roles omp's `/model` menu assigns: default, smol, slow,
//! plan, task, …) and `task.agentModelOverrides` (one entry per subagent
//! name). Read and written through omp's own CLI, like `goal_config.rs`:
//! `omp config get <key> --json` / `omp config set <key> '<json object>'`,
//! so omp stays the owner of `config.yml`'s location, format and layering.
//! omp's task tool reloads its settings from disk before every subagent
//! spawn, so a change reaches the next subagent of a running tab.
//!
//! The webview names a record by [`Scope`] only, never by setting key, and
//! one entry at a time: [`set`] is a read-modify-write under one lock, so
//! two quick edits cannot drop each other.
//!
//! `profile` follows `goal_config.rs`: `None` = built-in, `Some(id)` an id
//! that went through `ProfileStore::resolve_owned`.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::{Mutex, PoisonError};

use serde::Serialize;

/// Names the subcommand in `omp_cli::run`'s failure messages.
const OMP_CONFIG: &str = "omp config";

/// Longest role / agent name and model selector accepted from the webview.
const NAME_MAX_BYTES: usize = 128;
const VALUE_MAX_BYTES: usize = 256;

/// How much of an unexpected `config get` output is quoted in an error.
const OUTPUT_SNIPPET_MAX_CHARS: usize = 120;

/// Serialises every read and write, as `goal_config::CONFIG_LOCK` does.
static CONFIG_LOCK: Mutex<()> = Mutex::new(());

/// `name → "provider/model[:thinking]"`.
pub type Record = BTreeMap<String, String>;

/// Which of the two records a call addresses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    Roles,
    Agents,
}

impl Scope {
    /// The webview's name for a record (`"roles"` / `"agents"`).
    pub fn parse(scope: &str) -> Result<Self, String> {
        match scope {
            "roles" => Ok(Self::Roles),
            "agents" => Ok(Self::Agents),
            _ => Err(format!("unknown model setting: {scope}")),
        }
    }

    const fn key(self) -> &'static str {
        match self {
            Self::Roles => "modelRoles",
            Self::Agents => "task.agentModelOverrides",
        }
    }
}

/// What Settings shows: both records and the user's own agent files.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfig {
    roles: Record,
    agents: Record,
    /// Names of `<agent dir>/agents/*.md` (omp's user-level agents).
    custom_agents: Vec<String>,
}

/// Both records of `profile` plus the agent names found in `agents_dir`.
///
/// Spawns `omp` twice: callers MUST run this off the main thread.
pub fn get(profile: Option<&str>, agents_dir: &Path) -> Result<ModelConfig, String> {
    let _guard = CONFIG_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    Ok(ModelConfig {
        roles: read(profile, Scope::Roles)?,
        agents: read(profile, Scope::Agents)?,
        custom_agents: agent_names(agents_dir),
    })
}

/// Set (`Some`) or remove (`None`) one entry of `scope`'s record, keeping
/// every other entry, and return the record re-read after the write.
/// Nothing is written when the entry already says that.
///
/// Blocking (up to three `omp` spawns), like [`get`].
pub fn set(
    profile: Option<&str>,
    scope: Scope,
    name: &str,
    value: Option<&str>,
) -> Result<Record, String> {
    check_text(name, NAME_MAX_BYTES, "name")?;
    if let Some(v) = value {
        check_text(v, VALUE_MAX_BYTES, "model")?;
    }
    let _guard = CONFIG_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    let mut record = read(profile, scope)?;
    if apply(&mut record, name, value) {
        crate::omp_cli::run(&set_args(profile, scope, &record)?, OMP_CONFIG)?;
        return read(profile, scope);
    }
    Ok(record)
}

/// A name or selector from the webview: non-empty, bounded, no whitespace
/// or control characters (a selector never has them, and they would only
/// garble `config.yml`).
fn check_text(text: &str, max: usize, what: &str) -> Result<(), String> {
    if text.is_empty()
        || text.len() > max
        || text.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(format!(
            "invalid {what}: {:?}",
            crate::text::prefix_within(text, 64)
        ));
    }
    Ok(())
}

/// Apply one entry change; `true` when the record changed.
fn apply(record: &mut Record, name: &str, value: Option<&str>) -> bool {
    match value {
        Some(v) if record.get(name).map(String::as_str) == Some(v) => false,
        Some(v) => {
            record.insert(name.to_string(), v.to_string());
            true
        }
        None => record.remove(name).is_some(),
    }
}

fn read(profile: Option<&str>, scope: Scope) -> Result<Record, String> {
    parse_record(
        &crate::omp_cli::run(&get_args(profile, scope), OMP_CONFIG)?,
        scope,
    )
}

/// Argv for `omp [--profile=<id>] config get <key> --json`.
fn get_args(profile: Option<&str>, scope: Scope) -> Vec<String> {
    let mut args = Vec::with_capacity(5);
    args.extend(crate::agent::spawn::profile_flag(profile));
    args.extend(["config", "get", scope.key(), "--json"].map(String::from));
    args
}

/// Argv for `omp [--profile=<id>] config set <key> '<json object>'`: the
/// object is ONE argv element, no shell involved.
fn set_args(profile: Option<&str>, scope: Scope, record: &Record) -> Result<Vec<String>, String> {
    let value = serde_json::to_string(record)
        .map_err(|e| format!("could not encode {}: {e}", scope.key()))?;
    let mut args = Vec::with_capacity(5);
    args.extend(crate::agent::spawn::profile_flag(profile));
    args.extend(["config", "set", scope.key()].map(String::from));
    args.push(value);
    Ok(args)
}

/// Parse `omp config get <key> --json` — `{"key":…,"value":{…},…}` — into
/// the record. A `null` / missing value is an empty record (the setting is
/// unset); any non-string entry is an error.
fn parse_record(stdout: &[u8], scope: Scope) -> Result<Record, String> {
    let text = String::from_utf8_lossy(stdout);
    let text = text.trim();
    let unexpected = || {
        let snippet: String = text.chars().take(OUTPUT_SNIPPET_MAX_CHARS).collect();
        format!("unexpected {} from omp: {snippet}", scope.key())
    };
    let mut parsed: serde_json::Value = serde_json::from_str(text).map_err(|_| unexpected())?;
    match parsed.get_mut("value").map(serde_json::Value::take) {
        None | Some(serde_json::Value::Null) => Ok(Record::new()),
        Some(serde_json::Value::Object(map)) => map
            .into_iter()
            .map(|(k, v)| match v {
                serde_json::Value::String(s) => Ok((k, s)),
                _ => Err(unexpected()),
            })
            .collect(),
        Some(_) => Err(unexpected()),
    }
}

/// File stems of `dir/*.md`, sorted; an unreadable or missing folder is
/// an empty list.
// shortcut: the file stem stands for the agent name (omp's bundled and
// unpacked agents match it); read the `name:` frontmatter if one ever differs.
fn agent_names(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| {
            let path = e.path();
            (path.extension()? == "md").then_some(())?;
            path.file_stem()?.to_str().map(String::from)
        })
        .collect();
    names.sort_unstable();
    names
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(pairs: &[(&str, &str)]) -> Record {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect()
    }

    #[test]
    fn scope_parse_accepts_only_the_two_records() {
        assert_eq!(Scope::parse("roles"), Ok(Scope::Roles));
        assert_eq!(Scope::parse("agents"), Ok(Scope::Agents));
        assert!(Scope::parse("goal.continuationModes").is_err());
    }

    #[test]
    fn args_put_profile_first_and_json_as_one_element() {
        assert_eq!(
            get_args(Some("work"), Scope::Agents),
            [
                "--profile=work",
                "config",
                "get",
                "task.agentModelOverrides",
                "--json"
            ]
        );
        assert_eq!(
            set_args(None, Scope::Roles, &rec(&[("smol", "a/b:low")])).unwrap(),
            ["config", "set", "modelRoles", r#"{"smol":"a/b:low"}"#]
        );
    }

    #[test]
    fn parse_record_reads_object_null_and_rejects_others() {
        let ok = br#"{"key":"modelRoles","value":{"default":"anthropic/x","smol":"a/b:low"},"type":"record"}"#;
        assert_eq!(
            parse_record(ok, Scope::Roles).unwrap(),
            rec(&[("default", "anthropic/x"), ("smol", "a/b:low")])
        );
        assert_eq!(
            parse_record(br#"{"value":null}"#, Scope::Roles).unwrap(),
            Record::new()
        );
        assert!(parse_record(br#"{"value":{"a":1}}"#, Scope::Roles).is_err());
        assert!(parse_record(br#"{"value":[]}"#, Scope::Roles).is_err());
        assert!(parse_record(b"Unknown setting", Scope::Roles).is_err());
    }

    #[test]
    fn apply_sets_replaces_and_removes_one_entry() {
        let mut r = rec(&[("scout", "a/b")]);
        assert!(!apply(&mut r, "scout", Some("a/b")));
        assert!(apply(&mut r, "scout", Some("a/c:high")));
        assert!(apply(&mut r, "task", Some("a/d")));
        assert_eq!(r, rec(&[("scout", "a/c:high"), ("task", "a/d")]));
        assert!(apply(&mut r, "scout", None));
        assert!(!apply(&mut r, "scout", None));
        assert_eq!(r, rec(&[("task", "a/d")]));
    }

    #[test]
    fn check_text_refuses_empty_spaced_and_long() {
        assert!(check_text("anthropic/claude:high", VALUE_MAX_BYTES, "model").is_ok());
        assert!(check_text("", NAME_MAX_BYTES, "name").is_err());
        assert!(check_text("a b", NAME_MAX_BYTES, "name").is_err());
        assert!(check_text("a\nb", NAME_MAX_BYTES, "name").is_err());
        assert!(check_text(&"x".repeat(NAME_MAX_BYTES + 1), NAME_MAX_BYTES, "name").is_err());
    }

    #[test]
    fn agent_names_lists_md_stems_sorted() {
        let dir = std::env::temp_dir().join(format!("omp-model-config-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub.md")).unwrap();
        for f in ["zeta.md", "alpha.md", "notes.txt"] {
            std::fs::write(dir.join(f), "").unwrap();
        }
        assert_eq!(agent_names(&dir), ["alpha", "zeta"]);
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(agent_names(&dir), Vec::<String>::new());
    }
}
