//! omp's voice settings (Settings → Voice): voice to text (`stt.*`), the
//! live conversation's voice, and whether the on-device speech models are
//! installed. omp's `speech.*` (reading replies aloud) is left out on
//! purpose: only omp's terminal UI acts on it, `omp --mode rpc-ui` never
//! does, so the app reads replies itself (`tts.rs`).
//!
//! Values and an enum's choices come from one `omp config list` run (its
//! `--json` form leaves the choices out). A change is `omp config set <key>
//! <value>`: omp itself refuses a value the setting does not take, so the
//! choices are never copied here. The webview names a setting by its omp
//! key, which must be one of [`KEYS`]; nothing else is written.
//!
//! `profile` follows `goal_config.rs`: `None` = built-in, `Some(id)` an id
//! that went through `ProfileStore::resolve_owned`.

use std::sync::{Mutex, PoisonError};

use serde::Serialize;

/// Names the subcommands in failure messages.
const OMP_CONFIG: &str = "omp config";
const OMP_SETUP: &str = "omp setup speech";

/// Longest value accepted from the webview (a voice name, a language code,
/// a number).
const VALUE_MAX_BYTES: usize = 64;

/// The settings this module reads and writes, in the order Settings shows
/// them.
pub const KEYS: [&str; 3] = ["stt.enabled", "stt.language", "live.voice"];

/// Serialises every read and write, as `goal_config::CONFIG_LOCK` does.
static CONFIG_LOCK: Mutex<()> = Mutex::new(());

/// One omp setting as `omp config list` prints it.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Setting {
    key: &'static str,
    /// In omp's own spelling: `true`, `vi`, `sol`.
    value: String,
    /// `boolean` | `number` | `string` | `enum`.
    kind: &'static str,
    /// An enum's choices in omp's order; empty for the other kinds.
    options: Vec<String>,
}

/// One on-device model of `omp setup speech --check`.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Model {
    name: String,
    pub ready: bool,
    pub status: String,
}

/// The report entry of the model `omp say` speaks with.
const TTS_MODEL: &str = "Text-to-Speech model";

/// What Settings → Voice shows.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechConfig {
    settings: Vec<Setting>,
    models: Vec<Model>,
    /// Why the model check could not be read; the settings still show.
    models_error: Option<String>,
    /// The dictation models omp knows and which are downloaded.
    stt_models: Vec<crate::stt_models::SttModel>,
}

/// The voice settings of `profile` and the state of the on-device models;
/// `stt_models` is `stt_models::list` for that profile.
///
/// Spawns `omp` twice: callers MUST run this off the main thread.
pub fn get(
    profile: Option<&str>,
    stt_models: Vec<crate::stt_models::SttModel>,
) -> Result<SpeechConfig, String> {
    let _guard = CONFIG_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    let settings = read_settings(profile)?;
    let (models, models_error) = match read_models(profile) {
        Ok(models) => (models, None),
        Err(error) => (Vec::new(), Some(error)),
    };
    Ok(SpeechConfig {
        settings,
        models,
        models_error,
        stt_models,
    })
}

/// The on-device text-to-speech model (Kokoro) as `omp setup speech
/// --check` reports it. One `omp` spawn.
pub fn tts_model(profile: Option<&str>) -> Result<Model, String> {
    read_models(profile)?
        .into_iter()
        .find(|model| model.name == TTS_MODEL)
        .ok_or_else(|| format!("{OMP_SETUP} reports no {TTS_MODEL}"))
}

/// Set one of [`KEYS`] and return the settings re-read after the write.
/// omp's own refusal (a value outside an enum, a non-number) is the error.
///
/// Blocking (two `omp` spawns), like [`get`].
pub fn set(profile: Option<&str>, key: &str, value: &str) -> Result<Vec<Setting>, String> {
    let key = known_key(key)?;
    check_value(value)?;
    let _guard = CONFIG_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    crate::omp_cli::run(&set_args(profile, key, value), OMP_CONFIG)?;
    read_settings(profile)
}

/// `key` as the entry of [`KEYS`] it names.
fn known_key(key: &str) -> Result<&'static str, String> {
    KEYS.into_iter().find(|known| *known == key).ok_or_else(|| {
        format!(
            "not a voice setting: {:?}",
            crate::text::prefix_within(key, 64)
        )
    })
}

/// A value from the webview: non-empty, bounded, no whitespace or control
/// characters, and no leading `-`, which omp's argument parser would read
/// as a flag.
fn check_value(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > VALUE_MAX_BYTES
        || value.starts_with('-')
        || value.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(format!(
            "invalid value: {:?}",
            crate::text::prefix_within(value, 64)
        ));
    }
    Ok(())
}

fn read_settings(profile: Option<&str>) -> Result<Vec<Setting>, String> {
    let mut args = Vec::with_capacity(3);
    args.extend(crate::agent::spawn::profile_flag(profile));
    args.extend(["config", "list"].map(String::from));
    let settings = parse_settings(&String::from_utf8_lossy(&crate::omp_cli::run(
        &args, OMP_CONFIG,
    )?));
    if settings.is_empty() {
        return Err("omp config list names no voice setting".to_string());
    }
    Ok(settings)
}

/// Argv for `omp [--profile=<id>] config set <key> <value>`.
fn set_args(profile: Option<&str>, key: &str, value: &str) -> Vec<String> {
    let mut args = Vec::with_capacity(5);
    args.extend(crate::agent::spawn::profile_flag(profile));
    args.extend(["config", "set", key, value].map(String::from));
    args
}

