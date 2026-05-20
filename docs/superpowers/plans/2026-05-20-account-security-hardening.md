# Phase 11 — Account Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add password confirmation, email verification (Resend), and Google sign-in (web + Electron desktop) to the registration / login flow.

**Architecture:**
- Backend (FastAPI): three new tables (`email_verifications`, `oauth_states`, plus columns on `users`), four new endpoints (`/auth/request-code`, `/auth/providers`, `/auth/google/start`, `/auth/google/callback`), two modified ones (`/auth/register`, `/auth/login`). Mail via Resend HTTP API with a stub-print fallback; Google id_token verified locally with `google-auth`.
- Frontend (React): `RegisterPage` becomes a two-step state machine (request code → enter code + password + confirm); shared `GoogleSignInButton` component on both auth pages; new `/oauth/callback` route + the shared `completeOAuthCallback` helper.
- Desktop (Electron): a single-use `http.createServer` on `127.0.0.1:0` per attempt; two new IPC channels (`oauth:start-loopback`, `oauth:open-external`) plus one main→renderer broadcast (`oauth:callback`).

**Tech Stack:** FastAPI · SQLAlchemy 2 (async) · Alembic · bcrypt · PyJWT · `google-auth` (new) · `httpx` (already a transitive dep) · slowapi · React 19 + Vite 8 + react-router-dom · Electron.

**Spec:** [docs/superpowers/specs/2026-05-20-account-security-hardening-design.md](../specs/2026-05-20-account-security-hardening-design.md)

---

## Conventions used in this plan

- **Test convention.** This repo does NOT use pytest. Tests are stand-alone smoke scripts named `<module>_test.py` next to the source (see `apps/server/app/share_token_test.py`). They use bare `assert` statements, define a `main()`, and run with `.venv/Scripts/python.exe -m app.<module>_test`. Integration / endpoint tests follow the same pattern but use `fastapi.testclient.TestClient` over an in-process app whose `DATABASE_URL` is overridden to a disposable sqlite file (see Task 10 for the bootstrap). Each task therefore writes a `*_test.py` that exits 0 on success.
- **Run commands assume PowerShell.** All `Bash` commands shown work because the repo provides Bash via Git Bash; PowerShell equivalents are noted only where the syntax actually differs.
- **Server venv path** is `apps/server/.venv/Scripts/python.exe` on Windows.
- **Commit messages** use the Conventional-Commit style already used in the repo (`feat: …`, `fix: …`, `docs: …`).
- **No new top-level dependencies** beyond `google-auth` on the server side; the frontend / Electron add nothing.

---

## File map

### Backend — creates
- `apps/server/alembic/versions/0006_phase11_account_security.py`
- `apps/server/app/mail.py`
- `apps/server/app/oauth_google.py`
- `apps/server/app/mail_test.py`
- `apps/server/app/oauth_google_test.py`
- `apps/server/app/auth_flow_test.py`

### Backend — modifies
- `apps/server/app/models.py`            (User columns + 2 new tables)
- `apps/server/app/schemas.py`           (Phase 11 schemas)
- `apps/server/app/settings.py`          (mail + OAuth env)
- `apps/server/app/routers/auth.py`     (6 endpoint edits/adds)
- `apps/server/requirements.txt`        (+ google-auth)

### Frontend — creates
- `apps/web/src/components/auth/GoogleSignInButton.tsx`
- `apps/web/src/pages/OAuthCallbackPage.tsx`
- `apps/web/src/lib/oauth.ts`

### Frontend — modifies
- `apps/web/src/pages/RegisterPage.tsx`  (two-step state machine)
- `apps/web/src/pages/LoginPage.tsx`     (add Google button)
- `apps/web/src/auth/AuthContext.tsx`    (providers fetch)
- `apps/web/src/lib/desktop.ts`          (extend type bridge)
- `apps/web/src/App.tsx`                 (route + desktop callback listener)

### Desktop — creates
- `apps/desktop/src/oauth.ts`            (loopback server + openExternal whitelist)

### Desktop — modifies
- `apps/desktop/src/ipc.ts`              (3 new channel names)
- `apps/desktop/src/main.ts`             (register OAuth IPC)
- `apps/desktop/src/preload.ts`          (expose `desktop.oauth`)

### Repo root — modifies
- `.env.example`                         (Phase 11 env vars)
- `docs/Roadmap_CN.md` + `docs/Roadmap_EN.md`  (mark Phase 11 done at the end)

---

## Task 1: Alembic migration — users + email_verifications + oauth_states

**Files:**
- Create: `apps/server/alembic/versions/0006_phase11_account_security.py`

- [ ] **Step 1: Create the migration file**

Create `apps/server/alembic/versions/0006_phase11_account_security.py` with this content:

```python
"""Phase 11: account security hardening

users:
  - add google_id (nullable, unique)
  - drop NOT NULL on password_hash (Google-only accounts have no
    password)
  - add CHECK (password_hash IS NOT NULL OR google_id IS NOT NULL)
    so every row has at least one sign-in method

New tables:
  - email_verifications: 6-digit code (bcrypt-hashed) tied to an
    email + purpose, with attempts counter and expiry. One row per
    (email, purpose) is enforced by the router (DELETE-then-INSERT).
  - oauth_states: PKCE verifier + redirect_uri pinned to a state
    token, short TTL; deleted on use.

Revision ID: 0006_phase11_account_security
Revises: 0005_shares_and_imported_from
Create Date: 2026-05-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0006_phase11_account_security"
down_revision: str | None = "0005_shares_and_imported_from"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # (a) users.google_id + invariant
    op.add_column("users", sa.Column("google_id", sa.Text(), nullable=True))
    op.create_unique_constraint(
        "uq_users_google_id", "users", ["google_id"]
    )
    op.alter_column("users", "password_hash", nullable=True)
    op.create_check_constraint(
        "ck_users_auth_method",
        "users",
        "password_hash IS NOT NULL OR google_id IS NOT NULL",
    )

    # (b) email_verifications
    op.create_table(
        "email_verifications",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("code_hash", sa.Text(), nullable=False),
        sa.Column(
            "expires_at", sa.DateTime(timezone=True), nullable=False
        ),
        sa.Column(
            "attempts",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "sent_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_email_verifications_email_purpose",
        "email_verifications",
        ["email", "purpose"],
    )

    # (c) oauth_states
    op.create_table(
        "oauth_states",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("state", sa.Text(), nullable=False),
        sa.Column("code_verifier", sa.Text(), nullable=False),
        sa.Column("redirect_uri", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "expires_at", sa.DateTime(timezone=True), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("state", name="uq_oauth_states_state"),
    )


def downgrade() -> None:
    op.drop_table("oauth_states")
    op.drop_index(
        "ix_email_verifications_email_purpose",
        table_name="email_verifications",
    )
    op.drop_table("email_verifications")
    op.drop_constraint("ck_users_auth_method", "users", type_="check")
    # Best-effort: Postgres will reject this if any row has NULL
    # password_hash; that's intentional — drop Google-only rows first.
    op.alter_column("users", "password_hash", nullable=False)
    op.drop_constraint("uq_users_google_id", "users", type_="unique")
    op.drop_column("users", "google_id")
```

- [ ] **Step 2: Sanity-check the migration boots**

Run from `apps/server`:

```bash
.venv/Scripts/python.exe -m alembic check
```

Expected: prints `No new upgrade operations detected.` once you have applied through `head` — for now `alembic heads` should list `0006_phase11_account_security`.

```bash
.venv/Scripts/python.exe -m alembic heads
```

Expected output contains `0006_phase11_account_security (head)`.

- [ ] **Step 3: Apply locally (or stash for later if no DB running)**

If a Postgres is running (`docker compose up -d db`):

```bash
.venv/Scripts/python.exe -m alembic upgrade head
```

Expected: `Running upgrade 0005_shares_and_imported_from -> 0006_phase11_account_security`.

If no DB is available now, skip this step — the smoke tests in later tasks use sqlite via `TestClient` and create_all, not Alembic.

- [ ] **Step 4: Commit**

```bash
git add apps/server/alembic/versions/0006_phase11_account_security.py
git commit -m "feat(db): phase 11 migration — users.google_id, email_verifications, oauth_states"
```

---

## Task 2: ORM models — User columns + EmailVerification + OAuthState

**Files:**
- Modify: `apps/server/app/models.py`

- [ ] **Step 1: Make `password_hash` nullable and add `google_id`**

In `apps/server/app/models.py`, replace the `User` class body:

```python
class User(Base):
    __tablename__ = "users"

    id: Mapped[PyUUID] = _uuid_pk()
    email: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    # Nullable: Google-only accounts have no password. The DB-level
    # CHECK ck_users_auth_method (migration 0006) guarantees at least
    # one of password_hash / google_id is non-null on every row.
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Google `sub` claim — opaque, stable per user per OAuth client.
    # NOT the email (the email may change at the Google side).
    google_id: Mapped[str | None] = mapped_column(
        Text, nullable=True, unique=True
    )
    created_at: Mapped[datetime] = _now_column()

    __table_args__ = (
        CheckConstraint(
            "password_hash IS NOT NULL OR google_id IS NOT NULL",
            name="ck_users_auth_method",
        ),
    )
```

- [ ] **Step 2: Add `EmailVerification` and `OAuthState` models**

At the end of `apps/server/app/models.py`, append:

