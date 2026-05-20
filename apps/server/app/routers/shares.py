"""Share-link cross-account transfer (Roadmap stage 9).

Five endpoints:
  POST   /shares                    — create a share from owned question ids
  GET    /shares/{token}            — public preview (no auth)
  POST   /shares/{token}/import     — import the snapshot into the caller's account
  GET    /shares/me                 — list caller's active shares (for revoke UI)
  DELETE /shares/{id}               — soft-delete (revoke) a share owned by the caller

Conventions mirror routers/questions.py and routers/review.py: no router
prefix, `user: CurrentUser` on the authed routes, every query scoped to
the user (where applicable) AND `deleted_at IS NULL`, 404 (not 403) on
foreign / missing ids.
"""

from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import CurrentUser
from app.models import Question, QuestionTag, Share, Tag
from app.question_query import tags_by_question
from app.schemas import (
    MyShareListOut,
    MyShareRow,
    ShareCreateIn,
    ShareCreateOut,
    ShareImportOut,
    SharePayload,
    SharePreviewOut,
    SharedQuestion,
)
from app.settings import get_settings
from app.share_token import generate_share_token, is_valid_share_token

router = APIRouter(tags=["shares"])


@router.post(
    "/shares",
    response_model=ShareCreateOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_share(
    body: ShareCreateIn,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> ShareCreateOut:
    """Snapshot the named live owned questions into a new share row.
    404 if any id isn't owned/live (so the user gets a clear error
    rather than a silently shortened snapshot)."""
    # Dedup ids preserving order
    unique_ids = list(dict.fromkeys(body.question_ids))

    rows = list(
        (
            await db.scalars(
                select(Question).where(
                    Question.id.in_(unique_ids),
                    Question.user_id == user.id,
                    Question.deleted_at.is_(None),
                )
            )
        ).all()
    )
    found_ids = {q.id for q in rows}
    missing = [qid for qid in unique_ids if qid not in found_ids]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"question not found or not owned: {missing[0]}",
        )

    # Preserve the caller's order in the payload
    by_id = {q.id: q for q in rows}
    ordered = [by_id[qid] for qid in unique_ids]

    tags_by_q = await tags_by_question(db, [q.id for q in ordered])

    payload_questions = [
        SharedQuestion(
            source_id=q.id,
            stem=q.stem,
            type=q.type,
            options=q.options,
            correct=q.correct,
            knowledge_summary=q.knowledge_summary,
            source=q.source,
            tag_names=[t.name for t in tags_by_q.get(q.id, [])],
        )
        for q in ordered
    ]
    payload = SharePayload(version=1, questions=payload_questions)

    # Try a few times in the (astronomically unlikely) case of a token
    # collision — the unique constraint protects correctness; this loop
    # just turns a 500 into a transparent retry.
    token = ""
    for _ in range(5):
        token = generate_share_token()
        share = Share(
            id=uuid4(),
            creator_id=user.id,
            token=token,
            payload=payload.model_dump(mode="json"),
        )
        db.add(share)
        try:
            await db.commit()
            break
        except IntegrityError:  # token collision
            await db.rollback()
            continue
    else:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="could not allocate a share token; please retry",
        )

    settings = get_settings()
    base = settings.frontend_base_url.rstrip("/")
    return ShareCreateOut(token=token, share_url=f"{base}/s/{token}")


# IMPORTANT: any static `/shares/<word>` route must be declared ABOVE
# `/shares/{token}` below — FastAPI matches in registration order, and
# the parametric route will otherwise capture the request (see the
# previously-fixed `/shares/me` vs `{token}` shadowing bug).
@router.get("/shares/me", response_model=MyShareListOut)
async def list_my_shares(
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> MyShareListOut:
    """Current user's active shares, newest first. `question_count` is
    derived from `len(payload['questions'])` to avoid a second table /
    a denormalized counter."""
    rows = list(
        (
            await db.scalars(
                select(Share)
                .where(
                    Share.creator_id == user.id,
                    Share.deleted_at.is_(None),
                )
                .order_by(Share.created_at.desc())
            )
        ).all()
    )
    items = [
        MyShareRow(
            id=r.id,
            token=r.token,
            question_count=len(r.payload.get("questions", [])),
            created_at=r.created_at,
        )
        for r in rows
    ]
    return MyShareListOut(items=items)


async def _get_active_share_by_token(
    db: AsyncSession, token: str
) -> Share:
    """Fetch by token. 404 on unknown / malformed; 410 on revoked."""
    if not is_valid_share_token(token):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="share not found"
        )
    row = await db.scalar(select(Share).where(Share.token == token))
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="share not found"
        )
    if row.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="this share has been revoked",
        )
    return row


@router.get("/shares/{token}", response_model=SharePreviewOut)
async def get_share(
    token: str,
    db: AsyncSession = Depends(get_db),
) -> SharePreviewOut:
    """Public — no auth. Returns payload + created_at only. Creator
    identity is intentionally not exposed (spec §2.2)."""
    share = await _get_active_share_by_token(db, token)
    return SharePreviewOut(
        payload=SharePayload.model_validate(share.payload),
        created_at=share.created_at,
    )


