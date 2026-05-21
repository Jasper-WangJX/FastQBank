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
