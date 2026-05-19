"""Shared question-read helpers used by /questions and /review.

Extracted verbatim from routers/questions.py so there is exactly one
implementation of (a) the multi-tag AND/OR predicate, (b) the owned-question
fetch, (c) the QuestionOut builder, and (d) the batched tag loader that
avoids an N+1 on list responses. No ORM relationship is used on purpose
(async lazy-load = MissingGreenlet); tags are loaded explicitly.
"""

from collections import defaultdict
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import false, select
from sqlalchemy.sql.elements import ColumnElement
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Question, QuestionTag, Tag
from app.schemas import QuestionOut


def to_question_out(q: Question, tags: list[Tag]) -> QuestionOut:
    """Build the response model. `tags` is supplied explicitly (no ORM
    relationship); pydantic validates the ORM Tag objects via TagOut's
    from_attributes, and the JSONB option dicts via OptionOut."""
    return QuestionOut(
        id=q.id,
        user_id=q.user_id,
        stem=q.stem,
        type=q.type,
        options=q.options,
        correct=q.correct,
        knowledge_summary=q.knowledge_summary,
        source=q.source,
        created_at=q.created_at,
        updated_at=q.updated_at,
        tags=tags,
    )


async def get_owned_question(
    db: AsyncSession, user_id: UUID, question_id: UUID
) -> Question:
    """Fetch a live question owned by the user, or 404 (not 403 — don't
    leak which ids exist)."""
    q = await db.scalar(
        select(Question).where(
            Question.id == question_id,
            Question.user_id == user_id,
            Question.deleted_at.is_(None),
        )
    )
    if q is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="question not found",
        )
    return q


async def tags_for(db: AsyncSession, question_id: UUID) -> list[Tag]:
    """Live tags linked to one question, ordered by name."""
    rows = await db.scalars(
        select(Tag)
        .join(QuestionTag, QuestionTag.tag_id == Tag.id)
        .where(
            QuestionTag.question_id == question_id,
            Tag.deleted_at.is_(None),
        )
        .order_by(Tag.name)
    )
    return list(rows.all())


async def tags_by_question(
    db: AsyncSession, question_ids: list[UUID]
) -> dict[UUID, list[Tag]]:
    """One query for all tags across many questions, grouped in Python
    (avoids an N+1 when building a list response)."""
    out: dict[UUID, list[Tag]] = defaultdict(list)
    if not question_ids:
        return out
    rows = (
        await db.execute(
            select(QuestionTag.question_id, Tag)
            .join(Tag, Tag.id == QuestionTag.tag_id)
            .where(
                QuestionTag.question_id.in_(question_ids),
                Tag.deleted_at.is_(None),
            )
            .order_by(Tag.name)
        )
    ).all()
    for qid, tag in rows:
        out[qid].append(tag)
    return out


async def multi_tag_predicate(
    db: AsyncSession,
    user_id: UUID,
    tag_ids: list[UUID],
    match: str,
) -> ColumnElement[bool]:
    """Build a SQLAlchemy boolean expression matching questions tagged
    with the given tag ids under either AND (`match="all"`) or OR
    (`match="any"`) semantics.

    - tag_ids = [] => true() (no filter)
    - Any unknown/foreign/deleted tag id => false() so the caller matches
      nothing rather than erroring (callers may have stale ids).
    - match="all": one EXISTS subquery per tag (deterministic, indexed
      lookup on (question_id, tag_id) via the question_tags PK).
    - match="any": single EXISTS with tag_id IN (...).
    """
    from sqlalchemy import and_, true

    if not tag_ids:
        return true()

    # Validate ownership + liveness; drop unknown ids. If everything
    # was unknown we return false() (matches nothing, no error).
    valid_ids = list(
        (
            await db.scalars(
                select(Tag.id).where(
                    Tag.id.in_(tag_ids),
                    Tag.user_id == user_id,
                    Tag.deleted_at.is_(None),
                )
            )
        ).all()
    )
    if not valid_ids:
        return false()

    if match == "any":
        return (
            select(QuestionTag.question_id)
            .where(
                QuestionTag.question_id == Question.id,
                QuestionTag.tag_id.in_(valid_ids),
            )
            .exists()
        )

    # "all" semantics: AND of N EXISTS subqueries.
    return and_(
        *(
            select(QuestionTag.question_id)
            .where(
                QuestionTag.question_id == Question.id,
                QuestionTag.tag_id == tid,
            )
            .exists()
            for tid in valid_ids
        )
    )
