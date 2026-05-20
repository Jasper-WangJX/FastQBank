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
