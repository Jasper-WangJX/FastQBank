"""Windows OCR engine — PaddleOCR (paddlepaddle 2.6.2 + paddleocr 2.9.1).

This is the Windows side of the sidecar, kept in its own file so it can be
maintained independently of the macOS engine (``engine_vision.py``).
``ocr_server.py`` imports exactly one engine, chosen by platform at startup.

Why 2.x with oneDNN on (and not 3.x): see README "Stack". oneDNN gives the
fast CPU path on x86; it does not exist on Apple Silicon, which is why mac
uses Apple Vision instead of this engine.
"""

import os

import cv2
import numpy as np

NAME = "paddleocr"


def _bundled_model_kwargs(bundled_dir: str | None) -> dict:
    """When frozen by PyInstaller, point PaddleOCR at the det/rec/cls models
    bundled under ``<bundled_dir>/models`` so it never downloads — fully
    offline. In dev (``bundled_dir`` is None) fall back to the ~/.paddleocr
    cache / auto-download."""
    if not bundled_dir:
        return {}
    md = os.path.join(bundled_dir, "models")
    if not os.path.isdir(md):
        return {}
    return {
        "det_model_dir": os.path.join(md, "det"),
        "rec_model_dir": os.path.join(md, "rec"),
        "cls_model_dir": os.path.join(md, "cls"),
    }


class Engine:
    name = NAME
    needs_lock = True  # PaddleOCR.ocr is not concurrency-safe.

    def __init__(self, bundled_dir: str | None = None) -> None:
        from paddleocr import PaddleOCR

        self._ocr = PaddleOCR(
            use_angle_cls=True,
            lang="en",  # target users capture English-only questions
            enable_mkldnn=True,  # oneDNN CPU acceleration (works on 2.6.2)
            show_log=False,
            **_bundled_model_kwargs(bundled_dir),
        )

    def recognize(self, png_bytes: bytes) -> tuple[int, int, list[dict]]:
        arr = np.frombuffer(png_bytes, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("bad_image")
        h, w = img.shape[:2]

        result = self._ocr.ocr(img, cls=True)
        # result is [page]; page is a list of [bbox, (text, score)] or None.
        page = result[0] if result else None
        lines = []
        for bbox, (text, score) in page or []:
            lines.append(
                {
                    "text": text,
                    "score": float(score),
                    "bbox": [[float(x), float(y)] for x, y in bbox],
                }
            )
        return int(w), int(h), lines
