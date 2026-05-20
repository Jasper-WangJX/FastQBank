from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text

from app.db import engine
from app.ratelimit import limiter
from app.routers import ai, auth, questions, review, shares, tags
from app.settings import get_settings

settings = get_settings()

# The FastAPI application instance. Uvicorn loads this object ("main:app").
# NOTE: this `app` (a FastAPI instance) is unrelated to the `app` package
# imported above — `from app.xxx import` always resolves the package, not
# this module-level variable.
app = FastAPI(title="AI Question Bank API")

# slowapi (stage 6): the /ai routes decorate themselves with
# @limiter.limit(...). The limiter must hang off app.state and a 429
# handler must be registered for those decorators to take effect; this
# is inert for every non-/ai route.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS: a browser blocks cross-origin requests unless the server opts in.
# The origin list now comes from settings so it lives in exactly one place.
# (allow_credentials=True forbids the "*" wildcard, so the explicit list
# stays — Vite uses 5174 if 5173 is taken; both are whitelisted.)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Auth endpoints: /auth/register, /auth/login, /me
app.include_router(auth.router)
# Stage 2 — tag + question CRUD
app.include_router(tags.router)
app.include_router(questions.router)
# Stage 6 — AI endpoints (text now; vision parse-question in step 5)
app.include_router(ai.router)
# Stage 7 — Flashcards review endpoints
app.include_router(review.router)
# Stage 9 — Share-link cross-account transfer + bulk operations
app.include_router(shares.router)


# Liveness probe: the front-end HealthCheck component calls this on
# startup to confirm the browser -> React -> FastAPI chain works.
@app.get("/health")
def health():
    return {"status": "ok"}


# Readiness probe: proves settings loaded AND the async engine can
# actually reach Postgres. Raises (HTTP 500) if the DB is down or
# DATABASE_URL is wrong — this is the B1 exit check.
@app.get("/health/db")
async def health_db():
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    return {"status": "ok", "db": "connected"}
