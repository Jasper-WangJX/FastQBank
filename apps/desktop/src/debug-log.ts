// One-line NDJSON logger for diagnosing macOS OCR capture issues.
// Writes to ~/Library/Logs/FastQBank/ocr-debug.log (the standard
// macOS app log dir Electron resolves via app.getPath("logs")).
// Synchronous appends — the OCR capture flow is user-initiated and
// writes at most ~10 lines per trigger, so the I/O cost is invisible,
// and a crash mid-flow keeps the line that preceded it.
//
// Default: disabled (no-op). Enable by launching with FQB_OCR_DEBUG=1
// — `open` discards env vars (launchd resets them), so launch the
// embedded binary directly when you need a debug trace:
//   FQB_OCR_DEBUG=1 \
//     /Applications/FastQBank.app/Contents/MacOS/FastQBank
//
// Also no-op on non-mac platforms regardless of the env var.

import { app } from "electron";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const enabled =
  process.platform === "darwin" && process.env.FQB_OCR_DEBUG === "1";

let logPath: string | null = null;
let ensured = false;

function resolveAndEnsure(): string | null {
  if (!enabled) return null;
  if (logPath && ensured) return logPath;
  const dir = app.getPath("logs");
  if (!ensured) {
    try {
      mkdirSync(dir, { recursive: true });
      ensured = true;
    } catch {
      // Electron creates the dir on first getPath("logs"); if mkdir
      // races with that, the next append will succeed anyway.
    }
  }
  logPath = path.join(dir, "ocr-debug.log");
  return logPath;
}

/** True when FQB_OCR_DEBUG=1 was set at process start AND we're on
 *  macOS. Use this to gate heavier diagnostic side-effects (e.g.
 *  writing the desktopCapturer thumbnail to disk) that you don't want
 *  paying for on every capture in normal use. */
export function dlogEnabled(): boolean {
  return enabled;
}

export function dlog(
  area: string,
  msg: string,
  fields?: Record<string, unknown>,
): void {
  const target = resolveAndEnsure();
  if (!target) return;
  const line =
    JSON.stringify({
      t: new Date().toISOString(),
      area,
      msg,
      fields: fields ?? null,
    }) + "\n";
  try {
    appendFileSync(target, line);
  } catch {
    // If the log file is unwritable, swallow — never let diagnostic
    // logging break the OCR flow it's meant to diagnose.
  }
}
