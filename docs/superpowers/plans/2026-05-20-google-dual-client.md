# Phase 11.3 — Google Dual-Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Google OAuth credentials per platform so a Web Application client (with registered `https://…/oauth/callback`) and a Desktop client (with auto-allowed loopback) can coexist, with the backend picking the right pair based on the platform the sign-in was initiated from.

**Architecture:**
- Backend: migration 0008 adds an `oauth_states.platform` text column (CHECK in `('web','desktop')`). Settings replace the single `GOOGLE_CLIENT_ID/SECRET` pair with `GOOGLE_WEB_CLIENT_ID/SECRET` + `GOOGLE_DESKTOP_CLIENT_ID/SECRET`. A single `_credentials_for(platform)` helper centralises the lookup. Three router endpoints touch it: `/auth/providers` reshapes to `{ google: { web, desktop } }`, `/auth/google/start` records the platform in the new column, and `/auth/google/callback` reads it back to choose the right client pair for the token exchange and id_token audience check.
- Frontend: `AuthContext`'s `Providers` interface mirrors the new shape; `GoogleSignInButton` gates rendering on the flag matching the current platform (web vs desktop).

**Tech Stack:** FastAPI · SQLAlchemy 2 async · Alembic · pydantic-settings · React 19 + Vite.

**Spec:** [docs/superpowers/specs/2026-05-20-google-dual-client-design.md](../specs/2026-05-20-google-dual-client-design.md)

---

## Conventions

- Branch: `phase-11-3-google-dual-client` (already cut from `main`).
- Tests follow the existing convention (no pytest; structural smoke + manual checklist). The route set is unchanged so `auth_routes_test.py` is NOT touched.
- After Task 1 lands you SHOULD run `alembic upgrade head` once locally to apply migration 0008 before manual verification.
- Commit-message style: Conventional Commits (`feat: …`, `fix: …`, `docs: …`).

---

## File map

### Backend — creates
- `apps/server/alembic/versions/0008_oauth_states_platform.py`

### Backend — modifies
- `apps/server/app/models.py`               (OAuthState gains `platform` column)
- `apps/server/app/settings.py`             (rename + add 4 OAuth credential fields)
- `apps/server/app/schemas.py`              (ProvidersOut reshape + new GoogleProvidersOut)
- `apps/server/app/routers/auth.py`         (helper + 3 endpoint edits)

### Frontend — modifies
- `apps/web/src/auth/AuthContext.tsx`       (Providers interface + .catch fallback)
- `apps/web/src/components/auth/GoogleSignInButton.tsx`  (gate)

### Repo root — modifies
- `.env.example`                            (Phase 11 Google block replaced)
- `deploy/env.prod.example`                 (Phase 11 Google block replaced)

### Docs — modifies (final task)
- `docs/Roadmap_CN.md`
- `docs/Roadmap_EN.md`

---

## Task 1: Alembic migration 0008 — `oauth_states.platform`

**Files:**
- Create: `apps/server/alembic/versions/0008_oauth_states_platform.py`

- [ ] **Step 1: Write the migration**

Create `apps/server/alembic/versions/0008_oauth_states_platform.py`:

```python
"""Phase 11.3: oauth_states.platform

Add a `platform` text column to oauth_states so /auth/google/callback
can look up which OAuth client (web vs desktop) was used at start
time and pick the right client_id/secret pair for token exchange.

The DEFAULT 'web' keeps the migration safe for any in-flight rows
present at upgrade time; the router always sets `platform` explicitly
going forward, so the default is also a harmless fallback if a future
code path forgets to set it.

Revision ID: 0008_oauth_states_platform
Revises: 0007_account_independence
Create Date: 2026-05-20
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0008_oauth_states_platform"
down_revision: str | None = "0007_account_independence"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "oauth_states",
        sa.Column(
            "platform",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'web'"),
        ),
    )
    op.create_check_constraint(
        "ck_oauth_states_platform",
        "oauth_states",
        "platform IN ('web', 'desktop')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_oauth_states_platform", "oauth_states", type_="check"
    )
    op.drop_column("oauth_states", "platform")
```

