// Sign-in page — "Sapphire Console" visual language.
// Outside the AppLayout (reachable only when logged-out): renders its own
// guide-line texture, CRT scan line, mono status footer, header strip.
// Behavior is unchanged: POST /auth/login → store token → redirect to "/".

import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Circle, CornerDownLeft, Lock, Mail } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { ApiError, apiFetch } from "../lib/api";
import { getDesktop } from "../lib/desktop";
import GoogleSignInButton from "../components/auth/GoogleSignInButton";
import WindowControls from "../components/WindowControls";
import { DRAG_STYLE, NO_DRAG_STYLE } from "../components/windowChrome";

interface TokenOut {
  access_token: string;
  token_type: string;
}

const BUILD_TAG = "v1.0.2";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const desktop = getDesktop();
  const location = useLocation();
  const passwordResetSuccess =
    (location.state as { passwordReset?: boolean } | null)?.passwordReset === true;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const data = await apiFetch<TokenOut>("/auth/login", {
        method: "POST",
        body: { email, password },
      });
      login(data.access_token);
      // `/` is now the public LandingPage, so jump straight into the
      // app shell on successful login.
      navigate("/questions", { replace: true });
    } catch (err) {
      // ApiError.message carries the backend's `detail`
      // (e.g. "invalid email or password").
      setError(err instanceof ApiError ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col bg-white text-slate-900">
      {/* Vertical guide-line texture — same as AppLayout. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(11,59,140,0.06) 1px, transparent 1px)",
          backgroundSize: "96px 100%",
        }}
      />
      {/* CRT-style sweep line drifting top→bottom over 18s. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-0 h-px bg-[#60A5FA]/40 motion-reduce:hidden"
        style={{ animation: "fqb-auth-sweep 18s linear infinite" }}
      />

      {/* Inline keyframes — scoped names so they can't collide with AppLayout. */}
      <style>{`
        @keyframes fqb-auth-sweep {
          0% { transform: translateY(0vh); opacity: 0; }
          8% { opacity: 0.5; }
          92% { opacity: 0.5; }
          100% { transform: translateY(100vh); opacity: 0; }
        }
        @keyframes fqb-auth-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0.35; }
        }
        @keyframes fqb-auth-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="fqb-auth-sweep"],
          [style*="fqb-auth-blink"],
          [style*="fqb-auth-pulse"] { animation: none !important; }
        }
      `}</style>

      {/* Sticky header strip — brand + build tag, plus the desktop
          window controls on the right. Whole strip is the drag region
          (Electron frameless) so users can grab any empty space to
          move the window. */}
      <header
        className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur-sm"
        style={desktop ? DRAG_STYLE : undefined}
      >
        <div className="flex items-center gap-2 pl-4">
          <div
            className="flex items-center gap-2 py-3"
            style={desktop ? NO_DRAG_STYLE : undefined}
          >
            <img
              src="/fastqb-logo.png"
              alt=""
              className="h-7 w-7 shrink-0 select-none rounded-sm object-contain"
              draggable={false}
            />
            <span className="font-semibold tracking-tight text-slate-900">
              FastQBank
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">
              {BUILD_TAG}
            </span>
          </div>
          <div className="ml-auto flex items-center">
            {desktop && <WindowControls desktop={desktop} />}
          </div>
        </div>
      </header>

      {/* Centered card */}
      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-10 pb-16">
        <form
          onSubmit={onSubmit}
          className="w-[420px] max-w-full rounded-sm border border-slate-200 bg-white px-6 py-6"
          noValidate
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
            MODULE / SIGN-IN
          </div>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-slate-900">
            Sign in to FastQBank
          </h1>
          <p className="mt-1 font-mono text-[12px] text-slate-600">
            &gt;_ enter credentials below
          </p>

          {passwordResetSuccess && (
            <div className="mt-4 rounded-sm border border-emerald-300 bg-emerald-50 px-3 py-2 font-mono text-[12px] text-emerald-800">
              [ AUTH ] · Password updated — please sign in with your new password.
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-sm border border-red-300 bg-red-50 px-3 py-2 font-mono text-[12px] text-red-700">
              [ AUTH ] · {error}
            </div>
          )}

          {/* Email */}
          <div className="mt-5">
            <label
              htmlFor="auth-email"
              className="block font-mono text-[11px] uppercase tracking-[0.1em] text-slate-500"
            >
              Email
            </label>
            <div className="relative mt-1">
              <Mail
                size={14}
                strokeWidth={1.5}
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400"
              />
              <input
                id="auth-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-sm border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm text-slate-900 outline-none transition-colors duration-150 focus:border-[#1E3A8A]"
              />
            </div>
          </div>

          {/* Password */}
          <div className="mt-3">
            <label
              htmlFor="auth-password"
              className="block font-mono text-[11px] uppercase tracking-[0.1em] text-slate-500"
            >
              Password
            </label>
            <div className="relative mt-1">
              <Lock
                size={14}
                strokeWidth={1.5}
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400"
              />
              <input
                id="auth-password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-sm border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm text-slate-900 outline-none transition-colors duration-150 focus:border-[#1E3A8A]"
              />
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-sm border border-[#1E3A8A] bg-[#1E3A8A] px-3 py-2 font-mono text-[12.5px] uppercase tracking-[0.08em] text-white transition-colors duration-150 hover:bg-[#0B3B8C] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <CornerDownLeft size={14} strokeWidth={1.5} aria-hidden />
            {submitting ? (
              <span style={{ animation: "fqb-auth-blink 1.5s ease-in-out infinite" }}>
                AUTHENTICATING…
              </span>
            ) : (
              <span>SIGN IN</span>
            )}
          </button>

          <p className="mt-3 font-mono text-[12px] text-slate-600">
            &gt; forgot your password?{" "}
            <Link
              to="/forgot-password"
              className="text-slate-900 underline underline-offset-2 transition-colors duration-150 hover:text-[#1E3A8A]"
            >
              Reset it
            </Link>
          </p>

          <GoogleSignInButton mode="signin" />

          <p className="mt-5 font-mono text-[12px] text-slate-600">
            &gt; need an account?{" "}
            <Link
              to="/register"
              className="text-slate-900 underline underline-offset-2 transition-colors duration-150 hover:text-[#1E3A8A]"
            >
              Register
            </Link>
          </p>
        </form>
      </main>

      {/* Sticky mono status footer — logged-out variant. */}
      <footer
        className="fixed inset-x-0 bottom-0 z-20 flex h-7 items-center gap-4 border-t border-[#1E40AF] bg-[#1E3A8A] px-4 font-mono text-[11px] text-white/90"
        role="contentinfo"
      >
        <span className="flex items-center gap-1.5">
          <Circle
            size={8}
            strokeWidth={0}
            fill="currentColor"
            className="text-[#60A5FA]"
            style={{ animation: "fqb-auth-pulse 1.6s ease-in-out infinite" }}
            aria-hidden
          />
          READY
        </span>
        <span>· awaiting sign-in</span>
        <span className="ml-auto text-white/60">FastQBank · {BUILD_TAG}</span>
      </footer>
    </div>
  );
}
