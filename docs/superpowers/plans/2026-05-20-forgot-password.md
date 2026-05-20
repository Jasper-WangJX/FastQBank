# Phase 11.2 — Forgot Password (Public Reset Flow) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a logged-out "forgot password" flow: LoginPage links to a new `/forgot-password` page where the user enters their email, receives a 6-digit code by mail, and sets a new password — then signs in manually on `/login`.

**Architecture:**
- Backend: two new unauthenticated endpoints (`/auth/forgot-password`, `/auth/reset-password-public`) that reuse Phase 11.1's `EmailVerification(purpose='reset')` pipeline. Both designed for email-enumeration resistance: request endpoint always returns 204; completion endpoint folds "no such password account" and "no pending code" into the same `400 invalid code` as a wrong-code attempt.
- Frontend: `ForgotPasswordPage` is a structural clone of `RegisterPage`'s two-step Sapphire Console card. After a successful reset the user is bounced to `/login` with a green "Password updated" banner via `react-router`'s `useLocation().state`.

**Tech Stack:** FastAPI · SQLAlchemy 2 async · slowapi · existing `EmailVerification` model and `mail.py` from Phase 11 · React 19 + Vite · react-router-dom.

**Spec:** [docs/superpowers/specs/2026-05-20-forgot-password-design.md](../specs/2026-05-20-forgot-password-design.md)

---

## Conventions

- Branch: continuation of `phase-11-account-security`.
- Backend "tests" are stand-alone smoke scripts (no pytest); only the route-mount smoke test is touched in this plan. Behavioural coverage lives in the manual checklist at Task 8 / spec §6.2.
- All commits use Conventional-Commit style (`feat: …` / `fix: …` / `docs: …`).

---

## File map

### Backend — modifies
- `apps/server/app/schemas.py`              (two new request bodies)
- `apps/server/app/routers/auth.py`         (two new endpoints, appended at end)
- `apps/server/app/auth_routes_test.py`     (assert new routes mount)

### Frontend — creates
- `apps/web/src/pages/ForgotPasswordPage.tsx`

### Frontend — modifies
- `apps/web/src/lib/account.ts`             (two helper exports)
- `apps/web/src/App.tsx`                    (register the new route)
- `apps/web/src/pages/LoginPage.tsx`        ("Reset it" link + success banner)

---

## Task 1: Schemas — ForgotPasswordIn + ResetPasswordPublicIn

**Files:**
- Modify: `apps/server/app/schemas.py`

- [ ] **Step 1: Append the two new bodies**

At the END of `apps/server/app/schemas.py`, append:

```python
# ---------------------------------------------------------------------------
# Phase 11.2 — Public forgot-password flow
# ---------------------------------------------------------------------------


class ForgotPasswordIn(BaseModel):
    """Body for POST /auth/forgot-password (public). The endpoint
    always responds 204, even if no password account exists for the
    email — preventing email-enumeration probes."""

    email: EmailStr


class ResetPasswordPublicIn(BaseModel):
    """Body for POST /auth/reset-password-public. The public sibling
    of ResetPasswordIn — also carries `email` since the caller has
    no JWT to identify themselves."""

    email: EmailStr
    code: str = Field(pattern=r"^\d{6}$")
    new_password: str = Field(min_length=8, max_length=72)
    confirm_password: str = Field(min_length=8, max_length=72)
```

- [ ] **Step 2: Verify imports**

From `apps/server`:

