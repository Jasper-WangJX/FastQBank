# macOS OCR Diagnostic + H2 Defensive Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-rebuild diagnostic + H2 defensive fix to the macOS Electron shell so the next user-triggered `⌘⇧Q` produces a decisive log + thumbnail naming which hypothesis (H1/H2/H3/H4) is the real cause of the black-flash OCR failure.

**Architecture:** A new ~20-LOC `debug-log.ts` helper appends NDJSON lines to `~/Library/Logs/FastQBank/ocr-debug.log` on macOS only (no-op on Windows). `main.ts` is instrumented at five stages of `captureAndRecognize` plus a one-shot PNG dump of `desktopCapturer`'s thumbnail. `overlay.ts` gets matching event logs and a `process.platform !== "darwin"` guard around the lone `win.on("blur", () => finish(null))` line — Esc + IPC cancel already cover user-initiated cancellation on macOS.

**Tech Stack:** TypeScript (Electron main-process side, strict), Node `fs` (synchronous appends are fine — file is small, OCR is user-initiated), `electron.systemPreferences.getMediaAccessStatus`, no new runtime deps.

**Reference spec:** [`docs/superpowers/specs/2026-05-22-mac-ocr-diagnostic-design.md`](../specs/2026-05-22-mac-ocr-diagnostic-design.md) (commit `cee37da`).

**Working dir for all bash commands:** `/Users/jasper/Coding/MyProjects/FQB/FastQBank`

---

## File structure

- **Create:** `apps/desktop/src/debug-log.ts` — single-purpose helper. Exports `dlog(area, msg, fields?)`. macOS = append NDJSON line synchronously; everything else = no-op.
- **Modify:** `apps/desktop/src/main.ts` — add three imports; six new `dlog(...)` calls inside `captureAndRecognize`; one macOS-only `writeFileSync` block dumping the `desktopCapturer` thumbnail.
- **Modify:** `apps/desktop/src/overlay.ts` — add one import; five event log lines (`constructed`, `did-finish-load`, `onReady`, `onRegion`, `onCancel`, `closed`); replace the bare `win.on("blur", () => finish(null))` with a `process.platform !== "darwin"` branch.

No other files change. `apps/desktop/src/capture.ts` is shared with Windows and stays platform-agnostic.

---

## Task 0: Commit the staged B2 sidecar work as a clean prerequisite

The B2 macOS sidecar port (Apple Vision engine + mac PyInstaller spec + requirements split) is currently staged but uncommitted. Land it as its own commit so this diagnostic round has a stable base — and so a later `git revert` of the diagnostic commit doesn't lose the sidecar work.

**Files:**
- Modify (already staged): `apps/desktop/pnpm-lock.yaml`, `apps/desktop/pnpm-workspace.yaml`, `packages/ocr-sidecar/build.py`, `packages/ocr-sidecar/ocr_server.py`, `packages/ocr-sidecar/requirements.txt`
- Create (already untracked): `packages/ocr-sidecar/engine_paddle.py`, `packages/ocr-sidecar/engine_vision.py`, `packages/ocr-sidecar/ocr_sidecar_mac.spec`, `packages/ocr-sidecar/requirements-mac.txt`

- [ ] **Step 1: Verify nothing else got staged by mistake**

Run: `git status --short`

Expected output (exactly these lines, no others — the spec commit `cee37da` is already in HEAD):
```
 M apps/desktop/pnpm-lock.yaml
 M apps/desktop/pnpm-workspace.yaml
 M packages/ocr-sidecar/build.py
 M packages/ocr-sidecar/ocr_server.py
 M packages/ocr-sidecar/requirements.txt
?? packages/ocr-sidecar/engine_paddle.py
?? packages/ocr-sidecar/engine_vision.py
?? packages/ocr-sidecar/ocr_sidecar_mac.spec
?? packages/ocr-sidecar/requirements-mac.txt
```

If any other path appears, stop and ask the user — do not stage it blindly.

- [ ] **Step 2: Stage exactly these files**

```bash
git add \
  apps/desktop/pnpm-lock.yaml \
  apps/desktop/pnpm-workspace.yaml \
  packages/ocr-sidecar/build.py \
  packages/ocr-sidecar/ocr_server.py \
  packages/ocr-sidecar/requirements.txt \
  packages/ocr-sidecar/engine_paddle.py \
  packages/ocr-sidecar/engine_vision.py \
  packages/ocr-sidecar/ocr_sidecar_mac.spec \
  packages/ocr-sidecar/requirements-mac.txt
```

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(ocr): split OCR sidecar into platform engines (paddle + apple-vision)

