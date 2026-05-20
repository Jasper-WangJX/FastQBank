// Register page — "Sapphire Console" visual language.
// Phase 11: split into two steps —
//   Step 1 ("request"): ask for email, POST /auth/request-code,
//   Step 2 ("verify"): show code + password + confirm-password
//     fields, POST /auth/register on submit.
// Google sign-in button added below the primary CTA, sharing
// AuthContext.providers state.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Circle, KeyRound, Lock, Mail, Plus, Send } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { ApiError, apiFetch } from "../lib/api";
import { getDesktop } from "../lib/desktop";
import WindowControls from "../components/WindowControls";
import { DRAG_STYLE, NO_DRAG_STYLE } from "../components/windowChrome";
import GoogleSignInButton from "../components/auth/GoogleSignInButton";

interface TokenOut {
  access_token: string;
  token_type: string;
}

const BUILD_TAG = "v0.9.0";
const RESEND_COOLDOWN = 60; // seconds

type Step = "request" | "verify";

function friendlyError(detail: string | undefined): string {
  if (!detail) return "Network error";
  if (detail === "email already registered")
    return "Already registered. Sign in instead.";
  if (detail === "please wait before requesting another code")
    return "Please wait a moment before requesting another code.";
  if (detail === "invalid code") return "Invalid code — try again.";
  if (detail === "code expired")
    return "Code expired. Please request a new one.";
  if (detail === "too many attempts")
    return "Too many attempts. Please request a new code.";
  if (detail === "verification required")
    return "Please verify your email first.";
  if (detail === "mail delivery failed")
    return "Could not send the email. Try again in a moment.";
  return detail;
}

