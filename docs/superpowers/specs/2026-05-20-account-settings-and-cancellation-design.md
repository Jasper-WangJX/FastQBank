# Phase 11.1 — Account Independence, Settings Modal, Cancellation (Design)

Date: 2026-05-20
Status: Draft (pending implementation)

Follow-up to `2026-05-20-account-security-hardening-design.md`. Phase 11
shipped registration with email-verification + Google sign-in, but
silently auto-merged a Google sign-in into an existing password
account when the email matched. This phase reverses that and adds a
"Settings" entry point with password reset and account deletion.

## 1. Goals

1. **Account independence.** A Google sign-in and a password account
   that happen to share an email become two independent rows. This
   removes the surprise where a user who later signs up with Google
   has no idea what their "password account" password is.
2. **Settings button.** Replace the placeholder Help icon (top-right
   in `AppLayout`) with a Settings (gear) icon. Clicking opens a
   modal with two capabilities:
   - **Reset password** — password accounts only. Same code +
     double-input UX as the register flow.
   - **Delete account** — every account. Hard-delete the user and
     all owned data. Password accounts get a 24-hour cooldown
     before the same email can password-register again. Google can
     re-sign-in immediately (the cooldown does not apply).
3. **Operations note.** Document how to wipe local dev data
   (Postgres volume + browser localStorage). Not implemented as an
   endpoint.

## 2. Scope and non-goals

In scope:
- Migration 0007: drop the user-email unique constraint and replace
  with two partial unique indexes; create `deleted_users` table.
- Backend: `/auth/google/callback` lookup-by-`sub` (no email
  merge), `/auth/request-code` cooldown check, three new authed
  endpoints (`/auth/request-password-reset-code`,
  `/auth/reset-password`, `/auth/delete-account`), `UserOut` gains
  `has_password`.
- Frontend: Settings (gear) button in AppLayout, new
  `SettingsModal`, `AuthContext` caches `/me` as `currentUser`.

Out of scope:
- "Forgot password" flow for logged-out users (this phase only
  supports reset *while logged in*).
- Soft-delete / "undelete" of accounts. Deletion is permanent;
  cooldown is just an anti-abuse measure.
- Re-binding a deleted Google account's `google_id` to a new local
  row (handled implicitly by `/auth/google/callback`).
- Reaping rows from `deleted_users` older than 24h. They are inert
  (the cooldown query ignores them) and tiny.

## 3. Data model

### 3.1 `users` (modified)

Drop the existing `UNIQUE (email)` constraint added by migration
0001 and the no-longer-needed `uq_users_google_id` from 0006
(keep `google_id` indexed, just not via the global unique). Replace
with two partial unique indexes:

```sql
ALTER TABLE users DROP CONSTRAINT users_email_key;
-- 0006 created this:
ALTER TABLE users DROP CONSTRAINT uq_users_google_id;

CREATE UNIQUE INDEX uq_users_email_password
  ON users (email) WHERE google_id IS NULL;
CREATE UNIQUE INDEX uq_users_email_google
  ON users (email) WHERE google_id IS NOT NULL;
CREATE UNIQUE INDEX uq_users_google_id_notnull
  ON users (google_id) WHERE google_id IS NOT NULL;
```

The exact constraint name `users_email_key` is Postgres's default
for a column-level `UNIQUE`; the migration introspects current
constraints rather than guessing — see §3.4.

Why three partial indexes:
- `uq_users_email_password` — among rows with `google_id IS NULL`,
  email is unique. Prevents two password accounts with the same
  email.
- `uq_users_email_google` — among rows with `google_id IS NOT NULL`,
  email is unique. Prevents two Google accounts with the same
  email (defensive — Google `sub` should already guarantee this).
- `uq_users_google_id_notnull` — `google_id` itself is still unique
  globally, but only enforced when non-null. Replaces 0006's
  `uq_users_google_id` (which used a regular UNIQUE that already
  treats nulls as distinct, so behaviorally equivalent — the swap
  is for naming consistency with the others).