- [ ] **Step 2: Confirm the new head**

From `apps/server`:

```bash
.venv/Scripts/python.exe -m alembic heads
```

Expected: `0008_oauth_states_platform (head)`.

- [ ] **Step 3: (If DB available) apply**

```bash
.venv/Scripts/python.exe -m alembic upgrade head
```

Expected: `Running upgrade 0007_account_independence -> 0008_oauth_states_platform`. Skip if no DB running — the user will apply later.

- [ ] **Step 4: Commit**

```bash
git add apps/server/alembic/versions/0008_oauth_states_platform.py
git commit -m "feat(db): phase 11.3 migration — oauth_states.platform"
```

---

## Task 2: ORM — `OAuthState.platform`

**Files:**
- Modify: `apps/server/app/models.py`

- [ ] **Step 1: Add the field**

In `apps/server/app/models.py`, find the existing `OAuthState` class (added in Phase 11). The class currently looks like:

```python
class OAuthState(Base):
    """Per-attempt PKCE state for Google sign-in.
    ...
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

Insert a new `platform` field RIGHT AFTER `redirect_uri`:

```python
    state: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    code_verifier: Mapped[str] = mapped_column(Text, nullable=False)
    redirect_uri: Mapped[str] = mapped_column(Text, nullable=False)
    # 'web' or 'desktop'. The DB CHECK constraint ck_oauth_states_platform
    # (migration 0008) restricts the value; the router writes it
    # explicitly on every insert.
    platform: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = _now_column()
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
```

- [ ] **Step 2: Verify import**

From `apps/server`:

```bash
.venv/Scripts/python.exe -c "from app.models import OAuthState; print(OAuthState.platform)"
```

Expected: prints the SQLAlchemy column descriptor (something like `OAuthState.platform`).

- [ ] **Step 3: Commit**

```bash
git add apps/server/app/models.py
git commit -m "feat(models): OAuthState.platform field"
```

---

## Task 3: Settings — rename + add 4 Google OAuth fields

**Files:**
- Modify: `apps/server/app/settings.py`

- [ ] **Step 1: Replace the Phase 11 Google block**

In `apps/server/app/settings.py`, find the existing block:

```python
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

Replace it with:

```python
    # --- Phase 11.3: Google sign-in (one client per platform) ---
    # Google enforces redirect-URI rules per client type, so we need
    # TWO OAuth clients:
    #   - Web Application:  https://<domain>/oauth/callback (per-URL
    #     registration required). Used by the browser flow.
    #   - Desktop app:      http://127.0.0.1:<port>/oauth/callback
    #     (Google auto-allows ANY loopback port without registration).
    #     Used by the Electron loopback flow.
    # Either, both, or neither may be set — /auth/providers reports
    # which platforms are available and the frontend gates the
    # Continue-with-Google button accordingly.
    google_web_client_id: str | None = None
    google_web_client_secret: str | None = None
    google_desktop_client_id: str | None = None
    google_desktop_client_secret: str | None = None
    oauth_redirect_uri_web: str = "http://localhost:5173/oauth/callback"
```

- [ ] **Step 2: Verify settings load**

From `apps/server`:

```bash
.venv/Scripts/python.exe -c "from app.settings import get_settings; get_settings.cache_clear(); s = get_settings(); print(s.google_web_client_id, s.google_desktop_client_id, s.oauth_redirect_uri_web)"
```

Expected (with defaults): `None None http://localhost:5173/oauth/callback`. (Or your actual local values if `.env` carries the old `GOOGLE_CLIENT_ID` — those are now silently ignored, which is part of the breaking rename. Step 10 fixes `.env.example`; the operator renames their own `.env`.)

- [ ] **Step 3: Commit**

