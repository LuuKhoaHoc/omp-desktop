# Vietnamese TTS for a desktop coding assistant

**Research date:** 2026-11-11. Primary-source claims are linked inline. No models were run or auditioned for this report; no independent MOS or 20-word latency measurements are claimed. Most model cards do not test Vietnamese tones, regional accents, numeric normalization, abbreviations, or English technical terms in code-switched sentences. Treat those as required acceptance tests, not assumed capabilities.

## Shortlist

| Rank / purpose | Recommendation | Rationale and caveat |
|---|---|---|
| Local quality | **VieNeu-TTS v3 Turbo** | Vietnamese-first, bilingual En/Vi, 25 preset voices, ONNX CPU mode, reported ~0.5 RTF on a 12th-gen i5. Upstream claims first frame ~115 ms on RTX 3060, not this machine. Apache-2.0. Heavy Python/model download. [Repo and README](https://github.com/pnnbao97/VieNeu-TTS), [PyPI docs](https://github.com/pnnbao97/VieNeu-TTS/blob/main/README_PYPI.md) |
| Light local | **Piper `piper-tts` + vetted Vietnamese ONNX voice** | Small model and native CPU CLI, direct WAV output. Community voice card/terms vary; official current voice list does not establish maintained Vietnamese voices. GPL engine distribution needs notice/compliance; voice license separate. [Piper docs](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/VOICES.md) |
| Free online | **Microsoft Edge TTS through `edge-tts`** | `vi-VN-HoaiMyNeural`, `vi-VN-NamMinhNeural`; no API key. Third-party client of consumer service, not an officially supported public API. Do not rely on its terms/access for a commercial product. [Microsoft language/voice list](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support), [edge-tts](https://github.com/rany2/edge-tts) |
| Paid cloud | **FPT.AI Speech** | Vietnamese service, official API, published 100,000 characters/month free tier and paid packs. Commercial terms/account required; proprietary API, no OpenAI endpoint documented. [API](https://docs.fpt.ai/docs/en/speech/api/text-to-speech), [pricing](https://docs.fpt.ai/docs/en/speech/documentation/tts-pricing) |

The GTX 1650 4 GB is not a reason to use GPU for short local replies. VieNeu states CPU ONNX is usually faster for a short interactive call; GPU benefits long/batched throughput. Its cited GPU timing is RTX 3060, not GTX 1650. For an OpenAI-shaped local endpoint, VieNeu upstream server supports `POST /v1/audio/speech` and streaming. Piper does not natively.

## Local and open models

| Model | Vietnamese evidence / voices | Licence and commercial use | Footprint, latency, streaming/API, cross-platform |
|---|---|---|---|
| **VieNeu-TTS v3 Turbo** | Vietnamese-first, bilingual En/Vi, 25 built-in voices; instant voice cloning. No controlled tone/accent/technical-text MOS. | Repository and v3 Turbo card state Apache-2.0; confirm bundled artifacts' terms. | 48 kHz. Upstream reports CPU RTF ~0.5 on 12th-gen i5, ~115 ms first audio on RTX 3060. Torch-free ONNX CPU. GPU adds Torch/Transformers; short replies favor CPU. `infer_stream`; upstream FastAPI OpenAI-compatible streaming. `pip install vieneu` / `uv` environment. Linux/macOS CPU documented, Windows standalone installer documented; macOS installer not yet. Size not stated. |
| **VieNeu-TTS v3 Nano** | Six preset voices in PyPI guide; weaker English/code-switching, no frame streaming. | Check artifact licence at download. | 48M parameters, 24 kHz; upstream desktop CPU RTF .11–.22, lower quality. Python package. No verified OpenAI endpoint for Nano. |
| **viXTTS** (capleaf/thinhlpg) | Vietnamese XTTS-v2 fine-tune, voice cloning; no validated regional accent or bilingual code-switch score. [Card](https://huggingface.co/capleaf/viXTTS) | `coqui-public-model-license`; commercial use is restricted absent a separate commercial licence. [Coqui terms](https://coqui.ai/cpml) | Large PyTorch model; no trustworthy size/CPU RTF found. Python/Coqui across OSes with dependency friction; wrappers possible, no guaranteed API or TTFA. |
| **F5-TTS fine-tunes** (EraX-Smile, hynt ViVoice) | Vietnamese fine-tunes; no accent/MOS for coding text found. [ViVoice card](https://huggingface.co/hynt/F5-TTS-Vietnamese-ViVoice) | ViVoice is **CC-BY-NC-SA-4.0, non-commercial**. Verify EraX-Smile’s card independently. | PyTorch/vocoder and checkpoint download; no supported light installer or 4 GB GPU benchmark. API/streaming wrapper-dependent. |
| **Piper current OHF `piper-tts`**, community `vais1000`, `vivos`, `25hours_single` | VITS ONNX; Vietnamese dataset voice is not evidence of north/south balance or English terms. OHF voice list currently does not list vi; community model listing is distinct. [Voice catalogue](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/VOICES.md), [HF files](https://huggingface.co/rhasspy/piper-voices/tree/main/vi/vi_VN) | Engine GPL-3.0. Each model has its own `MODEL_CARD`; Piper says some voice models are restrictive. [Licensing](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/LICENSING.md) | Small voice-specific ONNX + JSON files; CPU, GPU unnecessary. Vietnamese RTF/TTFA unknown. CLI writes WAV; no native OpenAI API. `uv tool install piper-tts` where wheel exists; check each OS build. |
| **sherpa-onnx** (`vits-piper-vi`, MMS vie) | Runtime/model catalogue includes Vietnamese model options; evidence and accent quality are model-specific. No Vietnamese inference from multilingual Matcha/Kokoro label unless model metadata lists vi. [TTS model catalogue](https://k2-fsa.github.io/sherpa/onnx/tts/) | Runtime and each model have distinct licences. | ONNX, CPU-friendly, model size/RTF vary. C++ binaries/Python on major OSes; streaming depends on model. No OpenAI server guaranteed. |
| **Meta MMS `facebook/mms-tts-vie`** | Vietnamese model, but no evidence of English mixing or accent choice. [Model](https://huggingface.co/facebook/mms-tts-vie) | **CC-BY-NC-4.0, non-commercial.** [MMS project](https://github.com/facebookresearch/fairseq/tree/main/examples/mms) | Python/fairseq or Transformers; size in model files, CPU speed unverified. No native streaming/OpenAI endpoint. |
| **Kokoro-82M** | Current official model language list excludes Vietnamese; OMP `local/kokoro` voices are English. [Card](https://huggingface.co/hexgrad/Kokoro-82M) | Apache-2.0. | 82M, light, but no verified Vietnamese checkpoint. Kokoro-FastAPI exposes OpenAI-compatible speech API for supported models, not Vietnamese. |
| **Chatterbox multilingual** | 23-language card includes Vietnamese; no regional/numeric/code-switch score. [Repo](https://github.com/resemble-ai/chatterbox), [card](https://huggingface.co/ResembleAI/chatterbox) | Code MIT, weights **CC-BY-NC-4.0, non-commercial**. | Large Torch; 4GB fit/RTF not established. Python, wrappers needed for streaming/API. |
| **Fish Speech / OpenAudio** | Vietnamese quality/support not verified for the current checkpoint in primary sources examined. [Repo](https://github.com/fishaudio/fish-speech) | Version-specific weights; inspect model card, not just code licence. | Large, GPU-oriented; GTX 1650 likely constrained. Docker/Python; TTFA and OpenAI compatibility depend on server. |
| **CosyVoice 2/3** | Multilingual research system; exact Vietnamese language/model and quality require checking release-specific metadata. [Repo](https://github.com/FunAudioLLM/CosyVoice) | Check code, model, and dataset terms separately. | Large Python/Torch; no 4GB recipe established. Streaming exists in project; API varies. |
| **MeloTTS** | Vietnamese listed among supported languages; no evidence of north/south or coding-text performance. [Repo](https://github.com/myshell-ai/MeloTTS) | MIT code; verify model/data terms. | Python; CPU-capable, RTF unknown. No native OpenAI speech endpoint. |
| **Coqui XTTS-v2 stock** | Vietnamese in supported language list, but no Vietnamese-specific MOS. [Card](https://huggingface.co/coqui/XTTS-v2) | Coqui public model terms restrict commercial use without separate agreement. | Large Torch model, CPU slow, 4GB GPU tight; streaming inference available, OpenAI API needs wrapper. |
| **Orpheus / Dia** | Official releases do not establish Vietnamese support; Orpheus primarily English and Dia English dialogue. [Orpheus](https://github.com/canopylabs/Orpheus-TTS), [Dia](https://github.com/nari-labs/dia) | Check specific code and weights. | Large GPU-first models; no light cross-platform Vietnamese install or endpoint verified. |
| **VinAI XPhoneBERT / Zalo research** | XPhoneBERT is Vietnamese phoneme representation, not an installable TTS engine. [Repo](https://github.com/VinAIResearch/XPhoneBERT) | Research project/model terms apply. | No maintained desktop TTS deployment identified. |
| **vietTTS (NTT123), VietTTS (dangvansam)** | Older Vietnamese projects; no current evidence for natural English-Vietnamese coding speech, regional variants, or maintained deployment. [NTT123](https://github.com/NTT123/vietTTS), [dangvansam](https://github.com/dangvansam/VietTTS) | Check each repository/model terms. | Current size, RTF, streaming, and cross-platform installers unconfirmed. |
| **ZipVoice Vietnamese** | No maintained first-party Vietnamese checkpoint verified. | Unconfirmed. | Unconfirmed; not shortlisted. |

## Online services

| Service | Vietnamese / commercial terms | Free allowance and published price | API / app fit |
|---|---|---|---|
| **Edge TTS** | HoaiMy + NamMinh neural voices. Third-party client, consumer endpoint; not a documented public API licence. | No API key or published production quota. | `edge-tts` client. `openai-edge-tts` offers third-party OpenAI-shaped server, inheriting unofficial endpoint risk. Network TTFA unknown. |
| **gTTS** | Vietnamese supported via Google Translate; limited voice control, not Google Cloud TTS. Automated client terms do not grant a clear commercial API right. [Repo](https://github.com/pndurette/gTTS) | No supported API quota/price. | Third-party client, not OpenAI-compatible. |
| **Google Cloud TTS** | vi-VN voices across supported types; Chirp 3 HD docs list Vietnamese and streaming. Do not infer accent/code-switch quality. [Voices](https://cloud.google.com/text-to-speech/docs/list-voices-and-types), [Chirp](https://cloud.google.com/text-to-speech/docs/chirp3-hd) | Billing required. Free usage and per-million-character prices vary by model; live official table is authority. [Pricing](https://cloud.google.com/text-to-speech/pricing) | Official API/SDK, all desktop OS; app adapter needed, not OpenAI API. |
| **Azure Speech** | Vietnamese TTS / vi-VN voices listed in official language matrix. [Support](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support) | F0 allowance and paid rates subject to current official pricing/region; verify [pricing](https://azure.microsoft.com/en-us/pricing/details/speech/). | REST/SDK all OS; not OpenAI speech endpoint. |
| **FPT.AI** | Vietnamese voice API. | **100,000 chars/month** free, low speed/queued/usage limits/no support. Packs: 500,000 VND / 1.5m chars; 1m / 4m; 2m / 10m; 5m / 27m. [Pricing](https://docs.fpt.ai/docs/en/speech/documentation/tts-pricing) | Proprietary REST, adapter required; network TTFA not published. |
| **Viettel AI** | Vietnamese TTS service. [Product](https://viettelai.vn/en/chuyen-giong-noi) | Current public free quota/price not confirmed in source checked. | API account; compatibility/latency unconfirmed. |
| **Zalo AI TTS** | Vietnamese-focused service. [Product](https://zalo.ai/products/text-to-audio-converter) | Current free quota/price not confirmed. | API compatibility and TTFA unconfirmed. |
| **Vbee** | Vietnamese voice service; [API/pricing](https://vbee.vn/en/pricing). | Current exact API free quota not confirmed. | Proprietary API; compatibility/TTFA unconfirmed. |
| **ElevenLabs** | Vietnamese language support on some models; language coverage does not confirm accent. [TTS docs](https://elevenlabs.io/docs/capabilities/text-to-speech) | Free/paid character limits and commercial rights change by plan; verify live [pricing](https://elevenlabs.io/pricing). | Streaming API; OpenAI clients may require adapter. |
| **OpenAI `gpt-4o-mini-tts`** | Vietnamese quality/accent guarantees not confirmed; official model page currently marks model deprecated. [Guide](https://developers.openai.com/api/docs/guides/text-to-speech), [model](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts) | Paid API; no free quota confirmed. | Native `POST /audio/speech`; avoid new integration to deprecated model. |
| **xAI Grok TTS** | OMP lists `xai/grok-tts`; Vietnamese quality/voice support and current price not confirmed from first-party evidence. | Free quota not confirmed; treat as paid until official pricing says otherwise. | OMP backend uses `/tts`; not established as OpenAI `/v1/audio/speech`. |
| **Gemini TTS** | Multilingual generation; exact Vietnamese voice/availability must be verified on current model docs. [Guide](https://ai.google.dev/gemini-api/docs/speech-generation) | Free and paid access varies by model/region; live [pricing](https://ai.google.dev/gemini-api/docs/pricing) is authority. | Google API, not OpenAI-compatible; TTFA unknown. |

## Shortlist commands and detection

Commands below keep Python packages in an isolated environment; model artifacts download separately. Check OS wheels before offering a Settings installer. App detection should check executable/import plus model files and complete a short synthesis probe; a package being installed is not enough.

### VieNeu-TTS v3 Turbo

Linux/macOS:

```sh
uv venv "$HOME/.local/share/omp-tts/vieneu"
uv pip install --python "$HOME/.local/share/omp-tts/vieneu/bin/python" vieneu
```

Windows PowerShell:

```powershell
uv venv "$env:LOCALAPPDATA\omp-tts\vieneu"
uv pip install --python "$env:LOCALAPPDATA\omp-tts\vieneu\Scripts\python.exe" vieneu
```

Create `speak.py` in managed environment directory:

```python
from vieneu import Vieneu
tts = Vieneu(backend="onnx")
audio = tts.infer("Xin chào, bản build trên Linux đã chạy lúc 10 giờ 30.", voice="Hải Đăng")
tts.save(audio, "reply.wav")
```

Run with managed Python: `.../bin/python speak.py`, or Windows `...\Scripts\python.exe speak.py`. Detect with managed Python import probe `from vieneu import Vieneu`, required model-cache check, then WAV probe. This is a Python SDK, not a verified standalone CLI; macOS currently uses manual `uv` setup. For compatible server, upstream app supports `/v1/audio/speech`. [Install/API](https://github.com/pnnbao97/VieNeu-TTS/blob/main/README_PYPI.md)

### Piper

```sh
uv tool install piper-tts
piper --help
```

Download the vetted voice `.onnx` and `.onnx.json` from its model source, then:

```sh
printf '%s\n' 'Xin chào, bản build trên Linux đã chạy lúc 10 giờ 30.' | piper --model ./vi_voice.onnx --config ./vi_voice.onnx.json --output_file reply.wav
```

Detect the executable, help/version response, both model files and a WAV probe. Verify model licence and OS wheel availability. Engine GPL-3.0 affects redistribution; do not silently bundle it in a proprietary app.

### Edge TTS, unofficial

```sh
uv tool install edge-tts
edge-tts --voice vi-VN-HoaiMyNeural --text 'Xin chào, bản build trên Linux đã chạy lúc 10 giờ 30.' --write-media reply.mp3
ffmpeg -y -i reply.mp3 reply.wav
```

Switch to `vi-VN-NamMinhNeural` for the other listed voice. Detect by a short online synthesis probe. `openai-edge-tts` is a third-party wrapper, not a Microsoft-endorsed API.

### FPT.AI

Create provider account/API credentials, then call the official TTS API from the app's HTTPS adapter. No SDK install is required. Follow current API request/voice schema, do not store credentials in plaintext. Detect credentials and connectivity through a non-billable voice/list endpoint if offered; otherwise synthesize a user-approved short phrase and inspect quota. Pricing: 100k chars/month free with limits, then published character packs above. [API docs](https://docs.fpt.ai/docs/en/speech/api/text-to-speech)

## Test before enabling a voice

Use the same sentences and collect northern/southern listener ratings. Measure cold and warm TTFA until first playable chunk, not total WAV time:

- “Chào ní, mình đã chạy npm test và cargo check xong.”
- “Lỗi HTTP 401 từ API /v1/audio/speech; kiểm tra OAuth2 và token TTL.”
- “Bản build 2.4.1 tải 1,024 MB trong 3 phút 15 giây.”
- “PR #128 đã merge vào main; CI chạy trên Linux, Windows và macOS.”
- “SQL query timeout sau khi gọi endpoint /users/:id.”

Record model/cache warm and cold results separately on the target GTX 1650 and CPU. Published RTF and first-frame times depend on hardware, batch, and server state; this report has no firsthand timing.

## Scope notes

Model license is not necessarily training-data permission. Free online access is not a promise of stable endpoint or commercial use. Cloud pricing, free tiers, language lists, model IDs and voice availability change; recheck vendor pages before shipping. Where primary sources did not substantiate model quality, quota, license or endpoint support, the table says unconfirmed rather than guessing.