export default function RegisterPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const desktop = getDesktop();

  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resendAfter, setResendAfter] = useState(0);
  const tickRef = useRef<number | null>(null);

  const passwordsMatch =
    !confirmTouched || password === confirmPassword || confirmPassword === "";

  // 60s "resend" cooldown timer.
  useEffect(() => {
    if (resendAfter <= 0) return;
    tickRef.current = window.setInterval(() => {
      setResendAfter((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => {
      if (tickRef.current !== null) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [resendAfter]);

  async function requestCode(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch<void>("/auth/request-code", {
        method: "POST",
        body: { email, purpose: "register" },
      });
      setStep("verify");
      setResendAfter(RESEND_COOLDOWN);
    } catch (err) {
      setError(
        friendlyError(err instanceof ApiError ? err.message : undefined),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function submitRegister(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setError("Verification code must be 6 digits.");
      return;
    }
    setSubmitting(true);
    try {
      const data = await apiFetch<TokenOut>("/auth/register", {
        method: "POST",
        body: { email, password, code },
      });
      login(data.access_token);
      navigate("/", { replace: true });
    } catch (err) {
      const detail = err instanceof ApiError ? err.message : undefined;
      setError(friendlyError(detail));
      // Snap back to step 1 if the code is unusable for further tries.
      if (
        detail === "code expired" ||
        detail === "too many attempts" ||
        detail === "verification required"
      ) {
        setStep("request");
        setCode("");
        setResendAfter(0);
      }
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
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-0 h-px bg-[#60A5FA]/40 motion-reduce:hidden"
        style={{ animation: "fqb-auth-sweep 18s linear infinite" }}
      />
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

      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-10 pb-16">
        <form
          onSubmit={step === "request" ? requestCode : submitRegister}
          className="w-[420px] max-w-full rounded-sm border border-slate-200 bg-white px-6 py-6"
          noValidate
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
            MODULE / REGISTER
          </div>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-slate-900">
            Create your FastQBank account
          </h1>
          <p className="mt-1 font-mono text-[12px] text-slate-600">
            &gt;_ {step === "request" ? "provision new account" : "verify and set password"}
          </p>

          {error && (
            <div className="mt-4 rounded-sm border border-red-300 bg-red-50 px-3 py-2 font-mono text-[12px] text-red-700">
              [ AUTH ] · {error}
            </div>
          )}

          {step === "request" && (
            <>
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

              <button
                type="submit"
                disabled={submitting || !email}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-sm border border-[#1E3A8A] bg-[#1E3A8A] px-3 py-2 font-mono text-[12.5px] uppercase tracking-[0.08em] text-white transition-colors duration-150 hover:bg-[#0B3B8C] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Send size={14} strokeWidth={1.5} aria-hidden />
                {submitting ? (
                  <span style={{ animation: "fqb-auth-blink 1.5s ease-in-out infinite" }}>
                    SENDING…
                  </span>
                ) : (
                  <span>REQUEST CODE</span>
                )}
              </button>
            </>
          )}

          {step === "verify" && (
            <>
              <div className="mt-5 flex items-center justify-between font-mono text-[12px] text-slate-600">
                <span>
                  &gt; code sent to <span className="text-slate-900">{email}</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setStep("request");
                    setCode("");
                    setError(null);
                  }}
                  className="text-slate-900 underline underline-offset-2 hover:text-[#1E3A8A]"
                >
                  [ change ]
                </button>
              </div>

              <div className="mt-3">
                <label
                  htmlFor="auth-code"
                  className="block font-mono text-[11px] uppercase tracking-[0.1em] text-slate-500"
                >
                  Verification code
                </label>
                <div className="relative mt-1">
                  <KeyRound
                    size={14}
                    strokeWidth={1.5}
                    aria-hidden
                    className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400"
                  />
                  <input
                    id="auth-code"
                    type="text"
                    inputMode="numeric"
                    pattern="\d{6}"
                    autoComplete="one-time-code"
                    required
                    maxLength={6}
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    className="w-full rounded-sm border border-slate-200 bg-white py-2 pl-8 pr-3 font-mono text-sm tracking-[0.18em] text-slate-900 outline-none transition-colors duration-150 focus:border-[#1E3A8A]"
                  />
                </div>
                <button
                  type="button"
                  disabled={resendAfter > 0 || submitting}
                  onClick={() => requestCode()}
                  className="mt-1 font-mono text-[11px] text-slate-500 underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 hover:text-[#1E3A8A]"
                >
                  {resendAfter > 0
                    ? `Resend in ${resendAfter}s`
                    : "Resend code"}
                </button>
              </div>

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
                    minLength={8}
                    maxLength={72}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-sm border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm text-slate-900 outline-none transition-colors duration-150 focus:border-[#1E3A8A]"
                  />
                </div>
                <span className="mt-1 block font-mono text-[11px] text-slate-400">
                  length 8..72 chars
                </span>
              </div>

              <div className="mt-3">
                <label
                  htmlFor="auth-password-confirm"
                  className="block font-mono text-[11px] uppercase tracking-[0.1em] text-slate-500"
                >
                  Confirm password
                </label>
                <div className="relative mt-1">
                  <Lock
                    size={14}
                    strokeWidth={1.5}
                    aria-hidden
                    className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400"
                  />
                  <input
                    id="auth-password-confirm"
                    type="password"
                    required
                    minLength={8}
                    maxLength={72}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    onBlur={() => setConfirmTouched(true)}
                    className={`w-full rounded-sm border ${passwordsMatch ? "border-slate-200" : "border-red-300"} bg-white py-2 pl-8 pr-3 text-sm text-slate-900 outline-none transition-colors duration-150 focus:border-[#1E3A8A]`}
                  />
                </div>
                {!passwordsMatch && (
                  <span className="mt-1 block font-mono text-[11px] text-red-600">
                    passwords do not match
                  </span>
                )}
              </div>

              <button
                type="submit"
                disabled={submitting || !passwordsMatch || code.length !== 6}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-sm border border-[#1E3A8A] bg-[#1E3A8A] px-3 py-2 font-mono text-[12.5px] uppercase tracking-[0.08em] text-white transition-colors duration-150 hover:bg-[#0B3B8C] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Plus size={14} strokeWidth={1.5} aria-hidden />
                {submitting ? (
                  <span style={{ animation: "fqb-auth-blink 1.5s ease-in-out infinite" }}>
                    PROVISIONING…
                  </span>
                ) : (
                  <span>CREATE ACCOUNT</span>
                )}
              </button>
            </>
          )}

          {step === "request" && <GoogleSignInButton mode="signup" />}

          <p className="mt-5 font-mono text-[12px] text-slate-600">
            &gt; already registered?{" "}
            <Link
              to="/login"
              className="text-slate-900 underline underline-offset-2 transition-colors duration-150 hover:text-[#1E3A8A]"
            >
              Sign in
            </Link>
          </p>
        </form>
      </main>

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