Adds a macOS Apple Vision engine path (engine_vision.py via pyobjc) so
the sidecar can run on arm64 macOS without paddlepaddle (which has no
working accelerated arm64 wheel). The Windows codepath is untouched —
engine_paddle.py wraps the original paddle logic 1:1, ocr_server.py
picks the engine by sys.platform, and the HTTP contract (/healthz,
POST /ocr returning engine/image/lines/elapsed_ms) is bit-identical.

A separate ocr_sidecar_mac.spec and requirements-mac.txt keep the mac
build paddle-free; build.py branches on platform so neither side
drags in the other's deps. Verified end-to-end: the frozen mac
sidecar returns "engine":"apple-vision" with correct text on a real
crop in tens of milliseconds.
EOF
)"
```

- [ ] **Step 4: Verify clean working tree**

Run: `git status --short`

Expected output: empty.

---

## Task 1: Create the `debug-log.ts` helper

**Files:**
- Create: `apps/desktop/src/debug-log.ts`

- [ ] **Step 1: Write the module**

Create `apps/desktop/src/debug-log.ts` with this exact content:

```ts
// One-line NDJSON logger that lands in ~/Library/Logs/FastQBank/
// (the standard macOS app log dir Electron resolves for us via
// app.getPath("logs")). Synchronous appends — the OCR capture flow
// is user-initiated and writes at most ~10 lines per trigger, so the
// I/O cost is invisible, and a crash mid-flow keeps the line that
// preceded it.
//
// No-op on non-mac platforms: Windows already has a working OCR
// pipeline and we don't want to pollute it with disk writes or a
// second log path. If we ever need cross-platform structured logs
// here, this is the file to widen.

import { app } from "electron";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const isMac = process.platform === "darwin";

let logPath: string | null = null;
let ensured = false;

function resolveAndEnsure(): string | null {
  if (!isMac) return null;
  if (logPath && ensured) return logPath;
  const dir = app.getPath("logs");
  if (!ensured) {
    try {
      mkdirSync(dir, { recursive: true });
      ensured = true;
    } catch {
      // Electron creates the dir on first getPath("logs"); if mkdir
      // races with that, the next append will succeed anyway.
    }
  }
  logPath = path.join(dir, "ocr-debug.log");
  return logPath;
}

