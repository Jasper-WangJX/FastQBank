// Phase 11 — "Continue with / Sign in with Google" button.
//
// Visual: inverted treatment vs. the primary Sapphire-blue button on
// LoginPage / RegisterPage — white surface, slate border + text, so
// the two CTAs read as alternatives, not a hierarchy.
//
// Behavior (this file, web-only): fetch /auth/google/start?platform=web
// → window.location.assign(authorize_url).
// The desktop branch is layered on in Task 23 once the IPC bridge
// exists.

import { useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { ApiError, apiFetch } from "../../lib/api";
import { getDesktop } from "../../lib/desktop";

interface StartOut {
  authorize_url: string;
  state: string;
}

interface Props {
  mode: "signin" | "signup";
}

function GoogleG() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 48 48"
      aria-hidden
      focusable="false"
    >
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.3 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8c1.8-4.4 6.1-7.5 11.1-7.5 3 0 5.8 1.1 7.9 3l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.3 0 10.2-2 13.8-5.3l-6.4-5.4c-2 1.4-4.6 2.3-7.4 2.3-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.7 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.2 5.6l6.4 5.4c-.4.4 6.5-4.7 6.5-15 0-1.2-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

export default function GoogleSignInButton({ mode }: Props) {
  const { providers } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (providers === null) return null;
  const desktop = getDesktop();
  const enabled = desktop ? providers.google.desktop : providers.google.web;
  if (!enabled) return null;

  async function onClick() {
    setErr(null);
    setSubmitting(true);
    try {
      const desktop = getDesktop();
      if (desktop) {
        const { port } = await desktop.oauth.startLoopback();
        const redirect_uri = `http://127.0.0.1:${port}/oauth/callback`;
        const out = await apiFetch<StartOut>(
          `/auth/google/start?platform=desktop&redirect_uri=${encodeURIComponent(redirect_uri)}`,
        );
        desktop.oauth.openExternal(out.authorize_url);
        return;
      }
      const out = await apiFetch<StartOut>(
        "/auth/google/start?platform=web",
      );
      window.location.assign(out.authorize_url);
    } catch (e) {
      setErr(
        e instanceof ApiError ? e.message : "Could not start Google sign-in",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-3">
      {/* "OR" divider */}
      <div className="my-3 flex items-center gap-2">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">
          OR
        </span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={submitting}
        className="inline-flex w-full items-center justify-center gap-2 rounded-sm border border-slate-300 bg-white px-3 py-2 font-mono text-[12.5px] uppercase tracking-[0.08em] text-slate-800 transition-colors duration-150 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <GoogleG />
        <span>
          {mode === "signin" ? "Sign in with Google" : "Continue with Google"}
        </span>
      </button>
      {err && (
        <div className="mt-2 rounded-sm border border-red-300 bg-red-50 px-3 py-2 font-mono text-[12px] text-red-700">
          [ AUTH ] · {err}
        </div>
      )}
    </div>
  );
}