```python
class EmailVerification(Base):
    """Pending email-verification record for the register flow
    (and any future password-reset flow via the `purpose` column).

    Only ONE row exists per (email, purpose) at a time: the router
    DELETEs any prior row before INSERTing a fresh one. A successful
    /auth/register also deletes the matching row, so the table never
    accumulates expired or "consumed but lingering" data.
    """

    __tablename__ = "email_verifications"

    id: Mapped[PyUUID] = _uuid_pk()
    email: Mapped[str] = mapped_column(Text, nullable=False)
    # bcrypt hash of the 6-digit code (never store the code itself).
    code_hash: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    sent_at: Mapped[datetime] = _now_column()
    purpose: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        Index(
            "ix_email_verifications_email_purpose",
            "email",
            "purpose",
        ),
    )


class OAuthState(Base):
    """Per-attempt PKCE state for Google sign-in.

    Inserted by /auth/google/start, deleted by /auth/google/callback
    on use. `redirect_uri` is recorded at start time because Google's
    token exchange validates that exchange's redirect_uri equals the
    authorize_url's; for desktop loopback the value is per-attempt.
    """

    __tablename__ = "oauth_states"

    id: Mapped[PyUUID] = _uuid_pk()
    state: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    code_verifier: Mapped[str] = mapped_column(Text, nullable=False)
    redirect_uri: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = _now_column()
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
```

- [ ] **Step 3: Verify imports still resolve**

Run from `apps/server`:

```bash
.venv/Scripts/python.exe -c "from app.models import User, EmailVerification, OAuthState; print('ok')"
```

Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add apps/server/app/models.py
git commit -m "feat(models): User.google_id + EmailVerification + OAuthState"
```

---

## Task 3: Settings additions

**Files:**
- Modify: `apps/server/app/settings.py`
- Modify: `.env.example`

- [ ] **Step 1: Extend `Settings`**

In `apps/server/app/settings.py`, add these fields inside the `Settings` class (right before `model_config`):

```python
    # --- Phase 11: email verification ---
    # When None, mail.send_verification() prints the code to stdout
    # instead of calling the Resend API (same pattern as the AI keys).
    resend_api_key: str | None = None
    mail_from: str = "FastQBank <onboarding@resend.dev>"

    # --- Phase 11: Google sign-in ---
    # When client_id is None, /auth/providers returns {"google": false}
    # and the frontend hides the button entirely.
    # OAuth client must be of type "Desktop" so the loopback IP
    # redirect_uri exception applies (any port on 127.0.0.1 is
    # accepted without console-side pre-registration). The same
    # client serves the web flow.
    google_client_id: str | None = None
    google_client_secret: str | None = None
    oauth_redirect_uri_web: str = "http://localhost:5173/oauth/callback"
```

- [ ] **Step 2: Extend `.env.example`**

Append to `.env.example` (at the end of the file):

```dotenv

# --- Phase 11: email verification (optional) ---
# Sign up at https://resend.com (free 100/day). Leave blank to print
# the verification code to the server console instead of sending mail.
RESEND_API_KEY=
MAIL_FROM=FastQBank <onboarding@resend.dev>

# --- Phase 11: Google sign-in (optional) ---
# Create an OAuth client at
# https://console.cloud.google.com/apis/credentials.
# Use client type "Desktop" — its loopback URI exception (any port
# on 127.0.0.1) is what makes desktop sign-in work without per-port
# registration. The same client also serves the web flow.
# Leave GOOGLE_CLIENT_ID blank to hide the "Continue with Google" button.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
OAUTH_REDIRECT_URI_WEB=http://localhost:5173/oauth/callback
```

- [ ] **Step 3: Verify settings load**

From `apps/server`:

```bash
.venv/Scripts/python.exe -c "from app.settings import get_settings; s = get_settings(); print(s.resend_api_key, s.google_client_id, s.oauth_redirect_uri_web)"
```

Expected (with defaults): `None None http://localhost:5173/oauth/callback`.

- [ ] **Step 4: Commit**

```bash
git add apps/server/app/settings.py .env.example
git commit -m "feat(server): phase 11 settings + .env.example"
```

---

## Task 4: requirements.txt — google-auth

**Files:**
- Modify: `apps/server/requirements.txt`

- [ ] **Step 1: Add the dependency**

In `apps/server/requirements.txt`, after the Stage-6 AI block (around the `Pillow~=11.0` line), add:

```
# --- Phase 11: Google sign-in (new) ---
# Verifies Google id_tokens locally (signature + audience + issuer);
# transitively pulls cryptography + requests, both already common deps.
google-auth~=2.34
```

- [ ] **Step 2: Install**

From `apps/server`:

```bash
.venv/Scripts/python.exe -m pip install -r requirements.txt
```

Expected: `Successfully installed google-auth-2.x.y` (plus its transitive deps).

- [ ] **Step 3: Verify import**

```bash
.venv/Scripts/python.exe -c "from google.oauth2 import id_token; from google.auth.transport import requests as _r; print('ok')"
```

Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add apps/server/requirements.txt
git commit -m "feat(server): add google-auth for id_token verification"
```

---

## Task 5: `mail.py` — pure formatters + send_verification

**Files:**
- Create: `apps/server/app/mail.py`

- [ ] **Step 1: Write the module**

Create `apps/server/app/mail.py`:

```python
"""Outbound email — Phase 11.

One public coroutine: `send_verification(email, code)`.

Provider is Resend (https://resend.com), called over plain HTTPS via
`httpx` (already a transitive dep of `openai`). No SDK on purpose —
keeps the dependency surface minimal.

When `settings.resend_api_key` is None the function prints the code
to stdout and returns; this mirrors the stage-6 AI fallback so local
dev (and CI) work without external credentials.
"""

from __future__ import annotations

import httpx

from app.settings import get_settings

# Module-level constants — shaped so tests can import them.
SUBJECT = "Your FastQBank verification code"
EXPIRY_MINUTES = 10
RESEND_URL = "https://api.resend.com/emails"


def format_text_body(code: str) -> str:
    """Plain-text body. Single trailing newline so MUAs render
    consistently."""
    return (
        f"Your FastQBank verification code is: {code}\n"
        f"It expires in {EXPIRY_MINUTES} minutes.\n"
        "If you did not request this, you can ignore this email.\n"
    )


def format_html_body(code: str) -> str:
    """Minimal HTML — no images, no external resources (keeps the
    spam score low). Inline styles only."""
    return (
        '<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;'
        'color:#0F172A;font-size:14px;line-height:1.5;">'
        '<p>Your FastQBank verification code is:</p>'
        '<p style="font-family:Consolas,Menlo,monospace;'
        'font-size:24px;letter-spacing:0.12em;'
        f'color:#1E3A8A;margin:8px 0;">{code}</p>'
        f"<p>It expires in {EXPIRY_MINUTES} minutes.</p>"
        '<p style="color:#64748B;">'
        "If you did not request this, you can ignore this email."
        "</p></div>"
    )


async def send_verification(
    email: str,
    code: str,
    *,
    client: httpx.AsyncClient | None = None,
) -> None:
    """Send a verification email; raise RuntimeError on failure.

    `client` is injectable so tests can pass an httpx MockTransport.
    """
    settings = get_settings()
    if settings.resend_api_key is None:
        # Local-dev stub — prints to stdout, returns quickly so the
        # caller flow stays functional.
        print(f"[MAIL STUB] code for {email}: {code}", flush=True)
        return

    payload = {
        "from": settings.mail_from,
        "to": [email],
        "subject": SUBJECT,
        "text": format_text_body(code),
        "html": format_html_body(code),
    }
    headers = {
        "Authorization": f"Bearer {settings.resend_api_key}",
        "Content-Type": "application/json",
    }

    owns_client = client is None
    if client is None:
        client = httpx.AsyncClient(timeout=10.0)
    try:
        resp = await client.post(RESEND_URL, json=payload, headers=headers)
    finally:
        if owns_client:
            await client.aclose()

    if resp.status_code >= 300:
        # The body usually contains a Resend error object; surface
        # it so the server log is actionable.
        raise RuntimeError(
            f"mail send failed: {resp.status_code} {resp.text}"
        )
```

- [ ] **Step 2: Commit**

```bash
git add apps/server/app/mail.py
git commit -m "feat(server): mail module (Resend + stub-mode fallback)"
```

---

## Task 6: `mail_test.py` — smoke tests

**Files:**
- Create: `apps/server/app/mail_test.py`

- [ ] **Step 1: Write the failing test**

Create `apps/server/app/mail_test.py`:

```python
"""Smoke-test the mail module without pulling in pytest.

Run: `.venv/Scripts/python.exe -m app.mail_test`
Exits 0 on success.
"""

from __future__ import annotations

import asyncio
import io
import sys

import httpx

from app import mail
from app.settings import get_settings


def test_format_text_body_has_code_and_expiry() -> None:
    body = mail.format_text_body("123456")
    assert "123456" in body, body
    assert "expires in 10 minutes" in body, body


def test_format_html_body_is_self_contained() -> None:
    body = mail.format_html_body("123456")
    assert "123456" in body
    # No external resources — keep deliverability high.
    assert "src=" not in body
    assert "href=" not in body