Net effect: same email can have at most one password account and
at most one Google account, totalling at most two rows; either
slot can be empty.

The existing `ck_users_auth_method` check constraint remains in
force.

### 3.2 `deleted_users` (new)

```python
class DeletedUser(Base):
    __tablename__ = "deleted_users"
    email: Mapped[str] = mapped_column(Text, primary_key=True)
    deleted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        primary_key=True,
        server_default=text("now()"),
    )
```

- Composite PK `(email, deleted_at)` — same email may be cancelled
  and re-registered many times over the project's lifetime.
- Written only when a **password** account is deleted (Google
  cancellation skips this table).
- `/auth/request-code` filters where
  `deleted_at > now() - interval '24 hours'`.
- No reaping job — table volume is tiny on a personal-use tool.

### 3.3 `EmailVerification.purpose` (semantic addition)

The column is already `Text`; no migration change. Pydantic
schemas expand `Literal["register"]` to
`Literal["register", "reset"]` where appropriate.

### 3.4 Migration 0007 strategy

Alembic 0007 plays defence with the email unique constraint
because its name on the user's local DB could be either
Postgres-default (`users_email_key`) or an Alembic-generated name
if migrations were re-run. The migration uses `op.execute(...)`
with a small DO-block that introspects `pg_constraint` and drops
whatever unique-on-email constraint exists, then recreates the
partial indexes. Same approach for `uq_users_google_id` from 0006.

Downgrade re-creates a column-level UNIQUE and drops the
`deleted_users` table; will fail if two rows share an email (you
must collapse them first, same caveat as 0006).

## 4. Backend API

### 4.1 `POST /auth/google/callback` (modified)

Replace the merge logic with a `google_id`-keyed lookup:

```
identity = verify_id_token(token)
user = SELECT * FROM users WHERE google_id = identity.sub
if user is None:
    user = User(
      email=identity.email,
      password_hash=NULL,
      google_id=identity.sub,
    )
    INSERT user
# else: log in unchanged user
issue JWT
```

No path touches any row where `password_hash IS NOT NULL`. A
password account with the same email is left strictly alone.

The previous `409 account conflict` branch is removed — it relied
on email-keyed lookup. The Google `sub` is globally unique by
construction; partial unique index
`uq_users_google_id_notnull` is the safety net.

### 4.2 `POST /auth/request-code` (modified)

Two changes:

1. **"Already registered" check** narrows from "any user with this
   email" to "any password user with this email":
   ```python
   existing_pw = await db.scalar(
       select(User).where(
           User.email == body.email,
           User.password_hash.is_not(None),
       )
   )
   if existing_pw is not None:
       raise HTTPException(409, "email already registered")
   ```

2. **Cooldown check** added before the per-(email, purpose)
   60-second window:
   ```python
   cutoff = now - timedelta(hours=24)
   recent_delete = await db.scalar(
       select(DeletedUser).where(
           DeletedUser.email == body.email,
           DeletedUser.deleted_at > cutoff,
       ).limit(1)
   )
   if recent_delete is not None:
       unlock_at = recent_delete.deleted_at + timedelta(hours=24)
       raise HTTPException(
           status_code=423,
           detail=f"email cooling down, try again after {unlock_at.isoformat()}",
       )
   ```
   Note: when multiple rows match, picking any one and showing
   "unlock at deleted_at + 24h" is fine — the frontend just needs
   the soonest unlock; the SQL ordering doesn't matter materially
   because the cutoff filter already restricts to rows that block
   right now. Sorting by `deleted_at DESC` and taking the first
   gives the latest, which is the actual unlock time.

### 4.3 `POST /auth/register` (touched)

The concurrent-register uniqueness re-check (today: any user with
this email → 409) narrows the same way as §4.2 step 1 — only
fires for password users. Adding a Google user with the same
email does not block password registration.

### 4.4 `GET /me` (modified)

`UserOut` adds `has_password: bool`, derived in the response model
as `password_hash is not None`. `password_hash` itself remains
unexposed.

