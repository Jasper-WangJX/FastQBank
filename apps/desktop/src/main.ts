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

import { app, BrowserWindow, Menu, Tray, nativeImage, protocol } from "electron";
import { promises as fsp, statSync } from "node:fs";
import path from "node:path";

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
// Distinguishes a real quit (tray "退出" / app.quit) from a window close,
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
    icon: path.join(__dirname, "..", "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
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

function createTray(): void {
  const icon = nativeImage.createFromPath(
    path.join(__dirname, "..", "assets", "tray.png"),
  );
  tray = new Tray(icon);
  tray.setToolTip("AI Question Bank");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开主窗", click: () => showWindow() },
      { type: "separator" },
      {
        label: "退出",
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
    registerAppProtocol();
    createWindow();
    createTray();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("before-quit", () => {
    isQuitting = true;
  });

  // Tray-resident: do NOT quit when the window is closed. App lifetime is
  // controlled solely by the tray "退出" item.
  app.on("window-all-closed", () => {
    /* intentionally empty */
  });
}
