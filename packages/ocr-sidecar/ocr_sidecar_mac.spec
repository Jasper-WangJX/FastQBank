# PyInstaller spec for the macOS OCR sidecar — Apple Vision engine
# (engine_vision.py). Unlike the Windows spec there are NO bundled models
# and NO paddle: Vision is a system framework that ships with macOS. onedir
# (not onefile) to match the layout electron-builder's extraResources
# expects: dist/ocr_server/.
#
# pyobjc bridges Vision/Quartz/Foundation through the dynamic objc runtime,
# which PyInstaller's static analysis can't fully see, so collect_all() the
# bridge packages rather than hand-listing submodules.

from PyInstaller.utils.hooks import collect_all

datas = []
binaries = []
hiddenimports = []

for pkg in ("objc", "Foundation", "CoreFoundation", "Quartz", "Vision", "CoreML"):
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception as exc:  # noqa: BLE001 - a missing optional pkg is ok
        print(f"[spec] collect_all({pkg}) skipped: {exc}")

a = Analysis(
    ["ocr_server.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    # Keep the Windows engine and its heavy native deps out of the mac
    # bundle entirely — ocr_server.py only imports engine_paddle on
    # non-darwin, but PyInstaller's static analysis would still pull the
    # whole chain in. Excluding engine_paddle cuts it at the source.
    excludes=[
        "engine_paddle",
        "paddle",
        "paddleocr",
        "cv2",
        "tkinter",
        "matplotlib",
    ],
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