```bash
git add apps/server/app/settings.py
git commit -m "feat(server): settings — google_web/desktop_client_id/secret"
```

---

## Task 4: Schemas — `GoogleProvidersOut` + reshaped `ProvidersOut`

**Files:**
- Modify: `apps/server/app/schemas.py`

- [ ] **Step 1: Replace `ProvidersOut`**

In `apps/server/app/schemas.py`, find the existing class:

```python
class ProvidersOut(BaseModel):
    """Response of GET /auth/providers.

    Drives the frontend's "show / hide Google button" decision so a
    misconfigured deploy doesn't render a broken control.
    """

    google: bool
```

Replace with TWO classes (new nested model + reshaped wrapper):

```python
class GoogleProvidersOut(BaseModel):
    """Per-platform availability of the Google sign-in button.

    `web` is true when the server has both google_web_client_id AND
    google_web_client_secret configured; `desktop` similarly for the
    desktop credential pair. The frontend reads these via
    GET /auth/providers and renders the button only for the platform
    it is currently running on."""

    web: bool
    desktop: bool


class ProvidersOut(BaseModel):
    """Response of GET /auth/providers. Phase 11.3 reshape — `google`
    is now an object (per-platform) instead of a single bool."""

    google: GoogleProvidersOut
```

- [ ] **Step 2: Verify import**

