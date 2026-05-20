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
