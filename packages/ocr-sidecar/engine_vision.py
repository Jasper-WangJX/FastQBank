"""macOS OCR engine — Apple Vision (VNRecognizeTextRequest) via pyobjc.

Kept separate from the Windows engine (``engine_paddle.py``) so the two
platforms are maintained independently; ``ocr_server.py`` picks one by
platform at startup.

Vision is a macOS system framework, so this engine ships no model files and
links no heavy native libraries — that keeps the signed/notarized .app small
and sidesteps the dylib-signing pain a bundled ML runtime would add. Target
users capture English-only questions, so recognition is pinned to en-US.
"""

import Quartz
import Vision
from Foundation import NSData

NAME = "apple-vision"

# VNRequestTextRecognitionLevel: 0 = Fast, 1 = Accurate. Exam screenshots
# are static and small, so accuracy is worth the (still sub-second) cost.
_LEVEL_ACCURATE = 1


class Engine:
    name = NAME
    # A fresh VNImageRequestHandler is created per call and shares no state,
    # so requests are independent — no server-side lock needed.
    needs_lock = False

    def __init__(self, bundled_dir: str | None = None) -> None:
        # Nothing to load: Vision is a system framework. Touch the symbol so
        # an unexpectedly-missing framework fails here (surfaced via /healthz)
        # rather than on the first /ocr request.
        _ = Vision.VNRecognizeTextRequest

    def recognize(self, png_bytes: bytes) -> tuple[int, int, list[dict]]:
        data = NSData.dataWithBytes_length_(png_bytes, len(png_bytes))
        src = Quartz.CGImageSourceCreateWithData(data, None)
        cg = (
            Quartz.CGImageSourceCreateImageAtIndex(src, 0, None)
            if src is not None
            else None
        )
        if cg is None:
            raise ValueError("bad_image")
        w = Quartz.CGImageGetWidth(cg)
        h = Quartz.CGImageGetHeight(cg)

        req = Vision.VNRecognizeTextRequest.alloc().init()
        req.setRecognitionLevel_(_LEVEL_ACCURATE)
        req.setRecognitionLanguages_(["en-US"])
        req.setUsesLanguageCorrection_(True)

        handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(
            cg, None
        )
        ok, err = handler.performRequests_error_([req], None)
        if not ok:
            raise RuntimeError(f"vision_failed: {err}")

        lines = []
        for obs in req.results() or []:
            cands = obs.topCandidates_(1)
            if not cands:
                continue
            cand = cands[0]
            # Vision returns a normalized rect with origin at the BOTTOM-left;
            # convert to top-left pixel coordinates to match the contract's
            # 4-point bbox (the desktop confirm page expects top-left origin).
            bb = obs.boundingBox()
            x = bb.origin.x * w
            bw = bb.size.width * w
            bh = bb.size.height * h
            y_top = (1.0 - bb.origin.y - bb.size.height) * h
            lines.append(
                {
                    "text": cand.string(),
                    "score": float(cand.confidence()),
                    "bbox": [
                        [x, y_top],
                        [x + bw, y_top],
                        [x + bw, y_top + bh],
                        [x, y_top + bh],
                    ],
                }
            )
        return int(w), int(h), lines
