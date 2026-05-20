# Phase 10 — Windows Installer + Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows NSIS `.exe` installer for FastQBank v1.0.0 with real branding, smoke-verified packaged sidecar, global toast/offline UX, lightweight onboarding, and a rewritten README — so a non-developer friend can install and use the app end-to-end.

**Architecture:** electron-builder NSIS target produces a per-user installer carrying the existing Phase 4 Electron shell + the Phase 5 PyInstaller OCR sidecar. The icon pipeline reuses the existing pure-zlib decoder in `gen-icons.cjs`; only ICO assembly needs a new dep (`png-to-ico`). Toast UX is sonner mounted once in `AppLayout`; onboarding is a data-driven empty-state card. No backend changes.

**Tech Stack:** electron-builder (NSIS), pnpm 11, png-to-ico (new), sonner (new), TypeScript, React 19, Vite, Tailwind 4, vitest, PaddleOCR (existing), FastAPI (unchanged).

**Branch:** `phase-10-polish` (created at task 1).

**Deviation from spec (documented):** The spec mentions adding `sharp` as a devDep alongside `png-to-ico`. We **skip sharp** because the existing `apps/desktop/scripts/gen-icons.cjs` already contains a pure-zlib PNG decoder + nearest-neighbor resizer + alpha-bbox composer. Only ICO assembly is missing, which `png-to-ico` provides. One new dep, not two. The Phase 4 author's pure-zlib pipeline is left intact.

---

## File Structure

### Files to create

- `apps/web/src/components/OfflineBanner.tsx` — yellow `online/offline` banner mounted in AppLayout
- `apps/web/src/components/onboarding/OnboardingEmpty.tsx` — empty-state guidance card
- `apps/web/src/components/onboarding/shouldShowOnboarding.ts` — pure predicate (tags-empty AND questions-empty) — extracted for vitest unit-testability, matching the codebase's pure-logic test pattern
- `apps/web/src/components/onboarding/shouldShowOnboarding.test.ts` — vitest unit test for the predicate

### Files to modify

- `resources/fastqbICON.png` — already on disk, untracked; commit as part of Task 1
- `apps/desktop/scripts/gen-icons.cjs` — switch source to `fastqbICON.png`, emit multi-size + `icon.ico` + 32×32 `tray.png`
- `apps/desktop/assets/icon.png` — regenerated artifact (committed)
- `apps/desktop/assets/icon.ico` — NEW artifact (committed)
- `apps/desktop/assets/tray.png` — regenerated artifact (committed, 32×32)
- `apps/desktop/package.json` — `version` → `1.0.0`; `build.win.target` → `nsis`; `build.win.icon` → `assets/icon.ico`; add `build.nsis` block; rename `scripts.package` → `scripts.pack`; add `scripts.dist`; add `png-to-ico` to devDependencies
- `apps/web/package.json` — add `sonner` to dependencies
- `apps/web/src/components/AppLayout.tsx` — mount `<Toaster/>` and `<OfflineBanner/>`
- `apps/web/src/lib/api.ts` — toast on `fetch` network failure and on HTTP `>=500`
- `apps/web/src/pages/QuestionListPage.tsx` — render `<OnboardingEmpty/>` when predicate returns true
- `README.md` — full rewrite per spec § 4.6

### Files NOT touched

- All `apps/server/**` — no backend changes this phase
- All Alembic migrations — no schema changes
- `apps/desktop/src/sidecar.ts` — only touched in Task 3 if a smoke failure forces a fix

---

## Task 1: App icon pipeline + ICO output

**Files:**
- Create branch + add: `resources/fastqbICON.png` (already on disk, untracked; commit it)
- Modify: `apps/desktop/scripts/gen-icons.cjs`
- Modify: `apps/desktop/package.json` (devDep)
- Output (committed): `apps/desktop/assets/{icon.png, icon.ico, tray.png}`

- [ ] **Step 1: Create the feature branch**

Run:
```bash
git checkout -b phase-10-polish
```

- [ ] **Step 2: Add `png-to-ico` as a desktop devDependency**

Edit `apps/desktop/package.json` — inside `devDependencies`, add `"png-to-ico": "^2.1.8"` (latest stable as of 2026-05; if a newer minor exists, use that).

- [ ] **Step 3: Install the new dep**

Run:
```bash
pnpm --dir apps/desktop install
```
Expected: pnpm reports `+ png-to-ico ^2.1.8`. No other changes.

- [ ] **Step 4: Rewrite `gen-icons.cjs` to use the new source and emit ICO + 32px tray**

Replace the file `apps/desktop/scripts/gen-icons.cjs` with the version below. Key changes vs the existing file:
1. `SRC` now points to `resources/fastqbICON.png` (810×810 square, user-cropped).
2. Output sizes: `icon.png` (256×256), `tray.png` (32×32, downscaled from a 512×512 base for crispness).
3. New: emit `icon.ico` containing 16/24/32/48/64/128/256-px PNG sub-images, packed via `png-to-ico`.

Full file content (paste-as-is):

