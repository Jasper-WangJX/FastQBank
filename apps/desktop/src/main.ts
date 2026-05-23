// Electron main process for the AI Question Bank desktop shell.
//
// Strategy (roadmap stage 4, "approach A"): do NOT rebuild the renderer
// here — load the existing apps/web production build through a custom
// `app://` scheme. A standard, secure custom scheme gives the renderer a
// stable origin (`app://aqb`), so:
//   - react-router's BrowserRouter keeps working (SPA fallback below
//     mirrors Caddy's try_files used in production);
//   - localStorage (the JWT lives there) persists across restarts;
//   - the backend CORS allow-list needs exactly one fixed origin.
//
// Dev mode (ELECTRON_DEV=1) instead points at the Vite dev server so the
// normal HMR workflow is unchanged.

import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  protocol,
  systemPreferences,
} from "electron";
import { promises as fsp, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  getSidecarState,
  ocrImage,
  startSidecar,
  stopSidecar,
} from "./sidecar";
import { cropToPng, grabScreen } from "./capture";
import { captureRegion } from "./overlay";
import { registerShortcut, unregisterShortcut } from "./shortcut";
import { IPC, registerIpc } from "./ipc";
import { openGoogleAuthUrl, startLoopbackOnce } from "./oauth";
import { dlog } from "./debug-log";

const isDev = process.env.ELECTRON_DEV === "1";
const DEV_SERVER_URL = "http://localhost:5173";
// Host segment of the custom scheme. Origin becomes `app://aqb` — this
// exact string must be in the backend CORS allow-list.
const APP_ORIGIN_URL = "app://aqb/";

// Resolve the built web SPA:
//   - packaged: copied next to the app via electron-builder
//     extraResources (-> resources/web-dist);
//   - dev / unpacked: apps/web/dist (out/main.js -> ../../web/dist).
const WEB_DIST = app.isPackaged
  ? path.join(process.resourcesPath, "web-dist")
  : path.join(__dirname, "..", "..", "web", "dist");

// Same preload script backs both the main window and the capture overlay.
const PRELOAD = path.join(__dirname, "preload.js");

// Minimal extension -> MIME map. Serving the bytes ourselves (rather than
// proxying file:// through net.fetch) keeps Content-Type deterministic —
// ES modules MUST be served as text/javascript or the renderer refuses
// to execute them.
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

// Custom schemes must be registered BEFORE the app 'ready' event.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
// Distinguishes a real quit (tray "Quit" / app.quit) from a window close,
// which we intercept to hide-to-tray instead.
let isQuitting = false;

/**
 * Map a request URL's pathname onto WEB_DIST. Vite builds with base "/",
 * so assets arrive as absolute paths (/assets/...). Decodes, strips the
 * leading slash, and blocks path traversal so nothing outside WEB_DIST
 * can ever be served.
 */
