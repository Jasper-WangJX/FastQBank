// Phase 11 — receives the Google OAuth redirect on the web platform.
//
// Reads `code` + `state` from the URL, POSTs them to
// /auth/google/callback via the shared helper, then logs the user in
// and lands on the question bank. Errors render the same
// Sapphire-Console card as the auth pages so the visual lineage is
// continuous.

import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Circle } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { completeOAuthCallback } from "../lib/oauth";
import { ApiError } from "../lib/api";

const BUILD_TAG = "v1.0.1";

export default function OAuthCallbackPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) {
      setError("Missing code or state in callback URL.");
      return;
    }
    let cancelled = false;
    completeOAuthCallback(code, state)
      .then((token) => {
        if (cancelled) return;
        login(token);
        navigate("/", { replace: true });
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : "Google sign-in failed.");
      });
    return () => {
      cancelled = true;
    };
  }, [params, login, navigate]);

  return (
    <div className="relative flex min-h-dvh flex-col bg-white text-slate-900">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-[420px] max-w-full rounded-sm border border-slate-200 bg-white px-6 py-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
            MODULE / OAUTH
          </div>
          {error ? (
            <>
              <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-slate-900">
                Sign-in failed
              </h1>
              <div className="mt-4 rounded-sm border border-red-300 bg-red-50 px-3 py-2 font-mono text-[12px] text-red-700">
                [ AUTH ] · {error}
              </div>
              <p className="mt-5 font-mono text-[12px] text-slate-600">
                &gt;{" "}
                <Link
                  to="/login"
                  className="text-slate-900 underline underline-offset-2 hover:text-[#1E3A8A]"
                >
                  Back to sign in
                </Link>
              </p>
            </>
          ) : (
            <>
              <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-slate-900">
                Completing sign-in…
              </h1>
              <p className="mt-1 font-mono text-[12px] text-slate-600">
                <Circle size={8} strokeWidth={0} fill="currentColor" className="mr-1 inline text-[#60A5FA]" />
                exchanging authorization code · {BUILD_TAG}
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