```bash
.venv/Scripts/python.exe -c "from app.schemas import ForgotPasswordIn, ResetPasswordPublicIn; print('ok')"
```

Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add apps/server/app/schemas.py
git commit -m "feat(server): ForgotPasswordIn + ResetPasswordPublicIn schemas"
```

---

## Task 2: Backend — two public endpoints

**Files:**
- Modify: `apps/server/app/routers/auth.py`

- [ ] **Step 1: Add the new schemas to the imports**

In `apps/server/app/routers/auth.py`, find the existing
`from app.schemas import (...)` block (added through Phase 11/11.1)
and EXTEND it so it includes `ForgotPasswordIn` and
`ResetPasswordPublicIn` (alphabetical). After this task the block
should include all of:

```python
from app.schemas import (
    DeleteAccountIn,
    ForgotPasswordIn,
    GoogleCallbackIn,
    GoogleStartOut,
    LoginIn,
    ProvidersOut,
    RegisterIn,
    RequestCodeIn,
    ResetPasswordIn,
    ResetPasswordPublicIn,
    TokenOut,
    UserOut,
)
```

- [ ] **Step 2: Append the two endpoints**

At the END of `apps/server/app/routers/auth.py` (after
`delete_account` from Phase 11.1), append:

```python
# --- Public forgot-password flow (Phase 11.2; unauthenticated) ------------


@router.post(
    "/auth/forgot-password",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
@limiter.limit("10/hour")
async def forgot_password(
    request: Request,
    body: ForgotPasswordIn,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Send a 6-digit reset code to the email IF a password account
    exists for it. Always returns 204 (regardless of whether the
    email is registered or whether a code is actually sent) so the
    response cannot be used to enumerate registered emails.
    Google-only accounts are also silently ignored — they have no
    password to reset.
    """
    now = datetime.now(tz=timezone.utc)

    user = await db.scalar(
        select(User).where(
            User.email == body.email,
            User.password_hash.is_not(None),
        )
    )
    if user is None:
        # No password account — silently 204 (anti-enumeration).
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    # 60s per-(email, purpose) cooldown: if a recent code exists,
    # silently 204 so the existing code stays valid and we don't
    # leak existence via a 429.
    prior = await db.scalar(
        select(EmailVerification).where(
            EmailVerification.email == body.email,
            EmailVerification.purpose == "reset",
        )
    )
    if prior is not None:
        elapsed = (now - prior.sent_at).total_seconds()
        if elapsed < CODE_RESEND_SECONDS:
            return Response(status_code=status.HTTP_204_NO_CONTENT)
        await db.execute(
            delete(EmailVerification).where(
                EmailVerification.email == body.email,
                EmailVerification.purpose == "reset",
            )
        )

    code = _new_code()
    row = EmailVerification(
        email=body.email,
        code_hash=hash_password(code),
        expires_at=now + timedelta(minutes=CODE_TTL_MINUTES),
        attempts=0,
        sent_at=now,
        purpose="reset",
    )
    db.add(row)
    await db.flush()

    try:
        await send_verification(body.email, code)
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="mail delivery failed",
        ) from e

    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/auth/reset-password-public",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def reset_password_public(
    body: ResetPasswordPublicIn,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Complete a forgot-password flow without a token. Folds "no
    such password account" and "no pending code" into the same
    `400 invalid code` as a wrong-code attempt, so an attacker
    cannot enumerate registered emails through differing errors."""
    if body.new_password != body.confirm_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="passwords do not match",
        )

    now = datetime.now(tz=timezone.utc)

    user = await db.scalar(
        select(User).where(
            User.email == body.email,
            User.password_hash.is_not(None),
        )
    )
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid code",
        )

    row = await db.scalar(
        select(EmailVerification).where(
            EmailVerification.email == body.email,
            EmailVerification.purpose == "reset",
        )
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid code",
        )
    if row.expires_at < now:
        await db.delete(row)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="code expired",
        )
    if row.attempts >= CODE_MAX_ATTEMPTS:
        await db.delete(row)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="too many attempts",
        )
    if not verify_password(body.code, row.code_hash):
        row.attempts += 1
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid code",
        )

    # Code is good — consume it and update the password. No JWT is
    # issued; the user signs in manually on /login (UX choice per
    # spec §3 / §4.3 banner).
    await db.delete(row)
    user.password_hash = hash_password(body.new_password)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
