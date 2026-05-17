// Screen grab + crop. We snapshot the display under the cursor at its
// PHYSICAL pixel size, show a DIP-sized overlay on top, then map the
// CSS-pixel selection back up by scaleFactor before cropping — so the
// crop is pixel-accurate on HiDPI / mixed-DPI multi-monitor setups.

import { desktopCapturer, screen, type Display, type NativeImage } from "electron";

export interface Grab {
  display: Display;
  /** Full screenshot of `display` at physical pixels. */
  thumbnail: NativeImage;
}

/** Selection rectangle in the overlay's CSS (DIP) pixels. */
export interface RectCss {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_SELECTION_CSS = 8; // smaller than this == a misclick, ignore

export async function grabScreen(): Promise<Grab> {
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const scale = display.scaleFactor;

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: {
      width: Math.round(display.size.width * scale),
      height: Math.round(display.size.height * scale),
    },
    fetchWindowIcons: false,
  });

  const match =
    sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
  if (!match) throw new Error("no screen source available");
  return { display, thumbnail: match.thumbnail };
}

/** A few px of slack so text flush against the selection edge (often
 *  the last option line) isn't clipped and the detector keeps it. */
const EDGE_PAD = 6;

/**
 * Crop the physical-pixel screenshot to the user's CSS-pixel selection.
 *
 * The ratio between the overlay (CSS/DIP px) and the screenshot bitmap
 * is derived from the bitmap's ACTUAL size vs the overlay size — NOT
 * assumed to be display.scaleFactor: desktopCapturer treats
 * thumbnailSize as a hint and may hand back a differently scaled
 * bitmap, and a wrong ratio compounds toward the bottom/right (it was
 * dropping the last option line). Returns null for a selection too
 * small to be intentional.
 */
export function cropToPng(
  thumbnail: NativeImage,
  rect: RectCss,
  overlayCssSize: { width: number; height: number },
): Buffer | null {
  if (rect.w < MIN_SELECTION_CSS || rect.h < MIN_SELECTION_CSS) return null;
  const ts = thumbnail.getSize(); // real bitmap pixels
  const rx = ts.width / overlayCssSize.width;
  const ry = ts.height / overlayCssSize.height;

  let x = Math.round(rect.x * rx) - EDGE_PAD;
  let y = Math.round(rect.y * ry) - EDGE_PAD;
  let w = Math.round(rect.w * rx) + EDGE_PAD * 2;
  let h = Math.round(rect.h * ry) + EDGE_PAD * 2;

  // Clamp to the bitmap so the crop rect is always fully inside it.
  x = Math.max(0, Math.min(x, ts.width - 1));
  y = Math.max(0, Math.min(y, ts.height - 1));
  w = Math.min(w, ts.width - x);
  h = Math.min(h, ts.height - y);
  if (w < 1 || h < 1) return null;

  return thumbnail.crop({ x, y, width: w, height: h }).toPNG();
}