def test_stub_mode_prints_and_returns() -> None:
    settings = get_settings()
    assert settings.resend_api_key is None, (
        "this smoke test assumes RESEND_API_KEY is unset"
    )
    buf = io.StringIO()
    old_stdout = sys.stdout
    sys.stdout = buf
    try:
        asyncio.run(mail.send_verification("a@example.com", "654321"))
    finally:
        sys.stdout = old_stdout
    out = buf.getvalue()
    assert "[MAIL STUB]" in out
    assert "654321" in out
    assert "a@example.com" in out


def test_http_error_raises() -> None:
    """Patch the settings cache for the duration of this test."""
    from app.settings import Settings, get_settings

    get_settings.cache_clear()
    settings = get_settings()
    settings.resend_api_key = "test-key"  # type: ignore[misc]
    try:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(401, json={"message": "nope"})

        transport = httpx.MockTransport(handler)
        client = httpx.AsyncClient(transport=transport)

        async def run() -> None:
            try:
                await mail.send_verification(
                    "a@example.com", "111111", client=client
                )
            finally:
                await client.aclose()

        try:
            asyncio.run(run())
        except RuntimeError as e:
            assert "401" in str(e), str(e)
        else:
            raise AssertionError("expected RuntimeError")
    finally:
        # Restore — don't leak the fake key into other tests.
        settings.resend_api_key = None  # type: ignore[misc]
        get_settings.cache_clear()


def main() -> None:
    test_format_text_body_has_code_and_expiry()
    test_format_html_body_is_self_contained()
    test_stub_mode_prints_and_returns()
    test_http_error_raises()
    print("OK — mail smoke test")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the smoke test**

From `apps/server` (with `RESEND_API_KEY` unset):

```bash
.venv/Scripts/python.exe -m app.mail_test
```

Expected: prints two lines — `[MAIL STUB] code for a@example.com: 654321` then `OK — mail smoke test`. Exit code 0.

- [ ] **Step 3: Commit**

```bash
git add apps/server/app/mail_test.py
git commit -m "test(server): mail smoke tests (stub + http error)"
```

---

## Task 7: `oauth_google.py` — PKCE + URL builder + id_token verifier

**Files:**
- Create: `apps/server/app/oauth_google.py`

- [ ] **Step 1: Write the module**

Create `apps/server/app/oauth_google.py`:

```python
"""Google OAuth helpers — Phase 11.

Three concerns:
1. PKCE pair generation (verifier + S256 challenge).
2. Authorize-URL builder.
3. id_token exchange + verification.

Kept in one module so the router stays a thin orchestration layer.
The id_token verification is delegated to `google.oauth2.id_token`,
which fetches Google's JWKS once and caches it process-wide.
"""

from __future__ import annotations

import base64
import hashlib
import secrets
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

GOOGLE_AUTHORIZE_BASE = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"


@dataclass(frozen=True)
class PkcePair:
    verifier: str
    challenge: str


def make_pkce_pair() -> PkcePair:
    """Return a (verifier, S256-challenge) pair per RFC 7636.

    Verifier is 64 URL-safe chars (≈ 384 bits of entropy); the
    challenge is the URL-safe base64 of SHA-256(verifier) without
    padding.
    """
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    return PkcePair(verifier=verifier, challenge=challenge)


def build_authorize_url(
    *,
    client_id: str,
    redirect_uri: str,
    state: str,
    code_challenge: str,
) -> str:
    """Build the consent-screen URL for Google."""
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "prompt": "select_account",
        "access_type": "online",
    }
    return f"{GOOGLE_AUTHORIZE_BASE}?{urlencode(params)}"


async def exchange_code_for_id_token(
    *,
    code: str,
    code_verifier: str,
    redirect_uri: str,
    client_id: str,
    client_secret: str,
    client: httpx.AsyncClient | None = None,
) -> str:
    """POST the token endpoint, return the raw id_token JWT.

    `client` is injectable so tests can mock the HTTP layer.
    """
    payload = {
        "code": code,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
        "code_verifier": code_verifier,
    }
    owns = client is None
    if client is None:
        client = httpx.AsyncClient(timeout=10.0)
    try:
        resp = await client.post(GOOGLE_TOKEN_ENDPOINT, data=payload)
    finally:
        if owns:
            await client.aclose()
    if resp.status_code >= 300:
        raise RuntimeError(
            f"google token exchange failed: {resp.status_code} {resp.text}"
        )
    body = resp.json()
    tok = body.get("id_token")
    if not tok:
        raise RuntimeError(f"google token response missing id_token: {body}")
    return tok


@dataclass(frozen=True)
class GoogleIdentity:
    sub: str
    email: str
    email_verified: bool


def verify_id_token(token: str, *, audience: str) -> GoogleIdentity:
    """Verify the JWT against Google's JWKS (signature + iss + aud).

    Raises ValueError on any mismatch; otherwise returns the
    extracted identity claims.
    """
    request = google_requests.Request()
    claims = google_id_token.verify_oauth2_token(
        token, request, audience=audience
    )
    issuer = claims.get("iss")
    if issuer not in ("accounts.google.com", "https://accounts.google.com"):
        raise ValueError(f"unexpected issuer: {issuer}")
    sub = claims.get("sub")
    email = claims.get("email")
    email_verified = bool(claims.get("email_verified", False))
    if not sub or not email:
        raise ValueError("id_token missing sub or email")
    return GoogleIdentity(
        sub=str(sub), email=str(email), email_verified=email_verified
    )
```

- [ ] **Step 2: Commit**

```bash
git add apps/server/app/oauth_google.py
git commit -m "feat(server): Google OAuth helpers (PKCE + authorize URL + verifier)"
```

---

## Task 8: `oauth_google_test.py` — smoke tests

**Files:**
- Create: `apps/server/app/oauth_google_test.py`

- [ ] **Step 1: Write the smoke test**

Create `apps/server/app/oauth_google_test.py`:

```python
"""Smoke-test the Google OAuth helpers.

Run: `.venv/Scripts/python.exe -m app.oauth_google_test`
Exits 0 on success.

The id_token verifier is NOT exercised here (it would need to mock
google-auth's JWKS fetcher); it is covered by manual end-to-end
testing in Task 24.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
from urllib.parse import parse_qs, urlparse

import httpx

from app import oauth_google


def test_pkce_pair_is_well_formed() -> None:
    pair = oauth_google.make_pkce_pair()
    assert len(pair.verifier) >= 43, len(pair.verifier)
    # Two consecutive calls must not collide.
    assert pair.verifier != oauth_google.make_pkce_pair().verifier
    # Re-derive the challenge and confirm it matches.
    digest = hashlib.sha256(pair.verifier.encode("ascii")).digest()
    expected = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    assert pair.challenge == expected


def test_authorize_url_has_required_params() -> None:
    url = oauth_google.build_authorize_url(
        client_id="abc.apps.googleusercontent.com",
        redirect_uri="http://127.0.0.1:54321/oauth/callback",
        state="STATE_VALUE",
        code_challenge="CHALLENGE_VALUE",
    )
    parsed = urlparse(url)
    assert parsed.netloc == "accounts.google.com"
    assert parsed.path == "/o/oauth2/v2/auth"
    qs = {k: v[0] for k, v in parse_qs(parsed.query).items()}
    assert qs["client_id"] == "abc.apps.googleusercontent.com"
    assert qs["redirect_uri"] == "http://127.0.0.1:54321/oauth/callback"
    assert qs["response_type"] == "code"
    assert qs["state"] == "STATE_VALUE"
    assert qs["code_challenge"] == "CHALLENGE_VALUE"
    assert qs["code_challenge_method"] == "S256"
    assert "openid" in qs["scope"]
    assert "email" in qs["scope"]


def test_exchange_returns_id_token_on_200() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert (
            str(request.url)
            == "https://oauth2.googleapis.com/token"
        )
        return httpx.Response(200, json={"id_token": "FAKE.JWT.TOKEN"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    async def run() -> str:
        try:
            return await oauth_google.exchange_code_for_id_token(
                code="CODE",
                code_verifier="VERIFIER",
                redirect_uri="http://127.0.0.1:1/oauth/callback",
                client_id="cid",
                client_secret="cs",
                client=client,
            )
        finally:
            await client.aclose()

    tok = asyncio.run(run())
    assert tok == "FAKE.JWT.TOKEN"


def test_exchange_raises_on_non_2xx() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": "invalid_grant"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    async def run() -> None:
        try:
            await oauth_google.exchange_code_for_id_token(
                code="CODE",
                code_verifier="VERIFIER",
                redirect_uri="http://127.0.0.1:1/oauth/callback",
                client_id="cid",
                client_secret="cs",
                client=client,
            )
        finally:
            await client.aclose()

    try:
        asyncio.run(run())
    except RuntimeError as e:
        assert "400" in str(e)
    else:
        raise AssertionError("expected RuntimeError")


def main() -> None:
    test_pkce_pair_is_well_formed()
    test_authorize_url_has_required_params()
    test_exchange_returns_id_token_on_200()
    test_exchange_raises_on_non_2xx()
    print("OK — oauth_google smoke test")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it**

From `apps/server`:

```bash
.venv/Scripts/python.exe -m app.oauth_google_test
```

Expected: `OK — oauth_google smoke test`, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add apps/server/app/oauth_google_test.py
git commit -m "test(server): oauth_google smoke tests"
```

---

## Task 9: Schemas — request-code body, providers, Google start/callback

**Files:**
- Modify: `apps/server/app/schemas.py`

- [ ] **Step 1: Append the Phase 11 schemas**

