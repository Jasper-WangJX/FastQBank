// Preload runs in an isolated, sandboxed context: it may only touch
// contextBridge + ipcRenderer (no fs / child_process), which is exactly
// enough to forward the stage-5 OCR IPC. Phase 4's `isDesktop` flag is
// kept so the web app can still feature-detect the desktop shell.
//
// Channel strings mirror src/ipc.ts (the source of truth on the main
// side); kept literal here to avoid importing main-only `ipcMain`.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

type Listener = (payload: unknown) => void;

/** Subscribe to a main->renderer channel; returns an unsubscribe fn. */
function sub(channel: string, cb: Listener): () => void {
  const handler = (_e: IpcRendererEvent, payload: unknown) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

interface RectCss {
  x: number;
  y: number;
  w: number;
  h: number;
}

contextBridge.exposeInMainWorld("desktop", {
  isDesktop: true,

  // Used by the main window (button + result/error/busy listeners).
  ocr: {
    trigger: () => ipcRenderer.send("ocr:trigger"),
    onResult: (cb: Listener) => sub("ocr:result", cb),
    onError: (cb: Listener) => sub("ocr:error", cb),
    onBusy: (cb: Listener) => sub("ocr:busy", cb),
    getState: () => ipcRenderer.invoke("sidecar:state"),
  },

  // Used only by the capture overlay window (?overlay=1).
  overlay: {
    onBackground: (cb: Listener) => {
      const unsub = sub("overlay:bg", cb);
      // Tell main we're mounted so it (re)sends the screenshot — covers
      // the race where this listener beats did-finish-load.
      ipcRenderer.send("overlay:ready");
      return unsub;
    },
    selectRegion: (rect: RectCss) =>
      ipcRenderer.send("overlay:region-selected", rect),
    cancel: () => ipcRenderer.send("overlay:cancel"),
  },
});
