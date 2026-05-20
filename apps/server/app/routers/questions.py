"""Question CRUD (Roadmap stage 2).

Conventions mirror auth.py / tags.py: explicit paths, `user: CurrentUser`,
`db: AsyncSession = Depends(get_db)`, every query scoped to the user AND
`deleted_at IS NULL`. Deletes are SOFT (stage 3): the delete endpoint
sets `deleted_at` instead of removing the row; reads already filter it,
so they're unchanged and a delete is reversible. Conflict policy is LWW
by server clock — `updated_at` is stamped `now()` on every mutation, so
the last write to reach the server wins (acceptable for personal use).

models.py declares NO ORM relationship on purpose (async lazy-load =
MissingGreenlet), so tags are loaded explicitly and the list endpoint
batch-loads them to avoid an N+1.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import CurrentUser
from app.models import Question, QuestionTag, Tag
from app.question_query import (
    get_owned_question,
    multi_tag_predicate,
    tags_by_question,
    tags_for,
    to_question_out,
)
from app.schemas import (
    BulkAddTagsIn,
    BulkAddTagsOut,
    QuestionIn,
    QuestionListOut,
    QuestionOut,
    QuestionUpdate,
)

# No prefix: paths written out explicitly, mirroring auth.py.
router = APIRouter(tags=["questions"])


async def _validate_tag_ids(
    db: AsyncSession, user: CurrentUser, tag_ids: list[UUID]
) -> list[UUID]:
    """Dedupe (preserving order) and assert every tag is owned & live.
    Any unknown/foreign/deleted id => 400 (bad reference in the body)."""
    unique = list(dict.fromkeys(tag_ids))
    if not unique:
        return []
    found = (
        await db.scalars(
            select(Tag.id).where(
                Tag.id.in_(unique),
                Tag.user_id == user.id,
                Tag.deleted_at.is_(None),
            )
        )
    ).all()
    if len(found) != len(unique):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="one or more tag_ids are invalid or not yours",
        )
    return unique


@router.get("/questions", response_model=QuestionListOut)
async def list_questions(
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    tag_id: list[UUID] = Query(default_factory=list),
    tag_match: str = Query("all", pattern="^(all|any)$"),
    q: str | None = Query(None),
) -> QuestionListOut:
    """Paginated list with optional keyword (ILIKE on stem) and one or
    more tag filters joined by AND (`tag_match=all`, default) or OR
    (`tag_match=any`). `total` is the match count BEFORE limit/offset."""
    conds = [Question.user_id == user.id, Question.deleted_at.is_(None)]
    if q:
        conds.append(Question.stem.ilike(f"%{q}%"))
    if tag_id:
        conds.append(
            await multi_tag_predicate(db, user.id, tag_id, tag_match)
        )

    total = await db.scalar(
        select(func.count()).select_from(Question).where(*conds)
    )
    questions = list(
        (
            await db.scalars(
                select(Question)
                .where(*conds)
                .order_by(Question.created_at.desc())
                .limit(limit)
                .offset(offset)
            )
        ).all()
    )

    qids = [qq.id for qq in questions]
    tags_by_q = await tags_by_question(db, qids)
    items = [to_question_out(qq, tags_by_q.get(qq.id, [])) for qq in questions]
    return QuestionListOut(
        items=items, total=total or 0, limit=limit, offset=offset
    )


@router.get("/questions/{question_id}", response_model=QuestionOut)
async def get_question(
    question_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> QuestionOut:
    """One owned question with its tags (used to prefill the edit form)."""
    question = await get_owned_question(db, user.id, question_id)
    tags = await tags_for(db, question.id)
    return to_question_out(question, tags)


@router.post(
    "/questions",
    response_model=QuestionOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_question(
    body: QuestionIn,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> QuestionOut:
    """Create a question (QuestionIn already enforced type/option/correct
    consistency) and link the validated tags."""
    tag_ids = await _validate_tag_ids(db, user, body.tag_ids)

    question = Question(
        user_id=user.id,
        stem=body.stem,
        type=body.type,
        options=[o.model_dump() for o in body.options],
        correct=list(body.correct),
        knowledge_summary=body.knowledge_summary,
        source=body.source,
    )
    db.add(question)
    await db.flush()  # assigns DB-generated id
    for tid in tag_ids:
        db.add(QuestionTag(question_id=question.id, tag_id=tid))
    await db.commit()
    await db.refresh(question)

    tags = await tags_for(db, question.id)
    return to_question_out(question, tags)


@router.put("/questions/{question_id}", response_model=QuestionOut)
async def update_question(
    question_id: UUID,
    body: QuestionUpdate,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> QuestionOut:
    """Full replace of scalar fields + replace-all of tag links. `source`
    in the body is intentionally ignored so editing an OCR/AI question
    never silently rewrites its origin."""
    question = await get_owned_question(db, user.id, question_id)
    tag_ids = await _validate_tag_ids(db, user, body.tag_ids)

    question.stem = body.stem
    question.type = body.type
    question.options = [o.model_dump() for o in body.options]
    question.correct = list(body.correct)
    question.knowledge_summary = body.knowledge_summary
    question.updated_at = func.now()

    # Replace-all: clearer than diffing, and avoids partial-merge bugs.
    await db.execute(
        delete(QuestionTag).where(QuestionTag.question_id == question.id)
    )
    for tid in tag_ids:
        db.add(QuestionTag(question_id=question.id, tag_id=tid))
    await db.commit()
    await db.refresh(question)

    tags = await tags_for(db, question.id)
    return to_question_out(question, tags)


@router.delete(
    "/questions/{question_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_question(
    question_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Soft-delete (stage 3): set `deleted_at` instead of removing the
    row. Every read path filters `deleted_at IS NULL`, so the question
    disappears from list/get while staying recoverable. question_tags
    links are kept (harmless — the question itself is hidden)."""
    question = await get_owned_question(db, user.id, question_id)
    question.deleted_at = func.now()
    await db.commit()