At the end of `apps/server/app/schemas.py`, append:

```python
# ---------------------------------------------------------------------------
# Phase 11 — Email verification + Google sign-in
# ---------------------------------------------------------------------------


class RequestCodeIn(BaseModel):
    """Body for POST /auth/request-code.

    `purpose` is a Literal so the schema rejects unexpected values up
    front. Future flows (e.g. password reset) extend the literal.
    """

    email: EmailStr
    purpose: Literal["register"] = "register"


class ProvidersOut(BaseModel):
    """Response of GET /auth/providers.

    Drives the frontend's "show / hide Google button" decision so a
    misconfigured deploy doesn't render a broken control.
    """

    google: bool


class GoogleStartOut(BaseModel):
    """Response of GET /auth/google/start. The frontend opens
    `authorize_url` (window.location in web, shell.openExternal in
    desktop) and remembers `state` only as a sanity check — the real
    state→verifier map is server-side."""

    authorize_url: str
    state: str


class GoogleCallbackIn(BaseModel):
    """Body for POST /auth/google/callback."""

    code: str = Field(min_length=1)
    state: str = Field(min_length=1)
```

- [ ] **Step 2: Modify `RegisterIn` to require `code`**

In the same file, replace the existing `RegisterIn` block with:

```python
class RegisterIn(BaseModel):
    """Request body for POST /auth/register (Phase 11 onwards).

    `code` is the 6-digit verification code returned by a prior
    successful /auth/request-code for the same email + purpose
    'register'. Without it, register fails with 400.
    """

    email: EmailStr
    # 8..72: lower bound is a minimum strength; the 72 upper bound
    # mirrors bcrypt's byte limit so the user gets a clean 422
    # instead of silent truncation. (security.py still byte-truncates
    # as a safety net.)
    password: str = Field(min_length=8, max_length=72)
    code: str = Field(pattern=r"^\d{6}$")
```

- [ ] **Step 3: Verify import**

From `apps/server`:

```bash
.venv/Scripts/python.exe -c "from app.schemas import RequestCodeIn, ProvidersOut, GoogleStartOut, GoogleCallbackIn, RegisterIn; print('ok')"
```

Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add apps/server/app/schemas.py
git commit -m "feat(server): phase 11 schemas (RegisterIn.code, providers, google)"
```

---

## Task 10: Set up `auth_flow_test.py` bootstrap + cover `/auth/request-code`

**Files:**
- Create: `apps/server/app/auth_flow_test.py`
- Modify: `apps/server/app/routers/auth.py`

This task introduces both a reusable test bootstrap (sqlite-backed `TestClient`) and the first new endpoint covered by it.

- [ ] **Step 1: Write `auth_flow_test.py` with the bootstrap + the request-code tests (initially expected to fail)**

Create `apps/server/app/auth_flow_test.py`:

```python
"""End-to-end smoke tests for /auth/* (Phase 11).

Run: `.venv/Scripts/python.exe -m app.auth_flow_test`
Exits 0 on success.

Bootstrap: spin up the app against a fresh sqlite file so the test
is hermetic (the dev DB stays untouched). The Postgres-specific
defaults (gen_random_uuid, JSONB) only matter for tables this test
does NOT exercise, so the model_metadata.create_all path works on
sqlite for our purposes.
"""

from __future__ import annotations

import asyncio
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

# Configure env BEFORE importing the app — settings is cached.
_tmp = Path(tempfile.mkdtemp(prefix="aqb_test_"))
_dbfile = _tmp / "test.db"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_dbfile}"
os.environ["JWT_SECRET"] = "test-secret-not-for-prod"

# Clear cached settings (the .env loader may have run already).
from app.settings import get_settings  # noqa: E402

get_settings.cache_clear()

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app import mail  # noqa: E402
from app.db import Base, engine  # noqa: E402
from app.models import EmailVerification, User  # noqa: E402
from main import app  # noqa: E402


async def _reset_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)


def reset() -> None:
    asyncio.run(_reset_db())


_mailed: list[tuple[str, str]] = []


async def _capture_mail(email: str, code: str, **_kw) -> None:
    _mailed.append((email, code))


def _patch_mail() -> None:
    """Replace mail.send_verification with an in-memory capture so
    the tests can assert on what was sent without hitting Resend or
    stdout."""
    mail.send_verification = _capture_mail  # type: ignore[assignment]


# --- request-code -----------------------------------------------------------


def test_request_code_creates_row_and_calls_mailer() -> None:
    reset()
    _mailed.clear()
    _patch_mail()

    with TestClient(app) as client:
        r = client.post(
            "/auth/request-code",
            json={"email": "a@example.com", "purpose": "register"},
        )
    assert r.status_code == 204, (r.status_code, r.text)
    assert len(_mailed) == 1, _mailed
    sent_email, sent_code = _mailed[0]
    assert sent_email == "a@example.com"
    assert len(sent_code) == 6 and sent_code.isdigit()


def test_request_code_60s_cooldown_returns_429() -> None:
    reset()
    _mailed.clear()
    _patch_mail()

    with TestClient(app) as client:
        r1 = client.post(
            "/auth/request-code",
            json={"email": "b@example.com", "purpose": "register"},
        )
        assert r1.status_code == 204
        r2 = client.post(
            "/auth/request-code",
            json={"email": "b@example.com", "purpose": "register"},
        )
    assert r2.status_code == 429, (r2.status_code, r2.text)
    assert len(_mailed) == 1


def test_request_code_409_when_email_already_registered() -> None:
    """Pre-seed a user, then attempt to send a register code."""
    reset()
    _mailed.clear()
    _patch_mail()

    from app.db import async_session_maker
    from app.security import hash_password

    async def seed() -> None:
        async with async_session_maker() as s:
            s.add(
                User(
                    email="taken@example.com",
                    password_hash=hash_password("password123"),
                )
            )
            await s.commit()

    asyncio.run(seed())

    with TestClient(app) as client:
        r = client.post(
            "/auth/request-code",
            json={"email": "taken@example.com", "purpose": "register"},
        )
    assert r.status_code == 409, (r.status_code, r.text)
    assert _mailed == []


def main() -> None:
    test_request_code_creates_row_and_calls_mailer()
    test_request_code_60s_cooldown_returns_429()
    test_request_code_409_when_email_already_registered()
    print("OK — auth_flow request-code smoke test")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Check that `app.db` exposes `async_session_maker` (the test uses it)**

```bash
.venv/Scripts/python.exe -c "from app.db import async_session_maker; print(async_session_maker)"
```

Expected: prints the sessionmaker object. If the import fails (because `db.py` exposes a different name), open `apps/server/app/db.py` and confirm the actual symbol (it may be `SessionLocal` or `AsyncSessionLocal`). Update the test import accordingly before running the test.

- [ ] **Step 3: Verify the test fails because the endpoint doesn't exist yet**

```bash
.venv/Scripts/python.exe -m app.auth_flow_test
```

Expected: AssertionError on `r.status_code == 204` (FastAPI returns 404 for the missing route).

- [ ] **Step 4: Implement `/auth/request-code`**

Open `apps/server/app/routers/auth.py`. Replace the entire file with:

