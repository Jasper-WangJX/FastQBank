"""Flashcards review + wrong-question set (Roadmap stage 7).

Conventions mirror questions.py: no router prefix, explicit paths,
`user: CurrentUser`, every query scoped to the user AND
`deleted_at IS NULL`, 404 (not 403) for a missing/foreign question id.
Session state is client-side; this router is stateless.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import CurrentUser
from app.models import Question, ReviewLog, WrongQuestion
from app.question_query import (
    get_owned_question,
    subtree_question_predicate,
    tags_by_question,
    to_question_out,
)
from app.schemas import (
    DeckIn,
    DeckOut,
    ReviewLogIn,
    TagQuestionIdsOut,
    WrongListOut,
)

router = APIRouter(tags=["review"])


async def _questions_out(
    db: AsyncSession, questions: list[Question]
) -> list:
    """QuestionOut list with one batched tag query (no N+1)."""
    tags_by_q = await tags_by_question(db, [q.id for q in questions])
    return [to_question_out(q, tags_by_q.get(q.id, [])) for q in questions]


@router.post("/review/deck", response_model=DeckOut)
async def review_deck(
    body: DeckIn,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> DeckOut:
    """Resolve the picked ids to live, owned questions. With `limit`,
    return a random sample of that size; otherwise all (cap 1000).
    Foreign / deleted / unknown ids are silently skipped (the client's
    selection may be stale — not an error)."""
    stmt = select(Question).where(
        Question.id.in_(body.question_ids),
        Question.user_id == user.id,
        Question.deleted_at.is_(None),
    )
    if body.limit is not None:
        stmt = stmt.order_by(func.random()).limit(body.limit)
    else:
        stmt = stmt.limit(1000)
    questions = list((await db.scalars(stmt)).all())
    return DeckOut(items=await _questions_out(db, questions))


@router.get("/review/tag-question-ids", response_model=TagQuestionIdsOut)
async def review_tag_question_ids(
    user: CurrentUser,
    tag_id: UUID = Query(...),
    db: AsyncSession = Depends(get_db),
) -> TagQuestionIdsOut:
    """Every live owned question id in `tag_id`'s subtree — backs the
    picker's per-tag "Select all" without paging. Unknown/foreign tag =>
    empty list (matches the subtree-predicate's match-nothing behaviour)."""
    pred = await subtree_question_predicate(db, user.id, tag_id)
    ids = (
        await db.scalars(
            select(Question.id).where(
                Question.user_id == user.id,
                Question.deleted_at.is_(None),
                pred,
            )
        )
    ).all()
    return TagQuestionIdsOut(question_ids=list(ids))
