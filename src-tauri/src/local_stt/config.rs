//! Persistent settings for the desktop's local STT (`local-stt.json`).

use serde::{Deserialize, Serialize};

use super::catalog::{Backend, ModelId};
use crate::config_file::ConfigFile;

/// Maximum number of custom vocabulary terms kept per config.
const MAX_VOCAB_TERMS: usize = 64;
const MAX_TERM_LEN: usize = 64;
const MAX_PROMPT_LEN: usize = 512;
const MAX_LANG_LEN: usize = 16;

/// Which dictation implementation handles the composer microphone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    /// Existing `omp` RPC dictation (`dictation_start` / `dictation_stop`).
    #[default]
    Omp,
    /// Desktop-native `Qwen3-ASR` + `Silero VAD` via `transcribe-cpp` (`uv`).
    Local,
}

impl Engine {
    pub fn parse(raw: &str) -> Result<Self, String> {
        match raw {
            "omp" => Ok(Self::Omp),
            "local" => Ok(Self::Local),
            _ => Err(format!(
                "unknown dictation engine: {:?}",
                crate::text::prefix_within(raw, 32)
            )),
        }
    }
}

/// Persisted configuration stored in `<app_config_dir>/local-stt.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct LocalSttConfig {
    pub engine: Engine,
    pub model: ModelId,
    pub backend: Backend,
    /// Empty = auto-detect language; otherwise an ISO code such as `"vi"` or `"en"`.
    pub language: String,
    pub vocabulary: Vec<String>,
    pub context_prompt: String,
}

/// Partial update accepted from the webview.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPatch {
    pub engine: Option<String>,
    pub model: Option<String>,
    pub backend: Option<String>,
    pub language: Option<String>,
    pub vocabulary: Option<Vec<String>>,
    pub context_prompt: Option<String>,
}

/// Validates and stores [`LocalSttConfig`].
pub struct ConfigStore {
    file: ConfigFile,
}

impl ConfigStore {
    pub const fn new(file: ConfigFile) -> Self {
        Self { file }
    }

    pub fn read(&self) -> LocalSttConfig {
        let mut cfg: LocalSttConfig = self.file.read_or_default();
        sanitize_loaded(&mut cfg);
        cfg
    }

    /// Validates `patch`, updates the config file atomically, and returns the
    /// resulting config.
    ///
    /// # Errors
    ///
    /// Returns an error if an enum string is invalid, the language tag contains
    /// non-ASCII/control characters, or persistence fails.
    pub fn apply(&self, patch: ConfigPatch) -> Result<LocalSttConfig, String> {
        let next_engine = patch.engine.as_deref().map(Engine::parse).transpose()?;
        let next_model = patch.model.as_deref().map(ModelId::parse).transpose()?;
        let next_backend = patch.backend.as_deref().map(Backend::parse).transpose()?;
        let next_lang = patch.language.as_deref().map(check_language).transpose()?;
        let next_vocab = patch.vocabulary.map(clean_vocabulary);
        let next_prompt = patch
            .context_prompt
            .as_deref()
            .map(clean_prompt)
            .transpose()?;

        self.file.update(
            |cfg: &mut LocalSttConfig| {
                if let Some(v) = next_engine {
                    cfg.engine = v;
                }
                if let Some(v) = next_model {
                    cfg.model = v;
                }
                if let Some(v) = next_backend {
                    cfg.backend = v;
                }
                if let Some(v) = next_lang {
                    cfg.language = v;
                }
                if let Some(v) = next_vocab {
                    cfg.vocabulary = v;
                }
                if let Some(v) = next_prompt {
                    cfg.context_prompt = v;
                }
                sanitize_loaded(cfg);
            },
            |cfg| cfg,
        )
    }
}

fn sanitize_loaded(cfg: &mut LocalSttConfig) {
    if check_language(&cfg.language).is_err() {
        cfg.language.clear();
    }
    cfg.vocabulary = clean_vocabulary(std::mem::take(&mut cfg.vocabulary));
    cfg.context_prompt =
        crate::text::prefix_within(&cfg.context_prompt, MAX_PROMPT_LEN).to_string();
}

fn check_language(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    let valid = trimmed.len() <= MAX_LANG_LEN
        && trimmed
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if !valid {
        return Err(format!(
            "invalid speech language code: {:?}",
            crate::text::prefix_within(trimmed, 24)
        ));
    }
    Ok(trimmed.to_ascii_lowercase())
}

fn clean_vocabulary(raw: Vec<String>) -> Vec<String> {
    let mut out = Vec::with_capacity(raw.len().min(MAX_VOCAB_TERMS));
    for item in raw {
        let trimmed = item.trim();
        if trimmed.is_empty() || trimmed.chars().any(char::is_control) {
            continue;
        }
        let term = crate::text::prefix_within(trimmed, MAX_TERM_LEN).to_string();
        if !out.contains(&term) {
            out.push(term);
            if out.len() >= MAX_VOCAB_TERMS {
                break;
            }
        }
    }
    out
}

fn clean_prompt(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.chars().any(|c| c == '\0') {
        return Err("context prompt contains a NUL character".to_string());
    }
    Ok(crate::text::prefix_within(trimmed, MAX_PROMPT_LEN).to_string())
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_preserve_omp_engine() {
        let store = ConfigStore::new(ConfigFile::new(None));
        let cfg = store.read();
        assert_eq!(cfg.engine, Engine::Omp);
        assert_eq!(cfg.model, ModelId::Qwen3Asr06B);
        assert_eq!(cfg.backend, Backend::Auto);
        assert_eq!(cfg.language, "");
        assert_eq!(cfg.vocabulary, Vec::<String>::new());
    }

    #[test]
    fn patch_validates_and_normalizes_fields() {
        let store = ConfigStore::new(ConfigFile::new(None));
        let updated = store
            .apply(ConfigPatch {
                engine: Some("local".into()),
                model: Some("whisper-large-v3-turbo".into()),
                backend: Some("vulkan".into()),
                language: Some(" VI ".into()),
                vocabulary: Some(vec![
                    " Tauri ".into(),
                    "Tauri".into(),
                    String::new(),
                    "omp-desktop".into(),
                ]),
                context_prompt: Some("  Vietnamese coding terms  ".into()),
            })
            .expect("valid patch");
        assert_eq!(updated.engine, Engine::Local);
        assert_eq!(updated.model, ModelId::WhisperLargeV3Turbo);
        assert_eq!(updated.backend, Backend::Vulkan);
        assert_eq!(updated.language, "vi");
        assert_eq!(updated.vocabulary, vec!["Tauri", "omp-desktop"]);
        assert_eq!(updated.context_prompt, "Vietnamese coding terms");
        assert_eq!(store.read(), updated);
    }

    #[test]
    fn rejects_invalid_engine_model_and_language() {
        let store = ConfigStore::new(ConfigFile::new(None));
        assert!(store
            .apply(ConfigPatch {
                engine: Some("cloud".into()),
                ..Default::default()
            })
            .is_err());
        assert!(store
            .apply(ConfigPatch {
                model: Some("bad".into()),
                ..Default::default()
            })
            .is_err());
        assert!(store
            .apply(ConfigPatch {
                language: Some("vi;rm".into()),
                ..Default::default()
            })
            .is_err());
    }
}