```python
"""Authentication endpoints — Phase 1 + Phase 11.

Phase 1:  /auth/register, /auth/login, /me
Phase 11: /auth/request-code, /auth/providers, /auth/google/{start,callback}

Conventions copied from routers/shares.py:
  - No router prefix; explicit paths.
  - slowapi limiter decorates the public anti-abuse endpoints with
    `@limiter.limit("...")` and takes `request: Request` as a param
    so slowapi can find the request object.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from secrets import randbelow
from typing import Literal
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import CurrentUser
from app.mail import send_verification
from app.models import EmailVerification, OAuthState, User
from app.oauth_google import (
    build_authorize_url,
    exchange_code_for_id_token,
    make_pkce_pair,
    verify_id_token,
)
from app.ratelimit import limiter
from app.schemas import (
    GoogleCallbackIn,
    GoogleStartOut,
    LoginIn,
    ProvidersOut,
    RegisterIn,
    RequestCodeIn,
    TokenOut,
    UserOut,
)
from app.security import create_access_token, hash_password, verify_password
from app.settings import get_settings

router = APIRouter(tags=["auth"])

# 6-digit decimal code, zero-padded so the prefix is always 6 chars.
def _new_code() -> str:
    return f"{randbelow(1_000_000):06d}"


CODE_TTL_MINUTES = 10
CODE_RESEND_SECONDS = 60
CODE_MAX_ATTEMPTS = 5


@router.post(
    "/auth/request-code",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
@limiter.limit("10/hour")
async def request_code(
    request: Request,
    body: RequestCodeIn,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Generate + email a 6-digit code; persist its bcrypt hash so
    /auth/register can verify it. Conflict (409) when the email is
    already a registered user; 429 when called again within 60s for
    the same (email, purpose)."""
    now = datetime.now(tz=timezone.utc)

    # Already-registered check (only meaningful for purpose=register).
    existing_user = await db.scalar(
        select(User).where(User.email == body.email)
    )
    if existing_user is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="email already registered",
        )

    # Per-(email,purpose) 60-second cooldown.
    prior = await db.scalar(
        select(EmailVerification).where(
            EmailVerification.email == body.email,
            EmailVerification.purpose == body.purpose,
        )
    )
    if prior is not None:
        elapsed = (now - prior.sent_at).total_seconds()
        if elapsed < CODE_RESEND_SECONDS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="please wait before requesting another code",
            )
        # Past cooldown — drop the old row so the unique-ish invariant
        # (one row per email+purpose) holds.
        await db.execute(
            delete(EmailVerification).where(
                EmailVerification.email == body.email,
                EmailVerification.purpose == body.purpose,
            )
        )

    code = _new_code()
    row = EmailVerification(
        email=body.email,
        code_hash=hash_password(code),
        expires_at=now + timedelta(minutes=CODE_TTL_MINUTES),
        attempts=0,
        sent_at=now,
        purpose=body.purpose,
    )
    db.add(row)
    await db.flush()  # surface DB errors before we hit the mailer

    try:
        await send_verification(body.email, code)
    except Exception as e:
        # Roll back the just-inserted row so the user can retry
        # immediately without the cooldown blocking them.
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="mail delivery failed",
        ) from e

    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/auth/register",
    response_model=TokenOut,
    status_code=status.HTTP_201_CREATED,
)
async def register(
    body: RegisterIn, db: AsyncSession = Depends(get_db)
) -> TokenOut:
    """Create the user only after a matching code has been verified.

    Code lifecycle:
      - missing            -> 400 verification required
      - expired            -> 400 code expired       (row deleted)
      - attempts >= 5      -> 400 too many attempts  (row deleted)
      - wrong code         -> 400 invalid code       (attempts ++)
      - correct code       -> row deleted, user created
    """
    now = datetime.now(tz=timezone.utc)

    row = await db.scalar(
        select(EmailVerification).where(
            EmailVerification.email == body.email,
            EmailVerification.purpose == "register",
        )
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="verification required",
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

    # Code is good — consume it.
    await db.delete(row)

    # Email uniqueness re-check (concurrent register).
    existing = await db.scalar(select(User).where(User.email == body.email))
    if existing is not None:
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="email already registered",
        )

    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return TokenOut(access_token=create_access_token(str(user.id)))


@router.post("/auth/login", response_model=TokenOut)
async def login(
    body: LoginIn, db: AsyncSession = Depends(get_db)
) -> TokenOut:
    user = await db.scalar(select(User).where(User.email == body.email))
    # Same response for: no such email / wrong password / Google-only
    # account (password_hash is NULL). Prevents probing.
    if (
        user is None
        or user.password_hash is None
        or not verify_password(body.password, user.password_hash)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid email or password",
        )
    return TokenOut(access_token=create_access_token(str(user.id)))


@router.get("/me", response_model=UserOut)
async def me(current_user: CurrentUser) -> User:
    return current_user


@router.get("/auth/providers", response_model=ProvidersOut)
async def providers() -> ProvidersOut:
    settings = get_settings()
    return ProvidersOut(google=bool(settings.google_client_id))


# --- Google OAuth ----------------------------------------------------------


_LOOPBACK_REDIRECT_PREFIXES = (
    "http://127.0.0.1:",
    "http://localhost:",
)


def _validate_redirect_uri(platform: str, supplied: str | None) -> str:
    settings = get_settings()
    if platform == "web":
        return settings.oauth_redirect_uri_web
    if platform == "desktop":
        if not supplied:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="redirect_uri required for desktop",
            )
        ok = any(supplied.startswith(p) for p in _LOOPBACK_REDIRECT_PREFIXES)
        try:
            parsed = urlparse(supplied)
        except ValueError:
            ok = False
        if not ok or parsed.path != "/oauth/callback":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="invalid redirect_uri",
            )
        return supplied
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="unknown platform",
    )


@router.get("/auth/google/start", response_model=GoogleStartOut)
async def google_start(
    platform: Literal["web", "desktop"],
    redirect_uri: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> GoogleStartOut:
    settings = get_settings()
    if not settings.google_client_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="google sign-in not configured",
        )

    resolved = _validate_redirect_uri(platform, redirect_uri)

    pair = make_pkce_pair()
    import secrets as _secrets

    state = _secrets.token_urlsafe(32)
    now = datetime.now(tz=timezone.utc)
    db.add(
        OAuthState(
            state=state,
            code_verifier=pair.verifier,
            redirect_uri=resolved,
            expires_at=now + timedelta(minutes=5),
        )
    )
    await db.commit()

    authorize_url = build_authorize_url(
        client_id=settings.google_client_id,
        redirect_uri=resolved,
        state=state,
        code_challenge=pair.challenge,
    )
    return GoogleStartOut(authorize_url=authorize_url, state=state)


@router.post("/auth/google/callback", response_model=TokenOut)
async def google_callback(
    body: GoogleCallbackIn, db: AsyncSession = Depends(get_db)
) -> TokenOut:
    settings = get_settings()
    if not settings.google_client_id or not settings.google_client_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="google sign-in not configured",
        )

    row = await db.scalar(
        select(OAuthState).where(OAuthState.state == body.state)
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid state",
        )
    now = datetime.now(tz=timezone.utc)
    expires_at = row.expires_at
    redirect_uri = row.redirect_uri
    code_verifier = row.code_verifier
    await db.delete(row)
    await db.commit()
    if expires_at < now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid state",
        )

    try:
        token = await exchange_code_for_id_token(
            code=body.code,
            code_verifier=code_verifier,
            redirect_uri=redirect_uri,
            client_id=settings.google_client_id,
            client_secret=settings.google_client_secret,
        )
        identity = verify_id_token(
            token, audience=settings.google_client_id
        )
    except (RuntimeError, ValueError) as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"token exchange failed: {e}",
        ) from e
    if not identity.email_verified:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="google email not verified",
        )

    user = await db.scalar(
        select(User).where(User.email == identity.email)
    )
    if user is None:
        user = User(
            email=identity.email,
            password_hash=None,
            google_id=identity.sub,
        )
        db.add(user)
    else:
        if user.google_id is None:
            user.google_id = identity.sub
        elif user.google_id != identity.sub:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="account conflict",
            )
    await db.commit()
    await db.refresh(user)
    return TokenOut(access_token=create_access_token(str(user.id)))
```

- [ ] **Step 5: Re-run the smoke test**

```bash
.venv/Scripts/python.exe -m app.auth_flow_test
```

Expected: `OK — auth_flow request-code smoke test`, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add apps/server/app/routers/auth.py apps/server/app/auth_flow_test.py
git commit -m "feat(auth): /auth/request-code with cooldown + 409 + mailer stub"
```

---

## Task 11: End-to-end tests for the modified `/auth/register`

**Files:**
- Modify: `apps/server/app/auth_flow_test.py`

(The endpoint code already landed in Task 10; this task only adds coverage.)

- [ ] **Step 1: Add the new test functions**

In `apps/server/app/auth_flow_test.py`, append (before `def main()`):

```python
# --- register ---------------------------------------------------------------


def test_register_without_code_returns_400() -> None:
    reset()
    _mailed.clear()
    _patch_mail()
    with TestClient(app) as client:
        r = client.post(
            "/auth/register",
            json={
                "email": "x@example.com",
                "password": "longenough",
                "code": "123456",
            },
        )
    assert r.status_code == 400, (r.status_code, r.text)
    assert "verification required" in r.json()["detail"]


def test_register_wrong_code_increments_attempts() -> None:
    reset()
    _mailed.clear()
    _patch_mail()
    with TestClient(app) as client:
        r1 = client.post(
            "/auth/request-code",
            json={"email": "y@example.com", "purpose": "register"},
        )
        assert r1.status_code == 204
        sent_code = _mailed[-1][1]
        bad = "000000" if sent_code != "000000" else "111111"
        r2 = client.post(
            "/auth/register",
            json={
                "email": "y@example.com",
                "password": "longenough",
                "code": bad,
            },
        )
    assert r2.status_code == 400
    assert "invalid code" in r2.json()["detail"]


def test_register_success_creates_user_and_deletes_verification() -> None:
    reset()
    _mailed.clear()
    _patch_mail()
    with TestClient(app) as client:
        client.post(
            "/auth/request-code",
            json={"email": "z@example.com", "purpose": "register"},
        )
        code = _mailed[-1][1]
        r = client.post(
            "/auth/register",
            json={
                "email": "z@example.com",
                "password": "longenough",
                "code": code,
            },
        )
    assert r.status_code == 201, (r.status_code, r.text)
    body = r.json()
    assert body["token_type"] == "bearer"
    assert isinstance(body["access_token"], str)

    # Verification row must be gone.
    from app.db import async_session_maker

    async def check() -> None:
        async with async_session_maker() as s:
            row = await s.scalar(
                select(EmailVerification).where(
                    EmailVerification.email == "z@example.com"
                )
            )
            assert row is None
            user = await s.scalar(
                select(User).where(User.email == "z@example.com")
            )
            assert user is not None and user.password_hash is not None

    asyncio.run(check())


def test_register_then_login_with_password_succeeds() -> None:
    reset()
    _mailed.clear()
    _patch_mail()
    with TestClient(app) as client:
        client.post(
            "/auth/request-code",
            json={"email": "w@example.com", "purpose": "register"},
        )
        code = _mailed[-1][1]
        client.post(
            "/auth/register",
            json={
                "email": "w@example.com",
                "password": "longenough",
                "code": code,
            },
        )
        r = client.post(
            "/auth/login",
            json={"email": "w@example.com", "password": "longenough"},
        )
    assert r.status_code == 200, (r.status_code, r.text)
    assert r.json()["token_type"] == "bearer"
