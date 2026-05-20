// Single source of truth for the `window.desktop` bridge that the
// Electron preload (apps/desktop/src/preload.ts) exposes. The two
// projects don't import each other; this ambient declaration keeps the
// renderer side strongly typed and is a no-op in a plain browser (the
// bridge is simply absent).

import type { Option, QuestionType } from "./qbank";

export interface OcrLine {
  text: string;
  score: number;
  bbox: number[][];
}

export interface OcrResult {
  ok: boolean;
  engine: string;
  image: { width: number; height: number };
  lines: OcrLine[];
  elapsed_ms: number;
  /** base64 PNG of the cropped screenshot (main.ts attaches it so the
   *  confirm form can call /ai/parse-question without re-capturing). */
  image_b64?: string;
}

export interface OcrErrorPayload {
  error: string;
}

export interface OverlayBg {
  dataUrl: string;
  scale: number;
}

/** Selection rectangle in the overlay's CSS (DIP) pixels. */
export interface RectCss {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SidecarState = "starting" | "ready" | "down";

/** Draft passed via router state from AppLayout to the confirm form. */
export interface OcrPrefill {
  stem: string;
  type: QuestionType;
  options: Option[];
  matched: boolean;
  /** Carried so the confirm form's "Improve with AI" button can POST
   *  the original crop + OCR text to /ai/parse-question (stage 6). */
  imageB64?: string;
  ocrText?: string;
}

export interface DesktopBridge {
  isDesktop: true;
  ocr: {
    trigger(): void;
    onResult(cb: (r: OcrResult) => void): () => void;
    onError(cb: (e: OcrErrorPayload) => void): () => void;
    onBusy(cb: (busy: boolean) => void): () => void;
    getState(): Promise<SidecarState>;
  };
  overlay: {
    onBackground(cb: (bg: OverlayBg) => void): () => void;
    selectRegion(rect: RectCss): void;
    cancel(): void;
  };
  /** Custom-titlebar controls — undefined on web (feature-detect). */
  window: {
    minimize(): void;
    maximizeToggle(): void;
    close(): void;
    isMaximized(): Promise<boolean>;
    onMaximizedChange(cb: (maximized: boolean) => void): () => void;
  };
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

/** The bridge if running inside the desktop shell, else undefined. */
export function getDesktop(): DesktopBridge | undefined {
  return typeof window !== "undefined" && window.desktop?.isDesktop
    ? window.desktop
    : undefined;
}
