# Phase 11 — Account Security Hardening (Design)

Date: 2026-05-20
Status: Draft (pending implementation)

## 1. Goal

Make the registration window resistant to mass-signup abuse and add a
frictionless social sign-in:

1. **Password confirmation** — user enters the password twice, the two
   values must match before the form submits.
2. **Email verification** — a 6-digit code is mailed to the address
   the user typed. The account is created **only** after the code is
   confirmed, so the database never holds unverified rows.
3. **Google sign-in** — "Continue with Google" on both the web build
   and the Electron desktop build. If the Google address matches an
   existing local account, the two sign-in methods are auto-merged
   onto the same `user_id`.

The three features ship together as Phase 11.

## 2. Scope and non-goals

In scope:
- New mail-sending module backed by Resend HTTP API, with a console
  stub when no key is configured (mirrors stage-6 AI fallback).
- New backend endpoints for verification-code request and Google
  OAuth start/callback.
- Two-step registration UI; Google button on both `RegisterPage` and
  `LoginPage`.
- DB migration adding `google_id` + nullable `password_hash` to
  `users`, plus two new tables (`email_verifications`,
  `oauth_states`).
- Desktop OAuth via Electron `shell.openExternal` and the existing
  `app://aqb` custom protocol.

Out of scope:
- Password reset / "forgot password" flow (the verification table is
  designed to host a future `purpose='reset'`, but Phase 11 does not
  implement the endpoint).
- 2FA / TOTP.
- Other OAuth providers (GitHub, Microsoft …).
- Magic-link / passwordless sign-in.
- A frontend unit-test framework — UI changes are validated by
  manual test + `tsc --noEmit`, consistent with existing project
  convention (only library code under `apps/web/src/lib` has tests).

## 3. Data model

### 3.1 `users` (modified)

```sql
ALTER TABLE users
  ADD COLUMN google_id TEXT,
  ADD CONSTRAINT uq_users_google_id UNIQUE (google_id),
  ALTER COLUMN password_hash DROP NOT NULL;
```

- `google_id` stores Google's `sub` claim (a stable opaque id, not the
  email). Null means the user has no Google link yet.
- `password_hash` becomes nullable so Google-only accounts can exist.
- Application invariant (enforced in code, not by constraint): every
  row has at least one of `password_hash` or `google_id` set.
- The existing `email` unique constraint is the anchor for the
  auto-merge logic.

### 3.2 `email_verifications` (new)

```python
class EmailVerification(Base):
    __tablename__ = "email_verifications"
    id: UUID PK
    email: Text, indexed
    code_hash: Text                      # bcrypt of the 6-digit code
    expires_at: TIMESTAMPTZ
    attempts: Integer default 0
    sent_at: TIMESTAMPTZ default now()
    purpose: Text                        # 'register' (future: 'reset')
```

Invariants:
- At most one row per `(email, purpose)`. Sending a fresh code first
  `DELETE`s any prior row, then `INSERT`s the new one.
- A successful `/auth/register` deletes the matching row immediately;
  the table never accumulates "verified but unused" or expired data
  beyond the single in-flight code per email.
- No background cleanup job is needed for this phase.

### 3.3 `oauth_states` (new)

```python
class OAuthState(Base):
    __tablename__ = "oauth_states"
    id: UUID PK
    state: Text UNIQUE
    code_verifier: Text                  # PKCE
    redirect_uri: Text
    created_at: TIMESTAMPTZ default now()
    expires_at: TIMESTAMPTZ              # now() + 5 min
```

- Inserted by `/auth/google/start`, deleted by
  `/auth/google/callback` after a successful exchange.
- Expired rows aren't proactively pruned — table volume is bounded by
  a tiny single-user workload.

### 3.4 Migration

One Alembic revision creates the two new tables and applies both
column changes to `users`. Roll-back drops both tables and restores
`password_hash NOT NULL` (the down-migration is best-effort and will
fail if any Google-only rows exist — acceptable, the user can clear
them manually before downgrading).

## 4. Backend API

All endpoints under `apps/server/app/routers/auth.py`.