```

Update `main()` to call the new tests:

```python
def main() -> None:
    test_request_code_creates_row_and_calls_mailer()
    test_request_code_60s_cooldown_returns_429()
    test_request_code_409_when_email_already_registered()
    test_register_without_code_returns_400()
    test_register_wrong_code_increments_attempts()
    test_register_success_creates_user_and_deletes_verification()
    test_register_then_login_with_password_succeeds()
    print("OK — auth_flow register smoke test")
```

- [ ] **Step 2: Run**

```bash
.venv/Scripts/python.exe -m app.auth_flow_test
```

Expected: `OK — auth_flow register smoke test`.

- [ ] **Step 3: Commit**

```bash
git add apps/server/app/auth_flow_test.py
git commit -m "test(auth): register flow e2e (verify required, wrong code, success, login)"
```

---

## Task 12: Coverage for `/auth/providers`, `/auth/google/start`, login null-hash

**Files:**
- Modify: `apps/server/app/auth_flow_test.py`

- [ ] **Step 1: Add the test functions**

Append to `apps/server/app/auth_flow_test.py` before `main()`:

```python
# --- providers + google/start ----------------------------------------------


def test_providers_returns_false_when_unconfigured() -> None:
    reset()
    s = get_settings()
    assert s.google_client_id is None
    with TestClient(app) as client:
        r = client.get("/auth/providers")
    assert r.status_code == 200
    assert r.json() == {"google": False}


def test_providers_returns_true_when_client_id_set() -> None:
    reset()
    s = get_settings()
    s.google_client_id = "test.apps.googleusercontent.com"  # type: ignore[misc]
    try:
        with TestClient(app) as client:
            r = client.get("/auth/providers")
        assert r.status_code == 200
        assert r.json() == {"google": True}
    finally:
        s.google_client_id = None  # type: ignore[misc]


def test_google_start_rejects_bad_desktop_redirect() -> None:
    reset()
    s = get_settings()
    s.google_client_id = "cid"  # type: ignore[misc]
    s.google_client_secret = "cs"  # type: ignore[misc]
    try:
        with TestClient(app) as client:
            r = client.get(
                "/auth/google/start",
                params={
                    "platform": "desktop",
                    "redirect_uri": "https://attacker.example.com/x",
                },
            )
        assert r.status_code == 400, (r.status_code, r.text)
        assert "invalid redirect_uri" in r.json()["detail"]
    finally:
        s.google_client_id = None  # type: ignore[misc]
        s.google_client_secret = None  # type: ignore[misc]


def test_google_start_accepts_loopback_and_stores_state() -> None:
    reset()
    s = get_settings()
    s.google_client_id = "cid"  # type: ignore[misc]
    s.google_client_secret = "cs"  # type: ignore[misc]
    try:
        with TestClient(app) as client:
            r = client.get(
                "/auth/google/start",
                params={
                    "platform": "desktop",
                    "redirect_uri": "http://127.0.0.1:54321/oauth/callback",
                },
            )
        assert r.status_code == 200
        body = r.json()
        assert body["authorize_url"].startswith(
            "https://accounts.google.com/o/oauth2/v2/auth?"
        )
        assert body["state"]
        # The state row should exist.
        from app.db import async_session_maker
        from app.models import OAuthState

        async def check() -> None:
            async with async_session_maker() as ss:
                row = await ss.scalar(
                    select(OAuthState).where(OAuthState.state == body["state"])
                )
                assert row is not None
                assert (
                    row.redirect_uri
                    == "http://127.0.0.1:54321/oauth/callback"
                )

        asyncio.run(check())
    finally:
        s.google_client_id = None  # type: ignore[misc]
        s.google_client_secret = None  # type: ignore[misc]


# --- login (Google-only account is rejected by password login) -------------


def test_login_rejects_google_only_account() -> None:
    reset()
    from app.db import async_session_maker

    async def seed() -> None:
        async with async_session_maker() as ss:
            ss.add(
                User(
                    email="goog@example.com",
                    password_hash=None,
                    google_id="abc",
                )
            )
            await ss.commit()

    asyncio.run(seed())
    with TestClient(app) as client:
        r = client.post(
            "/auth/login",
            json={"email": "goog@example.com", "password": "whatever1"},
        )
    assert r.status_code == 401, (r.status_code, r.text)
```

Update `main()`:

```python
def main() -> None:
    test_request_code_creates_row_and_calls_mailer()
    test_request_code_60s_cooldown_returns_429()
    test_request_code_409_when_email_already_registered()
    test_register_without_code_returns_400()
    test_register_wrong_code_increments_attempts()
    test_register_success_creates_user_and_deletes_verification()
    test_register_then_login_with_password_succeeds()
    test_providers_returns_false_when_unconfigured()
    test_providers_returns_true_when_client_id_set()
    test_google_start_rejects_bad_desktop_redirect()
    test_google_start_accepts_loopback_and_stores_state()
    test_login_rejects_google_only_account()
    print("OK — auth_flow full smoke test")
```

- [ ] **Step 2: Run**

```bash
.venv/Scripts/python.exe -m app.auth_flow_test
```

Expected: `OK — auth_flow full smoke test`.

- [ ] **Step 3: Commit**

```bash
git add apps/server/app/auth_flow_test.py
git commit -m "test(auth): providers, google/start validation, login rejects google-only"
```

---

## Task 13: Wire `/auth/google/callback` auto-merge — manual test only

The callback endpoint code landed in Task 10, but its automated test would need to stub Google's token endpoint + JWKS — `verify_id_token` calls into `google-auth` which fetches Google's public keys at runtime. We keep the smoke suite hermetic and rely on Task 24's manual end-to-end pass for this endpoint.

- [ ] **Step 1: Sanity-check the route is mounted**

```bash
.venv/Scripts/python.exe -c "from main import app; print(sorted({r.path for r in app.routes if hasattr(r, 'path')}))"
```

Expected: the printed list includes `/auth/google/callback` and `/auth/google/start`.

- [ ] **Step 2: Note the manual coverage required**

Add a short comment block at the very top of `apps/server/app/routers/auth.py` (just below the existing docstring) noting why callback isn't in `auth_flow_test.py`:

```python
# /auth/google/callback is NOT covered by app/auth_flow_test.py because
# google-auth's id_token verifier fetches Google JWKS at call time;
# stubbing it would require monkey-patching internal symbols. See the
# manual end-to-end checklist in the Phase 11 plan (Task 24).
```

(Insert it after the module docstring, before the imports.)

- [ ] **Step 3: Commit**

```bash
git add apps/server/app/routers/auth.py
git commit -m "docs(auth): note manual coverage path for google/callback"
```

---

## Task 14: `AuthContext` fetches `/auth/providers` once

**Files:**
- Modify: `apps/web/src/auth/AuthContext.tsx`

- [ ] **Step 1: Update the context**

Replace the file body with:

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  UNAUTHORIZED_EVENT,
  apiFetch,
  clearToken,
  getToken,
  setToken as persistToken,
} from "../lib/api";

interface Providers {
  google: boolean;
}

interface AuthContextValue {
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string) => void;
  logout: () => void;
  /** Server-side feature flags. Null until the first /auth/providers
   *  fetch resolves; consumers should treat null as "still loading,
   *  hide the optional button for now". */
  providers: Providers | null;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [providers, setProviders] = useState<Providers | null>(null);

  const login = useCallback((newToken: string) => {
    persistToken(newToken);
    setTokenState(newToken);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setTokenState(null);
  }, []);

  useEffect(() => {
    const onUnauthorized = () => setTokenState(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () =>
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiFetch<Providers>("/auth/providers")
      .then((p) => {
        if (!cancelled) setProviders(p);
      })
      .catch(() => {
        // Network/CORS error: hide the optional button rather than
        // render a broken control.
        if (!cancelled) setProviders({ google: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      isAuthenticated: token !== null,
      login,
      logout,
      providers,
    }),
    [token, login, logout, providers],
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
```

- [ ] **Step 2: Typecheck**

From `apps/web`:

```bash
pnpm tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/auth/AuthContext.tsx
git commit -m "feat(web): AuthContext fetches /auth/providers"
```

---

## Task 15: `lib/oauth.ts` — shared `completeOAuthCallback`

**Files:**
- Create: `apps/web/src/lib/oauth.ts`

- [ ] **Step 1: Write the helper**

Create `apps/web/src/lib/oauth.ts`:

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/oauth.ts
git commit -m "feat(web): completeOAuthCallback helper"
```

---

## Task 16: `GoogleSignInButton` component — web flow only (desktop wired in Task 23)

**Files:**
- Create: `apps/web/src/components/auth/GoogleSignInButton.tsx`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/auth/GoogleSignInButton.tsx`:

```tsx
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

  if (providers === null || !providers.google) return null;

  async function onClick() {
    setErr(null);
    setSubmitting(true);
    try {
      const desktop = getDesktop();
      if (desktop) {
        // Desktop branch — Task 23 wires this. For now, surface a
        // clear error so the button never appears to do nothing.
        setErr("Desktop Google sign-in not yet wired.");
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
```

- [ ] **Step 2: Typecheck**

```bash
pnpm tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/auth/GoogleSignInButton.tsx
git commit -m "feat(web): GoogleSignInButton (web branch + desktop stub)"
```

