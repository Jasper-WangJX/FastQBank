from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import CurrentUser
from app.models import User
from app.schemas import LoginIn, RegisterIn, TokenOut, UserOut
from app.security import create_access_token, hash_password, verify_password

# No prefix: /me must stay at the root (exit criteria), while register/
# login live under /auth. Paths are written out explicitly below.
router = APIRouter(tags=["auth"])


@router.post(
    "/auth/register",
    response_model=TokenOut,
    status_code=status.HTTP_201_CREATED,
)
async def register(
    body: RegisterIn, db: AsyncSession = Depends(get_db)
) -> TokenOut:
    """Create an account and immediately return a token (register =
    auto-login, so the UI lands logged-in in one step)."""
    existing = await db.scalar(select(User).where(User.email == body.email))
    if existing is not None:
        # 409 (not 400) — the request was well-formed, the email just
        # collides. The frontend maps this to a friendly message.
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
    # Load the DB-generated id (and other server defaults) onto `user`.
    await db.refresh(user)
    return TokenOut(access_token=create_access_token(str(user.id)))


@router.post("/auth/login", response_model=TokenOut)
async def login(
    body: LoginIn, db: AsyncSession = Depends(get_db)
) -> TokenOut:
    user = await db.scalar(select(User).where(User.email == body.email))
    # Same message + status for "no such email" and "wrong password" so
    # an attacker cannot enumerate which emails are registered.
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid email or password",
        )
    return TokenOut(access_token=create_access_token(str(user.id)))


@router.get("/me", response_model=UserOut)
async def me(current_user: CurrentUser) -> User:
    """Protected endpoint proving the token works end to end.
    response_model=UserOut guarantees password_hash is never serialized."""
    return current_user
