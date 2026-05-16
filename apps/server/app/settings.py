from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve the repo-root .env independently of the current working
# directory. This file lives at apps/server/app/settings.py, so the repo
# root is 3 parents up. Without this, launching uvicorn from apps/server
# would make pydantic-settings look for .env in the wrong place.
_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    """Strongly-typed app configuration, loaded once from .env."""

    # Async SQLAlchemy URL: postgresql+asyncpg://user:pw@host:5432/db
    database_url: str

    # JWT signing. The secret has NO default on purpose: a missing
    # JWT_SECRET must fail loudly at startup, never fall back to a
    # guessable value.
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24  # 24h

    # CORS allow-list (Vite dev server; 5174 is the fallback port).
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:5174",
    ]

    model_config = SettingsConfigDict(
        env_file=_ENV_FILE,
        env_file_encoding="utf-8",
        # .env also holds POSTGRES_* keys (for docker-compose) that are
        # not fields here — ignore them instead of raising a ValidationError.
        extra="ignore",
        case_sensitive=False,
    )


@lru_cache
def get_settings() -> Settings:
    """Cached accessor so .env is parsed exactly once per process."""
    return Settings()
