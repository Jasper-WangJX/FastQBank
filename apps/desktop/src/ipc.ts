// Central registry of the IPC channel names used by the OCR capture
// flow, so main / preload / renderer can't drift apart on string typos.
//
// Direction (r = renderer, m = main):
//   r -> m  ocrTrigger        main-window button asks to start a capture
//   r -> m  overlayReady      overlay renderer mounted, ready for bg
//   r -> m  overlayRegion     overlay sends the selected rect (CSS px)
//   r -> m  overlayCancel     overlay was dismissed (Esc / blur)
//   r<->m   sidecarState      renderer queries 'starting'|'ready'|'down'
//   m -> r  overlayBg         full-screen screenshot + scale to overlay
//   m -> r  ocrResult         OCRResult JSON to the main window
//   m -> r  ocrError          { error } to the main window
//   m -> r  ocrBusy           { busy } loading flag to the main window

import { ipcMain } from "electron";

export const IPC = {
  ocrTrigger: "ocr:trigger",
  overlayReady: "overlay:ready",
  overlayRegion: "overlay:region-selected",
  overlayCancel: "overlay:cancel",
  sidecarState: "sidecar:state",
  overlayBg: "overlay:bg",
  ocrResult: "ocr:result",
  ocrError: "ocr:error",
  ocrBusy: "ocr:busy",
} as const;

interface IpcDeps {
  /** Start a screenshot -> OCR capture (also bound to the shortcut). */
  onTrigger: () => void;
  getSidecarState: () => "starting" | "ready" | "down";
}

export function registerIpc(deps: IpcDeps): void {
  ipcMain.on(IPC.ocrTrigger, () => deps.onTrigger());
  ipcMain.handle(IPC.sidecarState, () => deps.getSidecarState());
}
