// One-line NDJSON logger that lands in ~/Library/Logs/FastQBank/
// (the standard macOS app log dir Electron resolves for us via
// app.getPath("logs")). Synchronous appends — the OCR capture flow
// is user-initiated and writes at most ~10 lines per trigger, so the
// I/O cost is invisible, and a crash mid-flow keeps the line that
// preceded it.
//
// No-op on non-mac platforms: Windows already has a working OCR
// pipeline and we don't want to pollute it with disk writes or a
// second log path. If we ever need cross-platform structured logs
// here, this is the file to widen.

import { app } from "electron";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const isMac = process.platform === "darwin";

let logPath: string | null = null;
let ensured = false;

function resolveAndEnsure(): string | null {
  if (!isMac) return null;
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