function resolveAssetPath(requestUrl: string): string {
  const pathname = decodeURIComponent(new URL(requestUrl).pathname);
  const rel = path.normalize(pathname).replace(/^[/\\]+/, "");
  const full = path.join(WEB_DIST, rel);
  if (full !== WEB_DIST && !full.startsWith(WEB_DIST + path.sep)) {
    return path.join(WEB_DIST, "index.html");
  }
  return full;
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function registerAppProtocol(): void {
  protocol.handle("app", async (request) => {
    const resolved = resolveAssetPath(request.url);
    // SPA fallback: any path that isn't a real built file (e.g. "/",
    // "/questions", "/questions/:id/edit") serves the shell so
    // BrowserRouter can take over — exactly what Caddy's try_files does
    // for the web deployment.
    const target = isFile(resolved)
      ? resolved
      : path.join(WEB_DIST, "index.html");

    try {
      const body = await fsp.readFile(target);
      const mime = MIME[path.extname(target).toLowerCase()] ?? "application/octet-stream";
      return new Response(new Uint8Array(body), {
        status: 200,
        headers: { "content-type": mime },
      });
    } catch {
      return new Response(
        "Web build not found. Run `pnpm build:web` (or `pnpm build`).",
        { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    icon: path.join(__dirname, "..", "assets", "icon.png"),
    // Frameless: kill the native title bar + system menu so the renderer
    // can paint its own min/max/close buttons (sapphire-console style).
    // The header in AppLayout is marked as -webkit-app-region: drag so
    // users can still move the window.
    frame: false,
    // Hide the application menu bar (File / Edit / View …) entirely;
    // Menu.setApplicationMenu(null) below covers the keyboard-toggleable
    // mnemonic menu path too.
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    void mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    void mainWindow.loadURL(APP_ORIGIN_URL);
  }

  // Tell the renderer when the OS-level maximize state flips (e.g. user
  // double-clicked the drag region or used Win+Up/Down), so the custom
  // max/restore icon stays in sync.
  const sendMax = (maximized: boolean): void => {
    mainWindow?.webContents.send(IPC.windowMaximized, maximized);
  };
  mainWindow.on("maximize", () => sendMax(true));
  mainWindow.on("unmaximize", () => sendMax(false));

  // Close-to-tray: intercept the window close and just hide, unless a
  // real quit is in progress.
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleWindow(): void {
  if (mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.hide();
  } else {
    showWindow();
  }
}

// One capture at a time (the global shortcut can be spammed).
let capturing = false;

/**
 * The screenshot -> OCR flow: grab the screen under the cursor, let the
 * user rubber-band a region on the overlay, crop it, send it to the
 * sidecar, and hand the OCRResult to the main window (the renderer then
 * splits it and opens the prefilled confirm form). Bound to both the
 * global shortcut and the in-app button.
 */
async function captureAndRecognize(): Promise<void> {
  if (capturing) return;
  const st = getSidecarState();
  dlog("capture", "trigger", {
    sidecar: st,
    screenPerm: systemPreferences.getMediaAccessStatus("screen"),
  });
  if (st !== "ready") {
    showWindow();
    mainWindow?.webContents.send(IPC.ocrError, {
      error:
        st === "starting"
          ? "OCR engine is still starting — try again in a moment."
          : "OCR engine is unavailable.",
    });
    return;
  }
  capturing = true;
  try {
    const { display, thumbnail } = await grabScreen();
    dlog("capture", "grab ok", {
      displayId: display.id,
      scale: display.scaleFactor,
      bounds: display.bounds,
      bitmap: thumbnail.getSize(),
    });
    if (process.platform === "darwin") {
      const thumbPath = path.join(app.getPath("logs"), "last-thumb.png");
      try {
        writeFileSync(thumbPath, thumbnail.toPNG());
        dlog("capture", "thumb dumped", { thumbPath });
      } catch (e) {
        dlog("capture", "thumb dump failed", {
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }
    const overlayUrl = isDev
      ? `${DEV_SERVER_URL}/?overlay=1`
      : `${APP_ORIGIN_URL}?overlay=1`;
    dlog("capture", "overlay before", { overlayUrl });
    const rect = await captureRegion({
      display,
      backgroundDataUrl: thumbnail.toDataURL(),
      scaleFactor: display.scaleFactor,
      preloadPath: PRELOAD,
      overlayUrl,
    });
    dlog("capture", "overlay after", { rect });
    if (!rect) return; // cancelled (Esc / clicked away)
    // Overlay canvas == window.innerWidth/Height == this display's DIP
    // bounds; cropToPng derives the real bitmap ratio from that.
    const png = cropToPng(thumbnail, rect, {
      width: display.bounds.width,
      height: display.bounds.height,
    });
    if (!png) return; // selection too small — treat as a misclick
    mainWindow?.webContents.send(IPC.ocrBusy, true);
    dlog("capture", "ocr before", { bytes: png.length });
    const result = await ocrImage(png);
    dlog("capture", "ocr after", {
      engine: result.engine,
      lines: result.lines.length,
      elapsed: result.elapsed_ms,
    });
    showWindow();
    // Carry the cropped screenshot (base64 PNG) alongside the OCR text
    // so the renderer can offer "Improve with AI" (stage-6 vision
    // /ai/parse-question) without re-capturing. The server downsamples +
    // grayscales it, so sending the full crop here is fine.
    mainWindow?.webContents.send(IPC.ocrResult, {
      ...result,
      image_b64: png.toString("base64"),
    });
  } catch (err) {
    dlog("capture", "error", {
      err: err instanceof Error ? err.message : String(err),
    });
    showWindow();
    mainWindow?.webContents.send(IPC.ocrError, {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    mainWindow?.webContents.send(IPC.ocrBusy, false);
    capturing = false;
  }
}

function createTray(): void {
  const icon = nativeImage.createFromPath(
    path.join(__dirname, "..", "assets", "tray.png"),
  );
  tray = new Tray(icon);
  tray.setToolTip("FastQBank");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open", click: () => showWindow() },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  // Left-click toggles visibility (Windows convention).
  tray.on("click", () => toggleWindow());
}

// Single-instance lock: a second launch should focus the existing window
// rather than spawn a duplicate tray app.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());

  void app.whenReady().then(() => {
    // Belt-and-braces against the default Electron menu: even with
    // `autoHideMenuBar: true`, calling setApplicationMenu(null) here
    // guarantees no menu can be summoned via Alt or accelerators.
    Menu.setApplicationMenu(null);

    registerAppProtocol();
    createWindow();
    createTray();

    // OCR capture flow (roadmap stage 5).
    registerIpc({
      onTrigger: captureAndRecognize,
      getSidecarState,
      getMainWindow: () => mainWindow,
      onOauthOpenExternal: (url: string) => {
        try {
          openGoogleAuthUrl(url);
        } catch (e) {
          process.stderr.write(
            `[oauth] refused to open url: ${e instanceof Error ? e.message : e}\n`,
          );
        }
      },
      onOauthStartLoopback: async () => {
        const handle = await startLoopbackOnce();
        // Forward the callback to the renderer as soon as it arrives;
        // we don't keep a reference here.
        void handle.awaitCallback
          .then((payload) => {
            mainWindow?.webContents.send(IPC.oauthCallback, payload);
          })
          .catch((e) => {
            process.stderr.write(
              `[oauth] loopback failed: ${e instanceof Error ? e.message : e}\n`,
            );
          });
        return { port: handle.port };
      },
    });
    void startSidecar();
    const acc = registerShortcut(captureAndRecognize);
    process.stderr.write(
      acc
        ? `[shortcut] capture bound to ${acc}\n`
        : "[shortcut] no global hotkey free — use the in-app button\n",
    );

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.on("will-quit", () => {
    unregisterShortcut();
    stopSidecar();
  });

  // Tray-resident: do NOT quit when the window is closed. App lifetime is
  // controlled solely by the tray "Quit" item.
  app.on("window-all-closed", () => {
    /* intentionally empty */
  });
}
