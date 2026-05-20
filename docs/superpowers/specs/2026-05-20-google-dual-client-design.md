# Phase 11.3 — Google Dual-Client (Web + Desktop) Design

Date: 2026-05-20
Status: Draft (pending implementation)

Phase 11 added Google sign-in under the assumption that a single Google
OAuth client could serve both the web frontend and the Electron
desktop loopback flow. That assumption is wrong: Google enforces
client-type semantics — a **Desktop** client allows any
`http://127.0.0.1:*` redirect (no per-port registration) but rejects
`https://` redirect URIs, while a **Web application** client requires
each redirect URI to be explicitly registered and does not usefully
support dynamic loopback ports. The two flows therefore need two
separate OAuth clients.

This phase adapts the backend (and a thin frontend tweak) so it picks
the right client_id / client_secret pair based on the platform the
sign-in was initiated from.

## 1. Goals

1. **Two OAuth clients** — a Web Application client for browser users
   and a Desktop client for Electron loopback users — configured via
   independent env vars.
2. **Platform-aware token exchange** — `/auth/google/callback` uses the
   same client_id/secret pair that `/auth/google/start` used; mismatch
   would fail Google's token endpoint or the id_token audience check.
3. **Per-platform button visibility** — the "Continue with Google"
   button only renders when the platform the user is currently on has
   its credentials configured. A web visitor never sees a button that
   would fail because only desktop is set up, and vice versa.
4. **Graceful empty state** — when neither client is configured,
   neither flow renders the button (same as Phase 11 today).

## 2. Scope and non-goals

In scope:
- Migration 0008 adding an `oauth_states.platform` column.
- Settings rename (`google_client_id`/`_secret` → `google_web_client_id`/`_secret`)
  and addition of `google_desktop_client_id`/`_secret`.
- Router changes in `/auth/providers`, `/auth/google/start`, and
  `/auth/google/callback`.
- `.env.example` + `deploy/env.prod.example` updates.
- AuthContext.providers shape change + GoogleSignInButton gating.

Out of scope:
- A unified single-client architecture (not possible given Google's
  client-type rules — see the rationale above).
- Migrating existing rows in `oauth_states` from old shape to new
  (the table is short-lived; the migration's `DEFAULT 'web'` covers
  any in-flight rows at upgrade time).
- Backwards-compat shims for the renamed settings (manual `.env`
  rename is acceptable for this single-user project).
- Frontend tests (the project's UI layer has no test framework;
  manual checklist covers the four configuration combinations).

## 3. Data model

### 3.1 `oauth_states.platform` (new column)

Migration 0008 adds a non-null text column with a CHECK constraint:

```sql
ALTER TABLE oauth_states
  ADD COLUMN platform TEXT NOT NULL DEFAULT 'web';
ALTER TABLE oauth_states
  ADD CONSTRAINT ck_oauth_states_platform
    CHECK (platform IN ('web', 'desktop'));
```

- The `DEFAULT 'web'` only serves to satisfy NOT NULL for any in-flight
  rows present during the upgrade. Going forward, the router always
  writes the value explicitly.
- The CHECK constraint mirrors the Pydantic `Literal["web", "desktop"]`
  used in the schema, so an invalid value can't slip into the DB even
  if the router skipped validation.
- Downgrade drops the column. Best-effort; safe because no other table
  references it.

### 3.2 ORM change

In `apps/server/app/models.py`, `OAuthState` gains:

```python
platform: Mapped[str] = mapped_column(Text, nullable=False)
```

Right after `redirect_uri`. The model already has all the imports it
needs.

Why not store the actual `client_id` in `oauth_states`? Doing so couples
the row to a specific configuration value at insert time; if the admin
rotates the client (rare but possible) the row is orphaned. Storing
`platform` is an indirection that's looked up against current
settings at callback time, which is the right level of late-binding.

## 4. Settings

Replace `apps/server/app/settings.py`'s Phase 11 entries:

```python
# OLD (delete):
google_client_id: str | None = None
google_client_secret: str | None = None

# NEW:
google_web_client_id: str | None = None
google_web_client_secret: str | None = None
google_desktop_client_id: str | None = None
google_desktop_client_secret: str | None = None
```

`oauth_redirect_uri_web` stays unchanged.

