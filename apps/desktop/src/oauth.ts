// Phase 11 — Google OAuth helpers running in the Electron main
// process.
//
// startLoopbackOnce() — bind a single-use http server to 127.0.0.1:0,
//   capture the FIRST GET to /oauth/callback?code&state, respond with
//   a static "you can close this window" page, then close the server.
//   Times out after 5 minutes so a forgotten flow doesn't leak a
//   listener. Returns the OS-assigned port and a promise that
//   resolves with { code, state }.
//
// openGoogleAuthUrl() — only opens URLs whose origin is
//   https://accounts.google.com. The whitelist keeps a compromised
//   renderer from using this IPC to launch arbitrary protocols.

import { shell } from "electron";
import http from "node:http";

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
const ALLOWED_AUTH_ORIGIN = "https://accounts.google.com";

export interface LoopbackHandle {
  port: number;
  awaitCallback: Promise<{ code: string; state: string }>;
}

export async function startLoopbackOnce(): Promise<LoopbackHandle> {
  let resolve!: (v: { code: string; state: string }) => void;
  let reject!: (e: Error) => void;
  const awaitCallback = new Promise<{ code: string; state: string }>(
    (res, rej) => {
      resolve = res;
      reject = rej;
    },
  );

  const server = http.createServer((req, res) => {
    if (!req.url) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname !== "/oauth/callback") {
      res.statusCode = 404;
      res.end();
      return;
    }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) {
      res.statusCode = 400;
      res.end("missing code or state");
      return;
    }
    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(
      '<!doctype html><html><body style="font-family:system-ui;padding:24px;">' +
        "<h2>You can close this window.</h2>" +
        "<p>Returning to FastQBank…</p></body></html>",
    );
    resolve({ code, state });
    // Close after the response is flushed.
    server.close();
  });

  await new Promise<void>((res, rej) => {
    server.once("error", rej);
    server.listen(0, "127.0.0.1", () => res());
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    server.close();
    throw new Error("could not determine loopback port");
  }
  const port = addr.port;

  const timeout = setTimeout(() => {
    server.close();
    reject(new Error("oauth loopback timeout"));
  }, CALLBACK_TIMEOUT_MS);

  // Ensure the timer doesn't keep Electron alive past the resolve.
  awaitCallback.finally(() => clearTimeout(timeout));

  return { port, awaitCallback };
}

export function openGoogleAuthUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("invalid url");
  }
  if (parsed.origin !== ALLOWED_AUTH_ORIGIN) {
    throw new Error(`refused to open URL outside ${ALLOWED_AUTH_ORIGIN}`);
  }
  void shell.openExternal(url);
}