@router.post("/questions/bulk-tags", response_model=BulkAddTagsOut)
async def bulk_add_tags(
    body: BulkAddTagsIn,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> BulkAddTagsOut:
    """Append tag links to many questions atomically.

    Existing tags on each question are untouched (union, never replace).
    Foreign / unknown / soft-deleted question_ids and tag_ids are
    silently skipped (matches the tolerance for stale client state in
    POST /review/deck). Idempotent via PG ON CONFLICT DO NOTHING on the
    question_tags composite PK.
    """
    # Validate ownership/liveness; drop unknown ids (don't error so a
    # racing delete-in-another-tab doesn't 500 the whole bulk op).
    live_qs = list(
        (
            await db.scalars(
                select(Question.id).where(
                    Question.id.in_(body.question_ids),
                    Question.user_id == user.id,
                    Question.deleted_at.is_(None),
                )
            )
        ).all()
    )
    live_tags = list(
        (
            await db.scalars(
                select(Tag.id).where(
                    Tag.id.in_(body.tag_ids),
                    Tag.user_id == user.id,
                    Tag.deleted_at.is_(None),
                )
            )
        ).all()
    )
    if not live_qs or not live_tags:
        return BulkAddTagsOut(questions_updated=0, links_added=0)

    rows = [
        {"question_id": qid, "tag_id": tid}
        for qid in live_qs
        for tid in live_tags
    ]
    # ON CONFLICT DO NOTHING on the (question_id, tag_id) composite PK
    # makes this a true "append, idempotent" operation. `returning(*PK)`
    # gives us the rows that were actually inserted so we can count.
    stmt = (
        pg_insert(QuestionTag)
        .values(rows)
        .on_conflict_do_nothing(
            index_elements=["question_id", "tag_id"],
        )
        .returning(QuestionTag.question_id, QuestionTag.tag_id)
    )
    inserted = (await db.execute(stmt)).all()
    await db.commit()

    questions_touched = {qid for qid, _ in inserted}
    return BulkAddTagsOut(
        questions_updated=len(questions_touched),
        links_added=len(inserted),
    )