---

## Task 17: `OAuthCallbackPage` + route in `App.tsx`

**Files:**
- Create: `apps/web/src/pages/OAuthCallbackPage.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Create the page**

Create `apps/web/src/pages/OAuthCallbackPage.tsx`:

```tsx
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

const BUILD_TAG = "v0.9.0";

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
```

- [ ] **Step 2: Register the route**

In `apps/web/src/App.tsx`, add the import:

```tsx
import OAuthCallbackPage from "./pages/OAuthCallbackPage";
```

Add the route inside the `<Routes>` block, right after the `/register` route block:

```tsx
          <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
```

- [ ] **Step 3: Typecheck**

```bash
pnpm tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/OAuthCallbackPage.tsx apps/web/src/App.tsx
git commit -m "feat(web): /oauth/callback route + page"
```

---

## Task 18: `LoginPage` — wire the Google button

**Files:**
- Modify: `apps/web/src/pages/LoginPage.tsx`

- [ ] **Step 1: Import and place the button**

In `apps/web/src/pages/LoginPage.tsx`:

1. Add the import near the other component imports:

```tsx
import GoogleSignInButton from "../components/auth/GoogleSignInButton";
```

2. Find the existing submit button (the `<button type="submit"…>` block), and immediately AFTER its closing `</button>` (BEFORE the `<p className="mt-5 font-mono text-[12px] text-slate-600">` block that says "need an account?"), insert:

```tsx
          <GoogleSignInButton mode="signin" />
```

- [ ] **Step 2: Typecheck**

```bash
pnpm tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/LoginPage.tsx
git commit -m "feat(web): LoginPage shows Google sign-in button"
```

---

## Task 19: `RegisterPage` — two-step state machine + confirm password + Google

**Files:**
- Modify: `apps/web/src/pages/RegisterPage.tsx`

This is the largest UI change. Replace the file body from line 6 (`import { useState … }`) downward.

- [ ] **Step 1: Replace the imports and component**

Open `apps/web/src/pages/RegisterPage.tsx` and replace its full contents with:

```tsx
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
```

- [ ] **Step 2: Typecheck**

```bash
pnpm tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manual smoke**

From `apps/web`:

```bash
pnpm dev
```

In a separate shell from `apps/server`:

```bash
.venv/Scripts/python.exe -m uvicorn main:app --reload
```

Navigate to `http://localhost:5173/register`:
- Step 1 has email field only.
- Submit → if the server has no `RESEND_API_KEY`, the verification code prints in the uvicorn log. Page switches to Step 2.
- Step 2 shows code/password/confirm. Confirm-password mismatch displays "passwords do not match" red text on blur.
- Submit with the code from the log → land on `/questions` logged in.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/RegisterPage.tsx
git commit -m "feat(web): two-step RegisterPage (email → code+password+confirm)"
```

---

## Task 20: Desktop — extend IPC channel names

**Files:**
- Modify: `apps/desktop/src/ipc.ts`

- [ ] **Step 1: Add three channel names + register them**

Open `apps/desktop/src/ipc.ts`. Add to the `// Direction…` comment block (just before the existing direction comments end) three new lines:

```
//   r->m   oauthOpenExternal main process opens authorize URL in default browser
//   r->m   oauthStartLoopback main process starts the one-shot 127.0.0.1 server, returns its port
//   m->r   oauthCallback     forwarded {code,state} from the loopback handler
```

Then add to the `IPC` const literal:

```ts
  oauthOpenExternal: "oauth:open-external",
  oauthStartLoopback: "oauth:start-loopback",
  oauthCallback: "oauth:callback",
```

Extend the `IpcDeps` interface — add (at the end, before the closing `}`):

```ts
  /** Validate + shell.openExternal(url) for Google OAuth start. */
  onOauthOpenExternal: (url: string) => void;
  /** Start a single-shot loopback server; resolves to { port }; the
   *  caller is responsible for sending {code,state} to the renderer
   *  via IPC.oauthCallback once the callback arrives. */
  onOauthStartLoopback: () => Promise<{ port: number }>;
```

Extend the `registerIpc` body — add at the end (after the existing handlers):

```ts
  ipcMain.on(IPC.oauthOpenExternal, (_e, url: string) =>
    deps.onOauthOpenExternal(url),
  );
  ipcMain.handle(IPC.oauthStartLoopback, () =>
    deps.onOauthStartLoopback(),
  );
```

- [ ] **Step 2: Typecheck**

From the repo root or `apps/desktop`:

```bash
pnpm --filter desktop tsc --noEmit
```

(Or `pnpm -C apps/desktop tsc --noEmit` if the workspace command isn't set up.)
Expected: no errors. (TypeScript will flag `main.ts` for not implementing the new `IpcDeps` props yet — that's expected and will be fixed in Task 22.)

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/ipc.ts
git commit -m "feat(desktop): IPC channel names for OAuth loopback flow"
```

---

## Task 21: Desktop — `oauth.ts` module (loopback server + openExternal whitelist)

**Files:**
- Create: `apps/desktop/src/oauth.ts`

- [ ] **Step 1: Write the module**

Create `apps/desktop/src/oauth.ts`:

```ts
// Phase 11 — Google OAuth helpers running in the Electron main
// process.
//
// startLoopbackOnce() — bind a single-use http server to 127.0.0.1:0,
//   capture the FIRST GET to /oauth/callback?code&state, respond with
//   a static "you can close this window" page, then close the server.
//   Times out after 5 minutes so a forgotten flow doesn't leak a
//   listener. Returns the OS-assigned port and a promise that
//   resolves with { code, state }.
//
// openGoogleAuthUrl() — only opens URLs whose origin is
//   https://accounts.google.com. The whitelist keeps a compromised
//   renderer from using this IPC to launch arbitrary protocols.

import { shell } from "electron";
import http from "node:http";

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
const ALLOWED_AUTH_ORIGIN = "https://accounts.google.com";

export interface LoopbackHandle {
  port: number;
  awaitCallback: Promise<{ code: string; state: string }>;
}

export async function startLoopbackOnce(): Promise<LoopbackHandle> {
  let resolve!: (v: { code: string; state: string }) => void;
  let reject!: (e: Error) => void;
  const awaitCallback = new Promise<{ code: string; state: string }>(
    (res, rej) => {
      resolve = res;
      reject = rej;
    },
  );

  const server = http.createServer((req, res) => {
    if (!req.url) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname !== "/oauth/callback") {
      res.statusCode = 404;
      res.end();
      return;
    }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) {
      res.statusCode = 400;
      res.end("missing code or state");
      return;
    }
    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(
      '<!doctype html><html><body style="font-family:system-ui;padding:24px;">' +
        "<h2>You can close this window.</h2>" +
        "<p>Returning to FastQBank…</p></body></html>",
    );
    resolve({ code, state });
    // Close after the response is flushed.
    server.close();
  });

  await new Promise<void>((res, rej) => {
    server.once("error", rej);
    server.listen(0, "127.0.0.1", () => res());
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    server.close();
    throw new Error("could not determine loopback port");
  }
  const port = addr.port;

  const timeout = setTimeout(() => {
    server.close();
    reject(new Error("oauth loopback timeout"));
  }, CALLBACK_TIMEOUT_MS);

  // Ensure the timer doesn't keep Electron alive past the resolve.
  awaitCallback.finally(() => clearTimeout(timeout));

  return { port, awaitCallback };
}

export function openGoogleAuthUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("invalid url");
  }
  if (parsed.origin !== ALLOWED_AUTH_ORIGIN) {
    throw new Error(`refused to open URL outside ${ALLOWED_AUTH_ORIGIN}`);
  }
  void shell.openExternal(url);
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm -C apps/desktop tsc --noEmit
```

Expected: no errors (main.ts still flagged — Task 22 fixes).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/oauth.ts
git commit -m "feat(desktop): loopback OAuth server + openExternal whitelist"
```

---

## Task 22: Desktop — wire OAuth in `main.ts`

**Files:**
- Modify: `apps/desktop/src/main.ts`

- [ ] **Step 1: Import the new helpers**

In `apps/desktop/src/main.ts`, add to the imports near the top:

```ts
import { openGoogleAuthUrl, startLoopbackOnce } from "./oauth";
```

- [ ] **Step 2: Extend the `registerIpc(...)` call inside `app.whenReady().then(...)`**

Find the existing call:

```ts
    registerIpc({
      onTrigger: captureAndRecognize,
      getSidecarState,
      getMainWindow: () => mainWindow,
    });
```

Replace with:

```ts
    registerIpc({
      onTrigger: captureAndRecognize,
      getSidecarState,
      getMainWindow: () => mainWindow,
      onOauthOpenExternal: (url: string) => {
        try {
          openGoogleAuthUrl(url);
        } catch (e) {
          process.stderr.write(
            `[oauth] refused to open url: ${e instanceof Error ? e.message : e}\n`,
          );
        }
      },
      onOauthStartLoopback: async () => {
        const handle = await startLoopbackOnce();
        // Forward the callback to the renderer as soon as it arrives;
        // we don't keep a reference here.
        void handle.awaitCallback
          .then((payload) => {
            mainWindow?.webContents.send(IPC.oauthCallback, payload);
          })
          .catch((e) => {
            process.stderr.write(
              `[oauth] loopback failed: ${e instanceof Error ? e.message : e}\n`,
            );
          });
        return { port: handle.port };
      },
    });
```

