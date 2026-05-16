from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.settings import get_settings

settings = get_settings()

# One engine per process. pool_pre_ping issues a cheap liveness check
# before handing out a pooled connection, avoiding "server closed the
# connection" errors after Postgres restarts or idle timeouts.
engine = create_async_engine(settings.database_url, pool_pre_ping=True)

# expire_on_commit=False is critical with async SQLAlchemy: the default
# True expires ORM attributes after commit(), so the next attribute
# access triggers a lazy reload — which, outside an async context, raises
# MissingGreenlet. Keeping objects usable after commit lets routers
# serialize them into response models (see B5/B6).
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    """Declarative base shared by every ORM model (defined in models.py)."""


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency: yields a session, always closed afterwards."""
    async with AsyncSessionLocal() as session:
        yield session
