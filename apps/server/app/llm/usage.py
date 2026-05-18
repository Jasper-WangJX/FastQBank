"""Per-user daily AI token accounting (Roadmap stage 6 cost control).

`record_usage` upserts one ai_usage row per (user, UTC day) with PG
ON CONFLICT, so concurrent /ai calls accumulate atomically without a
read-modify-write race. `assert_under_daily_cap` is the pre-call gate;
`get_today_usage` backs the GET /ai/usage counter.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AiUsage


def _utc_today() -> "datetime.date":  # noqa: F821 - forward type only
    return datetime.now(timezone.utc).date()


async def get_today_usage(
    db: AsyncSession, user_id: UUID
) -> tuple[int, int]:
    """(total_tokens, request_count) for the user today, (0, 0) if none."""
    row = (
        await db.execute(
            select(AiUsage.total_tokens, AiUsage.request_count).where(
                AiUsage.user_id == user_id,
                AiUsage.day == _utc_today(),
            )
        )
    ).first()
    return (int(row[0]), int(row[1])) if row else (0, 0)


async def assert_under_daily_cap(
    db: AsyncSession, user_id: UUID, daily_limit: int
) -> None:
    """Raise 429 if the user already spent its daily token budget.
    Checked BEFORE the model call (a single call can still overshoot the
    cap a little — acceptable; the next call is then blocked)."""
    total, _ = await get_today_usage(db, user_id)
    if total >= daily_limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"daily AI token limit reached ({total}/{daily_limit}); "
                "resets at 00:00 UTC"
            ),
        )


async def record_usage(
    db: AsyncSession, user_id: UUID, tokens: int
) -> None:
    """Atomically add `tokens` (and +1 request) to today's row, creating
    it on first use of the day. Commits its own unit of work."""
    stmt = pg_insert(AiUsage).values(
        user_id=user_id,
        day=_utc_today(),
        total_tokens=tokens,
        request_count=1,
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_ai_usage_user_day",
        set_={
            "total_tokens": AiUsage.total_tokens + stmt.excluded.total_tokens,
            "request_count": AiUsage.request_count + 1,
            "updated_at": func.now(),
        },
    )
    await db.execute(stmt)
    await db.commit()
