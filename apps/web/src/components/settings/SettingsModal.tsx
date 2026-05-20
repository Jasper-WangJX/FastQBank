// Phase 11.1 — Settings modal opened from the gear button in
// AppLayout. Contains two sections:
//   - Reset password   (only rendered when currentUser.has_password)
//   - Delete account   (always rendered)
//
// Visual style follows the existing ImportModal / MySharesModal:
// backdrop + centered white card + slate borders + font-mono labels.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, Lock, ShieldAlert, X } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { ApiError } from "../../lib/api";
import {
  deleteAccount,
  requestPasswordResetCode,
  resetPassword,
} from "../../lib/account";

interface Props {
  open: boolean;
  onClose: () => void;
}

const RESEND_COOLDOWN = 60;

function friendlyError(detail: string | undefined): string {
  if (!detail) return "Network error";
  if (detail === "password reset not available for this account")
    return "Password reset is not available for Google accounts.";
  if (detail === "email mismatch")
    return "Email confirmation does not match.";
  if (detail.startsWith("email cooling down, try again after ")) {
    const iso = detail.slice("email cooling down, try again after ".length);
    const when = new Date(iso);
    if (!Number.isNaN(when.valueOf()))
      return `Email was recently cancelled. Try again after ${when.toLocaleString()}.`;
    return detail;
  }
  if (detail === "passwords do not match") return "Passwords do not match.";
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

export default function SettingsModal({ open, onClose }: Props) {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();

  // ----- reset-password state machine ----------------------------------
  type ResetStep = "idle" | "verify";
  const [resetStep, setResetStep] = useState<ResetStep>("idle");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetCooldown, setResetCooldown] = useState(0);
  const [resetSuccess, setResetSuccess] = useState(false);
  const successTimer = useRef<number | null>(null);

  // ----- delete-account state ------------------------------------------
  const [confirmEmail, setConfirmEmail] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Reset transient state every time the modal opens.
  useEffect(() => {
    if (!open) return;
    setResetStep("idle");
    setResetCode("");
    setNewPassword("");
    setConfirmPassword("");
    setConfirmTouched(false);
    setResetError(null);
    setResetBusy(false);
    setResetSuccess(false);
    setConfirmEmail("");
    setDeleteError(null);
    setDeleteBusy(false);
  }, [open]);

  // 60s "resend" cooldown timer.
  useEffect(() => {
    if (resetCooldown <= 0) return;
    const id = window.setInterval(() => {
      setResetCooldown((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [resetCooldown]);

  // Auto-fold the "Password updated." line after 3 seconds.
  useEffect(() => {
    if (!resetSuccess) return;
    successTimer.current = window.setTimeout(() => {
      setResetSuccess(false);
    }, 3000);
    return () => {
      if (successTimer.current !== null)
        window.clearTimeout(successTimer.current);
    };
  }, [resetSuccess]);

  if (!open) return null;
  if (!currentUser) return null; // /me hasn't resolved yet

  const passwordsMatch =
    !confirmTouched || newPassword === confirmPassword || confirmPassword === "";

  async function sendResetCode() {
    setResetError(null);
    setResetBusy(true);
    try {
      await requestPasswordResetCode();
      setResetStep("verify");
      setResetCooldown(RESEND_COOLDOWN);
    } catch (e) {
      setResetError(
        friendlyError(e instanceof ApiError ? e.message : undefined),
      );
    } finally {
      setResetBusy(false);
    }
  }

  async function submitReset(e: FormEvent) {
    e.preventDefault();
    setResetError(null);
    if (newPassword !== confirmPassword) {
      setResetError("Passwords do not match.");
      return;
    }
    if (!/^\d{6}$/.test(resetCode)) {
      setResetError("Verification code must be 6 digits.");
      return;
    }
    setResetBusy(true);
    try {
      await resetPassword({
        code: resetCode,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      // Reset UI back to idle + show inline confirmation.
      setResetStep("idle");
      setResetCode("");
      setNewPassword("");
      setConfirmPassword("");
      setConfirmTouched(false);
      setResetCooldown(0);
      setResetSuccess(true);
    } catch (e) {
      const detail = e instanceof ApiError ? e.message : undefined;
      setResetError(friendlyError(detail));
      if (
        detail === "code expired" ||
        detail === "too many attempts" ||
        detail === "verification required"
      ) {
        setResetStep("idle");
        setResetCode("");
        setResetCooldown(0);
      }
    } finally {
      setResetBusy(false);
    }
  }

  async function submitDelete() {
    if (!currentUser) return;
    if (confirmEmail !== currentUser.email) return;
    if (
      !window.confirm("Are you absolutely sure? This cannot be undone.")
    )
      return;
    setDeleteError(null);
    setDeleteBusy(true);
    try {
      await deleteAccount(currentUser.email);
      logout();
      navigate("/login", { replace: true });
    } catch (e) {
      setDeleteError(
        friendlyError(e instanceof ApiError ? e.message : undefined),
      );
      setDeleteBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-4 py-8"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-[480px] max-w-full rounded-sm border border-slate-200 bg-white"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
            MODULE / SETTINGS
          </span>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-slate-500 hover:text-slate-900"
            aria-label="Close"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-4">
          {/* Account summary */}
          <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-slate-500">
            Account
          </div>
          <div className="mt-1 font-mono text-[12px] text-slate-800">
            {currentUser.email}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-slate-500">
            sign-in: {currentUser.has_password ? "Password" : "Google"}
          </div>

          {/* Reset password section (password accounts only) */}
          {currentUser.has_password && (
            <section className="mt-5 border-t border-slate-200 pt-4">
              <div className="flex items-center justify-between">
                <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-slate-500">
                  Reset password
                </div>
                {resetSuccess && (
                  <span className="font-mono text-[11px] text-emerald-700">
                    Password updated.
                  </span>
                )}
              </div>

              {resetError && (
                <div className="mt-2 rounded-sm border border-red-300 bg-red-50 px-3 py-2 font-mono text-[12px] text-red-700">
                  [ AUTH ] · {resetError}
                </div>
              )}

              {resetStep === "idle" && (
                <div className="mt-3">
                  <p className="font-mono text-[12px] text-slate-600">
                    &gt;_ a 6-digit code will be sent to <span className="text-slate-900">{currentUser.email}</span>
                  </p>
                  <button
                    type="button"
                    onClick={sendResetCode}
                    disabled={resetBusy || resetCooldown > 0}
                    className="mt-3 inline-flex items-center justify-center gap-2 rounded-sm border border-[#1E3A8A] bg-[#1E3A8A] px-3 py-2 font-mono text-[12.5px] uppercase tracking-[0.08em] text-white transition-colors duration-150 hover:bg-[#0B3B8C] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {resetCooldown > 0
                      ? `RESEND IN ${resetCooldown}S`
                      : resetBusy
                      ? "SENDING…"
                      : "SEND CODE"}
                  </button>
                </div>
              )}

              {resetStep === "verify" && (
                <form onSubmit={submitReset} className="mt-3" noValidate>
                  <label
                    htmlFor="set-code"
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
                      id="set-code"
                      type="text"
                      inputMode="numeric"
                      pattern="\d{6}"
                      autoComplete="one-time-code"
                      required
                      maxLength={6}
                      value={resetCode}
                      onChange={(e) =>
                        setResetCode(
                          e.target.value.replace(/\D/g, "").slice(0, 6),
                        )
                      }
                      className="w-full rounded-sm border border-slate-200 bg-white py-2 pl-8 pr-3 font-mono text-sm tracking-[0.18em] text-slate-900 outline-none transition-colors duration-150 focus:border-[#1E3A8A]"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={resetCooldown > 0 || resetBusy}
                    onClick={sendResetCode}
                    className="mt-1 font-mono text-[11px] text-slate-500 underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 hover:text-[#1E3A8A]"
                  >
                    {resetCooldown > 0
                      ? `Resend in ${resetCooldown}s`
                      : "Resend code"}
                  </button>

                  <label
                    htmlFor="set-new-pw"
                    className="mt-3 block font-mono text-[11px] uppercase tracking-[0.1em] text-slate-500"
                  >
                    New password
                  </label>
                  <div className="relative mt-1">
                    <Lock
                      size={14}
                      strokeWidth={1.5}
                      aria-hidden
                      className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400"
                    />
                    <input
                      id="set-new-pw"
                      type="password"
                      required
                      minLength={8}
                      maxLength={72}
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full rounded-sm border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm text-slate-900 outline-none transition-colors duration-150 focus:border-[#1E3A8A]"
                    />
                  </div>

                  <label
                    htmlFor="set-confirm-pw"
                    className="mt-3 block font-mono text-[11px] uppercase tracking-[0.1em] text-slate-500"
                  >
                    Confirm new password
                  </label>
                  <div className="relative mt-1">
                    <Lock
                      size={14}
                      strokeWidth={1.5}
                      aria-hidden
                      className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400"
                    />
                    <input
                      id="set-confirm-pw"
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

                  <button
                    type="submit"
                    disabled={
                      resetBusy ||
                      !passwordsMatch ||
                      resetCode.length !== 6 ||
                      newPassword.length < 8
                    }
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-sm border border-[#1E3A8A] bg-[#1E3A8A] px-3 py-2 font-mono text-[12.5px] uppercase tracking-[0.08em] text-white transition-colors duration-150 hover:bg-[#0B3B8C] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {resetBusy ? "UPDATING…" : "UPDATE PASSWORD"}
                  </button>
                </form>
              )}
            </section>
          )}

          {/* Delete account section */}
          <section className="mt-5 rounded-sm border border-red-300 bg-red-50 p-3">
            <div className="flex items-center gap-2">
              <ShieldAlert size={14} strokeWidth={1.5} className="text-red-700" />
              <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-red-700">
                Danger zone — delete account
              </span>
            </div>
            <p className="mt-2 font-mono text-[12px] text-slate-700">
              {currentUser.has_password
                ? "This will permanently delete your account, all your questions, tags, and review history. "
                : "This will permanently delete your account, all your questions, tags, and review history."}
              {currentUser.has_password && (
                <>
                  The email <span className="text-slate-900">{currentUser.email}</span> will be blocked from password registration for 24 hours.
                </>
              )}
            </p>

            {deleteError && (
              <div className="mt-2 rounded-sm border border-red-300 bg-white px-3 py-2 font-mono text-[12px] text-red-700">
                [ AUTH ] · {deleteError}
              </div>
            )}

            <label
              htmlFor="set-confirm-email"
              className="mt-3 block font-mono text-[11px] uppercase tracking-[0.1em] text-red-700"
            >
              Type your email to confirm
            </label>
            <input
              id="set-confirm-email"
              type="email"
              autoComplete="off"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              className="mt-1 w-full rounded-sm border border-red-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors duration-150 focus:border-red-500"
            />

            <button
              type="button"
              onClick={submitDelete}
              disabled={confirmEmail !== currentUser.email || deleteBusy}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-sm border border-red-600 bg-red-600 px-3 py-2 font-mono text-[12.5px] uppercase tracking-[0.08em] text-white transition-colors duration-150 hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deleteBusy ? "DELETING…" : "DELETE ACCOUNT"}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
