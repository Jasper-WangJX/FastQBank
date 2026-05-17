# PyInstaller spec for the OCR sidecar. onedir (not onefile): paddle is
# hundreds of MB — onedir avoids re-extracting it to a temp dir on every
# launch and is far more reliable. Run via build.py (it stages the
# models into ./_models first).
#
# paddle / paddleocr drag in a long tail of native libs and dynamically
# imported submodules that PyInstaller's static analysis misses, so we
# collect_all() the whole dependency set rather than hand-listing.

import os
from PyInstaller.utils.hooks import collect_all

datas = []
binaries = []
hiddenimports = []

# Everything paddle/paddleocr touches at runtime. Missing one usually
# surfaces as a ModuleNotFoundError / missing .dll at first /ocr.
for pkg in (
    "paddle",
    "paddleocr",
    # paddleocr's flat install ships these as SEPARATE top-level
    # packages it imports at runtime (e.g. `from tools.infer ...`);
    # collect_all('paddleocr') doesn't reach them.
    "tools",
    "ppocr",
    "ppstructure",
    "skimage",
    "scipy",
    "sklearn",
    "shapely",
    "pyclipper",
    "imgaug",
    "lmdb",
    "imageio",
    "albumentations",
    "numpy",
    "cv2",
    "pandas",
    # paddle/skimage import Cython at runtime; without its bundled
    # Utility/*.cpp data files the model load dies with a
    # FileNotFoundError on Cython/Utility/CppSupport.cpp.
    "Cython",
):
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception as exc:  # noqa: BLE001 - a missing optional pkg is ok
        print(f"[spec] collect_all({pkg}) skipped: {exc}")

# The staged det/rec/cls models -> bundled at <_MEIPASS>/models/...
_models = os.path.join(os.path.abspath(SPECPATH), "_models")
if os.path.isdir(_models):
    datas += [(_models, "models")]
else:
    raise SystemExit("[spec] ./_models missing — run build.py (it stages models)")

a = Analysis(
    ["ocr_server.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib"],  # not used by the server path
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="ocr_server",
    debug=False,
    strip=False,
    upx=False,
    console=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="ocr_server",
)
