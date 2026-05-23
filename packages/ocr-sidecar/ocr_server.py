"""Local OCR HTTP sidecar (roadmap stage 5).

The Electron main process spawns this, waits for it to become ready, and
posts cropped PNG screenshots to it. We use HTTP over 127.0.0.1 (not
stdio): the OCR engines log heavily to stdout/stderr, which would corrupt
any stdio framing, whereas HTTP gives clean request/response boundaries,
status codes and a health probe.

Contract
--------
Started as:  ocr_server(.exe) --port <PORT> --token <SHARED_TOKEN>
  --port   a free port the parent picked (net.createServer().listen(0)).
  --token  a random secret; every request must echo it in X-OCR-Token,
           so other local processes can't drive the sidecar.

GET /healthz
  -> 200 {"status":"ok","model_loaded":bool,"model_error":str|null}
  Always 200 so the parent can poll readiness; `model_loaded` flips true
  once the background engine load finishes.

POST /ocr   (header X-OCR-Token, body = raw PNG bytes)
  -> 200 {"ok":true,"engine":"paddleocr"|"apple-vision",
          "image":{"width":W,"height":H},
          "lines":[{"text":..,"score":..,"bbox":[[x,y]*4]}],
          "elapsed_ms":N}
  -> 401 {"ok":false,"error":"unauthorized"}      bad/missing token
  -> 503 {"ok":false,"error":"model_loading"}     engine not ready yet
  -> 500 {"ok":false,"error":"model_init_failed"} engine load failed
  -> 400 {"ok":false,"error":"bad_image"}         body isn't a image
  -> 500 {"ok":false,"error":"ocr_failed: .."}    inference threw
  The process never exits on a request error — it stays up for the next
  capture. An empty/blank image is a normal 200 with "lines":[].

Engines
-------
The platform-specific engine implementations live in their own files and
are maintained independently:
  - Windows: engine_paddle.py  (PaddleOCR, oneDNN CPU path)
  - macOS:   engine_vision.py  (Apple Vision system framework)
Exactly one is imported below, chosen by platform. Each exposes an
``Engine`` class with ``name``, ``needs_lock`` and
``recognize(png_bytes) -> (width, height, lines)``.
"""

import argparse
import hmac
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

if sys.platform == "darwin":
    from engine_vision import Engine
else:
    from engine_paddle import Engine

# --- Engine: loaded once, in the background ------------------------------
# Lazy first-call init would freeze the first /ocr while the engine loads
# (and, on Windows, downloads weights on first run). Instead a daemon thread
# loads it at startup and /healthz reports progress.

_engine = None
_engine_error: str | None = None
_engine_lock = threading.Lock()  # some engines are not concurrency-safe.


def _bundled_dir() -> str | None:
    """The PyInstaller extraction root when frozen, else None (dev)."""
    return getattr(sys, "_MEIPASS", None)


def _load_engine() -> None:
    global _engine, _engine_error
    try:
        engine = Engine(_bundled_dir())
        with _engine_lock:
            _engine = engine
        _log(f"engine ready: {engine.name}")
    except Exception as exc:  # noqa: BLE001 - report, keep server alive
        _engine_error = f"{type(exc).__name__}: {exc}"
        _log(f"engine init FAILED: {_engine_error}")


def _log(msg: str) -> None:
    print(f"[ocr-sidecar] {msg}", file=sys.stderr, flush=True)


# --- Reading-order sort --------------------------------------------------


def _sort_reading_order(lines: list[dict]) -> list[dict]:
    """The engines return lines roughly top-to-bottom already; bucket by
    line height so words on the same visual row stay left-to-right and the
    front-end splitter sees clean lines."""
    if not lines:
        return lines

    def top(ln: dict) -> float:
        return min(p[1] for p in ln["bbox"])

    def left(ln: dict) -> float:
        return min(p[0] for p in ln["bbox"])

    def height(ln: dict) -> float:
        ys = [p[1] for p in ln["bbox"]]
        return max(ys) - min(ys)

    heights = sorted(height(ln) for ln in lines)
    median_h = heights[len(heights) // 2] or 10.0
    bucket = max(10.0, median_h * 0.7)
    return sorted(lines, key=lambda ln: (round(top(ln) / bucket), left(ln)))


# --- OCR -----------------------------------------------------------------


def _run_ocr(png_bytes: bytes) -> dict:
    t0 = time.perf_counter()
    if _engine.needs_lock:
        with _engine_lock:
            w, h, lines = _engine.recognize(png_bytes)
    else:
        w, h, lines = _engine.recognize(png_bytes)
    elapsed_ms = int((time.perf_counter() - t0) * 1000)

    return {
        "ok": True,
        "engine": _engine.name,
        "image": {"width": int(w), "height": int(h)},
        "lines": _sort_reading_order(lines),
        "elapsed_ms": elapsed_ms,
    }


# --- HTTP ----------------------------------------------------------------


class Handler(BaseHTTPRequestHandler):
    # Set from main() so the handler can check the shared secret.
    token = ""

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args) -> None:  # quieter, to stderr
        _log("http " + (fmt % args))

    def do_GET(self) -> None:
        if self.path != "/healthz":
            self._send(404, {"ok": False, "error": "not_found"})
            return
        self._send(
            200,
            {
                "status": "ok",
                "model_loaded": _engine is not None,
                "model_error": _engine_error,
            },
        )

    def do_POST(self) -> None:
        if self.path != "/ocr":
            self._send(404, {"ok": False, "error": "not_found"})
            return
        if not hmac.compare_digest(
            self.headers.get("X-OCR-Token", ""), self.token
        ):
            self._send(401, {"ok": False, "error": "unauthorized"})
            return
        if _engine is None:
            if _engine_error is not None:
                self._send(500, {"ok": False, "error": "model_init_failed"})
            else:
                self._send(503, {"ok": False, "error": "model_loading"})
            return

        length = int(self.headers.get("Content-Length", 0))
        png = self.rfile.read(length) if length > 0 else b""
        if not png:
            self._send(400, {"ok": False, "error": "bad_image"})
            return

        try:
            self._send(200, _run_ocr(png))
        except ValueError:
            self._send(400, {"ok": False, "error": "bad_image"})
        except Exception as exc:  # noqa: BLE001 - stay alive for next call
            _log(f"ocr failed: {type(exc).__name__}: {exc}")
            self._send(
                500, {"ok": False, "error": f"ocr_failed: {type(exc).__name__}"}
            )


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--token", required=True)
    args = ap.parse_args(argv)

    Handler.token = args.token
    threading.Thread(target=_load_engine, daemon=True).start()

    httpd = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    httpd.daemon_threads = True
    _log(f"listening on 127.0.0.1:{args.port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
