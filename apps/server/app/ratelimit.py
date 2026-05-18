"""slowapi limiter (Roadmap stage 6, per-minute request cap).

In its own module so BOTH main.py (registers state + the 429 handler)
and the /ai router (decorates routes with @limiter.limit) can import it
without a circular import.

Keyed per user: a bearer token is stable for one user within its 24h
validity, so it buckets per user without decoding the JWT here. Falls
back to client IP for unauthenticated calls.
"""

from __future__ import annotations

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address


def _user_key(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:]
    return get_remote_address(request)


limiter = Limiter(key_func=_user_key)
