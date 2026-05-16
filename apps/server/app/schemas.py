from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RegisterIn(BaseModel):
    """Request body for POST /auth/register."""

    email: EmailStr
    # 8..72: lower bound is a minimum strength; the 72 upper bound mirrors
    # bcrypt's byte limit so the user gets a clean 422 instead of silent
    # truncation. (security.py still byte-truncates as a safety net.)
    password: str = Field(min_length=8, max_length=72)


class LoginIn(BaseModel):
    """Request body for POST /auth/login. No length rules on purpose —
    validation here would just leak password policy to attackers."""

    email: EmailStr
    password: str


class TokenOut(BaseModel):
    """Response of register/login: the bearer access token."""

    access_token: str
    token_type: Literal["bearer"] = "bearer"


class UserOut(BaseModel):
    """Safe public view of a User. Whitelist of fields — password_hash is
    simply not declared here, so it can never be serialized to a client.
    from_attributes lets FastAPI build this straight from the ORM object."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    created_at: datetime
