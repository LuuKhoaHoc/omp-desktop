//! Catalog of local STT models (`Qwen3-ASR` + `Silero VAD`) and cache paths.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Exact `transcribe-cpp` `PyPI` package installed into the managed `uv` venv.
pub const TRANSCRIBE_CPP_SPEC: &str = "transcribe-cpp==0.4.1";
pub const RUNTIME_MARKER: &str = ".transcribe-cpp-0.4.1";

/// Model identifiers exposed to the settings UI and stored in `local-stt.json`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum ModelId {
    #[default]
    #[serde(rename = "qwen3-asr-0.6b")]
    Qwen3Asr06B,
    #[serde(rename = "whisper-large-v3-turbo")]
    WhisperLargeV3Turbo,
}

impl ModelId {
    pub const ALL: [Self; 2] = [Self::Qwen3Asr06B, Self::WhisperLargeV3Turbo];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Qwen3Asr06B => "qwen3-asr-0.6b",
            Self::WhisperLargeV3Turbo => "whisper-large-v3-turbo",
        }
    }

    pub fn parse(id: &str) -> Result<Self, String> {
        Self::ALL
            .into_iter()
            .find(|m| m.as_str() == id)
            .ok_or_else(|| {
                format!(
                    "unknown local speech model: {:?}",
                    crate::text::prefix_within(id, 48)
                )
            })
    }

    pub const fn spec(self) -> ModelSpec {
        match self {
            Self::Qwen3Asr06B => ModelSpec {
                id: "qwen3-asr-0.6b",
                name: "Qwen3-ASR 0.6B (Q4_K_M)",
                filename: "Qwen3-ASR-0.6B-Q4_K_M.gguf",
                url: "https://huggingface.co/handy-computer/Qwen3-ASR-0.6B-gguf/resolve/main/Qwen3-ASR-0.6B-Q4_K_M.gguf",
                sha256: "5b58f32a58ffa2c8783e0b0963485623e286e6272d953dfc9e28bc3447dee0c0",
                size_bytes: 589_560_480,
                hint: "Fast multilingual (Vietnamese, English, 30 languages) · 9.3% VI WER · ~562 MB",
            },
            Self::WhisperLargeV3Turbo => ModelSpec {
                id: "whisper-large-v3-turbo",
                name: "Whisper large-v3-turbo (Q5_K_M)",
                filename: "whisper-large-v3-turbo-Q5_K_M.gguf",
                url: "https://huggingface.co/handy-computer/whisper-large-v3-turbo-gguf/resolve/main/whisper-large-v3-turbo-Q5_K_M.gguf",
                sha256: "06fc9923c09fb3ae878ea12c34d1be3ed18fad039ab14b4b045c7b6c40af56b2",
                size_bytes: 619_628_096,
                hint: "100 languages · Whisper A/B baseline · 9.5% VI WER · ~591 MB",
            },
        }
    }
}

/// Companion Silero VAD v6.2 GGUF used for speech gating and pause detection.
pub const SILERO_VAD_SPEC: ModelSpec = ModelSpec {
    id: "silero-vad-v6.2",
    name: "Silero VAD v6.2",
    filename: "silero-vad-v6.2-F32.gguf",
    url: "https://huggingface.co/handy-computer/silero-vad-v6.2-gguf/resolve/main/silero-vad-v6.2-F32.gguf",
    sha256: "0d871a800c420fdd5d1b17a3aea4296d1c39608f0ff4a9295eb76457eb1c88e6",
    size_bytes: 1_241_056,
    hint: "Voice activity detector (~1.2 MB)",
};

/// Static metadata and verified Hugging Face source for a downloadable GGUF.
#[derive(Debug, Clone, Copy)]
pub struct ModelSpec {
    pub id: &'static str,
    pub name: &'static str,
    pub filename: &'static str,
    pub url: &'static str,
    pub sha256: &'static str,
    pub size_bytes: u64,
    pub hint: &'static str,
}

/// Compute backend passed to `transcribe_cpp.Model(..., backend=...)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Backend {
    #[default]
    Auto,
    Cpu,
    Vulkan,
    Metal,
    Cuda,
}

impl Backend {
    pub const ALL: [Self; 5] = [Self::Auto, Self::Cpu, Self::Vulkan, Self::Metal, Self::Cuda];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Cpu => "cpu",
            Self::Vulkan => "vulkan",
            Self::Metal => "metal",
            Self::Cuda => "cuda",
        }
    }

    pub fn parse(raw: &str) -> Result<Self, String> {
        Self::ALL
            .into_iter()
            .find(|b| b.as_str() == raw)
            .ok_or_else(|| {
                format!(
                    "unknown local speech backend: {:?}",
                    crate::text::prefix_within(raw, 32)
                )
            })
    }
}

/// Returns `<cache_root>/models/<filename>`.
pub fn model_path(cache_root: &Path, spec: ModelSpec) -> PathBuf {
    cache_root.join("models").join(spec.filename)
}

/// Returns `<cache_root>/venv`.
pub fn venv_dir(cache_root: &Path) -> PathBuf {
    cache_root.join("venv")
}

/// Returns the Python interpreter inside `venv_dir`.
pub fn venv_python(venv: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        venv.join("Scripts").join("python.exe")
    }
    #[cfg(not(windows))]
    {
        venv.join("bin").join("python")
    }
}

/// True when `model_path` exists and is non-empty (exact SHA-256 is verified
/// during download before atomic rename).
pub fn is_model_cached(cache_root: &Path, spec: ModelSpec) -> bool {
    let path = model_path(cache_root, spec);
    std::fs::metadata(path).is_ok_and(|meta| meta.is_file() && meta.len() > 0)
}

/// True when the `uv`-managed venv has its Python binary and completion marker.
pub fn is_runtime_installed(cache_root: &Path) -> bool {
    let venv = venv_dir(cache_root);
    venv_python(&venv).is_file() && venv.join(RUNTIME_MARKER).is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_id_roundtrips_all_variants() {
        for id in ModelId::ALL {
            assert_eq!(ModelId::parse(id.as_str()), Ok(id));
            let spec = id.spec();
            assert_eq!(spec.id, id.as_str());
            assert_eq!(spec.sha256.len(), 64);
            assert!(spec.sha256.bytes().all(|b| b.is_ascii_hexdigit()));
            assert!(spec.url.starts_with("https://huggingface.co/"));
        }
        assert!(ModelId::parse("whisper-tiny").is_err());
    }

    #[test]
    fn backend_roundtrips_all_variants() {
        for b in Backend::ALL {
            assert_eq!(Backend::parse(b.as_str()), Ok(b));
        }
        assert!(Backend::parse("rocm").is_err());
    }

    #[test]
    fn vad_spec_has_valid_sha256() {
        assert_eq!(SILERO_VAD_SPEC.sha256.len(), 64);
        assert!(SILERO_VAD_SPEC
            .sha256
            .bytes()
            .all(|b| b.is_ascii_hexdigit()));
    }
}