@router.post(
    "/shares/{token}/import", response_model=ShareImportOut
)
async def import_share(
    token: str,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> ShareImportOut:
    """Pull the snapshot into the caller's account.

    Dedup: skip a question if the caller already owns a row where
    `id = source_id` (self-import) OR `imported_from_id = source_id`
    (re-import). `deleted_at` is NOT filtered — re-importing one the
    caller previously deleted does NOT undelete; it is silently
    skipped. Tag names are find-or-created under the caller's account.
    """
    share = await _get_active_share_by_token(db, token)
    payload = SharePayload.model_validate(share.payload)

    if not payload.questions:
        return ShareImportOut(
            imported=0, skipped=0, tags_created=0, tags_reused=0
        )

    src_ids = [qq.source_id for qq in payload.questions]

    # Dedup query: any of the caller's rows whose id OR imported_from_id
    # matches a source_id (deleted_at-agnostic).
    existing_pairs = (
        await db.execute(
            select(Question.id, Question.imported_from_id).where(
                Question.user_id == user.id,
                or_(
                    Question.id.in_(src_ids),
                    Question.imported_from_id.in_(src_ids),
                ),
            )
        )
    ).all()
    already: set[UUID] = set()
    src_set = set(src_ids)
    for qid, imp in existing_pairs:
        if qid in src_set:
            already.add(qid)
        if imp in src_set:
            already.add(imp)

    new_questions = [
        qq for qq in payload.questions if qq.source_id not in already
    ]
    skipped = len(payload.questions) - len(new_questions)

    # Tag find-or-create — batched, race-safe.
    # ON CONFLICT DO NOTHING under the partial unique index handles a
    # concurrent same-user import (or double-click) without raising
    # IntegrityError. We re-SELECT afterwards to pick up both the rows
    # we just inserted and the ones a parallel request inserted.
    needed_names: set[str] = set()
    for qq in new_questions:
        needed_names.update(qq.tag_names)

    tags_created = 0
    tags_reused = 0
    existing_tags_by_name: dict[str, Tag] = {}

    if needed_names:
        # Count existing (live) tags BEFORE we attempt any insert, so
        # `tags_reused` is "names that were already present in this
        # user's tag list, not counting names created by this import".
        pre_existing = (
            await db.scalars(
                select(Tag).where(
                    Tag.user_id == user.id,
                    Tag.name.in_(needed_names),
                    Tag.deleted_at.is_(None),
                )
            )
        ).all()
        tags_reused = len(pre_existing)
        existing_tags_by_name = {t.name: t for t in pre_existing}

        # Batch-insert the new names with ON CONFLICT DO NOTHING. The
        # partial unique index `uq_tags_user_name` (deleted_at IS NULL)
        # is the conflict target, so a concurrent insert by the same
        # user is silently absorbed.
        to_create = [
            n for n in needed_names if n not in existing_tags_by_name
        ]
        if to_create:
            stmt = (
                pg_insert(Tag)
                .values(
                    [{"user_id": user.id, "name": n} for n in to_create]
                )
                .on_conflict_do_nothing(
                    index_elements=["user_id", "name"],
                    index_where=text("deleted_at IS NULL"),
                )
            )
            await db.execute(stmt)

            # Re-SELECT to capture both our newly-inserted rows and any
            # that a concurrent request inserted while we were running.
            rows = (
                await db.scalars(
                    select(Tag).where(
                        Tag.user_id == user.id,
                        Tag.name.in_(to_create),
                        Tag.deleted_at.is_(None),
                    )
                )
            ).all()
            for t in rows:
                if t.name not in existing_tags_by_name:
                    existing_tags_by_name[t.name] = t
                    tags_created += 1

    # Insert questions + their tag links
    for qq in new_questions:
        q = Question(
            user_id=user.id,
            stem=qq.stem,
            type=qq.type,
            options=[o.model_dump() for o in qq.options],
            correct=list(qq.correct),
            knowledge_summary=qq.knowledge_summary,
            source=qq.source,
            imported_from_id=qq.source_id,
        )
        db.add(q)
        await db.flush()
        for name in qq.tag_names:
            tag = existing_tags_by_name.get(name)
            if tag is not None:
                db.add(QuestionTag(question_id=q.id, tag_id=tag.id))

    await db.commit()

    return ShareImportOut(
        imported=len(new_questions),
        skipped=skipped,
        tags_created=tags_created,
        tags_reused=tags_reused,
    )


@router.delete(
    "/shares/{share_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def revoke_share(
    share_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Soft-delete a share owned by the caller. 404 if not theirs OR
    already revoked (the user can't 'unrevoke' or revoke twice)."""
    row = await db.scalar(
        select(Share).where(
            Share.id == share_id,
            Share.creator_id == user.id,
            Share.deleted_at.is_(None),
        )
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="share not found",
        )
    row.deleted_at = func.now()
    await db.commit()
