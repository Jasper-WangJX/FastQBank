"""Tag CRUD (flat, post-phase-8 refactor).

Tags are FLAT — no parent_id/path. Per-user uniqueness is enforced by the
partial unique index `uq_tags_user_name` (deleted_at IS NULL); the router
also pre-checks so callers get a clean 409 instead of an IntegrityError.

Every query is scoped to the current user AND `deleted_at IS NULL`.
Deletes are SOFT: the endpoint sets `deleted_at` instead of removing the
row; reads already filter it. question_tags links are kept (harmless —
the tag is hidden from reads).
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import CurrentUser
from app.models import Tag
from app.schemas import TagIn, TagOut, TagRename

router = APIRouter(tags=["tags"])


async def _get_owned_tag(
    db: AsyncSession, user: CurrentUser, tag_id: UUID
) -> Tag:
    """Fetch a live tag owned by the user, or raise 404. 404 (not 403)
    on not-owned avoids leaking which ids exist."""
    tag = await db.scalar(
        select(Tag).where(
            Tag.id == tag_id,
            Tag.user_id == user.id,
            Tag.deleted_at.is_(None),
        )
    )
    if tag is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="tag not found"
        )
    return tag


async def _name_taken(
    db: AsyncSession,
    user: CurrentUser,
    name: str,
    *,
    exclude_id: UUID | None = None,
) -> bool:
    """Soft pre-check mirroring the partial unique index. Returns True if
    another live tag of this user already owns `name`."""
    stmt = select(Tag.id).where(
        Tag.user_id == user.id,
        Tag.deleted_at.is_(None),
        Tag.name == name,
    )
    if exclude_id is not None:
        stmt = stmt.where(Tag.id != exclude_id)
    return (await db.scalar(stmt)) is not None


@router.post(
    "/tags", response_model=TagOut, status_code=status.HTTP_201_CREATED
)
async def create_tag(
    body: TagIn, user: CurrentUser, db: AsyncSession = Depends(get_db)
) -> Tag:
    """Create a flat tag for this user. 409 on duplicate name."""
    if await _name_taken(db, user, body.name):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="a tag with this name already exists",
        )
    tag = Tag(user_id=user.id, name=body.name)
    db.add(tag)
    await db.commit()
    await db.refresh(tag)
    return tag


@router.patch("/tags/{tag_id}", response_model=TagOut)
async def rename_tag(
    tag_id: UUID,
    body: TagRename,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> Tag:
    """Rename a tag. 409 on duplicate name."""
    tag = await _get_owned_tag(db, user, tag_id)
    if body.name != tag.name and await _name_taken(
        db, user, body.name, exclude_id=tag.id
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="a tag with this name already exists",
        )
    tag.name = body.name
    tag.updated_at = func.now()
    await db.commit()
    await db.refresh(tag)
    return tag


@router.delete("/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tag(
    tag_id: UUID, user: CurrentUser, db: AsyncSession = Depends(get_db)
) -> None:
    """Soft-delete the tag (sets deleted_at). question_tags links are
    intentionally kept — every read path filters `Tag.deleted_at IS NULL`
    so questions simply stop showing this tag."""
    tag = await _get_owned_tag(db, user, tag_id)
    tag.deleted_at = func.now()
    await db.commit()


@router.get("/tags", response_model=list[TagOut])
async def list_tags(
    user: CurrentUser, db: AsyncSession = Depends(get_db)
) -> list[Tag]:
    """All live tags for the user as a flat list ordered by name."""
    rows = await db.scalars(
        select(Tag)
        .where(Tag.user_id == user.id, Tag.deleted_at.is_(None))
        .order_by(Tag.name)
    )
    return list(rows.all())
