"""PaddleOCR feasibility spike (roadmap stage 5, Step 0 decision gate).

This is NOT shipped code. It exists only to answer one question before
any Electron / sidecar work is written: does PaddleOCR read real exam
screenshots well enough, and fast enough, to be usable?

Stack: paddlepaddle 2.6.2 + paddleocr 2.9.1 (the classic 2.x line). We
downgraded from 3.x on purpose: paddlepaddle 3.3.1's oneDNN path crashes
under its new executor ("ConvertPirAttribute2RuntimeAttribute not
support [pir::ArrayAttribute<pir::DoubleAttribute>]"), which forced
mkldnn off and a ~4-5s/image floor. On 2.6.2 oneDNN works, so
enable_mkldnn=True gives the fast CPU path, and the 2.x API is the
well-documented `.ocr(img, cls=True)` (far better PyInstaller prior art
for the shipped sidecar than 3.x + paddlex).

Target users capture English-only questions, so lang="en". Validate the
spike with ENGLISH exam screenshots.

Usage (from packages/ocr-sidecar/, with the venv active):

    python spike.py samples/q1.png samples/q2.png ...

For every image it prints, per detected line, the recognized text and
the confidence score, plus the wall-clock time. The FIRST image pays the
one-time model load (slow); later images are the realistic warm-path
latency that the screenshot flow will actually feel.

Pass / fail gate (judge by eye against the originals):
  - stem + options overall readable rate >= 90% (a few wrong chars are
    fine, the confirm page lets the user fix them);
  - option markers (A. / A) / (A) / 1. 2.) reliably show up in the text
    so the front-end regex splitter has something to latch onto;
  - warm single-image recognition < 3s.

If it fails: tune (det_db_box_thresh / use_angle_cls / upscale the
image, <=2 rounds) -> try the server det/rec models -> if only formulas
are bad but text is fine, accept it (type LaTeX by hand, note for
Phase 6) -> if unusable overall, stop and revisit with the user. 30
minutes, then decide.
"""

import sys
import time


def extract_lines(page: object) -> list[tuple[str, float]]:
    """Pull (text, score) pairs out of a 2.x result page.

    `ocr.ocr(img, cls=True)` returns one page per image; a page is a
    list of [bbox, (text, score)] entries, or None when nothing is
    detected.
    """
    if not page:
        return []
    out: list[tuple[str, float]] = []
    for entry in page:
        try:
            (_bbox, (text, score)) = entry
            out.append((text, float(score)))
        except Exception:  # noqa: BLE001 - spike: tolerate layout drift
            continue
    return out


def main(image_paths: list[str]) -> int:
    if not image_paths:
        print(__doc__)
        print("error: pass at least one image path", file=sys.stderr)
        return 2

    # Imported lazily so the usage message above works even before the
    # heavy deps are installed.
    from paddleocr import PaddleOCR

    print("Loading PaddleOCR (lang=en, angle-cls, mkldnn on) — first run "
          "downloads + loads models, this is the slow one-time cost...")
    t0 = time.perf_counter()
    ocr = PaddleOCR(
        use_angle_cls=True,
        lang="en",
        enable_mkldnn=True,  # oneDNN CPU acceleration (works on 2.6.2)
        show_log=False,
    )
    print(f"model ready in {time.perf_counter() - t0:.1f}s\n")

    for img in image_paths:
        print(f"=== {img} ===")
        t1 = time.perf_counter()
        try:
            result = ocr.ocr(img, cls=True)
        except Exception as exc:  # noqa: BLE001 - spike: surface anything
            print(f"  OCR FAILED: {exc!r}\n", file=sys.stderr)
            continue
        elapsed = time.perf_counter() - t1

        page = result[0] if result else None
        lines = extract_lines(page)
        if not lines:
            print("  (no text detected)")
        else:
            for text, score in lines:
                print(f"  [{score:.3f}] {text}")
        print(f"  -> {len(lines)} lines in {elapsed:.2f}s\n")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
