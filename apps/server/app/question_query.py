"""Shared question-read helpers used by /questions and /review.

Extracted verbatim from routers/questions.py so there is exactly one
implementation of (a) the tag-subtree predicate, (b) the owned-question
fetch, (c) the QuestionOut builder, and (d) the batched tag loader that
avoids an N+1 on list responses. No ORM relationship is used on purpose
(async lazy-load = MissingGreenlet); tags are loaded explicitly.
"""

from collections import defaultdict
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import false, or_, select
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
    """Live tags linked to one question, ordered by path."""
    rows = await db.scalars(
        select(Tag)
        .join(QuestionTag, QuestionTag.tag_id == Tag.id)
        .where(
            QuestionTag.question_id == question_id,
            Tag.deleted_at.is_(None),
        )
        .order_by(Tag.path)
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
            .order_by(Tag.path)
        )
    ).all()
    for qid, tag in rows:
        out[qid].append(tag)
    return out


async def subtree_question_predicate(
    db: AsyncSession, user_id: UUID, tag_id: UUID
) -> ColumnElement[bool]:
    """A SQLAlchemy boolean expression selecting questions tagged with
    `tag_id` OR any descendant tag (id-based materialized paths make the
    subtree a pure prefix query). If the tag isn't an owned, live tag,
    returns a `false()` expression so the caller matches nothing instead
    of erroring (mirrors the original questions.py behaviour)."""
    base_path = await db.scalar(
        select(Tag.path).where(
            Tag.id == tag_id,
            Tag.user_id == user_id,
            Tag.deleted_at.is_(None),
        )
    )
    if base_path is None:
        return false()
    return (
        select(QuestionTag.question_id)
        .join(Tag, Tag.id == QuestionTag.tag_id)
        .where(
            QuestionTag.question_id == Question.id,
            Tag.user_id == user_id,
            Tag.deleted_at.is_(None),
            or_(
                Tag.path == base_path,
                Tag.path.like(base_path + "/%"),
            ),
        )
        .exists()
    )
