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

    # Stage 9 — used by /shares to build the public share_url returned
    # on POST /shares. Local dev defaults to the Vite dev server origin;
    # production overrides via FRONTEND_BASE_URL in deploy/.env.prod.
    frontend_base_url: str = "http://localhost:5173"

    # --- Stage 6: AI integration ---
    # Keys default to None on purpose: the app must boot WITHOUT any AI
    # credentials (stages 0-5 stay fully functional). Each /ai endpoint
    # returns 503 "AI not configured" when its key is missing, rather
    # than crashing startup.
    #
    # Text tasks (suggest-tags / knowledge-summary / generate) -> DeepSeek;
    # vision (parse-question) -> Gemini. Both speak OpenAI-compatible Chat
    # Completions, so one client class covers both — only base_url / key /
    # model differ.
    deepseek_api_key: str | None = None
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"  # DeepSeek-V3

    # Put a Gemini API key in VISION_API_KEY. The base_url is Google's
    # OpenAI-compatibility shim so the same AsyncOpenAI client works.
    #
    # Model note: the roadmap named "gemini-2.0-flash", but Google has
    # retired that bare alias for NEW API keys (the completions call
    # 404s even though it still shows in /models). gemini-2.5-flash-lite
    # is the current cheapest vision-capable Flash tier with a free
    # quota — same "negligible personal cost" intent. Override via
    # VISION_MODEL without any code change.
    vision_api_key: str | None = None
    vision_base_url: str = (
        "https://generativelanguage.googleapis.com/v1beta/openai/"
    )
    vision_model: str = "gemini-2.5-flash-lite"

    # Cost controls. Daily token cap is enforced per user in app.llm;
    # the per-minute request cap is enforced by slowapi (main.py).
    # ai_max_tokens caps every single completion's output.
    ai_daily_token_limit: int = 200_000
    ai_rate_limit_per_min: int = 20
    ai_max_tokens: int = 1024

    # --- Phase 11: email verification ---
    # When None, mail.send_verification() prints the code to stdout
    # instead of calling the Resend API (same pattern as the AI keys).
    resend_api_key: str | None = None
    mail_from: str = "FastQBank <onboarding@resend.dev>"

    # --- Phase 11.3: Google sign-in (one client per platform) ---
    # Google enforces redirect-URI rules per client type, so we need
    # TWO OAuth clients:
    #   - Web Application:  https://<domain>/oauth/callback (per-URL
    #     registration required). Used by the browser flow.
    #   - Desktop app:      http://127.0.0.1:<port>/oauth/callback
    #     (Google auto-allows ANY loopback port without registration).
    #     Used by the Electron loopback flow.
    # Either, both, or neither may be set — /auth/providers reports
    # which platforms are available and the frontend gates the
    # Continue-with-Google button accordingly.
    google_web_client_id: str | None = None
    google_web_client_secret: str | None = None
    google_desktop_client_id: str | None = None
    google_desktop_client_secret: str | None = None
    oauth_redirect_uri_web: str = "http://localhost:5173/oauth/callback"

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