### 4.5 `POST /auth/request-password-reset-code` (new)

Authenticated (`CurrentUser`). No body.

```
if current_user.password_hash is None:
    raise 400 "password reset not available for this account"

(reuse the same 60-second cooldown query as request-code, but
 scoped to purpose='reset' for current_user.email)
(reuse the DELETE-then-INSERT pattern with purpose='reset',
 expires_at = now + 10 min)
mail.send_verification(current_user.email, code)
return 204
```

No IP-level slowapi limit needed here: the endpoint requires a
valid JWT, so the per-user rate limit is intrinsic (one user, one
account, 60-second per-(email, purpose) cooldown). Adds defence in
depth without complexity.

### 4.6 `POST /auth/reset-password` (new)

Authenticated (`CurrentUser`). Body
`{ code: str pattern \d{6}, new_password: str 8..72, confirm_password: str 8..72 }`.

```
if current_user.password_hash is None:
    raise 400 "password reset not available for this account"
if new_password != confirm_password:
    raise 400 "passwords do not match"
(same code lifecycle as /auth/register: missing/expired/too_many/wrong,
 with purpose='reset')
on success:
    DELETE the verification row
    current_user.password_hash = hash_password(new_password)
    db.commit()
    return 204
```

Issuing a new JWT is unnecessary — the existing token stays valid
because we don't bump `iat`/`exp`; `sub` (user id) is unchanged.

### 4.7 `POST /auth/delete-account` (new)

Authenticated (`CurrentUser`). Body `{ confirm_email: EmailStr }`.

```
if confirm_email != current_user.email:
    raise 400 "email mismatch"

# Explicit hard-delete in dependency order. Done in one
# transaction so a partial failure rolls back cleanly.
DELETE FROM review_logs       WHERE user_id = current_user.id
DELETE FROM wrong_questions   WHERE user_id = current_user.id
DELETE FROM ai_usage          WHERE user_id = current_user.id
DELETE FROM gen_sessions      WHERE user_id = current_user.id
# question_tags FK has CASCADE on question_id; deleting questions
# cleans up join rows automatically.
DELETE FROM questions         WHERE user_id = current_user.id
DELETE FROM tags              WHERE user_id = current_user.id
# shares.creator_id has ON DELETE CASCADE from migration 0005,
# so the user row delete cascades to shares.

if current_user.password_hash is not None:
    INSERT INTO deleted_users (email, deleted_at) VALUES (..., now())

DELETE FROM users WHERE id = current_user.id
COMMIT
return 204
```

Defensive cleanup of any pending verification rows for this
email (at most one per purpose, but cheap to delete unconditionally):
`DELETE FROM email_verifications WHERE email = current_user.email`.
Included in the same transaction so the table is fully consistent
post-commit.

Note: no ORM relationships are used; the explicit DELETEs work
without configuring CASCADE on every FK and keep the migration
surface minimal.

### 4.8 Schema additions

```python
class ResetPasswordIn(BaseModel):
    code: str = Field(pattern=r"^\d{6}$")
    new_password: str = Field(min_length=8, max_length=72)
    confirm_password: str = Field(min_length=8, max_length=72)


class DeleteAccountIn(BaseModel):
    confirm_email: EmailStr


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    email: str
    created_at: datetime
    has_password: bool  # NEW: derived from password_hash is not None
```

