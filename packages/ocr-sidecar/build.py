"""Build the OCR sidecar into a standalone, OFFLINE executable.

Run with the ocr-sidecar venv python (it has the engine deps + pyinstaller):

    # Windows
    .venv\\Scripts\\python.exe build.py
    # macOS
    .venv/bin/python build.py

The two platforms ship different engines and are built independently:

  Windows (PaddleOCR, engine_paddle.py)
    1. Make sure the det/rec/cls models are cached locally (instantiate
       PaddleOCR once — downloads on first run).
    2. Stage them into ./_models so ocr_sidecar.spec can bundle them; at
       runtime ocr_server.py points PaddleOCR at sys._MEIPASS/models → no
       network needed on the user's box.
    3. Run PyInstaller via ocr_sidecar.spec. Output: ./dist/ocr_server/.

  macOS (Apple Vision, engine_vision.py)
    Vision is a system framework — there are NO models to stage and NO
    paddle. Just run PyInstaller via ocr_sidecar_mac.spec. Output:
    ./dist/ocr_server/.

electron-builder then copies ./dist/ocr_server via extraResources.
"""

import glob
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STAGE = os.path.join(HERE, "_models")
IS_MAC = sys.platform == "darwin"


def stage_models() -> None:
    """Windows only — copy the cached det/rec/cls *_infer dirs into
    ./_models."""
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


def run_pyinstaller(spec: str, exe_name: str) -> None:
    try:
        import PyInstaller.__main__  # noqa: F401
    except ImportError:
        pip = ".venv/bin/python" if IS_MAC else ".venv\\Scripts\\python.exe"
        sys.exit(
            "[build] PyInstaller missing — install it into this venv:\n"
            f"        {pip} -m pip install pyinstaller"
        )
    import PyInstaller.__main__ as pi

    print(f"[build] running PyInstaller ({spec})...")
    pi.run([
        os.path.join(HERE, spec),
        "--noconfirm",
        "--clean",
        f"--distpath={os.path.join(HERE, 'dist')}",
        f"--workpath={os.path.join(HERE, 'build')}",
    ])
    out = os.path.join(HERE, "dist", "ocr_server", exe_name)
    print(
        f"[build] done -> {out}"
        if os.path.isfile(out)
        else f"[build] WARNING: expected executable not found at {out}"
    )


if __name__ == "__main__":
    if IS_MAC:
        # Apple Vision engine: no models, no paddle — just freeze.
        run_pyinstaller("ocr_sidecar_mac.spec", "ocr_server")
    else:
        stage_models()
        run_pyinstaller("ocr_sidecar.spec", "ocr_server.exe")