/// The [`KEYS`] found in `omp config list`'s text, in [`KEYS`] order. A key
/// this omp does not have is left out.
fn parse_settings(text: &str) -> Vec<Setting> {
    KEYS.into_iter()
        .filter_map(|key| {
            let (value, kind) = text.lines().find_map(|line| parse_line(line, key))?;
            let (kind, options) = match kind {
                "boolean" => ("boolean", Vec::new()),
                "number" => ("number", Vec::new()),
                "string" => ("string", Vec::new()),
                choices => ("enum", choices.split('|').map(str::to_string).collect()),
            };
            Some(Setting {
                key,
                value: value.to_string(),
                kind,
                options,
            })
        })
        .collect()
}

/// `  <key> = <value> (<kind>)` → `(value, kind)`, where `kind` is a type
/// name or an enum's `a|b|c`.
fn parse_line<'a>(line: &'a str, key: &str) -> Option<(&'a str, &'a str)> {
    let rest = line.trim().strip_prefix(key)?.strip_prefix(" = ")?;
    let (value, kind) = rest.rsplit_once(" (")?;
    Some((value, kind.strip_suffix(')')?))
}

/// `omp setup speech --check --json`: exits non-zero while a model is
/// missing and still prints the report, so the report decides, not the
/// exit status.
fn read_models(profile: Option<&str>) -> Result<Vec<Model>, String> {
    let mut args = Vec::with_capacity(5);
    args.extend(crate::agent::spawn::profile_flag(profile));
    args.extend(["setup", "speech", "--check", "--json"].map(String::from));
    let output = crate::agent::spawn::omp_output(&args)?;
    parse_models(&output.stdout).ok_or_else(|| {
        crate::omp_cli::exit_failure_message(
            OMP_SETUP,
            output.status,
            &output.stderr,
            &output.stdout,
        )
    })
}

/// `{"<name>": {"ready": bool, "status": "…"}, …}` → the models; `None`
/// when the output is not that.
fn parse_models(stdout: &[u8]) -> Option<Vec<Model>> {
    let serde_json::Value::Object(report) = serde_json::from_slice(stdout).ok()? else {
        return None;
    };
    report
        .into_iter()
        .map(|(name, entry)| {
            Some(Model {
                name,
                ready: entry.get("ready")?.as_bool()?,
                status: entry.get("status")?.as_str()?.to_string(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIST: &str = "\
Settings:
  stt.enabled = false (boolean)
  stt.submitTrigger = never (never|release|release-complete|say-submit)
  stt.language = en (string)
  live.voice = sol (arbor|breeze|sol)
  speech.enabled = true (boolean)
  speech.mode = assistant (all|assistant|yield)
  speech.voiceover = x (string)
  speech.voice = af_heart (af_heart|bm_fable)
  speech.speed = 1.25 (number)
";

    fn setting(key: &'static str, value: &str, kind: &'static str, options: &[&str]) -> Setting {
        Setting {
            key,
            value: value.to_string(),
            kind,
            options: options.iter().map(|o| (*o).to_string()).collect(),
        }
    }

    #[test]
    fn settings_come_out_in_key_order_with_an_enums_choices() {
        assert_eq!(
            parse_settings(LIST),
            vec![
                setting("stt.enabled", "false", "boolean", &[]),
                setting("stt.language", "en", "string", &[]),
                setting("live.voice", "sol", "enum", &["arbor", "breeze", "sol"]),
            ]
        );
    }

    #[test]
    fn a_key_is_not_matched_by_a_longer_one_or_a_stray_line() {
        // `speech.voiceover` must not answer for `speech.voice`.
        assert_eq!(
            parse_line("  speech.voiceover = x (string)", "speech.voice"),
            None
        );
        assert_eq!(parse_line("speech.voice = af_heart", "speech.voice"), None);
        assert_eq!(
            parse_line("  stt.language = a (b) c (string)", "stt.language"),
            Some(("a (b) c", "string"))
        );
        assert_eq!(parse_settings("nothing here"), []);
    }

    #[test]
    fn only_listed_keys_and_plain_values_are_written() {
        assert_eq!(known_key("stt.enabled"), Ok("stt.enabled"));
        assert!(known_key("modelRoles").is_err());
        assert!(known_key("stt.enabled ").is_err());
        for bad in ["", "--json", "-1", "a b", "a\nb", &"x".repeat(65)] {
            assert!(check_value(bad).is_err(), "{bad:?}");
        }
        for good in ["true", "1.25", "af_heart", "vi"] {
            assert_eq!(check_value(good), Ok(()));
        }
    }

    #[test]
    fn set_args_put_the_profile_first_and_the_value_last() {
        assert_eq!(
            set_args(Some("work"), "stt.language", "vi"),
            ["--profile=work", "config", "set", "stt.language", "vi"]
        );
        assert_eq!(
            set_args(None, "speech.enabled", "true"),
            ["config", "set", "speech.enabled", "true"]
        );
    }

    #[test]
    fn the_model_report_is_read_and_anything_else_refused() {
        let report = r#"{"Speech-to-Text model":{"ready":false,"status":"parakeet — not downloaded"},"Text-to-Speech model":{"ready":true,"status":"kokoro — ready"}}"#;
        assert_eq!(
            parse_models(report.as_bytes()),
            Some(vec![
                Model {
                    name: "Speech-to-Text model".to_string(),
                    ready: false,
                    status: "parakeet — not downloaded".to_string(),
                },
                Model {
                    name: "Text-to-Speech model".to_string(),
                    ready: true,
                    status: "kokoro — ready".to_string(),
                },
            ])
        );
        assert_eq!(parse_models(b"{}"), Some(Vec::new()));
        for bad in [
            &b"unknown component"[..],
            b"[]",
            br#"{"a":{"ready":"yes","status":"x"}}"#,
            br#"{"a":{"ready":true}}"#,
        ] {
            assert_eq!(parse_models(bad), None);
        }
    }
}