`UserOut.has_password` is populated in the `/me` handler before
the model is built (since it isn't a real ORM attribute):
```python
return UserOut(
    id=current_user.id,
    email=current_user.email,
    created_at=current_user.created_at,
    has_password=current_user.password_hash is not None,
)
```

## 5. Frontend

### 5.1 `AppLayout.tsx`

Replace the `HelpCircle` button at lines 218–225 with a
`Settings` (gear) button, same shape and classes. New state
`settingsOpen: boolean`; clicking the button sets it to true.
Render `<SettingsModal open={settingsOpen} onClose={...} />`
alongside the existing modals.

### 5.2 `AuthContext.tsx` — cache `/me`

Add state `currentUser: { id, email, has_password } | null`.
- When `token` becomes non-null, fetch `/me`, store result.
- When `token` becomes null (logout, 401), clear `currentUser`.
- Provide via context so `SettingsModal` reads
  `useAuth().currentUser` without making its own `/me` request.

Existing `RequireAuth` no longer needs to manage this — but its
basic guard behaviour stays unchanged.

### 5.3 `SettingsModal.tsx` (new)

`apps/web/src/components/settings/SettingsModal.tsx`. Uses the
existing modal pattern (backdrop, white card, top close button)
seen in `ImportModal`, `MySharesModal`.

Structure:
```
┌──────────────────────────────────────┐
│ MODULE / SETTINGS                  [X]│
│                                       │
│ Account                              │
│   email · sign-in: Password | Google │
│                                       │
├──────────────────────────────────────┤
│ Reset password   (if has_password)   │
│   [collapsed initial state]          │
│   [ SEND CODE ]                      │
│   ...expands into code/pw/confirm    │
│      after [SEND CODE] succeeds      │
├──────────────────────────────────────┤
│ DANGER ZONE                          │
│   Delete account                     │
│   Type your email to confirm: [    ] │
│   [ DELETE ACCOUNT ] (disabled until │
│                       email matches) │
└──────────────────────────────────────┘
```

Reset-password sub-state mirrors `RegisterPage` step 2 but starts
on a clickable "send code" button (no email field — the server
uses `current_user.email`):
- Pre-send view: heading + send button + cooldown timer (`Resend
  in Xs` after first send).
- Post-send view: 6-digit code input (`autoComplete="one-time-code"`),
  new_password, confirm_password, `[ UPDATE PASSWORD ]`.
- On 204 success: clear fields, fold back to pre-send view, show
  inline confirmation `Password updated.` for ~3 seconds.

Delete-account section:
- Description text per account type:
  - Password: "This will permanently delete your account, all
    your questions, tags, and review history. The email **<your
    email>** will be blocked from password registration for 24
    hours."
  - Google: "This will permanently delete your account, all your
    questions, tags, and review history."
- Confirmation input must equal `currentUser.email` exactly
  (case-sensitive compare — emails in the DB are stored verbatim).
- `[ DELETE ACCOUNT ]` button disabled until input matches.
- On click: `window.confirm("Are you absolutely sure? This cannot
  be undone.")`; on OK → `POST /auth/delete-account` →
  `logout()` + `navigate("/login", {replace:true})` + transient
  toast `Account deleted.`

### 5.4 Friendly error map additions

Whether shared with RegisterPage or duplicated locally:

| detail | UI text |
|---|---|
| `password reset not available for this account` | "Password reset is not available for Google accounts." |
| `email mismatch` | "Email confirmation does not match." |
| `email cooling down, try again after <iso>` | "Email was recently cancelled. Try again after <formatted local time>." |
| `passwords do not match` | "Passwords do not match." |

The cooldown message parses the ISO timestamp and formats it via
`Date(iso).toLocaleString()`.

### 5.5 Library helper

`apps/web/src/lib/account.ts` exporting:
```ts
requestPasswordResetCode(): Promise<void>     // POST /auth/request-password-reset-code → 204
resetPassword(body: ResetPasswordIn): Promise<void>  // POST /auth/reset-password → 204
deleteAccount(confirm_email: string): Promise<void>  // POST /auth/delete-account → 204
```
Keeps `SettingsModal` JSX-only.

### 5.6 File map

- Modify: `apps/web/src/components/AppLayout.tsx`
- Modify: `apps/web/src/auth/AuthContext.tsx`
- Create: `apps/web/src/components/settings/SettingsModal.tsx`
- Create: `apps/web/src/lib/account.ts`

## 6. Error handling

All endpoints return `HTTPException(status_code, detail=str)`,
consistent with the rest of the codebase. The frontend's existing
`ApiError` plumbing surfaces `detail` to the UI verbatim; friendly
mapping is in §5.4.

## 7. Testing strategy

Same project convention as Phase 11 — no pytest. Coverage relies
on a mix of pure-helper smoke tests and the project's manual
verification list.

### 7.1 Backend smoke tests

Extend `apps/server/app/auth_routes_test.py` to assert the three
new routes are mounted:
- `POST /auth/request-password-reset-code`
- `POST /auth/reset-password`
- `POST /auth/delete-account`

No new behavioural tests beyond that — same rationale as Phase
11: hermetic integration tests need a fixed Postgres test DB,
which the project doesn't have. Manual verification covers it.

### 7.2 Manual verification checklist (run before merge)

1. **Independence — Google after password.** Password-register
   email X (with stub mail). Log out. Google sign-in with the
   same email Y=X. Both rows exist. Log out, password-sign-in X
   → still works.
2. **Independence — password after Google.** Google sign-in with
   email X. Log out. Password-register X (code arrives, account
   created). Both rows exist; can log in to each separately.
3. **Settings button visible.** Logged in, top-right shows the
   gear icon (no more `?` HelpCircle).
4. **Reset password (password account).** Open Settings → Reset
   password → SEND CODE → uvicorn log shows `[MAIL STUB] code for
   <email>: <6 digits>` → fill code + matching new password →
   UPDATE PASSWORD → toast appears → log out and log back in with
   the new password.
5. **Reset password unavailable (Google account).** Sign in via
   Google → open Settings → Reset password section is NOT
   rendered (only Delete account is).
6. **Delete account (Google).** Sign in via Google → Settings →
   DANGER ZONE → type email exactly → click DELETE → confirm
   prompt → land at /login. Sign in via Google again with same
   email → fresh account, no historical data.
7. **Delete account (password) + cooldown.** Password-register Y,
   add a question. Settings → DANGER ZONE → type Y → DELETE →
   confirm → land at /login. Try to password-register Y again
   immediately → cooldown error with the unlock time. Try Google
   sign-in with Y → succeeds, no historical data.
8. **Email mismatch confirmation.** Type a wrong email; DELETE
   button stays disabled (and the server would 400 if forced).
9. **Password confirmation mismatch on reset.** New password and
   confirm differ → submit blocked client-side; if forced, server
   400.
10. **`/me has_password` flag.** Browser devtools network panel:
    `/me` response includes `has_password` as `true` for password
    sign-in, `false` for Google sign-in.
11. **Smoke tests.** From `apps/server`: `mail_test`,
    `oauth_google_test`, `auth_routes_test`, `share_token_test`
    all exit 0.
12. **Type checks.** `pnpm -C apps/web tsc -b --noEmit` and
    `pnpm -C apps/desktop tsc --noEmit` clean.

## 8. Local data wipe (operations note)

Not implemented as code. Two recipes for the dev environment:

### Option A — full reset
```bash
docker compose down -v
docker compose up -d db
cd apps/server
.venv/Scripts/python.exe -m alembic upgrade head
```
Drops the Postgres volume, brings DB back up, replays all
migrations through 0007.

### Option B — keep schema, truncate data
```sql
TRUNCATE
  review_logs, wrong_questions, ai_usage, gen_sessions,
  question_tags, tags, questions, shares,
  email_verifications, oauth_states, deleted_users,
  users
CASCADE;
```

Either way, also clear the browser/desktop `aqb_token` in
localStorage. For the Electron desktop build, the data lives
under the `app://aqb` origin's storage in
`%APPDATA%\<electron-app-name>\Local Storage`; a Logout click is
usually enough.

## 9. Open questions (none blocking)

- Whether to require the current password to delete a password
  account (additional safety vs. friction). This design leans on
  the type-your-email confirmation as the sole guard. Worth
  revisiting if real-world abuse appears.
- Whether to surface "you can re-sign-up at <unlock time>"
  preemptively on the register page when the cooldown is active
  (vs. only after a request-code attempt). The current design is
  pull-based; the spec keeps it that way for simplicity.
