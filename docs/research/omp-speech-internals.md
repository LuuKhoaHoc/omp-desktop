# omp speech internals (v18.18.7)

Research date: 2026-11-11. Source checked out at tag `v18.18.7`, commit `e325ffc73ab86e03bdd20a91b77d8e2b3964c906` ([tag](https://github.com/can1357/oh-my-pi/tree/v18.18.7)). Installed CLI also reports `omp/18.18.7`. Paths below are relative to that upstream repository unless noted.

## A. Live voice

### A1. Service, URL, model and credentials

Live voice is a Codex-specific OpenAI realtime service, not the general API-key Realtime endpoint.

- `packages/coding-agent/src/live/transport.ts:19` fixes the signaling URL as `${CODEX_BASE_URL}/codex/realtime/calls?intent=quicksilver&architecture=avas`. `CODEX_BASE_URL` is `https://chatgpt.com/backend-api` in `packages/catalog/src/wire/codex.ts:5`, hence the full URL is `https://chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas`.
- `packages/coding-agent/src/live/protocol.ts:3-4,15-20,163-171` fixes the model id to `gpt-live-1-codex`; the payload includes that model, instructions, output voice and client delegation.
- After signaling, sideband events use `wss://api.openai.com/v1/live/{rtc_call_id}` (`transport.ts:80-85`). Media negotiation uses WebRTC SDP; `live_connect` supplies the caller-owned peer, while `live_start` creates omp's native peer (`transport.ts:62-68,165-183`).
- `transport.ts:208-219` obtains access only with `withOAuthAccess(..., LIVE_PROVIDER)` where `LIVE_PROVIDER = "openai-codex"` (`:23`). Missing credential error string is exactly **`No Codex OAuth credential is available for a live call.`** `transport.ts:87-106` puts the OAuth access token in `Authorization: Bearer ...` and Codex session headers on signaling. There is no `OPENAI_API_KEY` path in this transport.

The code requires an `openai-codex` OAuth credential and does not perform a local paid-plan check. The claim that any free ChatGPT account's Codex OAuth login is entitled to live voice is **unconfirmed**: source code alone does not establish service-side account eligibility. A valid login may still receive a service HTTP error; failures are surfaced as `Codex live signaling failed (<status>): <bounded response body>` (`transport.ts:242-245`). No source-backed claim that free accounts work can be made.

### A2. Endpoint overrides

No live-specific provider, environment variable, models.yml endpoint, or base-URL override is wired into this transport. The URL is a module constant assembled from `CODEX_BASE_URL` in `packages/coding-agent/src/live/transport.ts:19`; the credential provider is likewise fixed as `openai-codex` (`:23,208-219`). This is distinct from ordinary provider model routing and does not establish compatibility with an arbitrary OpenAI-Realtime-compatible server, Azure OpenAI or self-hosted server. `live_connect` changes who owns the WebRTC peer, not the backend endpoint.

### A3. `providers.openaiLiveSteering` and `stream.serverUrl`

They are unrelated to live voice:

- `providers.openaiLiveSteering` is a boolean, default false (`packages/coding-agent/src/config/settings.ts:1183-1187`). It enables live steering of typed messages for GPT model streams in `packages/coding-agent/src/session/settings-stream-fn.ts:188-190`; the changelog explains it avoids unsupported in-flight message errors (`packages/coding-agent/CHANGELOG.md:566`). “Live” here means steering a text-generation stream, not microphone/audio realtime.
- `stream.serverUrl` defaults to `DEFAULT_STREAM_URL` (`packages/coding-agent/src/stream/settings.ts:10-21`; the wire default is `https://live.omp.sh`). It configures `omp stream` and clip uploads (`packages/coding-agent/src/commands/stream.ts:15-36`, `commands/clip.ts:23,59-60`). It is not the `/live` backend.

### A4. Free-account finding

Confirmed: no Codex OAuth means the exact missing-credential error above. Not confirmed: whether a free ChatGPT account that successfully logs into omp as Codex OAuth is permitted by OpenAI's live service. The client contains no entitlement rule or published account-plan mapping; only a live service response can settle it. Do not equate free ChatGPT sign-in with access to this endpoint.

## B. Assistant-output vocalization

### B1. Speaking code and host scope

The vocalizer is implemented in `packages/coding-agent/src/tts/vocalizer.ts`, and is fed by the interactive TUI's `packages/coding-agent/src/modes/controllers/event-controller.ts:1591-1622`. The TUI schedules text deltas by `speech.mode`: `assistant` and `all` speak assistant text as it streams; `all` also speaks thinking deltas; `yield` speaks the final assistant message at turn end. Config defaults are disabled and `assistant` mode (`packages/coding-agent/src/tts/settings.ts:41-70`).

This is not an RPC/RPC-UI host audio feature: the RPC mode does not instantiate the interactive-mode event controller/vocalizer. An RPC host wishing to speak replies itself should consume `message_update` frames (assistant text deltas, including the delta/full snapshot shape described by RPC `message_update`) and final `message_end`/`turn_end` events to flush; decide whether to include thinking separately. RPC live voice (`live_start` / `live_connect`) is a distinct audio conversation feature, not automatic TTS of ordinary assistant replies. RPC schema and command definitions: `packages/coding-agent/src/modes/rpc/rpc-types.ts:88-93,622-630`, `wire/commands.ts:187-198`; event types: `wire/events.ts` and generated `wire/rpc-wire.generated.ts`.

### B2. Role selection and enhanced speech

The regular TUI reply vocalizer does resolve the `speech` role, but deliberately selects only a local-inference candidate: `vocalizer.ts:65-72` filters `candidate.model.api === "local-inference"`, and `:380-386` invokes the local worker with `speech.voice` and `speech.speed`. Thus a cloud speech role candidate does **not** make TUI assistant-output vocalization use cloud TTS. The voice setting is specifically documented as Kokoro voice (`tts/settings.ts:85-95`).

The standalone `tts` tool is different: its prompt says it uses the configured speech-role fallback chain, including `local-inference`, `xai-tts`, and `openai-speech` (`packages/coding-agent/src/prompts/tools/tts.md:1`; dispatch in `packages/ai/src/speech/index.ts:12-31`). The tool may use cloud TTS.

`speech.enhanced` does not change the synthesis provider. It rewrites markdown blocks into spoken prose before local synthesis using the `tiny`/`smol` model role, describing code and dropping links/markdown. See `packages/coding-agent/src/tts/speech-enhancer.ts:55-83` and `tts/vocalizer.ts:8-19`; failures/timeouts fall back to mechanical speakable-text cleanup.

### B3. Linux audio playback

The vocalizer streams float PCM through `AudioPlayback` from `@oh-my-pi/pi-natives`, via `packages/coding-agent/src/tts/streaming-player.ts:1,14-40`. It does not shell out to `mpv`, `pw-play`, `paplay`, or `aplay`. Linux device/backend selection is implemented in the native module; no specific ALSA/PulseAudio/PipeWire backend choice was confirmed from the cited TTS caller source.

## C. Custom TTS models

### C1. OpenAI-compatible `/audio/speech` declaration

Yes. `models.yml` accepts a provider `baseUrl`, `auth: none`, custom models, and model-level `api` and `kind` (`packages/coding-agent/src/config/models-config-schema-bundle.ts:214-244,374-387`). `openai-speech` is a registered speech runner API (`packages/ai/src/speech/index.ts:12-18`), and `speech` role accepts models whose kind is `tts` (`packages/coding-agent/src/config/model-roles.ts:76-82`). Example:

```yaml
providers:
  local-tts:
    baseUrl: http://127.0.0.1:5050/v1
    auth: none
    models:
      - id: kokoro
        name: Local Kokoro TTS
        api: openai-speech
        kind: tts
```

The API expects a request at `<baseUrl>/audio/speech` (`packages/ai/src/speech/openai-speech.ts:17-25`); `/v1` therefore belongs in the base URL if the server expects `/v1/audio/speech`. Select the qualified selector as the speech role via omp settings (the role value is in the app settings, not part of `models.yml`), e.g. `modelRoles.speech: local-tts/kokoro`; exact command/config persistence can be managed with `omp config set` for the installed version. Model entry custom API id validation includes runner APIs (`models-config-schema-bundle.ts:120-130`).

One caveat matters: this config makes a custom TTS model available to the `speech` role and cloud-capable `tts` tool. The TUI reply vocalizer filters to `local-inference`, so it will not use this OpenAI-compatible remote model until omp changes that filter.

### C2. Cloud voice selection

The `openai-speech` adapter includes `voice` only when `request.voice !== undefined` (`packages/ai/src/speech/openai-speech.ts:17-25`); it sends no default voice. In contrast, the `tts` tool implementation supplies its selected voice when it synthesizes (`packages/coding-agent/src/tools/tts.ts:88-92,146-149`), so its calls are not necessarily voice-omitted. Assistant-output vocalization uses `speech.voice`, which is a fixed Kokoro voice enum, and is local-only (`vocalizer.ts:380-386`).

### C3. Setup download and `--check --json`

`omp setup speech` handles both STT and TTS (`packages/coding-agent/src/cli/setup-cli.ts:177-235`). TTS downloads the configured *local* speech-role model through `downloadTtsModel` and warms the local worker (`:213-234`; `packages/coding-agent/src/tts/downloader.ts:34-63`). This tag's only local TTS model is `kokoro`, repo `onnx-community/Kokoro-82M-v1.0-ONNX`, q8 (`packages/coding-agent/src/tts/models.ts:66-75`). Model weights live under the Transformers.js cache directory returned by `getTinyModelsCacheDir()` in a repo-named subdirectory (`downloader.ts:21-28`); the `kokoro-js` runtime is separately cached beside that directory at `tts-runtime/kokoro-1.2.1` (`packages/coding-agent/src/tts/runtime.ts:4-17`). The installed CLI's `--check --json` does not download; it reports component readiness/status and exits 1 if either is missing (`setup-cli.ts:251-261`).

Observed on this machine: output was `Speech-to-Text model: ready false, parakeet-tdt-0.6b-v3 — not downloaded` and `Text-to-Speech model: ready false, kokoro — model/runtime not installed`. The overall command exited 1. Once installed, code reports `{ "ready": true, "status": "kokoro" }` for TTS and the corresponding STT key as status (`setup-cli.ts:191-217,251-261`).

Model-card size: q8 ONNX weights are listed as **92.4 MB** (Hugging Face model card); runtime package dependencies/cache add further unquantified bytes. Thus 92.4 MB is not the full setup download. Source does not state total transfer size. Sources: [omp model spec](https://github.com/can1357/oh-my-pi/blob/v18.18.7/packages/coding-agent/src/tts/models.ts), [Hugging Face ONNX model card](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX).

## D. Kokoro and Vietnamese

The model card for the exact ONNX repository identifies language `en` / English and lists American and British voices; it has no Vietnamese language or voice ([Hugging Face card](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX)). Omp's curated list likewise contains American/British voices only (`packages/coding-agent/src/tts/models.ts:34-53`), and its configured local Kokoro model is the ONNX model above (`:66-75`). `kokoro-js` is the runtime wrapper ([upstream repo](https://github.com/hexgrad/kokoro)); the model card's own supported-language metadata is the direct evidence for the ONNX model version used here.

There is no Vietnamese language selection or translation/romanization pass in omp's local vocalizer: normal cleanup processes text/markdown, then feeds the original speakable text to Kokoro (`packages/coding-agent/src/tts/vocalizer.ts:8-19,365-386`). What audio Kokoro produces for Vietnamese input is not specified as supported; intelligible Vietnamese pronunciation should be treated as unsupported/unconfirmed, not promised.

## What a desktop host can do

- **Live voice without Codex:** **not possible** through the current omp `live_start`/`live_connect` path without an `openai-codex` OAuth credential; the endpoint, model, and credentials are hardwired. A host can provide its own separate realtime/WebRTC provider implementation, but that is outside omp's current live transport and needs an omp change for integration with omp's `/live` or RPC live commands.
- **Vietnamese TTS of replies:** **possible with a desktop-host-owned TTS pipeline**: consume assistant delta/final RPC frames and send text to a Vietnamese-capable local or cloud TTS endpoint. Using omp's built-in local Kokoro reply vocalizer for Vietnamese is **not supported by its model language/voice metadata**. Using a custom OpenAI-compatible TTS model through the speech role is possible for the `tts` tool, but making the built-in reply vocalizer use it **needs an omp change** (remove/alter the local-inference-only filter and define suitable voice/config behavior).
