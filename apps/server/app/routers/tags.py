"""Tag CRUD (Roadmap stage 2).

Materialized path is ID-BASED: a root tag's path is its own UUID, a child's
path is `<parent.path>/<self.id>`. Consequences:
- rename touches only `name` — path is stable, descendants untouched;
- only *move* rewrites the subtree's paths;
- LIKE prefix queries are safe (UUIDs never contain % or _).

Every query is scoped to the current user AND `deleted_at IS NULL`. The
`deleted_at IS NULL` predicate is written now even though deletes are
physical in stage 2 — stage 3 then only swaps DELETE for `SET deleted_at`
with zero read-path changes.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import CurrentUser
from app.models import QuestionTag, Tag
from app.schemas import TagIn, TagMove, TagOut, TagRename

# Root tag = depth 1. depth == path.count("/") + 1, so MAX_DEPTH levels
# means at most MAX_DEPTH - 1 slashes in any path.
MAX_DEPTH = 6

# No prefix: paths are written out explicitly, mirroring auth.py.
router = APIRouter(tags=["tags"])


def _level(path: str) -> int:
    """0-based depth of a path (root == 0). depth = _level + 1."""
    return path.count("/")


def _compute_path(parent: Tag | None, self_id: UUID) -> str:
    """ID-based materialized path for a tag with the given parent."""
    return str(self_id) if parent is None else f"{parent.path}/{self_id}"


async def _get_owned_tag(
    db: AsyncSession, user: CurrentUser, tag_id: UUID
) -> Tag:
    """Fetch a live tag owned by the user, or raise 404. Using 404 (not
    403) for the not-owned case avoids leaking which ids exist."""
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


async def _sibling_name_taken(
    db: AsyncSession,
    user: CurrentUser,
    parent_id: UUID | None,
    name: str,
    *,
    exclude_id: UUID | None = None,
) -> bool:
    """Soft uniqueness check for (user, parent, name). Not a DB constraint
    (that needs a migration) — can be hardened later without touching the
    read path. parent_id NULL needs IS NULL, not `= NULL`."""
    stmt = select(Tag.id).where(
        Tag.user_id == user.id,
        Tag.deleted_at.is_(None),
        Tag.name == name,
        Tag.parent_id.is_(None)
        if parent_id is None
        else Tag.parent_id == parent_id,
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
    """Create a tag. parent_id null => a root tag."""
    parent: Tag | None = None
    if body.parent_id is not None:
        parent = await db.scalar(
            select(Tag).where(
                Tag.id == body.parent_id,
                Tag.user_id == user.id,
                Tag.deleted_at.is_(None),
            )
        )
        if parent is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="parent tag not found",
            )
        # new tag depth = parent depth + 1 = _level(parent)+2
        if _level(parent.path) + 2 > MAX_DEPTH:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"tag hierarchy too deep (max {MAX_DEPTH} levels)",
            )

    if await _sibling_name_taken(db, user, body.parent_id, body.name):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="a sibling tag with this name already exists",
        )

    # path needs the DB-generated id; insert with a placeholder, flush to
    # get the id (Postgres RETURNING), then set the real path before commit.
    tag = Tag(
        user_id=user.id, name=body.name, parent_id=body.parent_id, path=""
    )
    db.add(tag)
    await db.flush()
    tag.path = _compute_path(parent, tag.id)
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
    """Rename only. ID-based paths => `path` and descendants are untouched."""
    tag = await _get_owned_tag(db, user, tag_id)
    if body.name != tag.name and await _sibling_name_taken(
        db, user, tag.parent_id, body.name, exclude_id=tag.id
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="a sibling tag with this name already exists",
        )
    tag.name = body.name
    tag.updated_at = func.now()
    await db.commit()
    await db.refresh(tag)
    return tag


@router.put("/tags/{tag_id}/move", response_model=TagOut)
async def move_tag(
    tag_id: UUID,
    body: TagMove,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> Tag:
    """Re-parent a tag (parent_id null => make it a root) and rewrite the
    paths of the whole moved subtree in one transaction."""
    tag = await _get_owned_tag(db, user, tag_id)

    new_parent: Tag | None = None
    if body.parent_id is not None:
        new_parent = await db.scalar(
            select(Tag).where(
                Tag.id == body.parent_id,
                Tag.user_id == user.id,
                Tag.deleted_at.is_(None),
            )
        )
        if new_parent is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="parent tag not found",
            )
        # Cycle prevention is pure string work thanks to ID-based paths:
        # a descendant's path starts with `<tag.path>/`.
        if (
            new_parent.id == tag.id
            or new_parent.path == tag.path
            or new_parent.path.startswith(tag.path + "/")
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="cannot move a tag under itself or its descendant",
            )

    # The moved subtree = the tag itself + every descendant.
    subtree = list(
        (
            await db.scalars(
                select(Tag).where(
                    Tag.user_id == user.id,
                    Tag.deleted_at.is_(None),
                    or_(
                        Tag.path == tag.path,
                        Tag.path.like(tag.path + "/%"),
                    ),
                )
            )
        ).all()
    )

    # Deepest node after the move must still fit MAX_DEPTH.
    new_tag_level = 0 if new_parent is None else _level(new_parent.path) + 1
    rel_height = max(_level(d.path) for d in subtree) - _level(tag.path)
    if new_tag_level + rel_height + 1 > MAX_DEPTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"move would exceed max depth ({MAX_DEPTH})",
        )

    if await _sibling_name_taken(
        db, user, body.parent_id, tag.name, exclude_id=tag.id
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="a sibling tag with this name already exists",
        )

    old_prefix = tag.path
    new_tag_path = _compute_path(new_parent, tag.id)
    for d in subtree:
        # d.path is either == old_prefix (the tag) or old_prefix + "/...".
        d.path = new_tag_path + d.path[len(old_prefix) :]
        d.updated_at = func.now()
    # `tag` is the same identity-mapped object as its entry in `subtree`,
    # so its path was already rewritten above; just re-parent it.
    tag.parent_id = new_parent.id if new_parent is not None else None

    await db.commit()
    await db.refresh(tag)
    return tag


@router.delete("/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tag(
    tag_id: UUID, user: CurrentUser, db: AsyncSession = Depends(get_db)
) -> None:
    """Delete the tag and its whole subtree; questions are kept but lose
    these tags. Physical delete in stage 2 (see module docstring)."""
    tag = await _get_owned_tag(db, user, tag_id)

    ids = list(
        (
            await db.scalars(
                select(Tag.id).where(
                    Tag.user_id == user.id,
                    Tag.deleted_at.is_(None),
                    or_(
                        Tag.path == tag.path,
                        Tag.path.like(tag.path + "/%"),
                    ),
                )
            )
        ).all()
    )

    # Unlink questions explicitly. The question_tags.tag_id FK is also
    # ON DELETE CASCADE, but being explicit documents the intent.
    await db.execute(delete(QuestionTag).where(QuestionTag.tag_id.in_(ids)))
    # One DELETE removes parents and children together; the self-FK RI
    # check runs after the statement, so subtree-in-one-statement is fine.
    await db.execute(delete(Tag).where(Tag.id.in_(ids)))
    await db.commit()


@router.get("/tags", response_model=list[TagOut])
async def list_tags(
    user: CurrentUser, db: AsyncSession = Depends(get_db)
) -> list[Tag]:
    """All live tags for the user as a flat list ordered by `path`; the
    client rebuilds the tree."""
    rows = await db.scalars(
        select(Tag)
        .where(Tag.user_id == user.id, Tag.deleted_at.is_(None))
        .order_by(Tag.path)
    )
    return list(rows.all())
