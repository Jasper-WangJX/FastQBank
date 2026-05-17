# ocr-sidecar

Local PaddleOCR sidecar for the desktop app's screenshot-to-question flow
(roadmap stage 5). The Electron main process spawns this as a child
process and talks to it over `127.0.0.1` HTTP. Shipped to end users as a
single PyInstaller `.exe` (no Python install required on their machine).

> Status: spike PASSED; HTTP server (`ocr_server.py`) and packaging
> (`build.py` / `ocr_sidecar.spec`) done.

## Build the shipped executable

PyInstaller is a build-time dep (not in `requirements.txt`):

```powershell
# from packages/ocr-sidecar/, with the venv active
.\.venv\Scripts\python.exe -m pip install pyinstaller
.\.venv\Scripts\python.exe build.py
```

`build.py` caches the det/rec/cls models, stages them into `./_models`,
and runs PyInstaller (**onedir** — paddle is huge). Output:
`./dist/ocr_server/ocr_server.exe` (+ its libs). `ocr_server.py` is
frozen-aware: when bundled it loads models from `sys._MEIPASS/models`,
so the user's machine needs **no network and no Python**.

The desktop app picks this up automatically — `apps/desktop`'s
`pnpm package` runs `build:sidecar` first, and electron-builder
`extraResources` copies `dist/ocr_server` → `resources/ocr-sidecar`
(where `sidecar.ts` expects `ocr_server.exe` when packaged).

## Stack: paddlepaddle 2.6.2 + paddleocr 2.9.1 (pinned)

We deliberately use the classic 2.x line, not 3.x. paddlepaddle 3.3.1's
oneDNN path crashes under its new executor
(`ConvertPirAttribute2RuntimeAttribute not support
[pir::ArrayAttribute<pir::DoubleAttribute>]`), which forces `mkldnn` off
and a ~4-5s/image floor. On 2.6.2 oneDNN works, so `enable_mkldnn=True`
gives a fast CPU path (~0.2-0.55s warm), and the 2.x `.ocr(img,
cls=True)` API has far better PyInstaller prior art for the shipped
sidecar. Target users capture English-only questions, so `lang="en"`.

## Step 0 — feasibility spike

A decision gate: confirm PaddleOCR reads real exam screenshots well
enough before any Electron/sidecar code is written.

```powershell
# from packages/ocr-sidecar/
python -m venv .venv
.\.venv\Scripts\Activate.ps1          # PowerShell
# (bash:  source .venv/bin/activate)

pip install --upgrade pip
# Pinned — newer (3.x) regresses, see "Stack" above.
pip install "paddlepaddle==2.6.2" "paddleocr==2.9.1"

# put 3-5 real ENGLISH screenshots somewhere, then:
python spike.py path\to\q1.png path\to\q2.png ...
```

Validate with English screenshots: a plain multiple-choice question, one
with `A. B. C. D.` markers, one with a `$x^2$`-style formula, one
true/false item, and one small-font screenshot.

### Pass / fail gate (judge by eye)

- stem + options overall readable rate **>= 90%** (a few wrong chars are
  acceptable — the confirm page lets you fix them);
- option markers (`A.` / `A)` / `(A)` / `1. 2.`) reliably appear in the
  recognized text;
- warm single-image recognition **< 3s** (the first image pays a one-time
  model-load cost, ignore that one).

### Result (2026-05-17, paddle 2.6.2 / paddleocr 2.9.1, CPU + mkldnn)

PASSED. Warm recognition **0.2–0.55s/image** (cold model load ~98s
incl. first-run download — a one-time startup cost the sidecar absorbs
via background preload + a `/healthz` ready flag). Lettered markers
(`A. B. C. D.`, `(a)(b)(c)`) and numeric question prefixes (`1.`, `P1-1.`)
read cleanly; bare unlabeled options also read but need the splitter's
no-marker fallback. Only chemical sub/superscripts (CO₂, x⁵) mangle —
acceptable, fixed on the confirm page, LaTeX deferred to Phase 6.

### If it had failed

In priority order: tune params (`det_db_box_thresh`, `use_angle_cls`,
upscale the image — at most 2 rounds) → try the server det/rec models →
if only formulas are bad but text is fine, accept it (hand-type LaTeX,
deferred to Phase 6) → if unusable overall, stop and revisit with the
user (do not switch engines unilaterally).

`spike.py` is throwaway: it is not imported by the shipped server and can
be deleted once the gate is cleared (kept for now as a quick re-check
tool).
