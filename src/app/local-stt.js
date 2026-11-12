// Pure helpers for desktop-native local Speech-to-Text (`local_stt`,
// Qwen3-ASR 0.6B / Whisper large-v3-turbo + Silero VAD via transcribe-cpp).
// Wrapped in an IIFE per the project rule for plain <script> tags.
(function () {
  const ENGINES = Object.freeze([
    { value: "omp", label: "omp built-in" },
    { value: "local", label: "Desktop native (Qwen3-ASR / Whisper)" },
  ]);

  const BACKENDS = Object.freeze([
    { value: "auto", label: "Auto (Vulkan GPU → CPU)" },
    { value: "vulkan", label: "Vulkan GPU" },
    { value: "cpu", label: "CPU only" },
  ]);

  const LANGUAGES = Object.freeze([
    ["", "Auto-detect"],
    ["vi", "Vietnamese"],
    ["en", "English"],
    ["zh", "Chinese"],
    ["ja", "Japanese"],
    ["ko", "Korean"],
    ["fr", "French"],
    ["de", "German"],
    ["es", "Spanish"],
  ]);

  const MAX_VOCAB_TERMS = 100;
  const MAX_TERM_LEN = 64;

  function isLocalEngine(status) {
    return status?.config?.engine === "local";
  }

  function selectedModel(status) {
    const id = status?.config?.model;
    return status?.models?.find(m => m.id === id) ?? status?.models?.[0] ?? null;
  }

  function formatSizeMb(bytes) {
    if (!(typeof bytes === "number" && Number.isFinite(bytes) && bytes > 0)) return "";
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  }

  function parseVocabulary(raw) {
    if (typeof raw !== "string") return [];
    const out = [];
    for (const part of raw.split(/[\n,]+/)) {
      const term = part.trim().slice(0, MAX_TERM_LEN);
      if (!term || out.includes(term)) continue;
      out.push(term);
      if (out.length >= MAX_VOCAB_TERMS) break;
    }
    return out;
  }

  function formatVocabulary(list) {
    if (!Array.isArray(list) || !list.length) return "";
    return list.join(", ");
  }

  function canStartLocalDictation(status) {
    if (!status) return { ok: false, reason: "Local voice to text status is still loading." };
    if (!status.cacheAvailable) return { ok: false, reason: "Local speech cache folder is unavailable." };
    if (!status.uvInstalled) return { ok: false, reason: "`uv` is not installed. Install uv or switch back to omp built-in in Settings → Voice." };
    if (!status.runtimeInstalled || !status.vadDownloaded) {
      return { ok: false, reason: "Local speech runtime is not installed yet. Open Settings → Voice to install it." };
    }
    const model = selectedModel(status);
    if (!model?.downloaded) {
      const name = model?.name || status.config?.model || "selected model";
      return { ok: false, reason: `Local model ${name} is not downloaded yet. Open Settings → Voice to download it.` };
    }
    return { ok: true, reason: null };
  }

  function localAutoStopMs(pauseSeconds, handsFreeArmed, handsFreeFallbackSeconds = 2) {
    const effective = handsFreeArmed
      ? (typeof pauseSeconds === "number" && pauseSeconds > 0 ? pauseSeconds : handsFreeFallbackSeconds)
      : pauseSeconds;
    return typeof effective === "number" && effective > 0 ? Math.round(effective * 1000) : 0;
  }

  function reduceInstallEvent(prev, payload) {
    if (!payload || typeof payload !== "object") return prev ?? null;
    if (payload.done) {
      if (payload.error) {
        return {
          kind: payload.kind ?? prev?.kind ?? "model",
          id: payload.id ?? prev?.id ?? "",
          percent: null,
          message: payload.message || "Failed",
          done: true,
          error: payload.error,
          downloaded: payload.downloaded ?? 0,
          total: payload.total ?? null,
        };
      }
      return null;
    }
    const pct = typeof payload.percent === "number" && Number.isFinite(payload.percent)
      ? Math.max(0, Math.min(100, Math.round(payload.percent)))
      : (typeof payload.downloaded === "number" && typeof payload.total === "number" && payload.total > 0
        ? Math.max(0, Math.min(100, Math.round((payload.downloaded / payload.total) * 100)))
        : null);
    return {
      kind: payload.kind ?? "model",
      id: payload.id ?? "",
      percent: pct,
      message: typeof payload.message === "string" ? payload.message : "",
      done: false,
      error: null,
      downloaded: typeof payload.downloaded === "number" ? payload.downloaded : 0,
      total: typeof payload.total === "number" ? payload.total : null,
    };
  }

  function formatInstallLabel(install) {
    if (!install || install.done) return "";
    const parts = [];
    if (install.message) parts.push(install.message);
    if (install.downloaded > 0 && install.total > 0) {
      parts.push(`${Math.floor(install.downloaded / 1e6)} / ${Math.floor(install.total / 1e6)} MB`);
    } else if (install.percent != null) {
      parts.push(`${install.percent}%`);
    }
    return parts.join(" · ");
  }

  window.OMP_LOCAL_STT = Object.freeze({
    ENGINES,
    BACKENDS,
    LANGUAGES,
    isLocalEngine,
    selectedModel,
    formatSizeMb,
    parseVocabulary,
    formatVocabulary,
    canStartLocalDictation,
    localAutoStopMs,
    reduceInstallEvent,
    formatInstallLabel,
  });
})();