export function dlog(
  area: string,
  msg: string,
  fields?: Record<string, unknown>,
): void {
  const target = resolveAndEnsure();
  if (!target) return;
  const line =
    JSON.stringify({
      t: new Date().toISOString(),
      area,
      msg,
      fields: fields ?? null,
    }) + "\n";
  try {
    appendFileSync(target, line);
  } catch {
    // If the log file is unwritable, swallow — never let diagnostic
    // logging break the OCR flow it's meant to diagnose.
  }
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --dir apps/desktop run build:desktop`

Expected: exits 0, no TypeScript errors. (This compiles all `src/*.ts` into `apps/desktop/out/`.)

- [ ] **Step 3: Confirm the compiled artifact exists**

Run: `ls apps/desktop/out/debug-log.js`

Expected: the file exists.

(No commit yet — Tasks 1–3 commit together at Task 4.)

---

## Task 2: Instrument `apps/desktop/src/main.ts`

**Files:**
- Modify: `apps/desktop/src/main.ts` (lines 15, 16, 224–227, 238, 242–248, 258, 268–272)

- [ ] **Step 1: Widen the `electron` import to include `systemPreferences`**

In `apps/desktop/src/main.ts` line 15, replace:

```ts
import { app, BrowserWindow, Menu, Tray, nativeImage, protocol } from "electron";
```

with:

```ts
import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  protocol,
  systemPreferences,
} from "electron";
```

- [ ] **Step 2: Add `writeFileSync` to the existing `node:fs` import**

In `apps/desktop/src/main.ts` line 16, replace:

```ts
import { promises as fsp, statSync } from "node:fs";
```

with:

```ts
import { promises as fsp, statSync, writeFileSync } from "node:fs";
```

- [ ] **Step 3: Add a `dlog` import after the existing imports**

In `apps/desktop/src/main.ts`, immediately after the line:

```ts
import { openGoogleAuthUrl, startLoopbackOnce } from "./oauth";
```

(this is line 28 in the unmodified file), insert a new line:

```ts
import { dlog } from "./debug-log";
```

- [ ] **Step 4: Log the trigger and screen-permission state at the top of `captureAndRecognize`**

In `apps/desktop/src/main.ts`, find this block (the body starts at line 224):

```ts
async function captureAndRecognize(): Promise<void> {
  if (capturing) return;
  const st = getSidecarState();
  if (st !== "ready") {
```

Replace it with:

```ts
async function captureAndRecognize(): Promise<void> {
  if (capturing) return;
  const st = getSidecarState();
  dlog("capture", "trigger", {
    sidecar: st,
    screenPerm: systemPreferences.getMediaAccessStatus("screen"),
  });
  if (st !== "ready") {
```

- [ ] **Step 5: Log the grab result and dump the thumbnail (mac only)**

In `apps/desktop/src/main.ts`, find this line (around line 238):

```ts
    const { display, thumbnail } = await grabScreen();
```

Replace it with:

```ts
    const { display, thumbnail } = await grabScreen();
    dlog("capture", "grab ok", {
      displayId: display.id,
      scale: display.scaleFactor,
      bounds: display.bounds,
      bitmap: thumbnail.getSize(),
    });
    if (process.platform === "darwin") {
      const thumbPath = path.join(app.getPath("logs"), "last-thumb.png");
      try {
        writeFileSync(thumbPath, thumbnail.toPNG());
        dlog("capture", "thumb dumped", { thumbPath });
      } catch (e) {
        dlog("capture", "thumb dump failed", {
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }
```

- [ ] **Step 6: Log before and after the overlay region prompt**

In `apps/desktop/src/main.ts`, find this block (around lines 239–249):

```ts
    const overlayUrl = isDev
      ? `${DEV_SERVER_URL}/?overlay=1`
      : `${APP_ORIGIN_URL}?overlay=1`;
    const rect = await captureRegion({
      display,
      backgroundDataUrl: thumbnail.toDataURL(),
      scaleFactor: display.scaleFactor,
      preloadPath: PRELOAD,
      overlayUrl,
    });
    if (!rect) return; // cancelled (Esc / clicked away)
```

Replace it with:

```ts
    const overlayUrl = isDev
      ? `${DEV_SERVER_URL}/?overlay=1`
      : `${APP_ORIGIN_URL}?overlay=1`;
    dlog("capture", "overlay before", { overlayUrl });
    const rect = await captureRegion({
      display,
      backgroundDataUrl: thumbnail.toDataURL(),
      scaleFactor: display.scaleFactor,
      preloadPath: PRELOAD,
      overlayUrl,
    });
    dlog("capture", "overlay after", { rect });
    if (!rect) return; // cancelled (Esc / clicked away)
```

- [ ] **Step 7: Log around the OCR call**

In `apps/desktop/src/main.ts`, find this block (around lines 257–259):

```ts
    mainWindow?.webContents.send(IPC.ocrBusy, true);
    const result = await ocrImage(png);
    showWindow();
```

Replace it with:

```ts
    mainWindow?.webContents.send(IPC.ocrBusy, true);
    dlog("capture", "ocr before", { bytes: png.length });
    const result = await ocrImage(png);
    dlog("capture", "ocr after", {
      engine: result.engine,
      lines: result.lines.length,
      elapsed: result.elapsed_ms,
    });
    showWindow();
```

- [ ] **Step 8: Log the error branch**

In `apps/desktop/src/main.ts`, find this block (around lines 268–273):

```ts
  } catch (err) {
    showWindow();
    mainWindow?.webContents.send(IPC.ocrError, {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
```

Replace it with:

```ts
  } catch (err) {
    dlog("capture", "error", {
      err: err instanceof Error ? err.message : String(err),
    });
    showWindow();
    mainWindow?.webContents.send(IPC.ocrError, {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
```

- [ ] **Step 9: Type-check**

Run: `pnpm --dir apps/desktop run build:desktop`

Expected: exits 0, no TypeScript errors.

(No commit yet — combined commit at Task 4.)

---

## Task 3: Patch `apps/desktop/src/overlay.ts` (H2 fix + event logs)

**Files:**
- Modify: `apps/desktop/src/overlay.ts` (lines 8, 62–66, 91–99, 108–110)

- [ ] **Step 1: Add the `dlog` import**

In `apps/desktop/src/overlay.ts`, immediately after the line:

```ts
import type { RectCss } from "./capture";
```

(this is line 10 in the unmodified file), insert a new line:

```ts
import { dlog } from "./debug-log";
```

- [ ] **Step 2: Log overlay construction**

In `apps/desktop/src/overlay.ts`, find this block (around lines 62–66):

```ts
    process.stderr.write(
      `[overlay] requested ${JSON.stringify(b)} actual ${JSON.stringify(
        win.getBounds(),
      )}\n`,
    );
```

Replace it with:

```ts
    process.stderr.write(
      `[overlay] requested ${JSON.stringify(b)} actual ${JSON.stringify(
        win.getBounds(),
      )}\n`,
    );
    dlog("overlay", "constructed", {
      requested: b,
      actual: win.getBounds(),
      scale: opts.scaleFactor,
    });
```

- [ ] **Step 3: Log the three IPC event handlers**

In `apps/desktop/src/overlay.ts`, find this block (around lines 91–99):

```ts
    const onReady = (e: Electron.IpcMainEvent) => {
      if (fromThisWin(e)) sendBg();
    };
    const onRegion = (e: Electron.IpcMainEvent, rect: RectCss) => {
      if (fromThisWin(e)) finish(rect);
    };
    const onCancel = (e: Electron.IpcMainEvent) => {
      if (fromThisWin(e)) finish(null);
    };
```

Replace it with:

```ts
    const onReady = (e: Electron.IpcMainEvent) => {
      if (!fromThisWin(e)) return;
      dlog("overlay", "ready");
      sendBg();
    };
    const onRegion = (e: Electron.IpcMainEvent, rect: RectCss) => {
      if (!fromThisWin(e)) return;
      dlog("overlay", "region", { rect });
      finish(rect);
    };
    const onCancel = (e: Electron.IpcMainEvent) => {
      if (!fromThisWin(e)) return;
      dlog("overlay", "cancel");
      finish(null);
    };
```

- [ ] **Step 4: Apply the H2 fix and log `did-finish-load` / `closed`**

In `apps/desktop/src/overlay.ts`, find this block (around lines 105–110):

```ts
    // did-finish-load covers the case where the renderer's onBackground
    // listener is registered before this fires; overlayReady covers the
    // opposite race. Both just set the same bg, so doubling is harmless.
    win.webContents.once("did-finish-load", sendBg);
    win.on("blur", () => finish(null));
    win.on("closed", () => finish(null));
```

Replace it with:

```ts
    // did-finish-load covers the case where the renderer's onBackground
    // listener is registered before this fires; overlayReady covers the
    // opposite race. Both just set the same bg, so doubling is harmless.
    win.webContents.once("did-finish-load", () => {
      dlog("overlay", "did-finish-load");
      sendBg();
    });
    if (process.platform !== "darwin") {
      win.on("blur", () => {
        dlog("overlay", "blur -> finish(null)");
        finish(null);
      });
    } else {
      // macOS: a stray focus loss right after show() (system overlay
      // animations, dock icon swap, ScreenCaptureKit picker) used to
      // instantly close the overlay before the user could draw. Esc
      // and IPC cancel are sufficient on this platform.
      win.on("blur", () => dlog("overlay", "blur (ignored on darwin)"));
    }
    win.on("closed", () => {
      dlog("overlay", "closed");
      finish(null);
    });
```

- [ ] **Step 5: Type-check the desktop bundle**

Run: `pnpm --dir apps/desktop run build:desktop`

Expected: exits 0, no TypeScript errors.

- [ ] **Step 6: Confirm both modified files made it into `out/`**

Run: `ls -la apps/desktop/out/main.js apps/desktop/out/overlay.js apps/desktop/out/debug-log.js`

Expected: all three files exist with modification timestamps from the just-run build.

---

## Task 4: Commit the diagnostic round

- [ ] **Step 1: Inspect the diff one last time**

Run: `git status --short`

Expected:
```
?? apps/desktop/src/debug-log.ts
 M apps/desktop/src/main.ts
 M apps/desktop/src/overlay.ts
```

(If anything else appears — especially `apps/desktop/out/*` — stop. `out/` should be gitignored; if it isn't, ask the user before staging.)

Run: `git diff apps/desktop/src/main.ts apps/desktop/src/overlay.ts | head -200`

Skim it: only the additions described in Tasks 2 and 3 should be present, plus the H2 blur branch in overlay.ts. No incidental whitespace or unrelated edits.

- [ ] **Step 2: Stage and commit**

```bash
git add apps/desktop/src/debug-log.ts apps/desktop/src/main.ts apps/desktop/src/overlay.ts
git commit -m "$(cat <<'EOF'
fix(desktop): instrument macOS OCR capture flow and skip overlay blur-close on darwin

Adds a small NDJSON logger (apps/desktop/src/debug-log.ts) that
appends to ~/Library/Logs/FastQBank/ocr-debug.log on macOS only.
captureAndRecognize now logs trigger (with getMediaAccessStatus and
sidecar state), grab result, an immediate PNG dump of the
desktopCapturer thumbnail to last-thumb.png, the overlay round-trip,
and the OCR call. overlay.ts mirrors the events (constructed, ready,
region, cancel, did-finish-load, closed) and platform-branches
win.on("blur", () => finish(null)) so macOS only logs the blur
instead of closing the overlay — Esc and the IPC cancel path already
cover user-initiated cancellation, and a transient focus loss right
after show() was suspected of closing the overlay before the user
could draw. Windows behavior is bit-identical.

The next session uses ocr-debug.log + last-thumb.png to decide
between H1 (ad-hoc-signature TCC instability), H2 (now defended
against), H3 (macOS 26.4 desktopCapturer regression), and H4
(silently-swallowed error) per the spec decision table.

See docs/superpowers/specs/2026-05-22-mac-ocr-diagnostic-design.md
EOF
)"
```

- [ ] **Step 3: Verify**

Run: `git log -1 --stat`

Expected: a single commit touching `apps/desktop/src/debug-log.ts` (new), `apps/desktop/src/main.ts`, `apps/desktop/src/overlay.ts`.

Run: `git status --short`

Expected: empty.

---

## Task 5: Hand off the manual verification to the user

We do not run `pnpm run pack` ourselves — the user is on this machine and the §5 protocol of the spec requires them to remove the existing TCC entry and click "Allow" in a system dialog, which only they can do.

- [ ] **Step 1: Print the verification protocol for the user**

Tell the user, verbatim:

> Diagnostic instrumentation is committed (one commit on top of the B2 sidecar commit). To collect the evidence we need to decide the real fix, please:
>
> 1. `cd apps/desktop && pnpm run pack`  *(rebuilds the .app under `release/mac-arm64/FastQBank.app`)*
> 2. `codesign --deep --force -s - apps/desktop/release/mac-arm64/FastQBank.app`  *(re-apply the ad-hoc signature — the rebuild invalidated it)*
> 3. **System Settings → Privacy & Security → Screen Recording**: select the existing `FastQBank` entry and click **−** to remove it.
> 4. Double-click `apps/desktop/release/mac-arm64/FastQBank.app`.
> 5. Press `⌘⇧Q` once. macOS should pop the "FastQBank wants to record the screen" dialog the first time → click Allow → fully **Quit** the app from the tray icon (not the close button) → reopen → press `⌘⇧Q` again.
> 6. Send me back:
>     - `cat ~/Library/Logs/FastQBank/ocr-debug.log`
>     - Whether `~/Library/Logs/FastQBank/last-thumb.png` looks like the real desktop or is fully black (just say which).
>
> I'll read the log + thumb against the decision table in the spec (§4) and propose the targeted fix.

- [ ] **Step 2: Stop and wait**

Do NOT proceed with any speculative fix for H1 or H3 before the user reports back. The whole point of this round is to let the data pick.

---

## Self-review notes (for the executing engineer)

- The spec §3.2's "Total additions: ~12 lines of instrumentation + 3 imports" is approximate; this plan's Task 2 adds slightly more (closer to ~30 lines including the platform-guarded thumb dump block). The shape is exactly what the spec describes.
- The spec §3.3 lists `did-finish-load` as one of the events to instrument; Task 3 Step 4 wraps it via an inline arrow function rather than passing `sendBg` directly — same behavior, plus a `dlog` line.
- The `last-thumb.png` path resolves to `~/Library/Logs/FastQBank/last-thumb.png` because Electron sets `app.getPath("logs")` to `~/Library/Logs/<productName>/` on macOS, and `productName` in `apps/desktop/package.json` is `FastQBank`.
- `node:fs.appendFileSync` will create the file on first call if the directory exists. The `mkdirSync(dir, { recursive: true })` in `debug-log.ts` is defensive: `app.getPath("logs")` is supposed to create the dir but it's lazy and we'd rather be safe than have the first capture lose its log.