This is a **breaking rename**. Existing `.env` / `.env.prod` files that
have `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` will silently
"un-configure" Google sign-in on the first run after upgrade
(pydantic-settings doesn't error on unknown env vars; it just leaves
the new fields at None). The Roadmap entry calls this out so the user
knows to rename their two existing vars (prefix with `WEB_`).

## 5. Helper: `_credentials_for(platform)`

A single private helper centralises the "which client_id/secret do I
use?" decision so the router doesn't have to spell it out twice.

```python
def _credentials_for(
    platform: Literal["web", "desktop"],
) -> tuple[str, str] | None:
    """Return (client_id, client_secret) for the given platform, or
    None if that platform is not configured. The caller maps None to
    503 service-unavailable."""
    s = get_settings()
    if platform == "web":
        if s.google_web_client_id and s.google_web_client_secret:
            return s.google_web_client_id, s.google_web_client_secret
        return None
    if platform == "desktop":
        if s.google_desktop_client_id and s.google_desktop_client_secret:
            return s.google_desktop_client_id, s.google_desktop_client_secret
        return None
    return None  # defensive; the Literal type already excludes other values
```

Lives near the top of `apps/server/app/routers/auth.py`.

## 6. Endpoint changes

### 6.1 `GET /auth/providers`

Response shape changes from a flat boolean to a nested object:

```python
class GoogleProvidersOut(BaseModel):
    web: bool
    desktop: bool


class ProvidersOut(BaseModel):
    google: GoogleProvidersOut
```

Handler body:

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

The frontend's `AuthContext` type and `GoogleSignInButton` gate both
mirror this nesting (see §7).

### 6.2 `GET /auth/google/start`

Modified:

- Replace the existing `if not settings.google_client_id` 503 with a
  `_credentials_for(platform)` call. If None → `503 google sign-in not
  configured`.
- Pass the resolved `client_id` to `build_authorize_url` (Google checks
  `redirect_uri` against the client's registered URIs; the client_id
  determines which list applies).
- Write `platform=platform` into the new `OAuthState` row alongside
  the existing `state`, `code_verifier`, `redirect_uri`, `expires_at`.

```python
@router.get("/auth/google/start", response_model=GoogleStartOut)
async def google_start(
    platform: Literal["web", "desktop"],
    redirect_uri: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> GoogleStartOut:
    creds = _credentials_for(platform)
    if creds is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="google sign-in not configured",
        )
    client_id, _client_secret = creds  # secret only needed at callback

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

`_validate_redirect_uri` is unchanged from Phase 11.1 — for `platform=web`
it returns `settings.oauth_redirect_uri_web`; for desktop it validates
the loopback shape.

### 6.3 `POST /auth/google/callback`

Modified:

- After looking up the state row, also read `row.platform`.
- Call `_credentials_for(row.platform)` to get the right pair. None →
  `503 google sign-in not configured` (the configuration was likely
  removed between start and callback).
- Pass the resolved `client_id` + `client_secret` into
  `exchange_code_for_id_token` AND into `verify_id_token`'s `audience`
  parameter. The token endpoint requires the same client_id/secret +
  the same redirect_uri as the start. The id_token's `aud` claim is the
  client_id; passing the right one is essential.

```python
async def google_callback(
    body: GoogleCallbackIn, db: AsyncSession = Depends(get_db)
) -> TokenOut:
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

The `# type: ignore[arg-type]` on `_credentials_for(platform)`
acknowledges that `platform` reads from the DB as `str`, not the
narrower `Literal`. Adding a runtime check that converts it (or asserts)
is pedantic; the CHECK constraint in §3 guarantees only valid values
land in the column.

## 7. Frontend

### 7.1 `AuthContext` interface

`apps/web/src/auth/AuthContext.tsx`:

```ts
interface Providers {
  google: { web: boolean; desktop: boolean };
}
```

The fetch logic + caching pattern stays identical. Only the type and
the default-on-fail value need updating:

```ts
.catch(() => {
  if (!cancelled) setProviders({ google: { web: false, desktop: false } });
});
```

### 7.2 `GoogleSignInButton` gating

`apps/web/src/components/auth/GoogleSignInButton.tsx`:

```tsx
if (providers === null) return null;
const desktop = getDesktop();
const enabled = desktop
  ? providers.google.desktop
  : providers.google.web;
if (!enabled) return null;
```

The existing `onClick` branch (which picks web vs desktop based on
`getDesktop()`) is unchanged; only this top-level gate.

### 7.3 No Electron changes

