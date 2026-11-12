//! Which of omp's on-device dictation models are downloaded (Settings →
//! Voice). `omp setup speech --check` reports only the model the
//! `dictation` role names, so the list is read where omp caches the files,
//! by the rule of omp's `isSttModelCached` (`stt/downloader.ts`, the specs
//! of `stt/models.ts`, the folder of `getTinyModelsCacheDir`; omp
//! v18.18.7). Display only: omp's own check stays the answer for the model
//! in use, and a wrong `false` here costs one `omp setup speech` run that
//! finds the files already there.
//!
//! A model a later omp adds is not in [`SPECS`]; Settings then still shows
//! the role's value.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;

/// One model of omp's `stt/models.ts`.
struct Spec {
    /// The model id; `modelRoles.dictation` stores it as `local/<key>`.
    key: &'static str,
    /// Hugging Face repo, also the folder under the cache.
    repo: &'static str,
    /// sherpa-onnx files (`true`) or a transformers.js Whisper (`false`).
    sherpa: bool,
}

const SPECS: [Spec; 5] = [
    Spec {
        key: "whisper-large-v3-turbo",
        repo: "onnx-community/whisper-large-v3-turbo",
        sherpa: false,
    },
    Spec {
        key: "whisper-small",
        repo: "onnx-community/whisper-small",
        sherpa: false,
    },
    Spec {
        key: "whisper-base",
        repo: "onnx-community/whisper-base",
        sherpa: false,
    },
    Spec {
        key: "parakeet-tdt-0.6b-v3",
        repo: "csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
        sherpa: true,
    },
    Spec {
        key: "nemotron-streaming-en-0.6b",
        repo: "csukuangfj2/sherpa-onnx-nemotron-speech-streaming-en-0.6b-160ms-int8-2026-04-25",
        sherpa: true,
    },
];

/// The files every sherpa-onnx model of [`SPECS`] consists of.
const SHERPA_FILES: [&str; 4] = [
    "encoder.int8.onnx",
    "decoder.int8.onnx",
    "joiner.int8.onnx",
    "tokens.txt",
];

/// One dictation model and whether its files are in omp's cache.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct SttModel {
    /// As `modelRoles.dictation` takes it: `local/<key>`.
    id: String,
    downloaded: bool,
}

/// Where omp redirects a profile's cache when `XDG_CACHE_HOME` is in use:
/// `<XDG_CACHE_HOME>/omp` for the built-in profile, `…/omp/profiles/<id>`
/// for a named one, and only when that folder exists (omp's `dirs.ts`).
/// `None` = the agent dir holds the cache. `agent_dir_overridden`: the
/// built-in profile runs with `PI_CODING_AGENT_DIR`, which switches the
/// redirect off.
pub fn xdg_cache_root(
    profile: Option<&str>,
    agent_dir_overridden: bool,
    xdg_cache_home: Option<&OsStr>,
) -> Option<PathBuf> {
    if agent_dir_overridden || !cfg!(any(target_os = "linux", target_os = "macos")) {
        return None;
    }
    let mut root = PathBuf::from(xdg_cache_home.filter(|v| !v.is_empty())?);
    root.push("omp");
    if let Some(id) = profile.filter(|id| !id.is_empty()) {
        root.push("profiles");
        root.push(id);
    }
    root.exists().then_some(root)
}

/// Where omp keeps the dictation models of the profile whose agent dir is
/// `agent_dir` and whose [`xdg_cache_root`] is `xdg_root`.
fn cache_dir(agent_dir: &Path, xdg_root: Option<&Path>) -> PathBuf {
    xdg_root
        .unwrap_or(agent_dir)
        .join("cache")
        .join("tiny-models")
}

/// Every model of [`SPECS`] with its download state, for that profile.
pub fn list(agent_dir: &Path, xdg_root: Option<&Path>) -> Vec<SttModel> {
    let cache = cache_dir(agent_dir, xdg_root);
    SPECS
        .iter()
        .map(|spec| SttModel {
            id: format!("local/{}", spec.key),
            downloaded: downloaded(&cache.join(spec.repo), spec.sherpa),
        })
        .collect()
}

/// A model whose files are arriving, and how much of them is on disk.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Arriving {
    /// As `modelRoles.dictation` takes it: `local/<key>`.
    id: String,
    bytes: u64,
}

/// The model omp is downloading: the one of [`SPECS`] with the most bytes
/// in files written since `since`, in its folder and the `onnx/` under it
/// (the downloader's temporary files included). omp downloads a missing
/// model before a capture starts and its RPC mode reports nothing
/// meanwhile, so the folder is the only place that shows it. What an
/// earlier, abandoned download left behind is older than `since` and does
/// not count. `None` when nothing was written.
pub fn arriving(agent_dir: &Path, xdg_root: Option<&Path>, since: SystemTime) -> Option<Arriving> {
    let cache = cache_dir(agent_dir, xdg_root);
    SPECS
        .iter()
        .map(|spec| {
            let repo = cache.join(spec.repo);
            let bytes = written_since(&repo, since) + written_since(&repo.join("onnx"), since);
            (spec, bytes)
        })
        .filter(|(_, bytes)| *bytes > 0)
        .max_by_key(|(_, bytes)| *bytes)
        .map(|(spec, bytes)| Arriving {
            id: format!("local/{}", spec.key),
            bytes,
        })
}

/// The size of the files directly in `dir` that were modified at or after
/// `since`; 0 for a folder that cannot be read.
fn written_since(dir: &Path, since: SystemTime) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .filter_map(|entry| entry.metadata().ok())
        .filter(|meta| meta.is_file() && meta.modified().is_ok_and(|at| at >= since))
        .map(|meta| meta.len())
        .sum()
}

