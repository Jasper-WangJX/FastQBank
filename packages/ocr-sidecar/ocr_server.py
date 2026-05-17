"""Local PaddleOCR HTTP sidecar (roadmap stage 5).

The Electron main process spawns this, waits for it to become ready, and
posts cropped PNG screenshots to it. We use HTTP over 127.0.0.1 (not
stdio): PaddleOCR/paddle log heavily to stdout/stderr, which would
corrupt any stdio framing, whereas HTTP gives clean request/response
boundaries, status codes and a health probe.

Contract
--------
Started as:  ocr_server(.exe) --port <PORT> --token <SHARED_TOKEN>
  --port   a free port the parent picked (net.createServer().listen(0)).
  --token  a random secret; every request must echo it in X-OCR-Token,
           so other local processes can't drive the sidecar.

GET /healthz
  -> 200 {"status":"ok","model_loaded":bool,"model_error":str|null}
  Always 200 so the parent can poll readiness; `model_loaded` flips true
  once the background model load finishes.

POST /ocr   (header X-OCR-Token, body = raw PNG bytes)
  -> 200 {"ok":true,"engine":"paddleocr","image":{"width":W,"height":H},
          "lines":[{"text":..,"score":..,"bbox":[[x,y]*4]}],
          "elapsed_ms":N}
  -> 401 {"ok":false,"error":"unauthorized"}      bad/missing token
  -> 503 {"ok":false,"error":"model_loading"}     model not ready yet
  -> 500 {"ok":false,"error":"model_init_failed"} model load failed
  -> 400 {"ok":false,"error":"bad_image"}         body isn't a image
  -> 500 {"ok":false,"error":"ocr_failed: .."}    inference threw
  The process never exits on a request error — it stays up for the next
  capture. An empty/blank image is a normal 200 with "lines":[].

Stack: paddlepaddle 2.6.2 + paddleocr 2.9.1, lang="en", oneDNN on. See
README "Stack" for why 2.x (3.x regresses oneDNN on the target box).
"""

import argparse
import hmac
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np

# --- Model: loaded once, in the background -------------------------------
# Lazy first-call init would freeze the first /ocr for ~tens of seconds
# (cold model load + first-run weight download). Instead a daemon thread
# loads it at startup and /healthz reports progress.

_model = None
_model_error: str | None = None
_model_lock = threading.Lock()  # PaddleOCR.ocr is not concurrency-safe.


def _bundled_model_kwargs() -> dict:
    """When frozen by PyInstaller, point PaddleOCR at the det/rec/cls
    models we shipped (build.py stages them, the spec bundles them under
    `models/`) so it never tries to download — fully offline."""
    base = getattr(sys, "_MEIPASS", None)
    if not base:
        return {}  # dev: use the ~/.paddleocr cache / auto-download
    md = os.path.join(base, "models")
    if not os.path.isdir(md):
        return {}
    return {
        "det_model_dir": os.path.join(md, "det"),
        "rec_model_dir": os.path.join(md, "rec"),
        "cls_model_dir": os.path.join(md, "cls"),
    }


def _load_model() -> None:
    global _model, _model_error
    try:
        from paddleocr import PaddleOCR

        model = PaddleOCR(
            use_angle_cls=True,
            lang="en",  # target users capture English-only questions
            enable_mkldnn=True,  # oneDNN CPU acceleration (works on 2.6.2)
            show_log=False,
            **_bundled_model_kwargs(),
        )
        with _model_lock:
            _model = model
        _log("model ready")
    except Exception as exc:  # noqa: BLE001 - report, keep server alive
        _model_error = f"{type(exc).__name__}: {exc}"
        _log(f"model init FAILED: {_model_error}")


def _log(msg: str) -> None:
    print(f"[ocr-sidecar] {msg}", file=sys.stderr, flush=True)


# --- Reading-order sort --------------------------------------------------


def _sort_reading_order(items: list) -> list:
    """PaddleOCR is roughly top-to-bottom already; bucket by line height
    so words on the same visual row stay left-to-right and the
    front-end splitter sees clean lines."""
    if not items:
        return items

    def top(it):
        return min(p[1] for p in it[0])

    def left(it):
        return min(p[0] for p in it[0])

    def height(it):
        ys = [p[1] for p in it[0]]
        return max(ys) - min(ys)

    heights = sorted(height(it) for it in items)
    median_h = heights[len(heights) // 2] or 10.0
    bucket = max(10.0, median_h * 0.7)
    return sorted(items, key=lambda it: (round(top(it) / bucket), left(it)))


# --- OCR -----------------------------------------------------------------


def _run_ocr(png_bytes: bytes) -> dict:
    arr = np.frombuffer(png_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("bad_image")
    h, w = img.shape[:2]

    t0 = time.perf_counter()
    with _model_lock:
        result = _model.ocr(img, cls=True)
    elapsed_ms = int((time.perf_counter() - t0) * 1000)

    # result is [page]; page is a list of [bbox, (text, score)] or None.
    page = result[0] if result else None
    lines = []
    for bbox, (text, score) in _sort_reading_order(page or []):
        lines.append(
            {
                "text": text,
                "score": float(score),
                "bbox": [[float(x), float(y)] for x, y in bbox],
            }
        )
    return {
        "ok": True,
        "engine": "paddleocr",
        "image": {"width": int(w), "height": int(h)},
        "lines": lines,
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
                "model_loaded": _model is not None,
                "model_error": _model_error,
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
        if _model is None:
            if _model_error is not None:
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
    threading.Thread(target=_load_model, daemon=True).start()

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
