# Phase 11.2 — Forgot Password (Public Reset Flow) Design

Date: 2026-05-20
Status: Draft (pending implementation)

Follow-up to `2026-05-20-account-settings-and-cancellation-design.md`.
Phase 11.1 added password reset for **logged-in** users via the
Settings modal. This phase covers the **logged-out** path: a user who
forgot their password can request a code from the LoginPage and set a
new one without ever signing in.

## 1. Goals

1. **LoginPage entry point.** Add a "Reset it" link next to the
   sign-in CTA pointing at `/forgot-password`.
2. **`/forgot-password` page.** A two-step Sapphire-Console card,
   visually a clone of `RegisterPage`: step 1 takes an email and
   triggers a code email; step 2 takes the 6-digit code, a new
   password, and a confirm-password.
3. **After success, return to `/login`.** Display a green
   "Password updated — please sign in" banner. The user must
   manually re-authenticate with the new password (no auto-login —
   this is the more conservative path between the two we
   considered).
4. **Email enumeration resistance.** The public endpoints behave the
   same whether the email belongs to a registered password account
   or not — no error string reveals which.

## 2. Scope and non-goals

In scope:
- Two new unauthenticated endpoints (`/auth/forgot-password`,
  `/auth/reset-password-public`).
- Frontend: `ForgotPasswordPage`, two new `lib/account.ts`
  helpers, LoginPage gains the link + success banner, App router
  gains the new route.
- `auth_routes_test.py` extended with the two new mountings.

Out of scope:
- DB migration / ORM changes (the EmailVerification table with
  `purpose='reset'` from Phase 11.1 is reused as-is).
- Google account password recovery (Google accounts have no
  password to recover — explicitly rejected in §3.1).
- Token rotation. The reset flow does NOT issue a JWT; the user is
  bounced to `/login` with a success banner.
- Auto-clearing the success banner on a timer. It clears on the
  next navigation away, which is good enough for a personal-use
  tool.

## 3. Backend API

Two new unauthenticated routes. Both are PUBLIC — no `CurrentUser`
dependency — so the body carries the email explicitly.

### 3.1 `POST /auth/forgot-password`

Request: `{ "email": EmailStr }`

Behavior:
1. slowapi `@limiter.limit("10/hour")` keyed per-IP (same as
   `/auth/request-code` — caps mail-bombing of arbitrary mailboxes).
2. Look up a password account: `User.email = X AND password_hash IS
   NOT NULL`. The `password_hash IS NOT NULL` clause matters
   because Google-only rows do not have a password to reset.
3. **No match → return 204 silently.** This is the
   enumeration-resistance branch: from the outside, the response
   looks identical whether the email is registered or not.
