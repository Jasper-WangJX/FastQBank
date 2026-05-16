from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.db import engine
from app.routers import auth, questions, tags
from app.settings import get_settings

settings = get_settings()

# The FastAPI application instance. Uvicorn loads this object ("main:app").
# NOTE: this `app` (a FastAPI instance) is unrelated to the `app` package
# imported above — `from app.xxx import` always resolves the package, not
# this module-level variable.
app = FastAPI(title="AI Question Bank API")

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
# Stage 2 — tag tree + question CRUD
app.include_router(tags.router)
app.include_router(questions.router)


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
