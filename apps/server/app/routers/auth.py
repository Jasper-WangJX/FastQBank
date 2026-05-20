"""Authentication endpoints — Phase 1 + Phase 11.

Phase 1:  /auth/register, /auth/login, /me
Phase 11: /auth/request-code, /auth/providers, /auth/google/{start,callback}

Conventions copied from routers/shares.py:
  - No router prefix; explicit paths.
  - slowapi limiter decorates the public anti-abuse endpoints with
    `@limiter.limit("...")` and takes `request: Request` as a param
    so slowapi can find the request object.

Note: /auth/google/callback is NOT covered by an automated smoke test
because google-auth's id_token verifier fetches Google JWKS at call
time; stubbing it would require monkey-patching internal symbols.
See the manual end-to-end checklist in the Phase 11 plan (Task 24).
"""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from secrets import randbelow
from typing import Literal
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import CurrentUser
from app.mail import send_verification
from app.models import DeletedUser, EmailVerification, OAuthState, User
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

    # Already-registered check: only blocks if a PASSWORD account
    # exists for this email. A Google account with the same email
    # does not block password registration (Phase 11.1 made the two
    # rows independent).
    existing_pw = await db.scalar(
        select(User).where(
            User.email == body.email,
            User.password_hash.is_not(None),
        )
    )
    if existing_pw is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="email already registered",
        )

    # Cooldown check: a password account at this email was recently
    # deleted; block re-registration for 24h. Google sign-in is not
    # affected — it doesn't write to deleted_users.
    cutoff = now - timedelta(hours=24)
    recent_delete = await db.scalar(
        select(DeletedUser)
        .where(
            DeletedUser.email == body.email,
            DeletedUser.deleted_at > cutoff,
        )
        .order_by(DeletedUser.deleted_at.desc())
        .limit(1)
    )
    if recent_delete is not None:
        unlock_at = recent_delete.deleted_at + timedelta(hours=24)
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail=f"email cooling down, try again after {unlock_at.isoformat()}",
        )

    # Per-(email, purpose) 60-second cooldown.
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
        # Past cooldown — drop the old row so only one row exists
        # per (email, purpose).
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
    await db.flush()  # surface DB errors before we call the mailer

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
    # Concurrent-register guard: only collides with another password
    # account; Google rows with the same email are independent.
    existing = await db.scalar(
        select(User).where(
            User.email == body.email,
            User.password_hash.is_not(None),
        )
    )
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
    # account (password_hash is NULL). Prevents probing for the
    # existence of an account or its sign-in method.
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
async def me(current_user: CurrentUser) -> UserOut:
    """`has_password` lets the frontend gate the reset-password UI
    (Settings modal). We compute it here because it's not an actual
    ORM attribute — UserOut otherwise builds straight from the User
    via `from_attributes=True`."""
    return UserOut(
        id=current_user.id,
        email=current_user.email,
        created_at=current_user.created_at,
        has_password=current_user.password_hash is not None,
    )


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
    """Resolve the redirect_uri for a Google sign-in attempt.

    Web: ignore the client-supplied value; use the configured URL so
    a misconfigured client cannot send users to an attacker's page.
    Desktop: require a loopback URL (Google allows any port on
    127.0.0.1 for Desktop OAuth clients). Path must be
    /oauth/callback.
    """
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
            parsed = None  # type: ignore[assignment]
        if not ok or parsed is None or parsed.path != "/oauth/callback":
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
    state = secrets.token_urlsafe(32)
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

    # Phase 11.1: identify users by Google sub, NOT by email. A
    # password account that happens to share this email is left
    # strictly alone.
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
