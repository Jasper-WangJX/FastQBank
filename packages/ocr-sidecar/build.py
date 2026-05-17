"""Build the OCR sidecar into a standalone, OFFLINE executable.

Run with the ocr-sidecar venv python (it has paddle/paddleocr +
pyinstaller):

    .venv\\Scripts\\python.exe build.py

What it does:
  1. Make sure the PaddleOCR det/rec/cls models are cached locally
     (instantiates PaddleOCR once — downloads on first run).
  2. Stage those three model dirs into ./_models/{det,rec,cls} so the
     spec can bundle them; at runtime ocr_server.py points PaddleOCR at
     them (sys._MEIPASS/models) → no network needed on the user's box.
  3. Run PyInstaller (onedir — paddle is huge; onedir starts faster and
     is far more reliable than onefile). Output: ./dist/ocr_server/.

electron-builder then copies ./dist/ocr_server via extraResources.
"""

import glob
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STAGE = os.path.join(HERE, "_models")


def stage_models() -> None:
    """Copy the cached det/rec/cls *_infer dirs into ./_models."""
    # Ensure the cache exists (download on first build only).
    from paddleocr import PaddleOCR

    print("[build] ensuring PaddleOCR models are cached...")
    PaddleOCR(use_angle_cls=True, lang="en", show_log=False)

    cache = os.path.join(os.path.expanduser("~"), ".paddleocr", "whl")
    if not os.path.isdir(cache):
        sys.exit(f"[build] model cache not found at {cache}")

    if os.path.isdir(STAGE):
        shutil.rmtree(STAGE)
    os.makedirs(STAGE)

    for kind in ("det", "rec", "cls"):
        # Exactly one *_infer dir per kind; glob so we don't hardcode the
        # version-specific model name.
        matches = glob.glob(
            os.path.join(cache, kind, "**", "*_infer"), recursive=True
        )
        if not matches:
            sys.exit(f"[build] no *_infer dir for '{kind}' under {cache}")
        src = matches[0]
        dst = os.path.join(STAGE, kind)
        shutil.copytree(src, dst)
        print(f"[build] staged {kind}: {src} -> {dst}")


def run_pyinstaller() -> None:
    try:
        import PyInstaller.__main__  # noqa: F401
    except ImportError:
        sys.exit(
            "[build] PyInstaller missing — install it into this venv:\n"
            "        .venv\\Scripts\\python.exe -m pip install pyinstaller"
        )
    import PyInstaller.__main__ as pi

    print("[build] running PyInstaller...")
    pi.run([
        os.path.join(HERE, "ocr_sidecar.spec"),
        "--noconfirm",
        "--clean",
        f"--distpath={os.path.join(HERE, 'dist')}",
        f"--workpath={os.path.join(HERE, 'build')}",
    ])
    out = os.path.join(HERE, "dist", "ocr_server", "ocr_server.exe")
    print(
        f"[build] done -> {out}"
        if os.path.isfile(out)
        else f"[build] WARNING: expected exe not found at {out}"
    )


if __name__ == "__main__":
    stage_models()
    run_pyinstaller()
