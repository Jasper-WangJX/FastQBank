"""12-char URL-safe share token generator.

`secrets.token_urlsafe(9)` returns Base64-URL-safe-encoded random
bytes — 9 bytes encode to exactly 12 characters with no padding,
giving ~72 bits of entropy (infeasible to guess). The output charset
is `[A-Za-z0-9_-]`, matching the spec's claim of "URL-safe" and the
frontend's extraction regex.

No third-party `nanoid` dependency is needed; `secrets` is stdlib.
"""

import secrets

SHARE_TOKEN_LENGTH = 12
# Charset documented for the route validators that prevalidate format
# before the DB lookup.
SHARE_TOKEN_CHARSET = (
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
)


def generate_share_token() -> str:
    """Returns exactly 12 URL-safe characters."""
    return secrets.token_urlsafe(9)


def is_valid_share_token(value: str) -> bool:
    """True iff `value` matches the produced format. Used by route
    handlers to 404 on a clearly-malformed token without a DB query."""
    if len(value) != SHARE_TOKEN_LENGTH:
        return False
    allowed = set(SHARE_TOKEN_CHARSET)
    return all(ch in allowed for ch in value)