4. **Match → reuse the Phase 11.1 reset-code pipeline:**
   - 60s cooldown query against `EmailVerification` for
     `(email, purpose='reset')`. If hit, return 204 silently
     (the user already has a valid code in their inbox; not
     re-sending is the safe action and does not leak existence
     because we'd return 204 anyway for a non-existent email).
   - Else: DELETE any prior row → INSERT a fresh row with
     `code_hash = bcrypt(code)`, `expires_at = now + 10min`,
     `attempts = 0`, `purpose = 'reset'`.
   - `await db.flush()` (surface DB errors before the network call).
   - `await send_verification(email, code)` → on RuntimeError
     `await db.rollback()` and return `502 mail delivery failed`.
   - `await db.commit()` then return 204.

Response: `204 No Content` on success; `429` on slowapi cap; `502`
only when mail delivery actually fails for a real account.

### 3.2 `POST /auth/reset-password-public`

Request:
```
{
  "email":            EmailStr,
  "code":             str pattern \d{6},
  "new_password":     str 8..72,
  "confirm_password": str 8..72
}
```

Behavior:
1. `new_password != confirm_password` → `400 passwords do not match`.
2. Look up a password account
   (`User.email = X AND password_hash IS NOT NULL`). Missing →
   `400 invalid code` (deliberately the same error as a wrong code;
   keeps enumeration resistance).
3. Look up `EmailVerification` for `(email, purpose='reset')`.
   Missing → `400 invalid code` (same rationale).
4. `expires_at < now` → delete row, commit, `400 code expired`.
5. `attempts >= CODE_MAX_ATTEMPTS` (5) → delete row, commit,
   `400 too many attempts`.
6. `verify_password(code, row.code_hash)` fails → `attempts += 1`,
   commit, `400 invalid code`.
7. Success: delete row, set `user.password_hash =
   hash_password(new_password)`, commit, return `204 No Content`.

Steps 4–6 mirror the existing `register` / authed `reset-password`
flow precisely so the same `friendlyError` map on the frontend
works without additions.

No JWT is issued (the user types the new password on `/login` to
verify they remember it — minor extra step that doubles as
short-term password retention check).

### 3.3 Schema additions (`app/schemas.py`)

```python
class ForgotPasswordIn(BaseModel):
    """Body for POST /auth/forgot-password (public). Always
    returns 204 to prevent email-enumeration attacks."""

    email: EmailStr


class ResetPasswordPublicIn(BaseModel):
    """Body for POST /auth/reset-password-public. The public
    sibling of ResetPasswordIn — also carries the email since the
    caller has no JWT to identify themselves."""

    email: EmailStr
    code: str = Field(pattern=r"^\d{6}$")
    new_password: str = Field(min_length=8, max_length=72)
    confirm_password: str = Field(min_length=8, max_length=72)
```

## 4. Frontend

### 4.1 `ForgotPasswordPage.tsx` (new)

`apps/web/src/pages/ForgotPasswordPage.tsx`. Structure mirrors
`RegisterPage.tsx` — same Sapphire Console card, same animation
keyframes, same header strip — to keep the auth pages visually
cohesive.

State machine:

```
type Step = "request" | "verify";
const [step, setStep] = useState<Step>("request");
const [email, setEmail] = useState("");
const [code, setCode] = useState("");
const [newPassword, setNewPassword] = useState("");
const [confirmPassword, setConfirmPassword] = useState("");
const [confirmTouched, setConfirmTouched] = useState(false);
const [error, setError] = useState<string | null>(null);
const [submitting, setSubmitting] = useState(false);
const [resendAfter, setResendAfter] = useState(0);
```

Step 1 ("request"):
- Single email input (`autoComplete="email"`).
- Submit button: `[ SEND CODE ]` (blue primary, Sapphire palette,
  Send icon).
- On submit → `POST /auth/forgot-password` → set `step =
  "verify"`, start 60s cooldown. The endpoint always returns 204,
  so the user always advances regardless of whether the email is
  registered — that's intentional (enumeration resistance).

Step 2 ("verify"):
- email shown read-only with a `[ change ]` link back to step 1
  (clears `code`, keeps cooldown).
- code input: 6 digits, `inputMode="numeric"`,
  `autoComplete="one-time-code"`.
- new_password + confirm_password inputs
  (`autoComplete="new-password"` on both). Mismatch shows the
  same red border + inline "passwords do not match" on blur as
  RegisterPage.
- "Resend code" link with 60s cooldown (re-calls
  `/auth/forgot-password`).
- Primary button: `[ RESET PASSWORD ]`. Enabled when
  `passwordsMatch && code.length === 6 && newPassword.length >=
  8`.
- Submit → `POST /auth/reset-password-public` →
  - 204 → `navigate("/login", { replace: true, state:
    { passwordReset: true } })`.
  - `400 code expired` / `400 too many attempts` →
    show error and snap back to step 1 (same logic as the
    authed reset).
  - Other 4xx → show error inline; remain on step 2.

Errors use the same `friendlyError` map as RegisterPage (already
covers `invalid code`, `code expired`, `too many attempts`,
`passwords do not match`, `mail delivery failed`, fallback `Network
error`).

### 4.2 `lib/account.ts` helpers

Append at the bottom of `apps/web/src/lib/account.ts`:

```ts
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

### 4.3 `LoginPage.tsx`

Two changes:

1. **"Reset it" link.** Below the `<button type="submit">SIGN IN`
   button, BEFORE the `<GoogleSignInButton />`, insert:

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

   The visual mirrors the existing "need an account? Register"
   line at the bottom.

2. **Success banner.** Read
   `useLocation()`-supplied state and render a green banner just
   below the page heading (above any error banner). The banner
   stays until the next navigation or page reload — no timer:

   ```tsx
   const location = useLocation();
   const passwordReset =
     (location.state as { passwordReset?: boolean } | null)
       ?.passwordReset === true;
   ...
   {passwordReset && (
     <div className="mt-4 rounded-sm border border-emerald-300 bg-emerald-50 px-3 py-2 font-mono text-[12px] text-emerald-800">
       [ AUTH ] · Password updated — please sign in with your new password.
     </div>
   )}
   ```

   `react-router`'s `Link` already imports cleanly into LoginPage
   (the `Register` link uses it).

### 4.4 `App.tsx` route

Add (between the `/register` and `/oauth/callback` route entries,
NOT wrapped in `PublicOnly` — a logged-in user clicking the
forgot-password link is a no-op safety hatch, not a bug):

```tsx
<Route path="/forgot-password" element={<ForgotPasswordPage />} />
```

And add the page to the imports at the top of `App.tsx`.

## 5. Error handling and security

- Both new endpoints return 4xx with `HTTPException(detail=str)`,
  consistent with the rest of the codebase. `ApiError.message`
  surfaces `detail` to the UI verbatim.
- Anti-enumeration: `/auth/forgot-password` is 204-only on the
  happy path. `/auth/reset-password-public` collapses
  "no such password account" and "no pending code" into the same
  `400 invalid code` as a wrong-code attempt.
- Rate limiting: slowapi `10/hour` per IP on the request
  endpoint. The completion endpoint inherits the 5-attempt
  burn-down baked into `EmailVerification.attempts`.
- The code lifetime (10 min) and resend cooldown (60 s) values
  remain shared with the rest of the email-verification flows
  (`CODE_TTL_MINUTES`, `CODE_RESEND_SECONDS`, `CODE_MAX_ATTEMPTS`
  constants in `auth.py`).

## 6. Testing

Same convention as Phase 11 / 11.1 — no pytest, just structural
smoke + manual walk-through.

### 6.1 Automated

Extend `apps/server/app/auth_routes_test.py`'s `EXPECTED_ROUTES`
with the two new POST routes.

### 6.2 Manual checklist (run before merge)

1. **LoginPage link present.** "Reset it" link is visible below
   the SIGN IN button, above the Google button.
2. **Routing.** Clicking "Reset it" navigates to
   `/forgot-password`.
3. **Anti-enumeration.** Request a code for an email with no
   account (or a Google-only email) — server log shows no
   `[MAIL STUB]` line; the page still advances to step 2 (no
   leakage). Attempting reset-password with a fabricated code
   returns `400 invalid code`.
4. **Real password account.** Request a code for a registered
   password email — uvicorn log emits
   `[MAIL STUB] code for <email>: <6 digits>` (or Resend delivers
   to the inbox if `RESEND_API_KEY` is set).
5. **60s cooldown.** Click Resend within 60s — the button is
   disabled and the timer counts down.
6. **Wrong code 5 times.** Snap back to step 1 with
   "Too many attempts".
7. **Expired code.** (Manually `UPDATE email_verifications SET
   expires_at = now() - interval '1 minute' WHERE email = '<your
   email>' AND purpose = 'reset';`.) Submit → "Code expired" +
   snap back.
8. **Password mismatch.** On step 2, confirm field with a
   different value — red border + "passwords do not match" +
   submit blocked.
9. **Happy path.** Correct code + matching passwords → land on
   `/login` with the green banner. Sign in with the NEW
   password — succeeds. Sign in with the OLD password — fails.
10. **Banner clears on navigation.** Click Register and come back
    to Login; the green banner is gone.

## 7. Implementation order (rough)

1. `app/schemas.py`: add `ForgotPasswordIn` + `ResetPasswordPublicIn`.
2. `app/routers/auth.py`: append `forgot_password` and
   `reset_password_public` endpoints.
3. `app/auth_routes_test.py`: assert the two new routes are mounted.
4. `apps/web/src/lib/account.ts`: append the two helpers.
5. `apps/web/src/pages/ForgotPasswordPage.tsx`: new file.
6. `apps/web/src/App.tsx`: register the new route.
7. `apps/web/src/pages/LoginPage.tsx`: add link + success banner.
8. Manual run-through (§6.2).

## 8. Open questions (none blocking)

- Whether to apply a per-email 60s cooldown that returns 429 (vs.
  silently 204). Spec sticks with silent 204 for stronger
  anti-enumeration; the IP slowapi cap and the per-(email,
  purpose) DELETE-then-INSERT pattern already serialize each
  email's traffic.
- Whether to auto-clear the success banner after N seconds. The
  current design clears on next navigation, which is the
  zero-state of `location.state`. Adding a timer feels noisier
  than helpful.
