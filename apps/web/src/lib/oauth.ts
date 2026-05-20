// Phase 11 — shared OAuth callback logic.
//
// Both the web /oauth/callback page and the desktop loopback-server
// IPC consumer call this helper so token exchange happens in exactly
// one place. The function does NOT navigate or touch the
// AuthContext directly: it returns the access token, the caller
// performs login + navigate.

import { apiFetch } from "./api";

interface TokenOut {
  access_token: string;
  token_type: string;
}

export async function completeOAuthCallback(
  code: string,
  state: string,
): Promise<string> {
  const out = await apiFetch<TokenOut>("/auth/google/callback", {
    method: "POST",
    body: { code, state },
  });
  return out.access_token;
}