```javascript
// Generate Windows icon assets from resources/fastqbICON.png.
//
// Pipeline (pure JS + one packaging dep):
//   1. Decode source PNG with the in-house zlib-only decoder (kept from
//      the Phase 4 placeholder script — it already handles 8-bit RGBA).
//   2. Find the alpha-bbox of the visible content; on a white background
//      the bbox is the full canvas (acceptable — we still center and pad).
//   3. Re-composite into a square canvas with 10% padding (object-contain
//      style), nearest-neighbor resampling.
//   4. Emit:
//        assets/icon.png   (256×256, dev / Linux / package.json metadata)
//        assets/tray.png   (32×32,   system tray — sized for Windows)
//        assets/icon.ico   (multi-resolution 16/24/32/48/64/128/256,
//                           used by electron-builder for the installer
//                           and the packaged exe)
//
// Re-run with `pnpm gen:icons` whenever resources/fastqbICON.png changes.

const zlib = require("node:zlib");
const fs = require("node:fs");
const path = require("node:path");
const pngToIco = require("png-to-ico");

const SRC = path.resolve(__dirname, "..", "..", "..", "resources", "fastqbICON.png");
const OUT_DIR = path.resolve(__dirname, "..", "assets");

// Internal working canvas. 512 gives the resampler enough headroom for
// the 256-px ICO sub-image without visible aliasing.
const CANVAS_SIDE = 512;
// Padding around the visible bbox, as a fraction of the bbox's longer
// side. Matches Windows app-icon breathing room.
const PADDING_FRAC = 0.1;
// ICO sub-image sizes. Windows picks the closest match at runtime.
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
// On-disk artifact sizes for the standalone PNGs.
const ICON_PNG_SIZE = 256;
const TRAY_PNG_SIZE = 32;

// --- CRC32 (PNG chunk checksum) --------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// --- Minimal PNG decoder (8-bit RGBA only). --------------------------------
function decodePng(buf) {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== SIG[i]) throw new Error("Not a PNG.");
  }
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString("ascii");
    const data = buf.subarray(off + 8, off + 8 + len);
    off += 8 + len + 4;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
        throw new Error(
          `Expected 8-bit RGBA or RGB PNG (bitDepth=8, colorType=6 or 2); ` +
            `got bitDepth=${bitDepth}, colorType=${colorType}. Re-export the ` +
            `source PNG and try again.`,
        );
      }
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  if (!width || !height) throw new Error("PNG: missing IHDR.");
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const channels = colorType === 6 ? 4 : 3; // RGBA vs RGB
  const stride = width * channels;
  const raw = Buffer.alloc(stride * height);
  // Undo per-row filtering. Filters reference previous pixel (left)
  // and the row above (up). Byte distance for "left" reference is
  // `channels` (3 or 4).
  const bpp = channels;
  for (let y = 0; y < height; y++) {
    const inOff = y * (stride + 1);
    const filter = inflated[inOff];
    const inRow = inflated.subarray(inOff + 1, inOff + 1 + stride);
    const outRow = raw.subarray(y * stride, y * stride + stride);
    const prevRow = y > 0 ? raw.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? outRow[x - bpp] : 0;
      const up = prevRow ? prevRow[x] : 0;
      const upLeft = prevRow && x >= bpp ? prevRow[x - bpp] : 0;
      let v = inRow[x];
      switch (filter) {
        case 0: break;
        case 1: v = (v + left) & 0xff; break;
        case 2: v = (v + up) & 0xff; break;
        case 3: v = (v + ((left + up) >> 1)) & 0xff; break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          const pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          v = (v + pred) & 0xff;
          break;
        }
        default: throw new Error(`Unknown PNG filter type ${filter} at row ${y}.`);
      }
      outRow[x] = v;
    }
  }
  // Normalize to RGBA: if source is RGB (colorType=2), append A=255.
  let pixels;
  if (channels === 4) {
    pixels = raw;
  } else {
    pixels = Buffer.alloc(width * height * 4);
    for (let i = 0, j = 0; i < raw.length; i += 3, j += 4) {
      pixels[j] = raw[i];
      pixels[j + 1] = raw[i + 1];
      pixels[j + 2] = raw[i + 2];
      pixels[j + 3] = 255;
    }
  }
  return { width, height, pixels };
}

// --- Encoder. -------------------------------------------------------------
function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const filtered = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 0;
    rgba.copy(filtered, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type (RGBA)
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(filtered, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- Find alpha bounding box ----------------------------------------------
// On a fully-opaque white background (no transparency), this falls back
// to the full canvas — which is the correct behavior for a pre-cropped
// square source (resources/fastqbICON.png).
function findAlphaBBox(width, height, pixels, alphaThreshold = 8) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  const stride = width * 4;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = pixels[y * stride + x * 4 + 3];
      if (a > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// --- Nearest-neighbor resize of an RGBA image -----------------------------
function resizeRgba(srcW, srcH, srcPixels, dstW, dstH) {
  const out = Buffer.alloc(dstW * dstH * 4);
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor(y * scaleY));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor(x * scaleX));
      const si = (sy * srcW + sx) * 4;
      const di = (y * dstW + x) * 4;
      out[di] = srcPixels[si];
      out[di + 1] = srcPixels[si + 1];
      out[di + 2] = srcPixels[si + 2];
      out[di + 3] = srcPixels[si + 3];
    }
  }
  return out;
}

// --- Composite a smaller RGBA buffer onto the center of a square canvas ---
function compose(side, srcW, srcH, srcPixels) {
  const canvas = Buffer.alloc(side * side * 4);
  const offX = Math.floor((side - srcW) / 2);
  const offY = Math.floor((side - srcH) / 2);
  for (let y = 0; y < srcH; y++) {
    const dstRow = (offY + y) * side * 4 + offX * 4;
    const srcRow = y * srcW * 4;
    srcPixels.copy(canvas, dstRow, srcRow, srcRow + srcW * 4);
  }
  return canvas;
}

// --- Build one centered, padded RGBA buffer at the given side. ------------
function buildCanvas(decoded, side) {
  const bbox = findAlphaBBox(decoded.width, decoded.height, decoded.pixels);
  if (!bbox) throw new Error("Source PNG has no visible pixels.");
  // Crop to bbox.
  const cropped = Buffer.alloc(bbox.w * bbox.h * 4);
  for (let y = 0; y < bbox.h; y++) {
    const srcRow = (bbox.y + y) * decoded.width * 4 + bbox.x * 4;
    decoded.pixels.copy(cropped, y * bbox.w * 4, srcRow, srcRow + bbox.w * 4);
  }
  // Fit into a square area inside the canvas with PADDING_FRAC margin.
  const target = Math.floor(side * (1 - PADDING_FRAC * 2));
  const aspect = bbox.w / bbox.h;
  const fitW = aspect >= 1 ? target : Math.round(target * aspect);
  const fitH = aspect >= 1 ? Math.round(target / aspect) : target;
  const resized = resizeRgba(bbox.w, bbox.h, cropped, fitW, fitH);
  return compose(side, fitW, fitH, resized);
}

// --- Main -----------------------------------------------------------------
async function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`Source not found: ${SRC}`);
    process.exit(1);
  }
  const src = fs.readFileSync(SRC);
  const decoded = decodePng(src);
  console.log(`Source: ${decoded.width}x${decoded.height}`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1) icon.png (256×256) — dev/Linux/package metadata.
  const iconCanvas = buildCanvas(decoded, ICON_PNG_SIZE);
  const iconPng = encodePng(ICON_PNG_SIZE, ICON_PNG_SIZE, iconCanvas);
  fs.writeFileSync(path.join(OUT_DIR, "icon.png"), iconPng);
  console.log(`Wrote assets/icon.png (${ICON_PNG_SIZE}x${ICON_PNG_SIZE}).`);

  // 2) tray.png (32×32) — system tray.
  const trayCanvas = buildCanvas(decoded, TRAY_PNG_SIZE);
  const trayPng = encodePng(TRAY_PNG_SIZE, TRAY_PNG_SIZE, trayCanvas);
  fs.writeFileSync(path.join(OUT_DIR, "tray.png"), trayPng);
  console.log(`Wrote assets/tray.png (${TRAY_PNG_SIZE}x${TRAY_PNG_SIZE}).`);

  // 3) icon.ico — multi-resolution.
  const pngBuffers = ICO_SIZES.map((s) => {
    const canvas = buildCanvas(decoded, s);
    return encodePng(s, s, canvas);
  });
  const ico = await pngToIco(pngBuffers);
  fs.writeFileSync(path.join(OUT_DIR, "icon.ico"), ico);
  console.log(`Wrote assets/icon.ico (${ICO_SIZES.join(", ")}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 5: Run the generator**

Run:
```bash
pnpm --dir apps/desktop gen:icons
```
Expected output (one line each):
```
Source: 810x810
Wrote assets/icon.png (256x256).
Wrote assets/tray.png (32x32).
Wrote assets/icon.ico (16, 24, 32, 48, 64, 128, 256).
```

- [ ] **Step 6: Eyeball the artifacts**

Open `apps/desktop/assets/icon.png` and `apps/desktop/assets/tray.png` in any image viewer.
Expected:
- `icon.png` shows the centered AC mark with motion lines, ~10% transparent margin.
- `tray.png` shows the same mark, downscaled — motion lines will be partially lost (expected per spec § 4.1 trade-off).
- `icon.ico` exists; on Windows, right-click → Properties shows multiple sizes.

- [ ] **Step 7: Commit the source + script + artifacts together**

```bash
git add resources/fastqbICON.png apps/desktop/scripts/gen-icons.cjs apps/desktop/package.json apps/desktop/pnpm-lock.yaml apps/desktop/assets/icon.png apps/desktop/assets/icon.ico apps/desktop/assets/tray.png
git commit -m "feat(desktop): real app icon from fastqbICON.png + ICO pipeline"
```

---

## Task 2: NSIS installer configuration

**Files:**
- Modify: `apps/desktop/package.json` (build config + scripts + version)

- [ ] **Step 1: Update `apps/desktop/package.json`**

Make these exact changes:

1. Set `"version": "1.0.0"` (was `"0.0.0"`).
2. In `scripts`, rename `"package"` → `"pack"` (same command — keeps the `--dir` shortcut for quick local smoke).
3. In `scripts`, add `"dist": "pnpm build:sidecar && pnpm build && electron-builder"` (no `--dir`; produces the NSIS installer).
4. In `build.win`, change `"target": "dir"` → `"target": "nsis"`.
5. In `build.win`, change `"icon": "assets/icon.png"` → `"icon": "assets/icon.ico"`.
6. Add a sibling `"nsis"` block under `build` (i.e. peer of `build.win`):

```jsonc
"nsis": {
  "oneClick": false,
  "perMachine": false,
  "allowToChangeInstallationDirectory": true,
  "createDesktopShortcut": true,
  "createStartMenuShortcut": true,
  "shortcutName": "FastQBank"
}
```

After this step the `build` section should look like (shown for clarity, paste only the deltas above):

```jsonc
"build": {
  "appId": "com.fastqbank.desktop",
  "productName": "FastQBank",
  "directories": { "output": "release" },
  "files": ["out/**", "assets/**", "package.json"],
  "extraResources": [
    { "from": "../web/dist", "to": "web-dist" },
    { "from": "../../packages/ocr-sidecar/dist/ocr_server", "to": "ocr-sidecar" }
  ],
  "win": {
    "target": "nsis",
    "icon": "assets/icon.ico"
  },
  "nsis": {
    "oneClick": false,
    "perMachine": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true,
    "shortcutName": "FastQBank"
  }
}
```

- [ ] **Step 2: Build the installer locally**

Run from the repo root:
```bash
pnpm --dir apps/desktop dist
```
Expected:
- `pnpm build:sidecar` runs first (rebuilds the PyInstaller onedir — slow, ~3 min). Skips silently if `packages/ocr-sidecar/dist/ocr_server/ocr_server.exe` already exists with a recent mtime (the existing `build.py` is incremental).
- `pnpm build` then runs `tsc -p tsconfig.json` for the desktop + the web Vite build with the prod API URL baked in.
- electron-builder completes with no errors. Output line ends with: `target=nsis file=release/FastQBank Setup 1.0.0.exe`.
- File size 300–500 MB.

- [ ] **Step 3: Verify the installer file exists with expected name and size**

Run:
```powershell
Get-Item "apps/desktop/release/FastQBank Setup 1.0.0.exe" | Select-Object Name, Length
```
Expected: `Name = FastQBank Setup 1.0.0.exe`, `Length` between `3.0e8` and `5.5e8`.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/package.json
git commit -m "feat(desktop): NSIS installer config + version 1.0.0"
```

---

## Task 3: Packaged-app sidecar smoke checklist

This is **manual verification only**. The executor walks through the 8 items, records pass/fail in the commit message of the next bugfix or in the plan markdown. **No code changes unless an item fails** — in which case fix `apps/desktop/src/sidecar.ts` or `package.json` and re-run the affected items.

**Pre-condition:** Task 2's installer (`apps/desktop/release/FastQBank Setup 1.0.0.exe`) is freshly built.

- [ ] **Step 1: Install on a clean Windows user profile (or current dev box if no spare profile)**

Double-click `apps/desktop/release/FastQBank Setup 1.0.0.exe`.
Expected: SmartScreen "unrecognized app" dialog appears → click "More info" → "Run anyway" → NSIS wizard appears.
In wizard: accept default install dir or pick a custom one → keep Desktop shortcut + Start menu checks → Install.

- [ ] **Step 2: Check shortcuts and start-menu entry**

Expected:
- Desktop shortcut "FastQBank" exists with the new AC-mark icon.
- Start menu → search "FastQBank" → entry exists with the same icon.
- Windows Settings → Apps → Installed apps → "FastQBank 1.0.0" is listed.

- [ ] **Step 3: Network-off boot test**

Disconnect from the internet (toggle WiFi off / unplug ethernet).
Launch FastQBank from the Desktop shortcut.
Expected:
- App boots within 5s to the login screen.
- If a cached token rehydrates: app lands on Question Bank; a `toast.error` appears in the top-right reporting a network failure (because tag/question fetches fail). **This implicitly exercises Task 5's toast** — note that this step assumes Task 5 has already been completed. If Task 3 runs before Task 5, this sub-check observes inline error UI instead.
- No crash, no white screen.

- [ ] **Step 4: Reconnect + log in**

Reconnect to internet, log in. Expected: Question Bank loads.

- [ ] **Step 5: Offline OCR end-to-end**

Disconnect again (sidecar is local, doesn't need network).
Open any non-FastQBank window with text (e.g. Notepad with "Q: What is 2+2? A. 3 B. 4 C. 5").
Press `Ctrl+Shift+Q` (or the fallback `Alt+Q` / `F8` shown in the OCR tooltip).
Drag a selection over the text.
Expected:
- OCR busy banner appears in AppLayout: `[ OCR ] · Recognizing screenshot…`.
- Within ~3–10s (cold) or <1s (warm), the OCR confirm page (`/questions/new`) opens with the stem + options pre-filled.
- The "Draft from OCR" banner is visible.

- [ ] **Step 6: Quit cleanly + orphan-process check**

Right-click the FastQBank tray icon → Quit (or use the tray menu).
Open Task Manager → Details tab → search `ocr_server`.
Expected: **0 instances of `ocr_server.exe`** (the `stopSidecar()` `taskkill /T /F` on Windows kills the child tree).

- [ ] **Step 7: Uninstall**

Windows Settings → Apps → Installed apps → FastQBank → Uninstall.
Expected:
- Desktop shortcut removed.
- Start menu entry removed.
- Install directory empty / deleted.

- [ ] **Step 8: Reinstall + token retention observation**

Re-run the installer. Launch the app.
Observe: did the previous login token in `%APPDATA%\FastQBank\Local Storage\...` survive uninstall? Either is acceptable; **note the observed behavior** in the commit message at step 9. (NSIS per-user uninstall typically leaves user-data dirs; document the actual behavior.)

- [ ] **Step 9: Commit the smoke result**

If all 8 items pass:
```bash
git commit --allow-empty -m "test(desktop): Phase 10 packaged-app smoke checklist — 8/8 pass

Observed: token retention across reinstall = [retained | cleared]"
```

If any item failed: do NOT commit the smoke-pass marker. Instead, debug the failure (most likely candidates: `apps/desktop/src/sidecar.ts` `resolveLaunch()` path, or `package.json` `extraResources` mapping), commit the fix with `fix(desktop): ...`, then re-run steps 5–6 (the items that exercise the packaged code paths most directly). Repeat until all 8 pass.

---

## Task 4: Install sonner + mount Toaster globally

**Files:**
- Modify: `apps/web/package.json` (dependency)
- Modify: `apps/web/src/components/AppLayout.tsx` (mount)

- [ ] **Step 1: Add sonner**

Run:
```bash
pnpm --dir apps/web add sonner
```
Expected: `apps/web/package.json` gains `"sonner": "^1.x"` in `dependencies`; `pnpm-lock.yaml` updated.

- [ ] **Step 2: Mount `<Toaster/>` in AppLayout**

Edit `apps/web/src/components/AppLayout.tsx`:

Add at the top with the other imports:
```typescript
import { Toaster } from "sonner";
```

Inside the outermost `<div className="relative min-h-dvh bg-white text-slate-900">`, immediately before the closing `</div>` (right after `<SettingsModal ... />`), insert:
```tsx
<Toaster position="top-right" richColors closeButton />
```

- [ ] **Step 3: Smoke-test by triggering a toast manually (dev)**

Start the web dev server: `pnpm --dir apps/web dev`.
Open the browser console on a logged-in page and run:
```javascript
const { toast } = await import("sonner"); toast.error("Test toast");
```
Expected: a red error toast appears top-right, dismissable via the close button.

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json apps/web/pnpm-lock.yaml apps/web/src/components/AppLayout.tsx
git commit -m "feat(web): mount sonner Toaster globally"
```

---

## Task 5: apiFetch surfaces network and 5xx failures as toasts

**Files:**
- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: Update `apiFetch` and `handleResponse` to emit toasts on uncaught failures**

In `apps/web/src/lib/api.ts`:

1. Add to imports at the top:
```typescript
import { toast } from "sonner";
```

2. Replace the body of `apiFetch` with a try/catch around the `fetch(...)` call, so network failures (TypeError thrown by fetch) are toasted then re-thrown:

```typescript
export async function apiFetch<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (err) {
    toast.error("Network error — please check your connection");
    throw err;
  }

  return handleResponse<T>(res);
}
```

3. Apply the same wrapping to `apiFetchForm` (mirror the try/catch around its `fetch(...)` call):

```typescript
export async function apiFetchForm<T = unknown>(
  path: string,
  form: FormData,
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers,
      body: form,
    });
  } catch (err) {
    toast.error("Network error — please check your connection");
    throw err;
  }

  return handleResponse<T>(res);
}
```

4. In `handleResponse`, after the existing 401 handling but before raw text parsing, add a 5xx-toast branch. The final function reads:

```typescript
async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }

  if (res.status >= 500) {
    toast.error("Server error — please try again");
  }

  const raw = await res.text();
  const data: unknown = raw ? JSON.parse(raw) : null;

  if (!res.ok) {
    const detail =
      data && typeof data === "object" && "detail" in data
        ? String((data as { detail: unknown }).detail)
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, detail);
  }

  return data as T;
}
```

**Why no toast on 4xx**: 4xx surfaces business errors (validation, "already exists", "invalid code", etc.) — pages already render these via the thrown `ApiError`. Auto-toasting would double up.
**Why no toast on 401**: the redirect to /login is the feedback.

- [ ] **Step 2: Manual smoke (dev)**

Start backend off (`docker compose stop server` or just don't start uvicorn). Start `pnpm --dir apps/web dev`. Try to log in.
Expected: a red toast "Network error — please check your connection" appears; the LoginPage's existing inline error UI also fires.

Start backend back on. Force a 5xx by hitting a route after stopping the DB (`docker compose stop postgres`).
Expected: a red toast "Server error — please try again" appears.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat(web): toast on uncaught network/5xx failures in apiFetch"
```

---

## Task 6: Offline banner driven by `navigator.onLine`

**Files:**
- Create: `apps/web/src/components/OfflineBanner.tsx`
- Modify: `apps/web/src/components/AppLayout.tsx`

- [ ] **Step 1: Create `OfflineBanner.tsx`**

Create `apps/web/src/components/OfflineBanner.tsx`:

```tsx
// Yellow strip at the top of AppLayout that appears whenever the browser
// reports `navigator.onLine === false`. Driven by `window.online` /
// `window.offline` events — no polling, no backend probe.
//
// Trade-off: navigator.onLine can lie under VPN/virtual-NIC stacks. A
// real failed request will still surface as a sonner toast (api.ts).

import { useEffect, useState } from "react";

export default function OfflineBanner() {
  const [offline, setOffline] = useState<boolean>(
    () => typeof navigator !== "undefined" && navigator.onLine === false,
  );

  useEffect(() => {
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  if (!offline) return null;
  return (
    <div
      role="status"
      className="border-b border-yellow-300 bg-yellow-50 px-4 py-2 text-center font-mono text-xs text-yellow-900"
    >
      [ NET ] · Offline — changes may not save
    </div>
  );
}
```

- [ ] **Step 2: Mount `OfflineBanner` in AppLayout**

Edit `apps/web/src/components/AppLayout.tsx`:

Add to imports:
```typescript
import OfflineBanner from "./OfflineBanner";
```

Inside the layout, immediately after the `</header>` closing tag and before the `{ocrBusy && ...}` block (so the banner sits above the OCR banner), insert:
```tsx
<OfflineBanner />
```

- [ ] **Step 3: Manual smoke (dev)**

Start `pnpm --dir apps/web dev`. In Chrome DevTools, switch the Network tab to "Offline".
Expected: a yellow `[ NET ] · Offline — changes may not save` banner appears at the top of the page.
Switch back to "No throttling".
Expected: banner disappears.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/OfflineBanner.tsx apps/web/src/components/AppLayout.tsx
git commit -m "feat(web): offline banner driven by navigator.onLine"
```

---

## Task 7: Empty-state onboarding card

**Files:**
- Create: `apps/web/src/components/onboarding/shouldShowOnboarding.ts`
- Create: `apps/web/src/components/onboarding/shouldShowOnboarding.test.ts`
- Create: `apps/web/src/components/onboarding/OnboardingEmpty.tsx`
- Modify: `apps/web/src/pages/QuestionListPage.tsx`

- [ ] **Step 1: Write the failing test for the predicate**

Create `apps/web/src/components/onboarding/shouldShowOnboarding.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { shouldShowOnboarding } from "./shouldShowOnboarding";

describe("shouldShowOnboarding", () => {
  it("returns true when both tags and questions are empty", () => {
    expect(shouldShowOnboarding({ tagCount: 0, questionTotal: 0 })).toBe(true);
  });

  it("returns false when there is at least one tag", () => {
    expect(shouldShowOnboarding({ tagCount: 1, questionTotal: 0 })).toBe(false);
  });

  it("returns false when there is at least one question", () => {
    expect(shouldShowOnboarding({ tagCount: 0, questionTotal: 1 })).toBe(false);
  });

  it("returns false when both are non-empty", () => {
    expect(shouldShowOnboarding({ tagCount: 3, questionTotal: 12 })).toBe(false);
  });

  it("returns false when either count is unknown (null)", () => {
    expect(shouldShowOnboarding({ tagCount: null, questionTotal: 0 })).toBe(false);
    expect(shouldShowOnboarding({ tagCount: 0, questionTotal: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Verify the test fails**

Run:
```bash
pnpm --dir apps/web exec vitest run src/components/onboarding/shouldShowOnboarding.test.ts
```
Expected: FAIL with `Cannot find module './shouldShowOnboarding'`.

- [ ] **Step 3: Implement the predicate**

Create `apps/web/src/components/onboarding/shouldShowOnboarding.ts`:

```typescript
// Pure predicate for the empty-state onboarding card.
//
// Triggers ONLY when both lists have been successfully fetched (counts
// are numbers, not null) AND both are zero. `null` for either count
// means "fetch still pending" — we hold off rendering anything to avoid
// a flash of guidance during initial load.

export interface OnboardingInput {
  tagCount: number | null;
  questionTotal: number | null;
}

export function shouldShowOnboarding({
  tagCount,
  questionTotal,
}: OnboardingInput): boolean {
  if (tagCount === null || questionTotal === null) return false;
  return tagCount === 0 && questionTotal === 0;
}
```

- [ ] **Step 4: Verify the test passes**

Run:
```bash
pnpm --dir apps/web exec vitest run src/components/onboarding/shouldShowOnboarding.test.ts
```
Expected: 5 tests pass.

- [ ] **Step 5: Create the presentational component**

Create `apps/web/src/components/onboarding/OnboardingEmpty.tsx`:

```tsx
// First-time empty-state guidance for a brand-new account.
//
// Rendered by QuestionListPage when both the user's tag list and
// question list are empty (per shouldShowOnboarding). Disappears
// automatically once either becomes non-empty — no dismiss button,
// no localStorage flag, no users.onboarded_at field.

import { Plus, Tag as TagIcon, Upload } from "lucide-react";

export default function OnboardingEmpty() {
  return (
    <div className="mx-auto my-8 max-w-2xl rounded-sm border-2 border-dashed border-slate-300 bg-slate-50/50 px-6 py-8">
      <h2 className="text-lg font-semibold text-slate-900">
        Welcome to FastQBank
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        Your question bank is empty. Two steps to get going:
      </p>

      <ol className="mt-4 space-y-3 text-sm text-slate-700">
        <li className="flex items-start gap-2">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-[#1E3A8A] font-mono text-[11px] font-semibold text-white">
            1
          </span>
          <span>
            Create a tag —{" "}
            <span className="inline-flex items-center gap-1 rounded-sm bg-white px-1.5 py-0.5 font-mono text-xs text-slate-700">
              <TagIcon size={11} strokeWidth={1.5} />
              Tags
            </span>{" "}
            button on the left of the toolbar.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-[#1E3A8A] font-mono text-[11px] font-semibold text-white">
            2
          </span>
          <span>
            Add your first question —{" "}
            <span className="inline-flex items-center gap-1 rounded-sm bg-white px-1.5 py-0.5 font-mono text-xs text-slate-700">
              <Plus size={11} strokeWidth={1.5} />
              New
            </span>{" "}
            tab in the top navigation.
          </span>
        </li>
      </ol>

      <p className="mt-4 text-xs text-slate-500">
        Or import a shared link via{" "}
        <span className="inline-flex items-center gap-1 rounded-sm bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
          <Upload size={10} strokeWidth={1.5} />
          Import
        </span>{" "}
        in the page header.
      </p>
    </div>
  );
}
```

- [ ] **Step 6: Wire `OnboardingEmpty` into `QuestionListPage`**

Edit `apps/web/src/pages/QuestionListPage.tsx`:

Add to imports:
```typescript
import OnboardingEmpty from "../components/onboarding/OnboardingEmpty";
import { shouldShowOnboarding } from "../components/onboarding/shouldShowOnboarding";
```

The existing component already has `tags: Tag[]` (loaded once via `listTags`) and `data: QuestionListOut | null` (with `data.total: number`). Compute the predicate near the other derived values (look for `const pageIds = ...` around line 173):

```typescript
const showOnboarding = shouldShowOnboarding({
  tagCount: tags.length,
  // data is null until the first list fetch resolves; map that to null
  // so the predicate holds off rendering during initial load.
  questionTotal: data ? data.total : null,
});
```

Note: `tags` is initialized to `[]` (length 0) before `listTags` resolves. To avoid showing the onboarding card during the initial tag-fetch race, track whether the tag fetch has completed. Replace the `useState<Tag[]>([])` line for tags with a parallel "tagsLoaded" state, OR — simpler — change the initial `tags` state to a sentinel:

Find the existing line:
```typescript
const [tags, setTags] = useState<Tag[]>([]);
```

Replace with:
```typescript
const [tags, setTags] = useState<Tag[] | null>(null);
```

Then update every read of `tags`:
- `tags.length` → `(tags ?? []).length` or pass `tags?.length ?? null` into the predicate (preferred for the predicate; for other read sites use `tags ?? []` to preserve behavior).
- `tags` passed to `<TagFilter tags={tags} ...>` → `tags ?? []`
- `tags` passed to `<TagManageDrawer tags={tags} ...>` → `tags ?? []`
- The `.then((t) => { if (!cancelled) setTags(t); })` in the initial fetch stays the same — first fetch flips `null` → array.
- Same for the `reloadTagsAndList` function — keeps setting an array.

Then compute the predicate:
```typescript
const showOnboarding = shouldShowOnboarding({
  tagCount: tags === null ? null : tags.length,
  questionTotal: data ? data.total : null,
});
```

Finally, in the JSX where the question list renders, conditionally show the onboarding card **above** the empty-state row already in the layout. Find the location where `data.items.length === 0` is rendered (the "No questions" UI) and insert:

```tsx
{showOnboarding && <OnboardingEmpty />}
```

at the top of the page content body — above the toolbar OR above the (empty) question list, whichever matches existing layout flow most cleanly. The card should appear inside the main `<Outlet/>` content area, not above the header.

**Specifically:** open `QuestionListPage.tsx`, find the outermost return statement, look for the first JSX element after the toolbar/filter area, and insert `{showOnboarding && <OnboardingEmpty />}` right before it. If unsure, place it at the very top of the returned JSX fragment as a sibling.

- [ ] **Step 7: Manual smoke (dev)**

Register a brand-new account on the dev web app. Land on Question Bank.
Expected: the onboarding card appears with the welcome copy.
Create a tag.
Expected on next refresh: the card disappears.

Log out → register another fresh account → land on Question Bank → create a question without creating a tag first.
Expected: card disappears after the question lands.

- [ ] **Step 8: Run the full vitest suite to confirm no regressions**

Run:
```bash
pnpm --dir apps/web exec vitest run
```
Expected: all existing tests still pass (Phase 7 review session tests, Phase 5 splitter tests, etc.) + the 5 new `shouldShowOnboarding` tests pass.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/onboarding/ apps/web/src/pages/QuestionListPage.tsx
git commit -m "feat(web): empty-state onboarding for new accounts"
```

---

## Task 8: README rewrite

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace `README.md` entirely**

Overwrite the file with this content (English, per the project's English-target-users memory):

```markdown
# FastQBank

A personal AI-assisted question bank: capture multiple-choice questions
from screenshots, tag them, drill with flashcards, generate new ones
with AI, and share via short links. Web + Windows desktop, both backed
by the same FastAPI server.

## For users (Windows)

1. Download `FastQBank Setup 1.0.0.exe` from the latest GitHub Release
   (link: TBD — replaced on first published release).
2. Double-click the installer. Windows SmartScreen will show
   "unrecognized app" — click *More info* → *Run anyway* (this build is
   unsigned; future releases may add code signing).
3. Step through the NSIS wizard. The app installs per-user; no
   administrator rights needed.
4. Launch FastQBank from the Start menu. Sign up with email + code, or
   sign in with Google.

The web version is also available at https://fastqbank.com — same
account works on both.

## For developers

### Repository layout

```
apps/
├── server/        FastAPI + SQLAlchemy + Alembic (Python 3.12)
├── web/           Vite + React 19 + TypeScript + Tailwind 4
└── desktop/       Electron shell — reuses the web build
packages/
└── ocr-sidecar/   Local PaddleOCR HTTP server (Python, PyInstaller)
deploy/            docker-compose.prod.yml + Caddy + .env templates
docs/              Roadmap, proposal, brainstorming specs/plans
```

### Local development

Backend:
```powershell
docker compose up -d postgres
cd apps\server
.venv\Scripts\activate.bat
uvicorn main:app --reload --port 8000
```

Web:
```powershell
pnpm --dir apps\web install
pnpm --dir apps\web dev   # serves on http://localhost:5173
```

Desktop (dev, reuses Vite dev server):
```powershell
pnpm --dir apps\desktop install
pnpm --dir apps\desktop dev   # ELECTRON_DEV=1, points at localhost:5173
```

OCR sidecar (one-time setup):
```powershell
cd packages\ocr-sidecar
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
# Phase 5 onedir build (~3 min, produces dist/ocr_server/ocr_server.exe)
.venv\Scripts\python.exe build.py
```

### Environment variables

`.env` at the repo root (template: `.env.example`):

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `JWT_SECRET` | yes | Auth token signing key |
| `DEEPSEEK_API_KEY` | optional | Text AI (tag suggestion, summaries, generation). 503 if unset. |
| `VISION_API_KEY` | optional | Vision AI (Improve with AI, parse-question). 503 if unset. |
| `GOOGLE_WEB_CLIENT_ID` / `GOOGLE_WEB_CLIENT_SECRET` | optional | Web Google sign-in. Button hidden if unset. |
| `GOOGLE_DESKTOP_CLIENT_ID` / `GOOGLE_DESKTOP_CLIENT_SECRET` | optional | Desktop loopback Google sign-in. |
| `RESEND_API_KEY` | optional | Email verification + password-reset codes. If unset, codes print to the uvicorn log. |

See `deploy/env.prod.example` for the full production list.

### Packaging the Windows installer

```powershell
pnpm --dir apps\desktop dist
```

Produces `apps\desktop\release\FastQBank Setup 1.0.0.exe` (300–500 MB —
the PaddleOCR sidecar dominates).

`pnpm --dir apps\desktop pack` (note: `pack`, not `dist`) does a faster
`--dir` build for local smoke without producing an installer.

## Deployment

Production runs on a small VPS via `deploy\docker-compose.prod.yml`:
Postgres + the FastAPI server + Caddy fronting both `https://fastqbank.com`
(static SPA build) and `https://api.fastqbank.com` (reverse-proxy to
`server:8000`, automatic HTTPS).

```powershell
git pull
docker compose -f deploy\docker-compose.prod.yml up -d --build
```

Schema migrations are applied automatically on container start
(`alembic upgrade head` in the server Dockerfile CMD).

## Documentation

- [Roadmap (English)](docs/Roadmap_EN.md) — phases 0–11 with as-built notes
- [Proposal (English)](docs/Proposal_EN.md) — feature + tech-stack baseline
- [Brainstorming specs](docs/superpowers/specs/) — design docs per phase
- [Implementation plans](docs/superpowers/plans/) — step-by-step plans
```

- [ ] **Step 2: Verify README renders cleanly**

Open `README.md` in VS Code's markdown preview, or run any markdown linter.
Expected: no syntax errors, code fences match, table renders, the relative links to `docs/...` resolve.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README — users + developers + packaging"
```

---

## Task 9: Final end-to-end verification + roadmap update + merge

**Files:**
- Modify: `docs/Roadmap_EN.md` (mark Phase 10 done with as-built notes)

- [ ] **Step 1: Run the full automated test suite**

Run:
```bash
pnpm --dir apps/web exec vitest run
pnpm --dir apps/web run build
pnpm --dir apps/web run lint
```
Expected: all green.

For the server, if the existing verification scripts still exist:
```bash
cd apps/server
.venv\Scripts\python.exe ..\..\scripts\verify_review.py
.venv\Scripts\python.exe ..\..\scripts\verify_phase9.py
```
Expected: all PASS (these cover Phase 7 + Phase 9 backends; this phase didn't touch them, so they should be untouched).

- [ ] **Step 2: End-to-end smoke through the installed app**

Walk through these flows in the installed `FastQBank.exe` from Task 2's `dist` output:

1. Sign in (password account) → see Question Bank → onboarding card visible (if account is empty).
2. Create a tag → onboarding card disappears.
3. Add a question manually (with LaTeX in the stem).
4. `Ctrl+Shift+Q` → OCR a screenshot of a multi-choice question → save.
5. Click "AI: suggest tags + summary" on a question form → toast-OK or 503 if no key.
6. Open Review → start a flashcard session → answer at least 3 cards.
7. Multi-select 2 questions in the bank → Bulk delete + Add tag.
8. Multi-select 2 questions → Bundle as link → copy URL.
9. Settings (gear icon) → Reset password (password account only).
10. Sign out → log in via Google (web build) and confirm landing on `/questions`.
11. Forgot password → request code → reset → log in.
12. Close-to-tray + tray menu open/quit; second launch focuses existing window.

For each: pass or fail. Any regression is a blocker.

- [ ] **Step 3: Mark Phase 10 done in the roadmap**

Edit `docs/Roadmap_EN.md`:
- Find the "Phase 10 — Polish + Windows Installer" section.
- Change the status line in the Phase Overview table from `⬜ Todo` to `✅ Done (2026-05-20)`.
- Insert a `> **Status: ✅ Done (2026-05-20).** ...` summary under the heading, briefly noting:
  - NSIS installer at `FastQBank Setup 1.0.0.exe`, per-user
  - Real icon from `resources/fastqbICON.png` via `png-to-ico` (no sharp dep)
  - Sidecar packaged-smoke 8/8 pass, no orphan `ocr_server.exe`
  - sonner toasts on network/5xx; offline banner via `navigator.onLine`
  - Empty-state onboarding triggered by zero-tags + zero-questions, no schema change
  - README rewrite + v1.0.0
  - Token-retention behavior across reinstall (record what Task 3 step 8 observed)

- [ ] **Step 4: Commit roadmap update**

```bash
git add docs/Roadmap_EN.md
git commit -m "docs: mark Phase 10 done — Windows installer + polish"
```

- [ ] **Step 5: Merge into main**

```bash
git checkout main
git merge --no-ff phase-10-polish -m "Merge branch 'phase-10-polish': Phase 10 — Windows installer + polish"
```

- [ ] **Step 6: Optional — tag v1.0.0**

```bash
git tag -a v1.0.0 -m "FastQBank v1.0.0 — MVP feature-complete release"
```

(Do not push the tag; that's a separate, explicit user-driven step.)

---

## Spec coverage check

Every Section in `docs/superpowers/specs/2026-05-20-phase10-windows-installer-and-polish-design.md` maps to a task above:

| Spec section | Implemented in |
|---|---|
| § 4.1 App icon pipeline | Task 1 |
| § 4.2 NSIS installer | Task 2 |
| § 4.3 Sidecar packaged-app smoke | Task 3 |
| § 4.4 Global error toasts + offline banner | Tasks 4, 5, 6 |
| § 4.5 Empty-state onboarding | Task 7 |
| § 4.6 Version + README | Tasks 2 (version), 8 (README) |
| § 5 Sub-task execution order | Tasks 1–8 (this plan reorders by independence) |
| § 6 Exit criteria | Task 9 |
| § 7 Risks and mitigations | Addressed inline (sharp deviation note in plan header; SmartScreen note in README and Task 3 step 1) |
| § 8 Testing strategy | Task 7 step 1 (predicate vitest); Task 9 step 1 (suite) |
| § 9 What's excluded | Acknowledged via what is NOT in this plan (no signing, no auto-update, etc.) |

## Notes for the executor

- **Do not run `git push`** during execution. Pushing to `origin/main` is a user-driven action after they've reviewed the merge locally.
- **Do not skip Task 3.** It's the entire reason the Phase 5 As-built notes flagged this work as "handed to Phase 10". Even if no fixes are needed, the manual checklist is the deliverable.
- The `sharp` deviation (using `png-to-ico` only) is **deliberate**, documented in the plan header. If you find an Issue where ICO assembly fails or `gen-icons.cjs` cannot decode `fastqbICON.png` for any reason, the fallback is to add `sharp` as the spec originally suggested — but try the lean path first.
- The plan's Task 4–6 order matters: sonner must be installed (Task 4) before api.ts can import `toast` (Task 5).
- Task 7 step 6 modifies how `tags` state is initialized in `QuestionListPage`. **This is invasive** — touch every read of `tags` to handle the `null` sentinel. If you'd rather avoid this, the alternative is a parallel `const [tagsLoaded, setTagsLoaded] = useState(false)` flag, kept in sync with the existing fetch — but the sentinel approach is more honest (the type captures "not yet fetched").
