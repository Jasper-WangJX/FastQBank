// The screenshot selection overlay: a transparent, frameless, top-most
// BrowserWindow covering exactly the target display. It loads the SAME
// web build as the main window via `?overlay=1` (main.tsx branches on
// that and renders only <OverlayCapture/>), so we don't maintain a
// separate HTML bundle. Resolves the user's selection rect, or null if
// they cancelled (Esc / clicked away / closed).

import { BrowserWindow, ipcMain, type Display } from "electron";
import { IPC } from "./ipc";
import type { RectCss } from "./capture";
import { dlog } from "./debug-log";

interface CaptureOpts {
  display: Display;
  /** Physical-pixel screenshot as a data URL, painted onto the canvas. */
  backgroundDataUrl: string;
  scaleFactor: number;
  preloadPath: string;
  overlayUrl: string;
}

export function captureRegion(opts: CaptureOpts): Promise<RectCss | null> {
  return new Promise((resolve) => {
    const b = opts.display.bounds; // DIP coords place it on that display
    const win = new BrowserWindow({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      // NOT transparent: we paint the full screenshot opaquely, so we
      // don't need it — and transparent frameless windows on Windows
      // get constrained to the work area, which squashed the
      // full-screen capture above the still-visible real taskbar (the
      // "two taskbars" artifact).
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      fullscreenable: false,
      hasShadow: false,
      backgroundColor: "#000000",
      webPreferences: {
        preload: opts.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    // Pin it to the WHOLE display (over the taskbar) and keep it there —
    // the constructor bounds can be clamped to the work area on Windows.
    win.setBounds(b);
    win.setMinimumSize(b.width, b.height);
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true);
    win.on("resize", () => {
      if (win.isDestroyed()) return;
      const c = win.getBounds();
      if (c.width !== b.width || c.height !== b.height) win.setBounds(b);
    });
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

    let settled = false;
    const finish = (rect: RectCss | null) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener(IPC.overlayReady, onReady);
      ipcMain.removeListener(IPC.overlayRegion, onRegion);
      ipcMain.removeListener(IPC.overlayCancel, onCancel);
      if (!win.isDestroyed()) win.close();
      resolve(rect);
    };

    // Only react to events from THIS overlay's webContents.
    const fromThisWin = (e: Electron.IpcMainEvent) =>
      !win.isDestroyed() && e.sender === win.webContents;

    const sendBg = () => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.overlayBg, {
          dataUrl: opts.backgroundDataUrl,
          scale: opts.scaleFactor,
        });
      }
    };
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

    ipcMain.on(IPC.overlayReady, onReady);
    ipcMain.on(IPC.overlayRegion, onRegion);
    ipcMain.on(IPC.overlayCancel, onCancel);

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

    void win.loadURL(opts.overlayUrl);
    win.show();
    win.focus();
  });
}
