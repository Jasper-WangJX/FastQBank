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