### 4.1 `POST /auth/request-code`

Request: `{ "email": EmailStr, "purpose": "register" }`

Behavior:
1. If `purpose == "register"` and `email` is already a registered
   user, return `409 email already registered` (same wording as
   existing register).
2. Query the latest `email_verifications` row for `(email, purpose)`:
   if `sent_at` is within the last 60 seconds, return
   `429 please wait before requesting another code`.
3. Generate a 6-digit code with `secrets.randbelow(1_000_000)`,
   zero-padded to 6 characters. Bcrypt-hash via `hash_password`.
4. `DELETE` any existing row for `(email, purpose)`, then `INSERT`
   the new row with `expires_at = now() + 10 minutes`, `attempts = 0`.
5. Call `mail.send_verification(email, code)`. On failure, roll back
   the DB transaction and return `502 mail delivery failed`.

Response: `204 No Content` (response carries no body so the endpoint
cannot be used to enumerate registered emails through timing — the
`409` branch above already exposes the registered/not-registered
state, but that exposure is intrinsic to "must reject duplicate
registration").

Rate limit: `@limiter.limit("10/hour")` per IP (slowapi, reuses the
existing `app.ratelimit.limiter`).

### 4.2 `POST /auth/register` (modified)

Request: `{ "email", "password" (8..72), "code" (^\d{6}$) }`

Behavior:
1. Look up `email_verifications` for `(email, purpose='register')`.
   Missing → `400 verification required`.
2. `expires_at < now()` → delete the row, return `400 code expired`.
3. `attempts >= 5` → delete the row, return `400 too many attempts`.
4. `verify_password(code, row.code_hash)` fails → `attempts += 1`,
   commit, return `400 invalid code`.
5. All checks pass → delete the verification row → check email
   uniqueness → create user → issue JWT.

Response: unchanged (`201 Created` + `TokenOut`).

### 4.3 `POST /auth/login` (modified)

One added clause: if the found user has `password_hash IS NULL`
(Google-only account), still return `401 invalid email or password`.
The error wording does not disclose that the account exists with a
different sign-in method.

### 4.4 `GET /auth/providers` (new, public)

Returns `{ "google": bool }`. Inspected once at frontend startup so
the Google button is hidden when the server has no `GOOGLE_CLIENT_ID`
configured, without each page trying `/auth/google/start` to find
out.

### 4.5 `GET /auth/google/start`

Query: `?platform=web|desktop`

Behavior:
1. If `GOOGLE_CLIENT_ID` is unconfigured, return `503 google sign-in
   not configured`.
2. Generate `state` (token_urlsafe 32) and `code_verifier`
   (token_urlsafe 64); derive `code_challenge = S256(code_verifier)`.
3. Choose `redirect_uri` from settings based on `platform`.
4. Insert `oauth_states` row.
5. Return `{ "authorize_url": "<https://accounts.google.com/o/oauth2/v2/auth?...>", "state": "<state>" }`.

The authorize URL uses standard Google OAuth params:
`client_id`, `redirect_uri`, `response_type=code`, `scope=openid
email profile`, `state`, `code_challenge`, `code_challenge_method=S256`,
`prompt=select_account`.

### 4.6 `POST /auth/google/callback`

Request: `{ "code": str, "state": str }`

Behavior:
1. Look up `oauth_states` by `state`. Missing or expired → delete (if
   present) and return `400 invalid state`. Otherwise read
   `code_verifier` + `redirect_uri`, then delete the row.
2. Exchange at `https://oauth2.googleapis.com/token` (form-encoded:
   `grant_type=authorization_code`, `code`, `redirect_uri`,
   `client_id`, `client_secret`, `code_verifier`). Non-2xx →
   `400 token exchange failed`.
3. Verify the returned `id_token` against Google's JWKS
   (`https://www.googleapis.com/oauth2/v3/certs`, cached in process)
   using the `google-auth` library. Extract `sub`, `email`,
   `email_verified`.
4. `email_verified != true` → `400 google email not verified`.
5. Auto-merge:
   - `SELECT users WHERE email = ?`:
     - Found, `google_id IS NULL` → write `google_id = sub`.
     - Found, `google_id == sub` → no-op.
     - Found, `google_id != sub` → `409 account conflict` (defensive;
       shouldn't happen because Google `sub` is stable per email).
     - Not found → create new user: `email`, `password_hash = NULL`,
       `google_id = sub`.
6. Issue JWT for the resolved user.

Response: `200 OK` + `TokenOut`.

### 4.7 Settings additions (`app.settings`)

```python
resend_api_key: str | None = None
mail_from: str = "FastQBank <onboarding@resend.dev>"

google_client_id: str | None = None
google_client_secret: str | None = None
oauth_redirect_uri_web: str = "http://localhost:5173/oauth/callback"
oauth_redirect_uri_desktop: str = "app://aqb/oauth/callback"
```

All keys default to None / dev defaults so the app still boots
without them (mail prints to console; Google button hidden via
`/auth/providers`).

## 5. Mail module (`apps/server/app/mail.py`)

Single public coroutine:

```python
async def send_verification(email: str, code: str) -> None
```

- Uses `httpx.AsyncClient` directly (already in venv via openai's
  deps — no new package).
- Posts to `https://api.resend.com/emails` with bearer auth.
- Body: `from = settings.mail_from`, `to = [email]`, subject
  `Your FastQBank verification code`, both `text` and `html` parts.
- The HTML part is a single inline-styled block: heading, code in
  monospace, expiry note. No images, no external resources (kept
  out of spam-score territory).
- When `settings.resend_api_key is None`, the function prints
  `[MAIL STUB] code for {email}: {code}` and returns; the rest of
  the registration flow remains functional for local dev.
- HTTP non-2xx → `raise RuntimeError("mail send failed: …")`. Router
  catches the exception, rolls back the DB transaction, returns 502.
- No retries: a single failed send surfaces immediately so the user
  can re-request; silent retry would extend latency unhelpfully.

## 6. Frontend changes

### 6.1 `RegisterPage.tsx` — two-step state machine

State: `step: "request" | "verify"` plus the existing
`email/password/error/submitting` fields, with new `code`,
`confirmPassword`, `resendAfter: number` (seconds remaining in the
60s cooldown).

Step 1 ("request"):
- Fields: email only.
- Submit button: `[ REQUEST CODE ]` in the same slot as the current
  primary button.
- On submit → `POST /auth/request-code`. Map results:
  - `204` → `setStep("verify")`, start 60s cooldown.
  - `409` → error message includes an inline `Sign in` link.
  - `429` → show remaining cooldown seconds.

Step 2 ("verify"):
- Email shown read-only with a small `[ change ]` link back to step 1
  (clears `code` + `confirmPassword`, keeps cooldown intact).
- Code input: 6 digits, `inputMode="numeric"`,
  `pattern="\d{6}"`, `autoComplete="one-time-code"` so iOS/Chrome can
  autofill from the mail or SMS plugins.
- Password input: unchanged (8..72, `autoComplete="new-password"`).
- Confirm-password input: matched against `password` on blur and on
  submit; mismatch shows `passwords do not match` immediately, blocks
  submit.
- "Resend code" secondary button, disabled while `resendAfter > 0`.
- Submit → `POST /auth/register` with `{ email, password, code }`:
  - `201` → `login(token) + navigate("/", { replace: true })`.
  - `400 invalid code` → keep step 2, surface message.
  - `400 code expired` → snap back to step 1, surface message.
  - `400 too many attempts` → snap back to step 1, surface message.

### 6.2 Google sign-in button

New component
`apps/web/src/components/auth/GoogleSignInButton.tsx`:

- Visual: inverted-treatment button (white background, slate border,
  slate text) so it contrasts the existing Sapphire-blue primary
  button. Inline 16px Google `G` SVG on the left.
- Label: `Continue with Google` on register, `Sign in with Google`
  on login (controlled by a `mode` prop).
- Behavior:
  - Web (`getDesktop() === null`): `fetch /auth/google/start?platform=web`,
    then `window.location.assign(res.authorize_url)`.
  - Desktop: `fetch /auth/google/start?platform=desktop`, then
    IPC `oauth:open-external` so the main process calls
    `shell.openExternal(authorize_url)`.
- The button is rendered only when `AuthContext.providers.google ===
  true` (see 6.3); otherwise the whole block (button + the `OR`
  divider above it) is omitted.
- Both `RegisterPage` and `LoginPage` import the component.

### 6.3 `AuthContext` provider check

On mount, `AuthContext` fetches `GET /auth/providers` once and caches
`{ google: boolean }`. Components read it via `useAuth().providers`.
A network failure defaults to `{ google: false }` so an outage
gracefully hides the button rather than rendering a broken control.

### 6.4 Web OAuth callback route

- New page `apps/web/src/pages/OAuthCallbackPage.tsx`.
- Route entry in `App.tsx`: `<Route path="/oauth/callback"
  element={<OAuthCallbackPage />} />`.
- The page reads `code` + `state` from `useSearchParams()`, posts to
  `/auth/google/callback`, then `login(token) + navigate("/", {
  replace: true })`. On error, render the same Sapphire-Console card
  with the error and a "Back to sign in" link.

### 6.5 Shared callback handler

Both the web route and the desktop IPC consumer call a single
function `lib/auth.ts → completeOAuthCallback({ code, state })`,
which performs the POST and dispatches `login(...)`. One source of
truth.

## 7. Desktop OAuth integration

### 7.1 Main process

- Reuses the existing `app://aqb` custom protocol from stage 4;
  extends its handler so a navigation to `app://aqb/oauth/callback`
  is intercepted: instead of loading a renderer page, it parses
  `code` + `state` from the URL and forwards them to the renderer
  via `webContents.send("oauth:callback", { code, state })`.
- New IPC channel `oauth:open-external` (renderer → main): main
  process validates the URL begins with
  `https://accounts.google.com/`, then calls
  `shell.openExternal(url)`. URL whitelist prevents a compromised
  renderer from using this channel to open arbitrary protocols.
- Preload script exposes `desktop.openExternal(url)` and
  `desktop.onOAuthCallback(cb)` on the `window.desktop` bridge,
  matching the existing pattern in `apps/web/src/lib/desktop.ts`.

### 7.2 Renderer

- A top-level `useEffect` in `App.tsx` (mounted whether logged in or
  not) subscribes to `desktop.onOAuthCallback`. On receipt, it calls
  `completeOAuthCallback(...)` (shared with the web route).
- After completion, `navigate("/")` lands the user on the main app
  view.

## 8. Error handling

- All backend 4xx use `HTTPException(status_code, detail=str)`.
  Existing `ApiError` plumbing already surfaces `detail` to the UI;
  no client-side library changes.
- Friendly mapping on the register page (with raw detail as fallback):

  | Detail string | UI message |
  |---|---|
  | `email already registered` | `Already registered. Sign in instead.` |
  | `please wait before requesting another code` | `Please wait Xs before requesting another code.` |
  | `invalid code` | `Invalid code — try again.` |
  | `code expired` | `Code expired. Please request a new one.` |
  | `too many attempts` | `Too many attempts. Please request a new code.` |
  | `verification required` | `Please verify your email first.` |
  | other | the raw detail (or `Network error` if not `ApiError`) |

- Google button errors map similarly (`token exchange failed`,
  `google email not verified`, `account conflict`, `google sign-in
  not configured`).

## 9. Testing strategy

### 9.1 Backend (pytest, sqlite-in-memory test DB pattern already in repo)

`tests/test_auth_verification.py`:
- `test_request_code_creates_row_and_calls_mailer` (mocks
  `mail.send_verification`).
- `test_request_code_rate_limit_60s`.
- `test_request_code_email_already_registered_returns_409`.
- `test_register_without_code_400`.
- `test_register_wrong_code_increments_attempts`.
- `test_register_5th_wrong_code_deletes_row`.
- `test_register_expired_code_400_and_row_deleted`.
- `test_register_success_deletes_verification_row_and_creates_user`.
- `test_register_then_login_with_password_succeeds` (end-to-end).

`tests/test_mail.py`:
- `test_mail_stub_when_no_key` (capsys assertion).
- `test_mail_send_http_error_raises` (`httpx.MockTransport`).

`tests/test_auth_google.py` (mocks Google token + JWKS endpoints,
no real network):
- `test_google_start_returns_url_with_pkce_challenge_and_stores_state`.
- `test_google_callback_creates_new_user_when_email_unseen`.
- `test_google_callback_merges_into_existing_password_user` —
  pre-creates a password-only user, runs the callback, asserts
  `google_id` is set on the SAME row and password login still works.
- `test_google_callback_invalid_state_400`.
- `test_google_callback_email_not_verified_400`.
- `test_google_callback_sub_mismatch_returns_409`.

### 9.2 Frontend

- No new test framework — the project's UI layer has no jest/vitest
  and Phase 11 keeps that convention.
- Manual coverage list (executed in the dev server before merge):
  1. Step 1 → 2 → 3 happy path (real Resend stub print).
  2. Same email request twice within 60s → cooldown error.
  3. Already-registered email → `409` UI text.
  4. Password mismatch on confirm field shows red error on blur,
     blocks submit.
  5. Wrong code 5×: row deletes, message appears, step rewinds.
  6. Expired code (manually edit `expires_at` in DB) → message +
     step rewinds.
  7. Google button hidden when `GOOGLE_CLIENT_ID` blank.
  8. Web Google flow: button → Google consent → callback page →
     logged in.
  9. Desktop Google flow: button → default-browser consent →
     `app://aqb/oauth/callback` → logged in.
  10. Auto-merge: register password user → log out → Google sign-in
      with same address → land logged in, then verify the same email
      can still log in via password.
- `pnpm tsc -b --noEmit` (both apps/web and apps/desktop) passes.

## 10. Configuration

`.env.example` additions:

```dotenv
# --- Phase 11: email verification (optional) ---
# Sign up at https://resend.com (free 100/day). Leave blank to print
# the verification code to the server console instead of sending mail.
RESEND_API_KEY=
MAIL_FROM=FastQBank <onboarding@resend.dev>

# --- Phase 11: Google sign-in (optional) ---
# Create an OAuth client at https://console.cloud.google.com/apis/credentials.
# Leave GOOGLE_CLIENT_ID blank to hide the "Continue with Google" button.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
OAUTH_REDIRECT_URI_WEB=http://localhost:5173/oauth/callback
OAUTH_REDIRECT_URI_DESKTOP=app://aqb/oauth/callback
```

`requirements.txt`: add `google-auth~=2.34` (for id_token + JWKS
verification). No frontend dep additions.

## 11. Implementation order (rough)

1. Alembic migration (users + email_verifications + oauth_states),
   model classes in `app/models.py`.
2. `mail.py` + settings additions + stub-mode test.
3. `request-code` + modified `register` schemas + router + tests.
4. `RegisterPage` two-step UI + confirm-password validation
   (manual-tested via dev server).
5. `/auth/providers` endpoint + `AuthContext.providers` plumbing.
6. `/auth/google/start` + `/auth/google/callback` + auto-merge logic
   + tests.
7. `GoogleSignInButton` component + Web `/oauth/callback` route +
   shared `completeOAuthCallback` helper.
8. Electron preload + main-process IPC + protocol handler extension.
9. `.env.example` update + Roadmap Phase 11 section.

Each step is independently committable; backend (1-3, 5-6) and
frontend (4, 7-8) can be interleaved without blocking either side
once step 1 lands.

## 12. Open questions (none blocking)

- Mail HTML body styling: kept intentionally minimal in this design.
  If, after the first deploy, deliverability drops because of
  "looks like spam" heuristics, consider adding an unsubscribe link
  (it's a transactional code so RFC 8058 doesn't strictly require
  one) and/or a postmaster-verified custom domain instead of
  `onboarding@resend.dev`.
- We rely on Google JWKS being reachable from the backend. In an
  air-gapped deployment, Google sign-in would degrade — the
  `/auth/providers` switch + missing-key fallback already covers
  this.
