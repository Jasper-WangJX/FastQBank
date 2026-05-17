from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Repo-root .env (apps/server/app/settings.py -> 3 parents up), resolved
# independently of CWD so launching uvicorn from any directory still
# finds it. In the Docker image the code lives shallower
# (/app/app/settings.py) with no repo-root .env — fall back to None so
# pydantic-settings just reads real environment variables (which
# docker-compose injects). Indexing parents[3] blindly would IndexError
# there and crash startup.
_resolved = Path(__file__).resolve()
_ENV_FILE = (
    _resolved.parents[3] / ".env" if len(_resolved.parents) > 3 else None
)


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

    # CORS allow-list. Vite dev server (5174 is the fallback port) plus
    # the Electron desktop shell: its renderer loads the SPA via the
    # custom `app://aqb` scheme (stage 4), so that fixed origin must be
    # whitelisted or every API call from the desktop app is blocked.
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:5174",
        "app://aqb",
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