/// omp's `isSttModelCached`: a sherpa model needs all of its files; a
/// Whisper needs `config.json` plus an `encoder*.onnx` and a
/// `decoder*.onnx` under `onnx/`, so a download cut off after one of them
/// reads as missing.
fn downloaded(repo_dir: &Path, sherpa: bool) -> bool {
    if sherpa {
        return SHERPA_FILES.iter().all(|f| repo_dir.join(f).exists());
    }
    if !repo_dir.join("config.json").exists() {
        return false;
    }
    let Ok(entries) = std::fs::read_dir(repo_dir.join("onnx")) else {
        return false;
    };
    let (mut encoder, mut decoder) = (false, false);
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.ends_with(".onnx") {
            encoder |= name.starts_with("encoder");
            decoder |= name.starts_with("decoder");
        }
    }
    encoder && decoder
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::tempdir;

    fn touch(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, b"x").unwrap();
    }

    fn state(models: &[SttModel], key: &str) -> bool {
        models
            .iter()
            .find(|m| m.id == format!("local/{key}"))
            .unwrap()
            .downloaded
    }

    #[test]
    fn a_whisper_needs_its_config_and_both_halves() {
        let agent = tempdir("stt-models", "whisper");
        let repo = agent.join("cache/tiny-models/onnx-community/whisper-small");
        assert!(!state(&list(&agent, None), "whisper-small"));

        touch(&repo.join("config.json"));
        touch(&repo.join("onnx/encoder_model_q4.onnx"));
        assert!(
            !state(&list(&agent, None), "whisper-small"),
            "a download cut off before the decoder is not a model"
        );

        touch(&repo.join("onnx/decoder_model_merged_q4.onnx.part"));
        assert!(!state(&list(&agent, None), "whisper-small"));

        touch(&repo.join("onnx/decoder_model_merged_q4.onnx"));
        let models = list(&agent, None);
        assert!(state(&models, "whisper-small"));
        assert!(!state(&models, "whisper-base"), "another model's folder");
    }

    #[test]
    fn a_sherpa_model_needs_every_file() {
        let agent = tempdir("stt-models", "sherpa");
        let repo =
            agent.join("cache/tiny-models/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8");
        for file in &SHERPA_FILES[..3] {
            touch(&repo.join(file));
        }
        assert!(!state(&list(&agent, None), "parakeet-tdt-0.6b-v3"));
        touch(&repo.join(SHERPA_FILES[3]));
        assert!(state(&list(&agent, None), "parakeet-tdt-0.6b-v3"));
    }

    #[test]
    fn the_xdg_cache_replaces_the_agent_dir_only_where_omp_uses_it() {
        let agent = tempdir("stt-models", "xdg-agent");
        let xdg = tempdir("stt-models", "xdg-home");
        let home = Some(xdg.as_os_str());
        // No `<XDG_CACHE_HOME>/omp` yet: omp stays in the agent dir.
        assert_eq!(xdg_cache_root(None, false, home), None);
        assert_eq!(xdg_cache_root(None, false, Some(OsStr::new(""))), None);

        std::fs::create_dir_all(xdg.join("omp")).unwrap();
        let expected = cfg!(any(target_os = "linux", target_os = "macos")).then(|| xdg.join("omp"));
        assert_eq!(xdg_cache_root(None, false, home), expected);
        assert_eq!(
            xdg_cache_root(None, true, home),
            None,
            "PI_CODING_AGENT_DIR"
        );
        assert_eq!(
            xdg_cache_root(Some("work"), false, home),
            None,
            "a named profile follows its own folder, not the base one"
        );

        if let Some(root) = expected {
            touch(&root.join("cache/tiny-models/onnx-community/whisper-base/config.json"));
            touch(&root.join("cache/tiny-models/onnx-community/whisper-base/onnx/encoder.onnx"));
            touch(&root.join("cache/tiny-models/onnx-community/whisper-base/onnx/decoder.onnx"));
            assert!(state(&list(&agent, Some(&root)), "whisper-base"));
            assert!(!state(&list(&agent, None), "whisper-base"));
        }
    }

    #[test]
    fn the_arriving_model_is_the_one_being_written_now() {
        use std::time::Duration;
        let agent = tempdir("stt-models", "arriving");
        let cache = agent.join("cache/tiny-models");
        let turbo = cache.join("onnx-community/whisper-large-v3-turbo");
        let hour = Duration::from_secs(3600);
        let before = SystemTime::now() - hour;
        assert_eq!(arriving(&agent, None, before), None, "no cache yet");

        std::fs::create_dir_all(turbo.join("onnx")).unwrap();
        std::fs::write(turbo.join("config.json"), [0u8; 10]).unwrap();
        std::fs::write(
            turbo.join("onnx/encoder_model_q4.onnx.tmp.1.abc"),
            [0u8; 300],
        )
        .unwrap();
        std::fs::write(
            turbo.join("onnx/decoder_model_merged_q4.onnx.tmp.1.def"),
            [0u8; 200],
        )
        .unwrap();
        touch(&cache.join("onnx-community/whisper-base/config.json"));
        assert_eq!(
            arriving(&agent, None, before),
            Some(Arriving {
                id: "local/whisper-large-v3-turbo".to_string(),
                bytes: 510,
            })
        );
        assert_eq!(
            arriving(&agent, None, SystemTime::now() + hour),
            None,
            "files older than the capture are what an earlier download left"
        );
    }
}
