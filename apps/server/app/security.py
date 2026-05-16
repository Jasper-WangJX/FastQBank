from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.settings import get_settings

settings = get_settings()

# bcrypt only ever consumes the first 72 BYTES of the password. We
# truncate explicitly — identically in hash AND verify — so behaviour is
# deterministic across bcrypt versions and consistent for multibyte
# (e.g. CJK) passwords. The Pydantic schema (B5) also caps the length so
# the user gets a clean validation error instead of silent truncation.
_BCRYPT_MAX_BYTES = 72


def _to_bcrypt_bytes(password: str) -> bytes:
    return password.encode("utf-8")[:_BCRYPT_MAX_BYTES]


def hash_password(password: str) -> str:
    """Return a bcrypt hash (salt embedded) safe to store as TEXT."""
    return bcrypt.hashpw(_to_bcrypt_bytes(password), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    """Constant-time check of a plaintext password against a stored hash."""
    return bcrypt.checkpw(_to_bcrypt_bytes(password), password_hash.encode())


class TokenError(Exception):
    """Raised when a JWT is missing/expired/tampered. deps.py -> HTTP 401."""


def create_access_token(sub: str) -> str:
    """Sign a short-lived access token. `sub` is the user id (as str)."""
    now = datetime.now(tz=timezone.utc)
    payload = {
        "sub": sub,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(
        payload, settings.jwt_secret, algorithm=settings.jwt_algorithm
    )


def decode_token(token: str) -> str:
    """Validate signature + expiry, return the `sub` claim (user id)."""
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
    except jwt.PyJWTError as exc:  # expired / bad signature / malformed
        raise TokenError(str(exc)) from exc

    sub = payload.get("sub")
    if not sub:
        raise TokenError("token missing 'sub' claim")
    return sub
