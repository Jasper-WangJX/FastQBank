// Inline styles that flag a region as draggable / non-draggable for
// Electron's frameless window. `-webkit-app-region` is non-standard
// but universally honoured by Chromium-based shells; plain browsers
// silently ignore it.
//
// Kept in a non-component module so Vite's fast-refresh rule
// (`react-refresh/only-export-components`) stays happy on
// WindowControls.tsx.

import type { CSSProperties } from "react";

export const DRAG_STYLE = {
  WebkitAppRegion: "drag",
} as CSSProperties;

export const NO_DRAG_STYLE = {
  WebkitAppRegion: "no-drag",
} as CSSProperties;
