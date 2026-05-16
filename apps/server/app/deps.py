from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import User
from app.security import TokenError, decode_token

# Registering an HTTPBearer scheme makes the OpenAPI spec declare bearer
# auth, so Swagger UI shows an "Authorize" (lock) button and actually
# sends the Authorization header. auto_error=False keeps full control of
# the 401 so every failure path returns the SAME response (see below).
bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(bearer_scheme)
    ] = None,
    db: AsyncSession = Depends(get_db),
) -> User:
    """Resolve the bearer token to a User, or raise 401.

    Every failure path returns the SAME 401 so the client cannot
    distinguish "no token" from "expired" from "user deleted".
    """
    cred_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if credentials is None or credentials.scheme.lower() != "bearer":
        raise cred_exc

    try:
        sub = decode_token(credentials.credentials)
        user_id = UUID(sub)
    except (TokenError, ValueError):
        raise cred_exc from None

    user = await db.get(User, user_id)
    if user is None:
        raise cred_exc
    return user


# Ergonomic alias so routes can just write `user: CurrentUser`.
CurrentUser = Annotated[User, Depends(get_current_user)]
