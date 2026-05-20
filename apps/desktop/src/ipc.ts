// Central registry of the IPC channel names, so main / preload /
// renderer can't drift apart on string typos.
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
//   r -> m  windowMinimize    custom titlebar button → win.minimize()
//   r -> m  windowMaxToggle   custom titlebar button → maximize/unmaximize
//   r -> m  windowClose       custom titlebar button → win.close() (→ hide-to-tray)
//   r<->m   windowIsMaxed     renderer asks: are we currently maximized?
//   m -> r  windowMaximized   broadcast when the OS-level maximize state flips

import { BrowserWindow, ipcMain } from "electron";

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
  windowMinimize: "window:minimize",
  windowMaxToggle: "window:max-toggle",
  windowClose: "window:close",
  windowIsMaxed: "window:is-maxed",
  windowMaximized: "window:maximized",
} as const;

interface IpcDeps {
  /** Start a screenshot -> OCR capture (also bound to the shortcut). */
  onTrigger: () => void;
  getSidecarState: () => "starting" | "ready" | "down";
  /** Returns the live main BrowserWindow, or null after it's destroyed. */
  getMainWindow: () => BrowserWindow | null;
}

export function registerIpc(deps: IpcDeps): void {
  ipcMain.on(IPC.ocrTrigger, () => deps.onTrigger());
  ipcMain.handle(IPC.sidecarState, () => deps.getSidecarState());

  // Window controls — the renderer's custom titlebar drives these. The
  // close handler delegates to win.close(), which the main process
  // intercepts to hide-to-tray (matching the existing taskbar/×
  // behavior, so the desktop button is consistent).
  ipcMain.on(IPC.windowMinimize, () => deps.getMainWindow()?.minimize());
  ipcMain.on(IPC.windowMaxToggle, () => {
    const w = deps.getMainWindow();
    if (!w) return;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  });
  ipcMain.on(IPC.windowClose, () => deps.getMainWindow()?.close());
  ipcMain.handle(
    IPC.windowIsMaxed,
    () => deps.getMainWindow()?.isMaximized() ?? false,
  );
}
