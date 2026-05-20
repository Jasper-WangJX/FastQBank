// Build a properly-centered square PNG for the desktop window / tray /
// Windows taskbar icon by re-compositing the canonical FastQBank LOGO
// onto a transparent square canvas.
//
// Why this exists: resources/fastqbLOGO.png is 1080x810 (4:3, wider than
// tall) and its visible content does not always sit at the canvas
// center. Letting electron-builder hand that PNG straight to Windows
// produced a taskbar icon that hugged the TOP of the icon slot. This
// script:
//   1. Decodes the source PNG (RGBA) using only Node's built-in zlib.
//   2. Finds the alpha bounding box of the visible content.
//   3. Pastes that bbox into the center of a square canvas, with a
//      small padding margin, so downstream Windows scaling centers
//      the LOGO correctly.
//
// Output:
//   assets/icon.png   square, ~512px — window/.ico source
//   assets/tray.png   identical square — system tray (Windows
//                     downscales as needed at runtime)
//
// Re-run with `pnpm gen:icons` whenever resources/fastqbLOGO.png
// changes.

const zlib = require("node:zlib");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.resolve(__dirname, "..", "..", "..", "resources", "fastqbLOGO.png");
const OUT_DIR = path.resolve(__dirname, "..", "assets");

// Target canvas side. 512 gives electron-builder plenty of resolution
// to derive a multi-size .ico without blurring at 256/128/64/48/32/16.
const CANVAS_SIDE = 512;
// Padding around the visible LOGO bbox, as a fraction of the bbox's
// longer side. 0.10 = 10% padding on each side ≈ Windows app-icon
// breathing room.
const PADDING_FRAC = 0.1;

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

// --- Minimal PNG decoder (8-bit RGBA only — covers fastqbLOGO.png). --------
// References: PNG spec § 7 (filtering) and § 11 (chunks).
function decodePng(buf) {
  // Signature check.
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
      if (bitDepth !== 8 || colorType !== 6) {
        throw new Error(
          `Expected 8-bit RGBA PNG (bitDepth=8, colorType=6); got ` +
            `bitDepth=${bitDepth}, colorType=${colorType}. Re-export the ` +
            `LOGO as RGBA and try again.`,
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
  const stride = width * 4; // RGBA
  const pixels = Buffer.alloc(stride * height);
  // Undo per-row filtering. Filters reference previous pixel (left)
  // and the row above (up). Per spec the byte distance for the
  // "left" reference is 4 here (RGBA).
  const bpp = 4;
  for (let y = 0; y < height; y++) {
    const inOff = y * (stride + 1);
    const filter = inflated[inOff];
    const inRow = inflated.subarray(inOff + 1, inOff + 1 + stride);
    const outRow = pixels.subarray(y * stride, y * stride + stride);
    const prevRow = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? outRow[x - bpp] : 0;
      const up = prevRow ? prevRow[x] : 0;
      const upLeft = prevRow && x >= bpp ? prevRow[x - bpp] : 0;
      let v = inRow[x];
      switch (filter) {
        case 0: // None
          break;
        case 1: // Sub
          v = (v + left) & 0xff;
          break;
        case 2: // Up
          v = (v + up) & 0xff;
          break;
        case 3: // Average
          v = (v + ((left + up) >> 1)) & 0xff;
          break;
        case 4: {
          // Paeth predictor (PNG spec § 9.4).
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          const pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          v = (v + pred) & 0xff;
          break;
        }
        default:
          throw new Error(`Unknown PNG filter type ${filter} at row ${y}.`);
      }
      outRow[x] = v;
    }
  }
  return { width, height, pixels };
}

// --- Encoder (matches the existing one, kept minimal). ---------------------
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
    filtered[y * (stride + 1)] = 0; // filter None
    rgba.copy(filtered, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
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

// --- Find alpha bounding box ------------------------------------------------
// Anything with alpha > threshold counts as "visible". Returns null if the
// source has no visible pixel at all (which would indicate a broken source).
function findAlphaBBox(width, height, pixels, alphaThreshold = 8) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
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

// --- Nearest-neighbor resize of an RGBA image -------------------------------
// Adequate for icon assets (the LOGO is mostly flat-color and Windows
// will re-scale our output again anyway). Avoids pulling in a real
// resampler library.
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

// --- Composite a smaller RGBA buffer onto the center of a square canvas ----
function compose(side, srcW, srcH, srcPixels) {
  const canvas = Buffer.alloc(side * side * 4); // transparent
  const offX = Math.floor((side - srcW) / 2);
  const offY = Math.floor((side - srcH) / 2);
  for (let y = 0; y < srcH; y++) {
    const dstRow = (offY + y) * side * 4 + offX * 4;
    const srcRow = y * srcW * 4;
    srcPixels.copy(canvas, dstRow, srcRow, srcRow + srcW * 4);
  }
  return canvas;
}

// --- Main -------------------------------------------------------------------
if (!fs.existsSync(SRC)) {
  console.error(`Source LOGO not found: ${SRC}`);
  process.exit(1);
}

const src = fs.readFileSync(SRC);
const decoded = decodePng(src);
console.log(`Source: ${decoded.width}x${decoded.height} RGBA`);

const bbox = findAlphaBBox(decoded.width, decoded.height, decoded.pixels);
if (!bbox) {
  console.error("Source PNG has no visible pixels — aborting.");
  process.exit(1);
}
console.log(
  `Visible bbox: x=${bbox.x} y=${bbox.y} w=${bbox.w} h=${bbox.h}`,
);

// Crop the source down to the bbox so any pre-existing transparent
// margin is dropped.
const cropped = Buffer.alloc(bbox.w * bbox.h * 4);
for (let y = 0; y < bbox.h; y++) {
  const srcRow = (bbox.y + y) * decoded.width * 4 + bbox.x * 4;
  cropped.copy; // type-only no-op for readability
  decoded.pixels.copy(cropped, y * bbox.w * 4, srcRow, srcRow + bbox.w * 4);
}

// Fit the cropped LOGO into a square area `target × target` inside the
// `CANVAS_SIDE × CANVAS_SIDE` canvas, keeping the LOGO's aspect ratio
// (object-contain style). PADDING_FRAC reserves an equal-thickness
// transparent margin on every side.
const target = Math.floor(CANVAS_SIDE * (1 - PADDING_FRAC * 2));
const aspect = bbox.w / bbox.h;
const fitW = aspect >= 1 ? target : Math.round(target * aspect);
const fitH = aspect >= 1 ? Math.round(target / aspect) : target;
console.log(`Fit LOGO to ${fitW}x${fitH} inside ${CANVAS_SIDE}x${CANVAS_SIDE}`);

const resized = resizeRgba(bbox.w, bbox.h, cropped, fitW, fitH);
const canvas = compose(CANVAS_SIDE, fitW, fitH, resized);
const png = encodePng(CANVAS_SIDE, CANVAS_SIDE, canvas);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "icon.png"), png);
fs.writeFileSync(path.join(OUT_DIR, "tray.png"), png);
console.log(`Wrote ${path.join(OUT_DIR, "icon.png")} (${CANVAS_SIDE}x${CANVAS_SIDE}).`);
console.log(`Wrote ${path.join(OUT_DIR, "tray.png")} (${CANVAS_SIDE}x${CANVAS_SIDE}).`);
