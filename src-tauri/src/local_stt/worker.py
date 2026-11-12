"""Persistent transcribe-cpp worker driven by omp-desktop over JSON lines."""

import array
import base64
import json
import sys
import traceback

import transcribe_cpp


def _emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _log_callback(level, msg):
    if level <= 3 and msg:
        sys.stderr.write(f"[transcribe-cpp:{level}] {msg}\n")
        sys.stderr.flush()


def _decode_pcm(b64_data):
    raw = base64.b64decode(b64_data)
    pcm = array.array("f")
    pcm.frombytes(raw)
    if sys.byteorder != "little":
        pcm.byteswap()
    return pcm


class State:
    def __init__(self):
        self.vad_model = None
        self.vad_session = None
        self.vad_path = None
        self.asr_model = None
        self.asr_session = None
        self.asr_path = None
        self.asr_backend = None

    def close_vad(self):
        if self.vad_session is not None:
            self.vad_session.close()
            self.vad_session = None
        if self.vad_model is not None:
            self.vad_model.close()
            self.vad_model = None
        self.vad_path = None

    def close_asr(self):
        if self.asr_session is not None:
            self.asr_session.close()
            self.asr_session = None
        if self.asr_model is not None:
            self.asr_model.close()
            self.asr_model = None
        self.asr_path = None
        self.asr_backend = None

    def load_vad(self, path):
        if self.vad_path == path and self.vad_session is not None:
            return {"ok": True}
        self.close_vad()
        model = transcribe_cpp.Model(path, backend="cpu")
        session = model.vad_session()
        self.vad_model = model
        self.vad_session = session
        self.vad_path = path
        return {"ok": True}

    def load_asr(self, path, backend):
        if self.asr_path == path and self.asr_backend == backend and self.asr_session is not None:
            return {
                "ok": True,
                "backend": self.asr_model.backend,
                "device": self.asr_model.device.name,
            }
        self.close_asr()
        effective = backend
        try:
            model = transcribe_cpp.Model(path, backend=backend)
        except Exception:
            if backend == "auto":
                model = transcribe_cpp.Model(path, backend="cpu")
                effective = "cpu"
            else:
                raise
        session = model.session()
        self.asr_model = model
        self.asr_session = session
        self.asr_path = path
        self.asr_backend = backend
        return {
            "ok": True,
            "backend": model.backend if effective == backend else f"{model.backend} (fallback)",
            "device": model.device.name,
        }

    def vad_reset(self):
        if self.vad_session is not None:
            self.vad_session.stream_reset()
        return {"ok": True}

    def vad_feed(self, pcm_b64):
        if self.vad_session is None:
            raise RuntimeError("VAD model is not loaded")
        pcm = _decode_pcm(pcm_b64)
        res = self.vad_session.stream_feed(pcm)
        return {"ok": True, "probs": [float(p) for p in res.probs]}

    def transcribe(self, pcm_b64, language, vocabulary, prompt):
        if self.asr_session is None or self.asr_model is None:
            raise RuntimeError("ASR model is not loaded")
        pcm = _decode_pcm(pcm_b64)
        kwargs = {
            "language": language or None,
            "timestamps": "none",
        }
        if vocabulary and self.asr_model.supports("vocabulary"):
            kwargs["vocabulary"] = vocabulary
        if prompt and self.asr_model.supports("context_prompt"):
            kwargs["prompt"] = prompt
        result = self.asr_session.run(pcm, **kwargs)
        return {
            "ok": True,
            "text": (result.text or "").strip(),
            "language": result.language or "",
            "encodeMs": round(result.timings.encode_ms, 1),
            "decodeMs": round(result.timings.decode_ms, 1),
        }

    def unload(self):
        self.close_asr()
        self.close_vad()
        return {"ok": True}


def main():
    transcribe_cpp.set_log_callback(_log_callback)
    state = State()
    devices = []
    try:
        devices = [d.kind for d in transcribe_cpp.backends()]
    except Exception:
        pass
    _emit({
        "type": "ready",
        "version": transcribe_cpp.native_version(),
        "backends": devices,
    })

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            cmd = req.get("cmd")
            if cmd == "ping":
                res = {"ok": True}
            elif cmd == "load_vad":
                res = state.load_vad(req["path"])
            elif cmd == "load_asr":
                res = state.load_asr(req["path"], req.get("backend", "auto"))
            elif cmd == "vad_reset":
                res = state.vad_reset()
            elif cmd == "vad_feed":
                res = state.vad_feed(req["pcm_b64"])
            elif cmd == "transcribe":
                res = state.transcribe(
                    req["pcm_b64"],
                    req.get("language"),
                    req.get("vocabulary"),
                    req.get("prompt"),
                )
            elif cmd == "unload":
                res = state.unload()
            elif cmd == "shutdown":
                state.unload()
                _emit({"id": req_id, "ok": True})
                break
            else:
                res = {"ok": False, "error": f"unknown command: {cmd}"}
        except Exception as exc:
            traceback.print_exc(file=sys.stderr)
            res = {"ok": False, "error": str(exc)}
        if req_id is not None:
            res["id"] = req_id
        _emit(res)


if __name__ == "__main__":
    main()
