// Lifecycle + client for the local PaddleOCR HTTP sidecar
// (packages/ocr-sidecar). We own the child process: pick a free port
// and a random shared token, spawn it, poll /healthz until the model is
// loaded, restart it (bounded) if it crashes, and kill its whole tree
// on quit. The renderer never talks to it directly — only main, via
// ocrImage().

import { app } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";

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
}

type State = "starting" | "ready" | "down";

let state: State = "down";
let child: ChildProcess | null = null;
let port = 0;
let token = "";
let shuttingDown = false;
let restarts = 0;
const MAX_RESTARTS = 3;
const READY_TIMEOUT_MS = 180_000; // cold model load can be ~90s+

function log(msg: string): void {
  process.stderr.write(`[sidecar] ${msg}\n`);
}

export function getSidecarState(): State {
  return state;
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const p = addr && typeof addr === "object" ? addr.port : 0;
      srv.close(() => resolve(p));
    });
  });
}

/**
 * Resolve how to launch the sidecar:
 *   - packaged: the PyInstaller exe shipped via extraResources (Step 6);
 *   - dev: the venv python running ocr_server.py. Overridable with
 *     OCR_SIDECAR_EXE / OCR_SIDECAR_PYTHON for ad-hoc testing.
 */
function resolveLaunch(): { cmd: string; args: string[] } {
  if (app.isPackaged) {
    const exe =
      process.env.OCR_SIDECAR_EXE ??
      path.join(process.resourcesPath, "ocr-sidecar", "ocr_server.exe");
    return { cmd: exe, args: [] };
  }
  // out/main.js -> repo root is three levels up.
  const pkgDir = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "packages",
    "ocr-sidecar",
  );
  const script = path.join(pkgDir, "ocr_server.py");
  const venvPy = path.join(pkgDir, ".venv", "Scripts", "python.exe");
  const py =
    process.env.OCR_SIDECAR_PYTHON ??
    (existsSync(venvPy) ? venvPy : "python");
  return { cmd: py, args: [script] };
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForReady(): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline && !shuttingDown) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (r.ok) {
        const j = (await r.json()) as {
          model_loaded?: boolean;
          model_error?: string | null;
        };
        if (j.model_loaded) {
          state = "ready";
          restarts = 0; // a clean ready resets the crash budget
          log("ready");
          return;
        }
        if (j.model_error) log(`model error: ${j.model_error}`);
      }
    } catch {
      /* not up yet — keep polling */
    }
    await delay(1000);
  }
  if (!shuttingDown) {
    state = "down";
    log("readiness timed out");
  }
}

function spawnOnce(): void {
  const { cmd, args } = resolveLaunch();
  const full = [...args, "--port", String(port), "--token", token];
  log(`spawn ${cmd} ${full.join(" ")}`);
  state = "starting";
  child = spawn(cmd, full, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout?.on("data", (d) => process.stderr.write(`[ocr] ${d}`));
  child.stderr?.on("data", (d) => process.stderr.write(`[ocr] ${d}`));

  child.on("exit", (code) => {
    log(`exited (code=${code})`);
    child = null;
    if (shuttingDown) {
      state = "down";
      return;
    }
    if (restarts < MAX_RESTARTS) {
      restarts += 1;
      const backoff = 2000 * 2 ** (restarts - 1); // 2s, 4s, 8s
      log(`restarting in ${backoff}ms (attempt ${restarts})`);
      state = "starting";
      setTimeout(() => {
        if (!shuttingDown) {
          spawnOnce();
          void waitForReady();
        }
      }, backoff);
    } else {
      state = "down";
      log("restart budget exhausted — OCR disabled");
    }
  });

  child.on("error", (err) => log(`spawn error: ${err.message}`));
}

export async function startSidecar(): Promise<void> {
  shuttingDown = false;
  restarts = 0;
  port = await findFreePort();
  token = randomBytes(16).toString("hex");
  spawnOnce();
  void waitForReady();
}

export function stopSidecar(): void {
  shuttingDown = true;
  const c = child;
  child = null;
  state = "down";
  if (!c || c.pid == null) return;
  if (process.platform === "win32") {
    // PyInstaller onefile spawns an unpacked child — kill the tree.
    spawn("taskkill", ["/pid", String(c.pid), "/T", "/F"], {
      windowsHide: true,
    });
  } else {
    c.kill();
  }
}

/** POST a cropped PNG to the sidecar; resolve its OCRResult or throw. */
export async function ocrImage(png: Buffer): Promise<OcrResult> {
  if (state !== "ready") throw new Error("OCR engine is not ready yet");
  const res = await fetch(`http://127.0.0.1:${port}/ocr`, {
    method: "POST",
    headers: { "Content-Type": "image/png", "X-OCR-Token": token },
    body: new Uint8Array(png),
  });
  const json = (await res.json().catch(() => null)) as
    | (OcrResult & { error?: string })
    | null;
  if (!res.ok || !json || json.ok !== true) {
    const detail = json?.error ?? `HTTP ${res.status}`;
    throw new Error(`OCR failed: ${detail}`);
  }
  return json;
}
