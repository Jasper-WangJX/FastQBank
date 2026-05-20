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