```

- [ ] **Step 3: Confirm both routes mount**

```bash
.venv/Scripts/python.exe -c "from main import app; paths = sorted({r.path for r in app.routes if hasattr(r, 'path')}); print('\n'.join(p for p in paths if 'forgot' in p or 'reset-password-public' in p))"
```

Expected output:

```
/auth/forgot-password
/auth/reset-password-public
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/app/routers/auth.py
git commit -m "feat(auth): /auth/forgot-password + /auth/reset-password-public"
```

---

## Task 3: Extend auth_routes_test with the two new mountings

**Files:**
- Modify: `apps/server/app/auth_routes_test.py`

- [ ] **Step 1: Add the two routes to `EXPECTED_ROUTES`**

In `apps/server/app/auth_routes_test.py`, find the `EXPECTED_ROUTES`
dict and replace it with:

```python
EXPECTED_ROUTES: dict[str, set[str]] = {
    "/auth/register": {"POST"},
    "/auth/login": {"POST"},
    "/auth/request-code": {"POST"},
    "/auth/providers": {"GET"},
    "/auth/google/start": {"GET"},
    "/auth/google/callback": {"POST"},
    "/auth/request-password-reset-code": {"POST"},
    "/auth/reset-password": {"POST"},
    "/auth/delete-account": {"POST"},
    "/auth/forgot-password": {"POST"},
    "/auth/reset-password-public": {"POST"},
    "/me": {"GET"},
}
```

- [ ] **Step 2: Run the smoke test**

```bash
.venv/Scripts/python.exe -m app.auth_routes_test
```

Expected: `OK — auth routes smoke test`.

- [ ] **Step 3: Commit**

```bash
git add apps/server/app/auth_routes_test.py
git commit -m "test(server): assert phase 11.2 routes are mounted"
```

---

## Task 4: `lib/account.ts` — two public helpers

**Files:**
- Modify: `apps/web/src/lib/account.ts`

- [ ] **Step 1: Append two helpers**

At the END of `apps/web/src/lib/account.ts`, append:

```ts
// --- Phase 11.2: public forgot-password flow -------------------------------

export async function forgotPassword(email: string): Promise<void> {
  await apiFetch<void>("/auth/forgot-password", {
    method: "POST",
    body: { email },
  });
}

export interface ResetPasswordPublicBody {
  email: string;
  code: string;
  new_password: string;
  confirm_password: string;
}

