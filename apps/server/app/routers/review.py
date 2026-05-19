"""Flashcards review + wrong-question set (Roadmap stage 7).

Conventions mirror questions.py: no router prefix, explicit paths,
`user: CurrentUser`, every query scoped to the user AND
`deleted_at IS NULL`, 404 (not 403) for a missing/foreign question id.
Session state is client-side; this router is stateless.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
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
    QuestionOut,
    ReviewLogIn,
    TagQuestionIdsOut,
    WrongListOut,
)

router = APIRouter(tags=["review"])


async def _questions_out(
    db: AsyncSession, questions: list[Question]
) -> list[QuestionOut]:
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
        stmt = stmt.order_by(Question.created_at.desc()).limit(1000)
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


@router.post("/review/logs", status_code=status.HTTP_204_NO_CONTENT)
async def review_log(
    body: ReviewLogIn,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Record one answered card. Always inserts a ReviewLog (history is
    kept). On a wrong answer, upsert wrong_questions active (PG
    ON CONFLICT, mirrors the AiUsage pattern): first entry, or
    reactivate a previously-mastered row. A correct answer does NOT
    touch wrong_questions (per the confirmed "manual clear" semantics).
    404 if the question isn't the user's / is soft-deleted."""
    await get_owned_question(db, user.id, body.question_id)

    db.add(
        ReviewLog(
            user_id=user.id,
            question_id=body.question_id,
            correct=body.correct,
        )
    )

    if not body.correct:
        stmt = (
            pg_insert(WrongQuestion)
            .values(
                user_id=user.id,
                question_id=body.question_id,
                cleared_at=None,
            )
            .on_conflict_do_update(
                constraint="uq_wrong_questions_user_question",
                set_={"cleared_at": None, "added_at": func.now()},
            )
        )
        await db.execute(stmt)

    await db.commit()


@router.get("/review/wrong", response_model=WrongListOut)
async def review_wrong(
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> WrongListOut:
    """Active wrong questions (cleared_at IS NULL) for this user, newest
    first, excluding soft-deleted questions. `total` backs the picker's
    "⚠ Wrong questions (N)" entry."""
    questions = list(
        (
            await db.scalars(
                select(Question)
                .join(
                    WrongQuestion,
                    WrongQuestion.question_id == Question.id,
                )
                .where(
                    WrongQuestion.user_id == user.id,
                    WrongQuestion.cleared_at.is_(None),
                    Question.deleted_at.is_(None),
                )
                .order_by(WrongQuestion.added_at.desc())
            )
        ).all()
    )
    items = await _questions_out(db, questions)
    return WrongListOut(items=items, total=len(items))


@router.post(
    "/review/wrong/{question_id}/master",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def review_master(
    question_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Mark a question as mastered: set cleared_at on the active row so
    it leaves the wrong set (the row stays — a later wrong answer
    reactivates it). 404 if it isn't currently in the active set."""
    row = await db.scalar(
        select(WrongQuestion).where(
            WrongQuestion.user_id == user.id,
            WrongQuestion.question_id == question_id,
            WrongQuestion.cleared_at.is_(None),
        )
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="not in the active wrong set",
        )
    row.cleared_at = func.now()
    await db.commit()
