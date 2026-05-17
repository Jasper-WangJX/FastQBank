// Dependency-free placeholder icon generator.
//
// Stage 4 only needs *a* valid raster icon (Windows Tray/BrowserWindow
// reject SVG); the polished brand icon is stage 10. This writes a clean
// two-tone "medallion" (blue disc + white ring) as a real RGBA PNG using
// only Node built-ins (zlib), so there is no extra dependency just to
// produce a placeholder. Re-run with `pnpm gen:icons` if the design
// changes.
//
// Outputs:
//   assets/icon.png  256x256  (window / app icon; electron-builder
//                               derives the .ico from this)
//   assets/tray.png   32x32   (system tray)

const zlib = require("node:zlib");
const fs = require("node:fs");
const path = require("node:path");

// --- CRC32 (PNG chunk checksum) ---
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

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// Render an RGBA buffer: blue disc with a white ring, soft outer edge.
function render(size) {
  const px = Buffer.alloc(size * size * 4); // RGBA
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const r = size / 2;
  const blue = [37, 99, 235]; // tailwind blue-600
  const white = [255, 255, 255];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const i = (y * size + x) * 4;

      // Outside the disc -> transparent (1px soft edge).
      if (d > r) {
        px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0;
        continue;
      }
      const edgeAlpha = d > r - 1.5 ? Math.max(0, (r - d) / 1.5) : 1;

      // Ring band between 56% and 72% of the radius.
      const inRing = d > r * 0.56 && d < r * 0.72;
      const col = inRing ? white : blue;
      px[i] = col[0];
      px[i + 1] = col[1];
      px[i + 2] = col[2];
      px[i + 3] = Math.round(255 * edgeAlpha);
    }
  }
  return px;
}

function encodePng(size) {
  const raw = render(size);
  // Prefix each scanline with filter byte 0 (none).
  const stride = size * 4;
  const filtered = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    filtered[y * (stride + 1)] = 0;
    raw.copy(filtered, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(filtered, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, "..", "assets");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "icon.png"), encodePng(256));
fs.writeFileSync(path.join(outDir, "tray.png"), encodePng(32));
console.log("Wrote assets/icon.png (256) and assets/tray.png (32).");