- [ ] **Step 3: Typecheck**

```bash
pnpm -C apps/desktop tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main.ts
git commit -m "feat(desktop): register OAuth IPC handlers in main"
```

---

## Task 23: Desktop — preload bridge + `lib/desktop.ts` types + GoogleSignInButton desktop branch + App.tsx subscription

This task spans preload + the renderer side so the desktop flow lands as one coherent commit.

**Files:**
- Modify: `apps/desktop/src/preload.ts`
- Modify: `apps/web/src/lib/desktop.ts`
- Modify: `apps/web/src/components/auth/GoogleSignInButton.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Extend the preload bridge**

In `apps/desktop/src/preload.ts`, add at the END of the `contextBridge.exposeInMainWorld("desktop", { … })` object literal (after the `window: { … }` block, with a comma before it):

```ts
  // Phase 11 — Google OAuth via a single-use loopback server in the
  // main process. The renderer calls startLoopback BEFORE opening the
  // browser so there is no race against the inbound callback.
  oauth: {
    startLoopback: (): Promise<{ port: number }> =>
      ipcRenderer.invoke("oauth:start-loopback"),
    openExternal: (url: string) =>
      ipcRenderer.send("oauth:open-external", url),
    onCallback: (cb: Listener<{ code: string; state: string }>) =>
      sub<{ code: string; state: string }>("oauth:callback", cb),
  },
```

- [ ] **Step 2: Extend the type bridge**

In `apps/web/src/lib/desktop.ts`, add inside the `DesktopBridge` interface (after the `window: { … }` block):

```ts
  /** Phase 11 — Google OAuth via loopback server. */
  oauth: {
    startLoopback(): Promise<{ port: number }>;
    openExternal(url: string): void;
    onCallback(
      cb: (payload: { code: string; state: string }) => void,
    ): () => void;
  };
```

- [ ] **Step 3: Wire the desktop branch in `GoogleSignInButton`**

In `apps/web/src/components/auth/GoogleSignInButton.tsx`, find the `if (desktop) { … }` block inside `onClick` and replace its body with:

```tsx
      if (desktop) {
        const { port } = await desktop.oauth.startLoopback();
        const redirect_uri = `http://127.0.0.1:${port}/oauth/callback`;
        const out = await apiFetch<StartOut>(
          `/auth/google/start?platform=desktop&redirect_uri=${encodeURIComponent(redirect_uri)}`,
        );
        desktop.oauth.openExternal(out.authorize_url);
        return;
      }
```

(The actual `oauth:callback` IPC is handled in App.tsx — see Step 4 — because subscription survives even if the user navigates between auth pages while waiting for the callback.)

- [ ] **Step 4: Subscribe to the OAuth callback in `App.tsx`**

In `apps/web/src/App.tsx`, replace the body with:

```tsx
import { useEffect, type ReactNode } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { RequireAuth } from "./auth/RequireAuth";
import AppLayout from "./components/AppLayout";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import OAuthCallbackPage from "./pages/OAuthCallbackPage";
import QuestionListPage from "./pages/QuestionListPage";
import QuestionFormPage from "./pages/QuestionFormPage";
import ReviewEntryPage from "./pages/ReviewEntryPage";
import ReviewSessionPage from "./pages/ReviewSessionPage";
import { getDesktop } from "./lib/desktop";
import { completeOAuthCallback } from "./lib/oauth";

function PublicOnly({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Navigate to="/" replace /> : <>{children}</>;
}

/** Listens for the desktop main-process IPC carrying the OAuth
 *  callback. Lives inside AuthProvider so it can call login(). */
function DesktopOAuthListener() {
  const { login } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    const desktop = getDesktop();
    if (!desktop) return;
    const unsubscribe = desktop.oauth.onCallback(async ({ code, state }) => {
      try {
        const token = await completeOAuthCallback(code, state);
        login(token);
        navigate("/", { replace: true });
      } catch (e) {
        console.error("[oauth] callback failed", e);
      }
    });
    return unsubscribe;
  }, [login, navigate]);
  return null;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <DesktopOAuthListener />
        <Routes>
          <Route
            path="/login"
            element={
              <PublicOnly>
                <LoginPage />
              </PublicOnly>
            }
          />
          <Route
            path="/register"
            element={
              <PublicOnly>
                <RegisterPage />
              </PublicOnly>
            }
          />
          <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
          <Route
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/questions" replace />} />
            <Route path="/questions" element={<QuestionListPage />} />
            <Route path="/questions/new" element={<QuestionFormPage />} />
            <Route
              path="/questions/:id/edit"
              element={<QuestionFormPage />}
            />
            <Route path="/review" element={<ReviewEntryPage />} />
            <Route path="/review/session" element={<ReviewSessionPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
```

- [ ] **Step 5: Typecheck both packages**

```bash
pnpm -C apps/desktop tsc --noEmit
pnpm -C apps/web tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/preload.ts apps/web/src/lib/desktop.ts \
        apps/web/src/components/auth/GoogleSignInButton.tsx \
        apps/web/src/App.tsx
git commit -m "feat: desktop OAuth bridge (preload + GoogleSignInButton + App listener)"
```

---

## Task 24: Manual end-to-end verification + Roadmap update

This is the last task. No new code; just exercising every path and recording the outcome.

**Files:**
- Modify: `docs/Roadmap_CN.md`
- Modify: `docs/Roadmap_EN.md`

Prereqs:
- Postgres running (`docker compose up -d db`).
- `apps/server/.venv` activated, migrations applied: `python -m alembic upgrade head`.
- (Optional but recommended) `RESEND_API_KEY` filled in `.env`.
- (Required for Google checks) `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` filled in `.env`.

For each item below, run the action and check the OUTCOME. Open the existing dev server (`pnpm -C apps/web dev`) and uvicorn (`.venv/Scripts/python.exe -m uvicorn main:app --reload`).

- [ ] **1. Step 1 → 2 → 3 happy path (stub mode)**

`RESEND_API_KEY` blank. Register a fresh email. Expect the uvicorn log to print `[MAIL STUB] code for <email>: <code>`. Step 2 fills in. Submit → land on `/questions`.

- [ ] **2. 60-second cooldown**

In Step 1, request a code, go back via `[ change ]`, immediately request again. Expect the error: `Please wait a moment before requesting another code.`

- [ ] **3. Already-registered email → 409**

Register A. Log out. Go to `/register`, type A's email, request code. Expect: `Already registered. Sign in instead.`

- [ ] **4. Password mismatch on confirm field**

In Step 2, type two different passwords. On confirm blur, expect red border and `passwords do not match` line. Submit button disabled.

- [ ] **5. Wrong code 5×**

Request a code, enter `999999` five times (assuming the printed code isn't `999999`). Expect: first four show `Invalid code — try again.`; the fifth show `Too many attempts. Please request a new code.` and snaps back to Step 1.

- [ ] **6. Expired code**

Request a code, then in psql: `UPDATE email_verifications SET expires_at = now() - interval '1 minute' WHERE email='<your-email>';`. Submit the code in Step 2. Expect: `Code expired. Please request a new one.` and snap back to Step 1.

- [ ] **7. Google button hidden when unconfigured**

With `GOOGLE_CLIENT_ID` blank, restart uvicorn. Reload `/register` and `/login`. Expect: NO "Continue with Google" button rendered.

- [ ] **8. Web Google flow**

Fill `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` from a Desktop-type OAuth client. Restart uvicorn. Visit `/register`. Click "Continue with Google" → consent in Google → land at `/oauth/callback` → automatically forwarded to `/questions`, logged in.

- [ ] **9. Desktop Google flow**

Build + run the Electron app (`pnpm -C apps/desktop dev` or the existing dev command). Click the Google button. Default browser opens. After Google consent, the browser hits `http://127.0.0.1:<port>/oauth/callback` and shows the "you can close this window" page; the Electron app silently logs in and navigates to `/questions`.

- [ ] **10. Auto-merge**

Register email X via password flow. Log out. Sign in with Google using the SAME address. Expect: logged in immediately. Now log out and try password sign-in with X — must still succeed (the password isn't wiped; only `google_id` was added).

- [ ] **11. Server smoke tests still green**

From `apps/server`:

```bash
.venv/Scripts/python.exe -m app.share_token_test
.venv/Scripts/python.exe -m app.mail_test
.venv/Scripts/python.exe -m app.oauth_google_test
.venv/Scripts/python.exe -m app.auth_flow_test
```

Each should print its `OK — …` line and exit 0.

- [ ] **12. Frontend typecheck**

```bash
pnpm -C apps/web tsc -b --noEmit
pnpm -C apps/desktop tsc --noEmit
```

Both clean.

- [ ] **13. Roadmap update**

Append a "Phase 11 — Account security hardening" section to BOTH `docs/Roadmap_CN.md` and `docs/Roadmap_EN.md` summarizing the shipped scope and pointing to the spec file. Keep prose terse (3-5 lines each) and mark the phase done.

- [ ] **14. Final commit**

```bash
git add docs/Roadmap_CN.md docs/Roadmap_EN.md
git commit -m "docs: mark Phase 11 done — account security hardening"
```

---

## Done

Final state: registration window requires a verified email + password confirmation; Google sign-in works on both web and Electron desktop with auto-merge into pre-existing password accounts; all three Phase 11 features degrade gracefully when their env vars are blank.