export async function resetPasswordPublic(
  body: ResetPasswordPublicBody,
): Promise<void> {
  await apiFetch<void>("/auth/reset-password-public", {
    method: "POST",
    body,
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm -C apps/web tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/account.ts
git commit -m "feat(web): account.ts — forgotPassword + resetPasswordPublic helpers"
```

---

## Task 5: ForgotPasswordPage

**Files:**
- Create: `apps/web/src/pages/ForgotPasswordPage.tsx`

- [ ] **Step 1: Write the page**

Create `apps/web/src/pages/ForgotPasswordPage.tsx`:

```tsx
// Phase 11.2 — Forgot password page.
//
// Visual clone of RegisterPage (Sapphire Console card, vertical
// guide-line texture, CRT sweep, mono footer) so the auth pages
// keep a unified look. Two-step state machine:
//   Step 1 ("request"): email → POST /auth/forgot-password
//   Step 2 ("verify"):  code + new_password + confirm →
//                       POST /auth/reset-password-public
// On success, navigate("/login", { state: { passwordReset: true } })
// — LoginPage renders a green "Password updated" banner from that.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Circle, KeyRound, Lock, Mail, RotateCcw, Send } from "lucide-react";
import { ApiError } from "../lib/api";
import {
  forgotPassword,
  resetPasswordPublic,
} from "../lib/account";
import { getDesktop } from "../lib/desktop";
import WindowControls from "../components/WindowControls";
import { DRAG_STYLE, NO_DRAG_STYLE } from "../components/windowChrome";

const BUILD_TAG = "v0.9.0";
const RESEND_COOLDOWN = 60; // seconds

type Step = "request" | "verify";

// Local copy of RegisterPage's friendlyError, narrowed to the
// strings this flow can actually produce. Kept inline so the page
// is self-contained — extracting a shared module is a worthwhile
// follow-up if a third reset surface ever appears.
function friendlyError(detail: string | undefined): string {
  if (!detail) return "Network error";
  if (detail === "invalid code") return "Invalid code — try again.";
  if (detail === "code expired")
    return "Code expired. Please request a new one.";
  if (detail === "too many attempts")
    return "Too many attempts. Please request a new code.";
  if (detail === "passwords do not match") return "Passwords do not match.";
  if (detail === "mail delivery failed")
    return "Could not send the email. Try again in a moment.";
  return detail;
}

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const desktop = getDesktop();

  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resendAfter, setResendAfter] = useState(0);
  const tickRef = useRef<number | null>(null);

  const passwordsMatch =
    !confirmTouched || newPassword === confirmPassword || confirmPassword === "";

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
      await forgotPassword(email);
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

  async function submitReset(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setError("Verification code must be 6 digits.");
      return;
    }
    setSubmitting(true);
    try {
      await resetPasswordPublic({
        email,
        code,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      navigate("/login", {
        replace: true,
        state: { passwordReset: true },
      });
    } catch (err) {
      const detail = err instanceof ApiError ? err.message : undefined;
      setError(friendlyError(detail));
      if (detail === "code expired" || detail === "too many attempts") {
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
          onSubmit={step === "request" ? requestCode : submitReset}
          className="w-[420px] max-w-full rounded-sm border border-slate-200 bg-white px-6 py-6"
          noValidate
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
            MODULE / RESET
          </div>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-slate-900">
            Reset your password
          </h1>
          <p className="mt-1 font-mono text-[12px] text-slate-600">
            &gt;_ {step === "request" ? "request a 6-digit code" : "verify and set a new password"}
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
                  <span>SEND CODE</span>
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
                  htmlFor="auth-new-pw"
                  className="block font-mono text-[11px] uppercase tracking-[0.1em] text-slate-500"
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
                    id="auth-new-pw"
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
                <span className="mt-1 block font-mono text-[11px] text-slate-400">
                  length 8..72 chars
                </span>
              </div>

              <div className="mt-3">
                <label
                  htmlFor="auth-confirm-pw"
                  className="block font-mono text-[11px] uppercase tracking-[0.1em] text-slate-500"
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
                    id="auth-confirm-pw"
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
                disabled={
                  submitting ||
                  !passwordsMatch ||
                  code.length !== 6 ||
                  newPassword.length < 8
                }
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-sm border border-[#1E3A8A] bg-[#1E3A8A] px-3 py-2 font-mono text-[12.5px] uppercase tracking-[0.08em] text-white transition-colors duration-150 hover:bg-[#0B3B8C] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RotateCcw size={14} strokeWidth={1.5} aria-hidden />
                {submitting ? (
                  <span style={{ animation: "fqb-auth-blink 1.5s ease-in-out infinite" }}>
                    RESETTING…
                  </span>
                ) : (
                  <span>RESET PASSWORD</span>
                )}
              </button>
            </>
          )}

          <p className="mt-5 font-mono text-[12px] text-slate-600">
            &gt; remembered it?{" "}
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
```

- [ ] **Step 2: Typecheck**

```bash
pnpm -C apps/web tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/ForgotPasswordPage.tsx
git commit -m "feat(web): ForgotPasswordPage — two-step public reset flow"
```

---

## Task 6: App.tsx — register the new route

**Files:**
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Import + route**

In `apps/web/src/App.tsx`:

1. Near the other page imports, add:

```tsx
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
```

2. Inside the `<Routes>` block, immediately AFTER the `/register`
   `<Route>` block (or `/oauth/callback` — either works, the routes
   are flat), add:

```tsx
<Route path="/forgot-password" element={<ForgotPasswordPage />} />
```

The route is NOT wrapped in `PublicOnly` — a logged-in user
clicking back to this URL is a no-op safety hatch, not a bug.

- [ ] **Step 2: Typecheck**

```bash
pnpm -C apps/web tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat(web): /forgot-password route"
```

---

## Task 7: LoginPage — "Reset it" link + success banner

**Files:**
- Modify: `apps/web/src/pages/LoginPage.tsx`

- [ ] **Step 1: Import useLocation**

In `apps/web/src/pages/LoginPage.tsx`, find the existing
`react-router-dom` import line. It should currently look like:

```tsx
import { Link, useNavigate } from "react-router-dom";
```

Replace with:

```tsx
import { Link, useLocation, useNavigate } from "react-router-dom";
```

- [ ] **Step 2: Read location state at the top of the component**

Inside the `LoginPage` function body, near the other `useXxx` hook
calls, add:

```tsx
  const location = useLocation();
  const passwordResetSuccess =
    (location.state as { passwordReset?: boolean } | null)?.passwordReset === true;
```

- [ ] **Step 3: Render the green success banner**

Find the existing red error banner inside the form, which looks
like:

```tsx
          {error && (
            <div className="mt-4 rounded-sm border border-red-300 bg-red-50 px-3 py-2 font-mono text-[12px] text-red-700">
              [ AUTH ] · {error}
            </div>
          )}
```

Just BEFORE that block, insert the green banner:

```tsx
          {passwordResetSuccess && (
            <div className="mt-4 rounded-sm border border-emerald-300 bg-emerald-50 px-3 py-2 font-mono text-[12px] text-emerald-800">
              [ AUTH ] · Password updated — please sign in with your new password.
            </div>
          )}
```

- [ ] **Step 4: Add the "Reset it" link**

Find the SIGN IN submit `<button type="submit">` block. After its
closing `</button>` and BEFORE `<GoogleSignInButton mode="signin" />`,
insert:

```tsx
          <p className="mt-3 font-mono text-[12px] text-slate-600">
            &gt; forgot your password?{" "}
            <Link
              to="/forgot-password"
              className="text-slate-900 underline underline-offset-2 transition-colors duration-150 hover:text-[#1E3A8A]"
            >
              Reset it
            </Link>
          </p>
```

- [ ] **Step 5: Typecheck**

```bash
pnpm -C apps/web tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/LoginPage.tsx
git commit -m "feat(web): LoginPage — forgot-password link + reset success banner"
```

---

## Task 8: Manual end-to-end verification + Roadmap note

**Files:**
- Modify: `docs/Roadmap_CN.md`
- Modify: `docs/Roadmap_EN.md`

This task is the closing step: walk the spec's §6.2 manual
checklist and append a short Phase 11.2 entry to both Roadmap
files.

- [ ] **Step 1: Server smoke tests**

From `apps/server`:

```bash
.venv/Scripts/python.exe -m app.share_token_test
.venv/Scripts/python.exe -m app.oauth_google_test
.venv/Scripts/python.exe -m app.auth_routes_test
```

Each must print its `OK — …` line and exit 0. (`mail_test`
requires `RESEND_API_KEY` unset; skip per the documented
pre-existing condition from earlier phases.)

- [ ] **Step 2: Frontend typecheck**

```bash
pnpm -C apps/web tsc -b --noEmit
pnpm -C apps/desktop tsc --noEmit
```

Both clean.

- [ ] **Step 3: Manual checklist (spec §6.2)**

With uvicorn + `pnpm -C apps/web dev` running, walk items 1–10
from the spec. Tick as each passes:

1. LoginPage shows "forgot your password? Reset it" between SIGN
   IN and the Google button.
2. Clicking "Reset it" navigates to `/forgot-password`.
3. Submit an email that has no account (or a Google-only email):
   no `[MAIL STUB]` in the uvicorn log, but the page advances to
   step 2 anyway (anti-enumeration).
4. Submit a registered password email: uvicorn log emits
   `[MAIL STUB] code for <email>: <6 digits>` (or Resend sends a
   real email if configured).
5. Resend button is disabled during the 60s cooldown countdown.
6. Submit a wrong code 5 times → "Too many attempts" + snap back
   to step 1.
7. Expire a code via SQL
   (`UPDATE email_verifications SET expires_at = now() - interval '1 minute' WHERE email = '<email>' AND purpose = 'reset';`)
   then submit → "Code expired" + snap back.
8. On step 2, mismatched confirm field → red border + "passwords
   do not match" + button disabled.
9. Happy path: correct code + matching passwords → land on
   `/login` with the green "Password updated" banner. Sign in
   with the NEW password succeeds. Sign in with the OLD password
   fails.
10. Click Register and come back to Login — the banner is gone.

- [ ] **Step 4: Append Phase 11.2 to `docs/Roadmap_CN.md`**

Find the overview table; immediately AFTER the row for "11.1 帐
号独立 + 设置面板 + 注销", add:

```
| 11.2 忘记密码 (公开重设) | ✅ 已完成 (2026-05-20) | LoginPage 加 "Reset it" 链接到新页面 `/forgot-password`，输入邮箱 → 收码 → 设新密码 → 跳回 `/login` 用新密码登入；反枚举：邮箱不存在也 204，错码与"无账号"同一报错 |
```

Then BEFORE the "## 风险点与早期验证建议" heading, add:

```markdown
## 阶段 11.2 — 忘记密码（公开重设）

> **状态：✅ 已完成 (2026-05-20)。** 设计：`docs/superpowers/specs/2026-05-20-forgot-password-design.md`。计划：`docs/superpowers/plans/2026-05-20-forgot-password.md`。

### 主要改动
- 后端：新增两个不需要 JWT 的端点 `POST /auth/forgot-password`（按邮箱发 6 位重设码；无密码账号则静默 204）与 `POST /auth/reset-password-public`（邮箱 + 码 + 新密码 + 确认 → 改 `password_hash`）。两者都共用 Phase 11.1 的 `EmailVerification(purpose='reset')`。
- 反邮箱枚举：请求端点对任何邮箱都 204；完成端点把"无账号"与"无 pending code"统一报 `400 invalid code`，与错码完全一致。
- 前端：`/forgot-password` 新页面（两步状态机克隆自 RegisterPage）；LoginPage 加 "Reset it" 链接；重设成功后跳 `/login` 带绿色 `[ AUTH ] · Password updated` 提示条。
```

- [ ] **Step 5: Mirror the addition in `docs/Roadmap_EN.md`**

Find the overview table; after the row for "11.1 Account
independence + Settings modal + Cancellation", add:

```
| 11.2 Forgot password (public reset) | ✅ Done (2026-05-20) | LoginPage gains a "Reset it" link to a new `/forgot-password` page where the user enters their email → gets a code → sets a new password → bounced to `/login` with a green banner; enumeration-resistant (silent 204 for unknown emails; "invalid code" lumps wrong-code and no-account) |
```

Then BEFORE the Risks/Early-validation closing section, add:

```markdown
## Phase 11.2 — Forgot password (public reset)

> **Status: ✅ Done (2026-05-20).** Design: `docs/superpowers/specs/2026-05-20-forgot-password-design.md`. Plan: `docs/superpowers/plans/2026-05-20-forgot-password.md`.

### Key changes
- Backend: two new unauthenticated endpoints. `POST /auth/forgot-password` mails a 6-digit reset code to the supplied email if a password account exists; silently 204 otherwise. `POST /auth/reset-password-public` consumes the code and updates `password_hash`. Both reuse Phase 11.1's `EmailVerification(purpose='reset')` pipeline.
- Anti-enumeration: the request endpoint always returns 204; the completion endpoint folds "no such account" and "no pending code" into the same `400 invalid code` as a wrong-code attempt.
- Frontend: new `/forgot-password` page (two-step state machine cloned from RegisterPage); LoginPage gains the "Reset it" link and a green `[ AUTH ] · Password updated` banner driven by `location.state` after a successful reset.
```

- [ ] **Step 6: Commit**

```bash
git add docs/Roadmap_CN.md docs/Roadmap_EN.md
git commit -m "docs: mark Phase 11.2 done — public forgot-password flow"
```

---

## Done

Final state: a user who forgot their password can recover from
`/login` → click "Reset it" → type email → enter the emailed code +
new password → land back on `/login` with the green banner and a
working new password. Anti-enumeration holds at both endpoints; no
new DB tables, ORM changes, or migrations are needed because
Phase 11.1's reset-purpose verification pipeline is reused.