```bash
.venv/Scripts/python.exe -c "from app.schemas import GoogleProvidersOut, ProvidersOut; print('ok')"
```

Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add apps/server/app/schemas.py
git commit -m "feat(server): ProvidersOut.google reshape — per-platform booleans"
```

---

## Task 5: Router — `_credentials_for` helper + `/auth/providers` update

**Files:**
- Modify: `apps/server/app/routers/auth.py`

- [ ] **Step 1: Extend the schema imports**

In `apps/server/app/routers/auth.py`, find the existing
`from app.schemas import (...)` block and ADD `GoogleProvidersOut`
alphabetically. The block should end up containing at least:

```python
from app.schemas import (
    DeleteAccountIn,
    ForgotPasswordIn,
    GoogleCallbackIn,
    GoogleProvidersOut,
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

- [ ] **Step 2: Add the `_credentials_for` helper**

In `apps/server/app/routers/auth.py`, find the existing
`_LOOPBACK_REDIRECT_PREFIXES` constant (Phase 11.1). IMMEDIATELY
ABOVE it, insert:

```python
def _credentials_for(
    platform: Literal["web", "desktop"],
) -> tuple[str, str] | None:
    """Return (client_id, client_secret) for the given platform, or
    None if that platform is not configured.

    The web and desktop flows MUST use different Google OAuth clients
    because Google enforces redirect-URI rules per client type
    (Desktop = loopback only; Web = exact-match registration). The
    router centralises the lookup here so each endpoint asks for
    "the right credentials for this platform" without sprinkling
    settings reads.
    """
    s = get_settings()
    if platform == "web":
        if s.google_web_client_id and s.google_web_client_secret:
            return s.google_web_client_id, s.google_web_client_secret
        return None
    if platform == "desktop":
        if (
            s.google_desktop_client_id
            and s.google_desktop_client_secret
        ):
            return (
                s.google_desktop_client_id,
                s.google_desktop_client_secret,
            )
        return None
    return None  # defensive; the Literal already excludes other values
```

- [ ] **Step 3: Rewrite `/auth/providers` handler**

Find the existing handler:

```python
@router.get("/auth/providers", response_model=ProvidersOut)
async def providers() -> ProvidersOut:
    settings = get_settings()
    return ProvidersOut(google=bool(settings.google_client_id))
```

Replace with:

```python
@router.get("/auth/providers", response_model=ProvidersOut)
async def providers() -> ProvidersOut:
    settings = get_settings()
    return ProvidersOut(
        google=GoogleProvidersOut(
            web=bool(
                settings.google_web_client_id
                and settings.google_web_client_secret
            ),
            desktop=bool(
                settings.google_desktop_client_id
                and settings.google_desktop_client_secret
            ),
        )
    )
```

- [ ] **Step 4: Smoke check**

```bash
.venv/Scripts/python.exe -m app.auth_routes_test
```

Expected: `OK — auth routes smoke test`.

- [ ] **Step 5: Commit**

```bash
git add apps/server/app/routers/auth.py
git commit -m "feat(auth): _credentials_for helper + /auth/providers per-platform"
```

---

## Task 6: Router — `/auth/google/start` picks credentials by platform

**Files:**
- Modify: `apps/server/app/routers/auth.py`

- [ ] **Step 1: Rewrite `google_start`**

In `apps/server/app/routers/auth.py`, find the existing
`google_start` function (added in Phase 11). Replace its entire body
with:

```python
@router.get("/auth/google/start", response_model=GoogleStartOut)
async def google_start(
    platform: Literal["web", "desktop"],
    redirect_uri: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> GoogleStartOut:
    """Per Phase 11.3: pick the client_id/secret pair matching the
    platform (web → google_web_*; desktop → google_desktop_*). Record
    `platform` on the oauth_states row so /auth/google/callback can
    resolve the same pair when the user returns."""
    creds = _credentials_for(platform)
    if creds is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="google sign-in not configured",
        )
    client_id, _client_secret = creds

    resolved = _validate_redirect_uri(platform, redirect_uri)

    pair = make_pkce_pair()
    state = secrets.token_urlsafe(32)
    now = datetime.now(tz=timezone.utc)
    db.add(
        OAuthState(
            state=state,
            code_verifier=pair.verifier,
            redirect_uri=resolved,
            platform=platform,
            expires_at=now + timedelta(minutes=5),
        )
    )
    await db.commit()

    authorize_url = build_authorize_url(
        client_id=client_id,
        redirect_uri=resolved,
        state=state,
        code_challenge=pair.challenge,
    )
    return GoogleStartOut(authorize_url=authorize_url, state=state)
```

The diff from Phase 11.1's version is small:
1. The leading `if not settings.google_client_id` → 503 block is
   replaced by `_credentials_for(platform)`.
2. `client_id` comes from the helper instead of `settings.google_client_id`.
3. The `OAuthState(...)` insert carries `platform=platform`.

- [ ] **Step 2: Smoke check**

```bash
.venv/Scripts/python.exe -m app.auth_routes_test
```

Expected: `OK — auth routes smoke test`.

- [ ] **Step 3: Commit**

```bash
git add apps/server/app/routers/auth.py
git commit -m "feat(auth): /auth/google/start picks credentials by platform"
```

---

## Task 7: Router — `/auth/google/callback` uses stored platform

**Files:**
- Modify: `apps/server/app/routers/auth.py`

- [ ] **Step 1: Rewrite `google_callback`**

In `apps/server/app/routers/auth.py`, find the existing
`google_callback` function (Phase 11.1's sub-keyed version). Replace
its entire body with:

```python
@router.post("/auth/google/callback", response_model=TokenOut)
async def google_callback(
    body: GoogleCallbackIn, db: AsyncSession = Depends(get_db)
) -> TokenOut:
    """Phase 11.3: resolve credentials from oauth_states.platform so
    the token exchange and id_token audience match the client_id used
    at start time."""
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
    platform = row.platform
    await db.delete(row)
    await db.commit()
    if expires_at < now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid state",
        )

    creds = _credentials_for(platform)  # type: ignore[arg-type]
    if creds is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="google sign-in not configured",
        )
    client_id, client_secret = creds

    try:
        token = await exchange_code_for_id_token(
            code=body.code,
            code_verifier=code_verifier,
            redirect_uri=redirect_uri,
            client_id=client_id,
            client_secret=client_secret,
        )
        identity = verify_id_token(token, audience=client_id)
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

    # Phase 11.1 auto-merge logic (look up by google_id) unchanged.
    user = await db.scalar(
        select(User).where(User.google_id == identity.sub)
    )
    if user is None:
        user = User(
            email=identity.email,
            password_hash=None,
            google_id=identity.sub,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    return TokenOut(access_token=create_access_token(str(user.id)))
```

The diff from Phase 11.1's version:
1. Read `row.platform` alongside the existing row fields.
2. Add the `_credentials_for(platform)` lookup with 503 on None.
3. Pass `client_id` + `client_secret` into both `exchange_code_for_id_token`
   AND `verify_id_token`'s `audience=` parameter (instead of
   `settings.google_client_id`).

- [ ] **Step 2: Smoke check**

```bash
.venv/Scripts/python.exe -m app.auth_routes_test
```

Expected: `OK — auth routes smoke test`.

- [ ] **Step 3: Commit**

```bash
git add apps/server/app/routers/auth.py
git commit -m "feat(auth): /auth/google/callback uses oauth_states.platform"
```

---

## Task 8: Frontend — `AuthContext.Providers` shape + `GoogleSignInButton` gate

**Files:**
- Modify: `apps/web/src/auth/AuthContext.tsx`
- Modify: `apps/web/src/components/auth/GoogleSignInButton.tsx`

Both files must change together so the codebase stays type-correct after a single commit (the interface change in AuthContext breaks the consumer in GoogleSignInButton until both edits are in).

- [ ] **Step 1: Update the `Providers` interface and catch fallback in AuthContext**

In `apps/web/src/auth/AuthContext.tsx`, find the existing interface:

```ts
interface Providers {
  google: boolean;
}
```

Replace with:

```ts
interface Providers {
  google: { web: boolean; desktop: boolean };
}
```

Then find the `/auth/providers` fetch effect — it currently has a
`.catch` that hides the optional button on network error:

```ts
.catch(() => {
  // Network/CORS error: hide the optional button rather than
  // render a broken control.
  if (!cancelled) setProviders({ google: false });
});
```

Replace the fallback with the new nested shape:

```ts
.catch(() => {
  // Network/CORS error: hide the optional button rather than
  // render a broken control.
  if (!cancelled)
    setProviders({ google: { web: false, desktop: false } });
});
```

- [ ] **Step 2: Update the gate in GoogleSignInButton**

In `apps/web/src/components/auth/GoogleSignInButton.tsx`, find the existing gate that follows the hooks:

```tsx
if (providers === null || !providers.google) return null;
```

Replace with the per-platform gate:

```tsx
if (providers === null) return null;
const desktop = getDesktop();
const enabled = desktop ? providers.google.desktop : providers.google.web;
if (!enabled) return null;
```

The existing `onClick` already branches on `getDesktop()` to pick the
flow, so no further change is needed.

Note: the `desktop` const captured here is `getDesktop()`'s return
value at render time. The existing `onClick` calls `getDesktop()`
inside the handler — keep that call too (the value is stable per
session anyway).

- [ ] **Step 3: Typecheck**

```bash
pnpm -C apps/web tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/auth/AuthContext.tsx \
        apps/web/src/components/auth/GoogleSignInButton.tsx
git commit -m "feat(web): per-platform google providers + button gate"
```

---

## Task 9: `.env.example` + `deploy/env.prod.example`

**Files:**
- Modify: `.env.example`
- Modify: `deploy/env.prod.example`

- [ ] **Step 1: Replace the Phase 11 Google block in `.env.example`**

In `.env.example`, find the existing Phase 11 Google block:

```dotenv
# --- Phase 11: Google sign-in (optional) ---
# Create an OAuth client at https://console.cloud.google.com/apis/credentials.
# Use client type "Desktop" — its loopback URI exception (any port on
# 127.0.0.1) is what makes desktop sign-in work without per-port
# registration. The same client also serves the web flow.
# Leave GOOGLE_CLIENT_ID blank to hide the "Continue with Google" button.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
OAUTH_REDIRECT_URI_WEB=http://localhost:5173/oauth/callback
```

Replace it with:

```dotenv
# --- Phase 11.3: Google sign-in (optional) ---
# Two separate OAuth clients are required because Google enforces
# redirect-URI rules per client type:
#   (a) Web Application — for the browser flow at http://localhost:5173
#       (dev) or https://your-domain (prod). Each redirect URI must be
#       added EXACTLY to its "Authorized redirect URIs" list in Google
#       Cloud Console.
#   (b) Desktop app     — for the Electron loopback flow. No redirect
#       URI registration is needed; Google auto-allows any port on
#       http://127.0.0.1/* for Desktop clients.
# Configure either, both, or neither — /auth/providers reports per-
# platform availability and the Continue-with-Google button hides
# accordingly.
GOOGLE_WEB_CLIENT_ID=
GOOGLE_WEB_CLIENT_SECRET=
GOOGLE_DESKTOP_CLIENT_ID=
GOOGLE_DESKTOP_CLIENT_SECRET=
OAUTH_REDIRECT_URI_WEB=http://localhost:5173/oauth/callback
```

- [ ] **Step 2: Replace the Phase 11 Google block in `deploy/env.prod.example`**

In `deploy/env.prod.example`, find the existing Phase 11 Google block:

```dotenv
# --- Phase 11: Google sign-in (optional) ---
# Create an OAuth client of type "Desktop" at
# https://console.cloud.google.com/apis/credentials. The Desktop type's
# loopback exception (any port on 127.0.0.1 without per-port
# registration) is what makes the Electron desktop flow work; the same
# client also serves the web flow when the redirect URI is added to its
# allowlist (Console → Edit OAuth client → Authorized redirect URIs).
#
# For prod, set OAUTH_REDIRECT_URI_WEB to your https://<domain>/oauth/callback
# and add the exact same string to the Google Console authorized URIs.
# Leave GOOGLE_CLIENT_ID blank to hide the "Continue with Google" button.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
OAUTH_REDIRECT_URI_WEB=https://fastqbank.com/oauth/callback
```

Replace it with:

```dotenv
# --- Phase 11.3: Google sign-in (optional) ---
# Two separate OAuth clients are required (see .env.example for the
# detailed rationale). Briefly:
#   (a) Web Application client — register
#       https://<your-domain>/oauth/callback as an Authorized redirect
#       URI in Google Cloud Console. Used by the browser flow.
#   (b) Desktop app client — no redirect registration required.
#       Used by Electron loopback flow.
# OAUTH_REDIRECT_URI_WEB must EXACTLY match what is registered for the
# Web client (https://<domain>/oauth/callback).
GOOGLE_WEB_CLIENT_ID=
GOOGLE_WEB_CLIENT_SECRET=
GOOGLE_DESKTOP_CLIENT_ID=
GOOGLE_DESKTOP_CLIENT_SECRET=
OAUTH_REDIRECT_URI_WEB=https://fastqbank.com/oauth/callback
```

- [ ] **Step 3: Commit**

```bash
git add .env.example deploy/env.prod.example
git commit -m "docs(env): split Google OAuth env vars per platform"
```

---

## Task 10: Manual end-to-end verification + Roadmap update

**Files:**
- Modify: `docs/Roadmap_CN.md`
- Modify: `docs/Roadmap_EN.md`

This task is the closing step. No new code; just walk the spec's §9.2
manual checklist and append a Phase 11.3 entry to both Roadmaps.

- [ ] **Step 1: Apply migration locally**

```bash
cd apps/server
.venv/Scripts/python.exe -m alembic upgrade head
```

Expected: `Running upgrade 0007_account_independence -> 0008_oauth_states_platform`.

- [ ] **Step 2: Update your local `.env` (operator action)**

Open the repo-root `.env` (NOT `.env.example`). Find:

```
GOOGLE_CLIENT_ID=<your existing value>
GOOGLE_CLIENT_SECRET=<your existing value>
```

Rename to:

```
GOOGLE_WEB_CLIENT_ID=<that same value>
GOOGLE_WEB_CLIENT_SECRET=<that same value>
```

If you already have a Desktop client (the one you've been using),
also add:

```
GOOGLE_DESKTOP_CLIENT_ID=<your desktop client id>
GOOGLE_DESKTOP_CLIENT_SECRET=<your desktop client secret>
```

Restart uvicorn so it picks up the new settings.

(Per the design, BOTH clients are independently optional — leave one
or both pairs blank if you only want one flow.)

- [ ] **Step 3: Server smoke tests**

From `apps/server`:

```bash
.venv/Scripts/python.exe -m app.share_token_test
.venv/Scripts/python.exe -m app.oauth_google_test
.venv/Scripts/python.exe -m app.auth_routes_test
```

Each must exit 0 with its `OK — …` line. (`mail_test` is a
pre-existing skip when `RESEND_API_KEY` is set locally; not a 11.3
regression.)

- [ ] **Step 4: Frontend typecheck**

```bash
pnpm -C apps/web tsc -b --noEmit
pnpm -C apps/desktop tsc --noEmit
```

Both clean.

- [ ] **Step 5: Manual checklist (spec §9.2)**

With uvicorn + `pnpm -C apps/web dev` running:

1. **Both clients configured.** Web at `/login` and `/register`:
   "Sign in / Continue with Google" visible; click it → consent →
   `/oauth/callback` → logged in. Electron desktop: same button
   visible; click → default browser consent → "you can close this
   window" → renderer auto-logs in.
2. **Only Web configured** (clear `GOOGLE_DESKTOP_*` in `.env`,
   restart uvicorn). Web button visible and works; Electron button
   hidden.
3. **Only Desktop configured** (clear `GOOGLE_WEB_*` in `.env`,
   restart uvicorn). Web button hidden; Electron button visible and
   works.
4. **Neither configured** (clear both). Both surfaces have no Google
   button.
5. **`/auth/providers` shape on the wire.** DevTools network panel:
   `/auth/providers` response is
   `{"google":{"web":<bool>,"desktop":<bool>}}`.

- [ ] **Step 6: Append a Phase 11.3 entry to `docs/Roadmap_CN.md`**

Find the overview table; immediately AFTER the row for "11.2 忘记密
码 (公开重设)", add:

```
| 11.3 Google 双 client (web+desktop) | ✅ 已完成 (2026-05-20) | 拆开 Google OAuth 凭据：`GOOGLE_WEB_CLIENT_ID/SECRET` 给 https 网页流，`GOOGLE_DESKTOP_CLIENT_ID/SECRET` 给 Electron loopback 流；`/auth/providers` 返回 `{google:{web,desktop}}`，前端按当前平台决定是否显示按钮 |
```

Then BEFORE the "## 风险点与早期验证建议" heading, add:

```markdown
## 阶段 11.3 — Google 双 client (web + desktop)

> **状态：✅ 已完成 (2026-05-20)。** 设计：`docs/superpowers/specs/2026-05-20-google-dual-client-design.md`。计划：`docs/superpowers/plans/2026-05-20-google-dual-client.md`。

### 背景
Phase 11 假设一个 Google OAuth 客户端可以同时服务网页流和桌面 loopback 流；事实上 Google 按 client type 严格区分 redirect URI 规则（Desktop 只接受 loopback、Web 必须精确注册），所以两个流必须用两个独立的 OAuth client。

### 主要改动
- DB 迁移 0008：`oauth_states` 加 `platform` 列（`'web'`/`'desktop'`，CHECK 约束）；`/auth/google/callback` 由此知道当时应该用哪一对凭据做 token exchange。
- 后端：settings 把 `GOOGLE_CLIENT_ID/SECRET` 拆成 `GOOGLE_WEB_CLIENT_ID/SECRET` + `GOOGLE_DESKTOP_CLIENT_ID/SECRET`；新增 `_credentials_for(platform)` helper；`/auth/providers` 返回结构变为 `{google: {web: bool, desktop: bool}}`；`/auth/google/start` 写入 platform、`/auth/google/callback` 读出 platform。
- 前端：`AuthContext.providers` 改成嵌套结构；`GoogleSignInButton` 按当前平台（`getDesktop()` 判断）只在对应 flag 为 true 时渲染。
- 操作要求：`.env` / `.env.prod` 把旧的 `GOOGLE_CLIENT_ID/SECRET` 改名为 `GOOGLE_WEB_CLIENT_ID/SECRET`；如果想启用桌面端 Google 登录，再去 Google Console 建一个 Desktop 类型的 OAuth client，填到 `GOOGLE_DESKTOP_CLIENT_ID/SECRET`。
```

- [ ] **Step 7: Mirror the addition in `docs/Roadmap_EN.md`**

After the row for "11.2 Forgot password (public reset)", add:

```
| 11.3 Google dual-client (web + desktop) | ✅ Done (2026-05-20) | Split the Google OAuth credentials: `GOOGLE_WEB_CLIENT_ID/SECRET` for the https web flow, `GOOGLE_DESKTOP_CLIENT_ID/SECRET` for the Electron loopback flow. `/auth/providers` now returns `{google:{web,desktop}}`; the frontend gates the button on the flag matching the current platform. |
```

Then BEFORE the Risks/Early-validation closing section, add:

```markdown
## Phase 11.3 — Google dual-client (web + desktop)

> **Status: ✅ Done (2026-05-20).** Design: `docs/superpowers/specs/2026-05-20-google-dual-client-design.md`. Plan: `docs/superpowers/plans/2026-05-20-google-dual-client.md`.

### Background
Phase 11 assumed a single Google OAuth client could serve both the web flow and the Electron loopback flow. Google's client-type rules disallow that: a Desktop client accepts only loopback redirect URIs, while a Web client requires exact-match registration of every redirect URI. The two flows therefore require two separate OAuth clients.

### Key changes
- DB migration 0008 adds an `oauth_states.platform` text column (`'web'`/`'desktop'`, CHECK constraint) so `/auth/google/callback` can resolve the correct client_id/secret pair when the user returns.
- Backend: settings split `GOOGLE_CLIENT_ID/SECRET` into `GOOGLE_WEB_CLIENT_ID/SECRET` + `GOOGLE_DESKTOP_CLIENT_ID/SECRET`; new `_credentials_for(platform)` helper; `/auth/providers` response reshaped to `{google: {web: bool, desktop: bool}}`; `/auth/google/start` writes `platform` and `/auth/google/callback` reads it back.
- Frontend: `AuthContext.providers` adopts the nested shape; `GoogleSignInButton` renders only when the flag matching the current platform (`getDesktop()` branch) is true.
- Operator action: rename the existing `GOOGLE_CLIENT_ID/SECRET` in `.env` / `.env.prod` to `GOOGLE_WEB_CLIENT_ID/SECRET`. To enable desktop Google sign-in, create a new Desktop OAuth client in Google Cloud Console and fill `GOOGLE_DESKTOP_CLIENT_ID/SECRET`.
```

- [ ] **Step 8: Commit**

```bash
git add docs/Roadmap_CN.md docs/Roadmap_EN.md
git commit -m "docs: mark Phase 11.3 done — Google dual-client (web + desktop)"
```

---

## Done

Final state: the backend reads two independent Google OAuth client pairs and chooses the right one based on the platform recorded in `oauth_states`; the frontend hides the Google button on a platform whose credentials are unset. The operator now needs two clients in Google Cloud Console (one Web Application + one Desktop) instead of one to enable both flows.