The Electron loopback bridge (`apps/desktop/src/oauth.ts`, `main.ts`,
`preload.ts`, IPC) is unaffected. The change is entirely about which
client_id/secret the backend uses; Electron only deals with code and
state strings, which work the same regardless of which client_id was
in play.

## 8. Configuration

### 8.1 `.env.example` (repo root, dev)

Replace the existing Phase 11 Google block:

```dotenv
# --- Phase 11 Google sign-in (optional) ---
# Two separate OAuth clients are required:
# (a) Web Application — for the browser flow at http://localhost:5173
#     or your https domain. Add the redirect URI exactly to its
#     "Authorized redirect URIs" in Google Cloud Console.
# (b) Desktop app — for the Electron loopback flow. No redirect URI
#     registration needed; Google auto-allows http://127.0.0.1:* for
#     Desktop clients.
# Configure either, both, or neither — /auth/providers reports which is
# available and the Continue-with-Google button hides accordingly.
GOOGLE_WEB_CLIENT_ID=
GOOGLE_WEB_CLIENT_SECRET=
GOOGLE_DESKTOP_CLIENT_ID=
GOOGLE_DESKTOP_CLIENT_SECRET=
OAUTH_REDIRECT_URI_WEB=http://localhost:5173/oauth/callback
```

### 8.2 `deploy/env.prod.example`

Mirror, with the prod redirect URI as the example:

```dotenv
OAUTH_REDIRECT_URI_WEB=https://fastqbank.com/oauth/callback
```

## 9. Testing

### 9.1 Automated

`apps/server/app/auth_routes_test.py` route set is unchanged; no edit
needed. The route-mount smoke test continues to pass.

### 9.2 Manual checklist (covers the four configuration combinations)

Run with both web (`pnpm -C apps/web dev`) and desktop (Electron) up,
against a local backend with `RESEND_API_KEY` set or stub-only.

1. **Both clients configured.**
   - Web at `/login`: "Sign in with Google" visible. Clicking goes to
     Google, consent, lands at `/oauth/callback`, logs in.
   - Electron: "Sign in with Google" visible. Clicking opens browser,
     consent, "you can close this window" page, Electron auto-logs in.
2. **Only Web configured.**
   - Web: button visible and works.
   - Electron: button hidden (because `providers.google.desktop` is
     false).
3. **Only Desktop configured.**
   - Web: button hidden.
   - Electron: button visible and works.
4. **Neither configured.**
   - Both surfaces: no button rendered.
5. **`/auth/providers` shape.** Browser devtools network panel: response
   is `{"google": {"web": <bool>, "desktop": <bool>}}` — confirms the
   shape change reached the wire.
6. **Smoke tests still green:**
   ```
   .venv/Scripts/python.exe -m app.share_token_test
   .venv/Scripts/python.exe -m app.oauth_google_test
   .venv/Scripts/python.exe -m app.auth_routes_test
   ```
7. **Typecheck:**
   ```
   pnpm -C apps/web tsc -b --noEmit
   pnpm -C apps/desktop tsc --noEmit
   ```
   Both clean.

## 10. Migration / rollout

For the local dev box and the VPS, the operator must:

1. Rename the existing `.env` / `.env.prod` variables:
   - `GOOGLE_CLIENT_ID` → `GOOGLE_WEB_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET` → `GOOGLE_WEB_CLIENT_SECRET`
2. Create a new Google OAuth client of type **Desktop** in Google Cloud
   Console (no redirect URI registration needed — Google auto-allows
   loopback for Desktop clients).
3. Add to the env file:
   - `GOOGLE_DESKTOP_CLIENT_ID=<new desktop client id>`
   - `GOOGLE_DESKTOP_CLIENT_SECRET=<new desktop client secret>`
4. Restart the server. Alembic upgrade head applies migration 0008
   automatically on container start (per the existing Dockerfile CMD).

If the operator skips step 1 (forgets to rename), Google sign-in
silently disables (settings see None for the web client). The button
disappears — non-fatal degradation, easy to spot.

## 11. Open questions (none blocking)

- Whether to issue distinct error detail strings for "web not configured"
  vs "desktop not configured" at the 503 path. The spec keeps the
  generic `google sign-in not configured`, which the frontend doesn't
  distinguish anyway (the button is gated before this point in normal
  use). If a debugging need surfaces, the server log already carries
  the platform context.
