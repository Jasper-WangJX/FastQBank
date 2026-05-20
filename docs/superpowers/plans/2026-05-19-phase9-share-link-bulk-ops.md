# Phase 9 — Share-Link Cross-Account Transfer + Bulk Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-select to the question-bank page (per-row checkbox + page-level + select-all-filtered) with three bulk actions — delete, add-tag, bundle-into-share-link — plus an Import button that pulls questions from a pasted share link (UUID dedup, tag-by-name match-or-create) and a "My shares" modal for revoking links.

**Architecture:** One Alembic migration adds the `shares` table + `questions.imported_from_id` column (no FK — dedup tag only). A new `shares.py` router exposes 5 endpoints (create / public-GET / import / list-mine / revoke). A new `POST /questions/bulk-tags` endpoint handles append-tag bulk semantics atomically (the existing PUT /questions/{id} is full-replace and unsuitable). Frontend adds a `Set<string>` selection state to `QuestionListPage`, four modal components (`BundleResultModal`, `BulkAddTagModal`, `ImportModal`, `MySharesModal`), and wires `[Import]` / `[My shares]` header buttons + an action bar.

**Tech Stack:** Backend — FastAPI + async SQLAlchemy + Alembic + asyncpg + Postgres 16; verification via `httpx.ASGITransport` script. Frontend — Vite + React 19 + TS + Tailwind 4; vitest for pure helpers.

**Spec:** `docs/superpowers/specs/2026-05-19-phase9-share-link-bulk-ops-design.md`

**Branch:** `phase-9-share-link` (all phase-9 work commits here; merge to `main` only after the exit criteria pass — same workflow as phases 7 and 8).

**Working directory conventions used throughout this plan:**
- Backend commands run from `apps/server/` using `.venv/Scripts/python.exe`.
- Frontend commands run from `apps/web/` using `pnpm`.
- Git commands run from the repo root.
- All paths in this plan are relative to the repo root unless prefixed `apps/.../`.
- Postgres must be running (`docker compose up -d postgres` from repo root) for any task that hits the DB.

---

## File Map

### Backend (`apps/server/`)

| File | Action | Responsibility |
|---|---|---|
| `alembic/versions/0005_shares_and_imported_from.py` | Create | Migration: `shares` table + `questions.imported_from_id` column + partial index |
| `app/models.py` | Modify | Add `Share` model; add `imported_from_id` field to `Question` |
| `app/schemas.py` | Modify | Add share-related pydantic schemas + `BulkAddTagsIn`/`BulkAddTagsOut` |
| `app/share_token.py` | Create | One-function helper: `generate_share_token() -> str` (12-char URL-safe nanoid via `secrets`) |
| `app/share_token_test.py` | Create | Pytest-free assertion smoke (run via `python -m app.share_token_test`) covering length, charset, uniqueness |
| `app/routers/shares.py` | Create | 5 endpoints: `POST /shares`, `GET /shares/{token}`, `POST /shares/{token}/import`, `GET /shares/me`, `DELETE /shares/{id}` |
| `app/routers/questions.py` | Modify | Add `POST /questions/bulk-tags` (append tag links to many questions, idempotent via PG `ON CONFLICT DO NOTHING`) |
| `main.py` | Modify | Mount the new `shares` router |
| `scripts/verify_phase9.py` | Create | End-to-end verification script mirroring `verify_review.py`/`verify_flat_tags.py` |

### Frontend (`apps/web/`)

| File | Action | Responsibility |
|---|---|---|
| `src/lib/qbank.ts` | Modify | Add `createShare`, `getSharePreview`, `importShare`, `listMyShares`, `revokeShare`, `bulkAddTags` + matching TS types |
| `src/lib/shareToken.ts` | Create | Pure helper: `extractShareToken(raw: string): string \| null` |
| `src/lib/shareToken.test.ts` | Create | vitest unit test for the regex helper |
| `src/components/share/BundleResultModal.tsx` | Create | Show share URL + Copy button + revoke hint |
| `src/components/share/BulkAddTagModal.tsx` | Create | Wraps `TagPicker` + Apply button |
| `src/components/share/ImportModal.tsx` | Create | Step 1 paste textarea → Step 2 preview → confirm Import |
| `src/components/share/MySharesModal.tsx` | Create | List own shares with per-row Copy / Revoke |
| `src/pages/QuestionListPage.tsx` | Modify | Add selection state, per-row + header checkboxes, action bar, `[Import]` + `[My shares]` header buttons, wire all four modals |
| `src/components/QuestionCard.tsx` | Modify | Accept optional `selectControl` prop rendered above the card body |

### Docs

| File | Action | Responsibility |
|---|---|---|
| `docs/Roadmap_CN.md` | Modify | Bump Phase 9 status to "进行中" → "✅ 已完成" after exit criteria pass (final task) |
| `docs/Roadmap_EN.md` | Modify | Same status bump in English |

---

## Task ordering rationale

Backend foundation first (migration → model → schemas → token helper) so the rest of the backend compiles. Then router (shares + bulk-tag). Then a verification script that proves the backend works end-to-end against a real DB. Then frontend: client wrappers → pure helper + test → modal components in isolation → page integration. Final task is a manual GUI walk-through + Roadmap status bump.

Each task is independently committable and reversible.

---

### Task 0: Branch + sanity check

**Files:** none

- [ ] **Step 1: Create the phase-9 branch from `main`**

```bash
git checkout main
git pull --ff-only
git checkout -b phase-9-share-link
```

- [ ] **Step 2: Confirm `0004_flatten_tags` is the current head**

```bash
cd apps/server
.venv/Scripts/python.exe -m alembic current
```

Expected output contains `0004_flatten_tags (head)`. If a later migration appears, stop and ask the user — this plan's migration revision must descend from `0004_flatten_tags`.

- [ ] **Step 3: Confirm Postgres is up**

```bash
docker compose ps postgres
```

Expected: status `Up`. If not: `docker compose up -d postgres` from repo root, then re-check.

---

### Task 1: Migration — `shares` table + `questions.imported_from_id` column

**Files:**
- Create: `apps/server/alembic/versions/0005_shares_and_imported_from.py`

- [ ] **Step 1: Write the migration file**

Create `apps/server/alembic/versions/0005_shares_and_imported_from.py` with:

```python
"""shares table + questions.imported_from_id (stage 9)

One migration combines two concerns because they ship as one feature:
- `shares` holds the cross-account share-token snapshots
- `questions.imported_from_id` tags rows that came in via Import,
  enabling UUID-based dedup without taking a PK conflict (Question.id
  is globally unique, so we cannot reuse the creator's id on the
  importer's row).

No FK on imported_from_id — it points to the *creator's* question.id
which may have been hard- or soft-deleted on the creator's side. The
column is a write-once dedup tag.

Revision ID: 0005_shares_and_imported_from
Revises: 0004_flatten_tags
Create Date: 2026-05-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0005_shares_and_imported_from"
down_revision: str | None = "0004_flatten_tags"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # (a) New table: shares
    op.create_table(
        "shares",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "creator_id", postgresql.UUID(as_uuid=True), nullable=False
        ),
        sa.Column("token", sa.String(length=16), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "deleted_at", sa.DateTime(timezone=True), nullable=True
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["creator_id"],
            ["users.id"],
            name="fk_shares_creator_id",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("token", name="uq_shares_token"),
    )
    op.create_index(
        "ix_shares_creator_active",
        "shares",
        ["creator_id"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    # (b) New column on questions: imported_from_id
    op.add_column(
        "questions",
        sa.Column(
            "imported_from_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    # Partial index — the dedup query is "for THIS user, is there a row
    # whose imported_from_id matches any of these source_ids?" Filtering
    # out NULLs makes the index small and the query plan tight.
    op.create_index(
        "ix_questions_user_imported_from",
        "questions",
        ["user_id", "imported_from_id"],
        postgresql_where=sa.text("imported_from_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_questions_user_imported_from", table_name="questions"
    )
    op.drop_column("questions", "imported_from_id")
    op.drop_index("ix_shares_creator_active", table_name="shares")
    op.drop_table("shares")
```

- [ ] **Step 2: Run the migration against the dev DB**

```bash
cd apps/server
.venv/Scripts/python.exe -m alembic upgrade head
```

Expected output ends with `Running upgrade 0004_flatten_tags -> 0005_shares_and_imported_from`.

- [ ] **Step 3: Verify schema in psql**

```bash
docker compose exec postgres psql -U postgres -d aqb -c "\d shares"
docker compose exec postgres psql -U postgres -d aqb -c "\d questions" | findstr imported_from_id
```

Expected: `shares` table exists with the listed columns + `uq_shares_token` unique constraint; `imported_from_id` column appears on `questions`.

- [ ] **Step 4: Verify the downgrade is reversible**

```bash
.venv/Scripts/python.exe -m alembic downgrade -1
.venv/Scripts/python.exe -m alembic upgrade head
```

Expected: both commands succeed; the table reappears.

- [ ] **Step 5: Commit**

```bash
git add apps/server/alembic/versions/0005_shares_and_imported_from.py
git commit -m "feat(server): migration 0005 — shares table + questions.imported_from_id"
```

---

### Task 2: ORM — `Share` model + `Question.imported_from_id`

**Files:**
- Modify: `apps/server/app/models.py`

- [ ] **Step 1: Add `imported_from_id` to the `Question` class**

In `apps/server/app/models.py`, inside the `Question` class (after `deleted_at`, before `__table_args__`), add:

```python
    # Stage 9: written once at import time, never updated. Refers to the
    # creator's question.id from the source share's payload — no FK, the
    # creator may have deleted that row by now. NULL on rows the user
    # entered directly (manual / OCR / AI).
    imported_from_id: Mapped[PyUUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
```

- [ ] **Step 2: Add the `Share` ORM class at the bottom of `models.py`**

Append to `apps/server/app/models.py`:

```python
class Share(Base):
    """Cross-account share-link snapshot (stage 9).

    `payload` is a self-contained JSONB snapshot of the selected
    questions (stem / type / options / correct / source / knowledge
    summary / tag NAMES). Editing or deleting the source question after
    creation does NOT propagate — links capture a value, not a
    reference. `deleted_at` is a soft-delete revoke: GET / import on a
    revoked token returns 410.
    """

    __tablename__ = "shares"

    id: Mapped[PyUUID] = _uuid_pk()
    creator_id: Mapped[PyUUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    token: Mapped[str] = mapped_column(
        Text, nullable=False, unique=True
    )
    # Self-contained snapshot. Versioned via payload["version"] for
    # forward compat without a column rename.
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = _now_column()
    deleted_at: Mapped[datetime | None] = _now_column(nullable=True)

    __table_args__ = (
        Index(
            "ix_shares_creator_active",
            "creator_id",
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )
```

- [ ] **Step 3: Verify import boots without errors**

```bash
cd apps/server
.venv/Scripts/python.exe -c "from app import models; print(models.Share.__tablename__, models.Question.imported_from_id)"
```

Expected: prints `shares <sqlalchemy ... InstrumentedAttribute>` with no exception.

- [ ] **Step 4: Commit**

```bash
git add apps/server/app/models.py
git commit -m "feat(server): Share ORM model + Question.imported_from_id"
```

---

### Task 3: Pydantic schemas — share payloads + bulk-tag bodies

**Files:**
- Modify: `apps/server/app/schemas.py`

- [ ] **Step 1: Append the share + bulk-tag schemas to the bottom of `schemas.py`**

```python
# ---------------------------------------------------------------------------
# Stage 9 — Share-link cross-account transfer + bulk operations
# ---------------------------------------------------------------------------


class ShareCreateIn(BaseModel):
    """Body for POST /shares. 1..99 owned question ids. The server
    snapshots the questions at creation time; the resulting share is
    immutable (no edit endpoint)."""

    question_ids: list[UUID] = Field(min_length=1, max_length=99)


class ShareCreateOut(BaseModel):
    """Response of POST /shares. The full URL is built server-side from
    the frontend base + the new token, so the client just copies it."""

    token: str
    share_url: str


class SharedQuestion(BaseModel):
    """One question inside a share payload. `source_id` is the creator's
    `question.id`; the importer's row gets a fresh `id` and stores this
    value in `imported_from_id` for UUID-based dedup."""

    source_id: UUID
    stem: str
    type: QuestionType
    options: list[OptionOut]
    correct: list[str]
    knowledge_summary: str | None = None
    source: Literal["manual", "ocr", "ai"]
    tag_names: list[str] = []


class SharePayload(BaseModel):
    """Top-level shape of the JSONB payload column. `version` is here so
    a future shape change can be detected without a column rename."""

    version: Literal[1] = 1
    questions: list[SharedQuestion]


class SharePreviewOut(BaseModel):
    """Response of GET /shares/{token}. Creator identity is NOT exposed
    — by design (spec §2.2 'no access logging / anonymous-ish')."""

    payload: SharePayload
    created_at: datetime


class ShareImportOut(BaseModel):
    """Response of POST /shares/{token}/import. Counters drive the
    success toast."""

    imported: int
    skipped: int
    tags_created: int
    tags_reused: int


class MyShareRow(BaseModel):
    """One entry in the GET /shares/me list. `question_count` is
    derived from `len(payload.questions)` server-side — the modal shows
    it so the user can identify which share is which."""

    id: UUID
    token: str
    question_count: int
    created_at: datetime


class MyShareListOut(BaseModel):
    items: list[MyShareRow]


class BulkAddTagsIn(BaseModel):
    """Body for POST /questions/bulk-tags. Adds the given tag ids to
    every listed question, idempotently. Existing other tags on each
    question are untouched. Foreign / unknown / soft-deleted ids are
    silently skipped (matches the rest of the codebase's tolerance for
    stale client state)."""

    question_ids: list[UUID] = Field(min_length=1)
    tag_ids: list[UUID] = Field(min_length=1)


class BulkAddTagsOut(BaseModel):
    """Response counters drive the success toast."""

    questions_updated: int
    links_added: int
```

- [ ] **Step 2: Verify the schemas import cleanly**

```bash
cd apps/server
.venv/Scripts/python.exe -c "from app import schemas; print(schemas.ShareCreateIn.model_json_schema()['properties']['question_ids']['maxItems'])"
```

Expected: `99`.

- [ ] **Step 3: Commit**

```bash
git add apps/server/app/schemas.py
git commit -m "feat(server): pydantic schemas for shares + bulk-add-tags"
```

---

### Task 4: Share token helper + smoke test

**Files:**
- Create: `apps/server/app/share_token.py`
- Create: `apps/server/app/share_token_test.py`

- [ ] **Step 1: Write the token helper**

Create `apps/server/app/share_token.py`:

```python
"""12-char URL-safe share token generator.

`secrets.token_urlsafe(9)` returns Base64-URL-safe-encoded random
bytes — 9 bytes encode to exactly 12 characters with no padding,
giving ~72 bits of entropy (infeasible to guess). The output charset
is `[A-Za-z0-9_-]`, matching the spec's claim of "URL-safe" and the
frontend's extraction regex.

No third-party `nanoid` dependency is needed; `secrets` is stdlib.
"""

import secrets

SHARE_TOKEN_LENGTH = 12
# Charset documented for the route validators that prevalidate format
# before the DB lookup.
SHARE_TOKEN_CHARSET = (
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
)


def generate_share_token() -> str:
    """Returns exactly 12 URL-safe characters."""
    return secrets.token_urlsafe(9)


def is_valid_share_token(value: str) -> bool:
    """True iff `value` matches the produced format. Used by route
    handlers to 404 on a clearly-malformed token without a DB query."""
    if len(value) != SHARE_TOKEN_LENGTH:
        return False
    allowed = set(SHARE_TOKEN_CHARSET)
    return all(ch in allowed for ch in value)
```

- [ ] **Step 2: Write the smoke test**

Create `apps/server/app/share_token_test.py`:

```python
"""Smoke-test the share token generator without pulling in pytest.

Run: `.venv/Scripts/python.exe -m app.share_token_test`
Exits 0 on success; raises AssertionError on the first failure.
"""

from app.share_token import (
    SHARE_TOKEN_CHARSET,
    SHARE_TOKEN_LENGTH,
    generate_share_token,
    is_valid_share_token,
)


def main() -> None:
    seen: set[str] = set()
    for _ in range(2000):
        t = generate_share_token()
        assert len(t) == SHARE_TOKEN_LENGTH, t
        assert all(c in SHARE_TOKEN_CHARSET for c in t), t
        assert is_valid_share_token(t), t
        seen.add(t)
    # 2000 generations should produce 2000 unique tokens (~72-bit
    # entropy makes collisions astronomically unlikely).
    assert len(seen) == 2000, len(seen)

    # Negative cases for is_valid_share_token
    assert not is_valid_share_token("")
    assert not is_valid_share_token("short")
    assert not is_valid_share_token("a" * 13)
    assert not is_valid_share_token("invalid@char_")  # @ not in charset
    assert not is_valid_share_token("with spaceXX")
    print("OK — share_token smoke test")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run the smoke test**

```bash
cd apps/server
.venv/Scripts/python.exe -m app.share_token_test
```

Expected output: `OK — share_token smoke test`.

- [ ] **Step 4: Commit**

```bash
git add apps/server/app/share_token.py apps/server/app/share_token_test.py
git commit -m "feat(server): share token generator + smoke test"
```

---

### Task 5: `shares.py` router — 5 endpoints

**Files:**
- Create: `apps/server/app/routers/shares.py`
- Modify: `apps/server/main.py`

- [ ] **Step 1: Write the shares router**

Create `apps/server/app/routers/shares.py`:

```python
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

from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_, select
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
        except Exception:  # IntegrityError on token collision
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
    for qid, imp in existing_pairs:
        if qid in src_ids:
            already.add(qid)
        if imp in src_ids:
            already.add(imp)

    new_questions = [
        qq for qq in payload.questions if qq.source_id not in already
    ]
    skipped = len(payload.questions) - len(new_questions)

    # Tag find-or-create — batched, deduped across all questions.
    needed_names: set[str] = set()
    for qq in new_questions:
        needed_names.update(qq.tag_names)

    existing_tags_by_name: dict[str, Tag] = {}
    if needed_names:
        rows = (
            await db.scalars(
                select(Tag).where(
                    Tag.user_id == user.id,
                    Tag.name.in_(needed_names),
                    Tag.deleted_at.is_(None),
                )
            )
        ).all()
        existing_tags_by_name = {t.name: t for t in rows}

    tags_reused = len(existing_tags_by_name)
    tags_created = 0
    for name in needed_names - existing_tags_by_name.keys():
        t = Tag(user_id=user.id, name=name)
        db.add(t)
        await db.flush()
        existing_tags_by_name[name] = t
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
```

- [ ] **Step 2: Confirm `frontend_base_url` exists in settings**

```bash
cd apps/server
.venv/Scripts/python.exe -c "from app.settings import get_settings; print(get_settings().frontend_base_url)"
```

Expected: a URL like `http://localhost:5173` or `https://fastqbank.com`.

If the command errors with `AttributeError`, open `apps/server/app/settings.py` and add `frontend_base_url` next to the existing fields:

```python
    # Used by /shares to build the public share_url returned on create.
    frontend_base_url: str = "http://localhost:5173"
```

Then add `FRONTEND_BASE_URL=https://fastqbank.com` to `deploy/env.prod.example` (mirroring how `CORS_ORIGINS` is documented). Commit the settings change with the same task (see Step 5).

- [ ] **Step 3: Mount the router in `apps/server/main.py`**

In `main.py`, modify the import line and `include_router` block:

```python
from app.routers import ai, auth, questions, review, shares, tags
```

…and after the existing `app.include_router(review.router)`:

```python
# Stage 9 — Share-link cross-account transfer + bulk operations
app.include_router(shares.router)
```

- [ ] **Step 4: Boot smoke check**

```bash
cd apps/server
.venv/Scripts/python.exe -c "from main import app; print([r.path for r in app.routes if r.path.startswith('/shares')])"
```

Expected: prints the 5 share paths (`/shares`, `/shares/{token}`, `/shares/{token}/import`, `/shares/me`, `/shares/{share_id}`).

- [ ] **Step 5: Commit**

```bash
git add apps/server/app/routers/shares.py apps/server/main.py apps/server/app/settings.py deploy/env.prod.example
git commit -m "feat(server): /shares router (create, GET, import, list-mine, revoke)"
```

(If you didn't have to touch `settings.py`/`env.prod.example`, drop those from `git add`.)

---

### Task 6: Bulk-add-tag endpoint — `POST /questions/bulk-tags`

**Files:**
- Modify: `apps/server/app/routers/questions.py`

- [ ] **Step 1: Add the endpoint**

In `apps/server/app/routers/questions.py`, add this handler at the bottom of the file (after `delete_question`):

```python
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
```

- [ ] **Step 2: Add the imports at the top of the file**

In the top imports block of `apps/server/app/routers/questions.py`, expand the schema import line to include the new ones AND add `pg_insert` (mirroring review.py's import style):

```python
from sqlalchemy.dialects.postgresql import insert as pg_insert
```

```python
from app.schemas import (
    BulkAddTagsIn,
    BulkAddTagsOut,
    QuestionIn,
    QuestionListOut,
    QuestionOut,
    QuestionUpdate,
)
```

- [ ] **Step 3: Boot smoke**

```bash
cd apps/server
.venv/Scripts/python.exe -c "from main import app; print([r.path for r in app.routes if 'bulk-tags' in r.path])"
```

Expected: `['/questions/bulk-tags']`.

- [ ] **Step 4: Commit**

```bash
git add apps/server/app/routers/questions.py
git commit -m "feat(server): POST /questions/bulk-tags (append-only, idempotent)"
```

---

### Task 7: Verification script — `scripts/verify_phase9.py`

**Files:**
- Create: `apps/server/scripts/verify_phase9.py`

- [ ] **Step 1: Write the verification script**

Create `apps/server/scripts/verify_phase9.py`:

```python
"""Verification: stage 9 share-link transfer + bulk-add-tag against real dev DB.

Prereqs: `docker compose up -d postgres` and `alembic upgrade head`.
Run from apps/server:  .venv/Scripts/python.exe scripts/verify_phase9.py
Exits 0 on success; raises AssertionError (non-zero) on the first failure.

Coverage:
  1. Create share — owner can create with 1 / 99 ids; >=100 ids → 422;
     a non-owned id → 404; a soft-deleted id → 404. Token is 12 URL-safe
     chars.
  2. GET /shares/{token} returns payload + created_at, no creator
     identity; soft-deleted → 410; nonexistent → 404; malformed → 404.
  3. Import under another account — all N inserted with fresh `id`,
     `imported_from_id = source_id`, source preserved, tags created
     or reused by name, counters match.
  4. UUID dedup — same share imported twice under same account: round
     2 all skipped. Self-import (creator imports own share): all
     skipped. Soft-delete an imported row then re-import: still
     skipped (does not undelete).
  5. My-shares + revoke — list returns only own active rows; revoke
     only by creator (foreign user → 404); revoked then re-import →
     410.
  6. Bulk-add-tags — union semantics, idempotent, soft-deleted /
     foreign ids silently dropped.
"""

import asyncio
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402
from httpx import ASGITransport  # noqa: E402

from main import app  # noqa: E402


def _qbody(stem: str, tag_ids: list[str]) -> dict:
    return {
        "stem": stem,
        "type": "single",
        "options": [
            {"label": "A", "content": "alpha"},
            {"label": "B", "content": "beta"},
        ],
        "correct": ["A"],
        "tag_ids": tag_ids,
    }


async def _register(c: httpx.AsyncClient) -> tuple[str, dict[str, str]]:
    """Returns (email, auth-headers)."""
    email = f"p9+{uuid.uuid4().hex[:8]}@example.com"
    r = await c.post(
        "/auth/register",
        json={"email": email, "password": "password123"},
    )
    assert r.status_code == 201, r.text
    return email, {"Authorization": f"Bearer {r.json()['access_token']}"}


async def main() -> None:
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as c:
        # --- Two users ---
        email_a, ha = await _register(c)
        _, hb = await _register(c)

        # --- User A owns 3 tags + 3 questions ---
        tag_math = (
            await c.post("/tags", json={"name": "math"}, headers=ha)
        ).json()
        tag_phys = (
            await c.post("/tags", json={"name": "physics"}, headers=ha)
        ).json()
        tag_only_a = (
            await c.post("/tags", json={"name": "only-a"}, headers=ha)
        ).json()

        q1 = (
            await c.post(
                "/questions",
                json=_qbody("Q1", [tag_math["id"], tag_phys["id"]]),
                headers=ha,
            )
        ).json()
        q2 = (
            await c.post(
                "/questions",
                json=_qbody("Q2", [tag_math["id"]]),
                headers=ha,
            )
        ).json()
        q3 = (
            await c.post(
                "/questions",
                json=_qbody("Q3", [tag_only_a["id"]]),
                headers=ha,
            )
        ).json()

        # --- 1. Create share with the 3 question ids ---
        r = await c.post(
            "/shares",
            json={"question_ids": [q1["id"], q2["id"], q3["id"]]},
            headers=ha,
        )
        assert r.status_code == 201, r.text
        share = r.json()
        token = share["token"]
        assert len(token) == 12, token
        allowed = set(
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
        )
        assert all(ch in allowed for ch in token), token
        assert share["share_url"].endswith(f"/s/{token}"), share

        # 1a. Empty list -> 422
        r = await c.post("/shares", json={"question_ids": []}, headers=ha)
        assert r.status_code == 422, r.text

        # 1b. >99 ids -> 422
        too_many = [str(uuid.uuid4()) for _ in range(100)]
        r = await c.post(
            "/shares", json={"question_ids": too_many}, headers=ha
        )
        assert r.status_code == 422, r.text

        # 1c. Foreign id -> 404
        # Make B own one question, then A tries to share it
        qb = (
            await c.post("/questions", json=_qbody("QB", []), headers=hb)
        ).json()
        r = await c.post(
            "/shares", json={"question_ids": [qb["id"]]}, headers=ha
        )
        assert r.status_code == 404, r.text

        # 1d. Soft-deleted id -> 404
        # Make A own a temp question, delete it, then try to share
        q_tmp = (
            await c.post("/questions", json=_qbody("QTMP", []), headers=ha)
        ).json()
        del_r = await c.delete(
            f"/questions/{q_tmp['id']}", headers=ha
        )
        assert del_r.status_code == 204, del_r.text
        r = await c.post(
            "/shares", json={"question_ids": [q_tmp["id"]]}, headers=ha
        )
        assert r.status_code == 404, r.text

        # --- 2. GET preview ---
        r = await c.get(f"/shares/{token}")
        assert r.status_code == 200, r.text
        prev = r.json()
        # No creator identity leak
        assert "creator_email" not in prev, prev
        assert "creator_id" not in prev, prev
        assert prev["payload"]["version"] == 1
        assert len(prev["payload"]["questions"]) == 3
        # tag_names by name, not by id
        q1_payload = next(
            qq
            for qq in prev["payload"]["questions"]
            if qq["source_id"] == q1["id"]
        )
        assert set(q1_payload["tag_names"]) == {"math", "physics"}, q1_payload

        # 2a. Malformed token -> 404 (not 410)
        r = await c.get("/shares/short")
        assert r.status_code == 404, r.text
        r = await c.get("/shares/AAAAAAAAAAAA")  # 12 chars but no match
        assert r.status_code == 404, r.text

        # --- 3. Import under user B ---
        r = await c.post(f"/shares/{token}/import", headers=hb)
        assert r.status_code == 200, r.text
        imp = r.json()
        assert imp["imported"] == 3, imp
        assert imp["skipped"] == 0, imp
        # B had zero of these tag names; all three created
        assert imp["tags_created"] == 3, imp
        assert imp["tags_reused"] == 0, imp

        # B now sees 4 questions (QB + 3 imported)
        b_list = (
            await c.get(
                "/questions?limit=100", headers=hb
            )
        ).json()
        assert b_list["total"] == 4, b_list
        imported_rows = [q for q in b_list["items"] if q["id"] != qb["id"]]
        # Fresh ids — not equal to creator's ids
        creator_ids = {q1["id"], q2["id"], q3["id"]}
        for q in imported_rows:
            assert q["id"] not in creator_ids, q
        # `source` preserved verbatim ('manual' in this case)
        for q in imported_rows:
            assert q["source"] == "manual", q
        # Tags resolved by name under B's account
        all_b_tag_names = {
            t["name"] for q in imported_rows for t in q["tags"]
        }
        assert {"math", "physics", "only-a"}.issubset(all_b_tag_names)

        # --- 4. UUID dedup ---
        # 4a. Re-import under B: all skipped
        r = await c.post(f"/shares/{token}/import", headers=hb)
        imp2 = r.json()
        assert imp2["imported"] == 0, imp2
        assert imp2["skipped"] == 3, imp2

        # 4b. Self-import (A imports own share): all skipped via id==source_id
        r = await c.post(f"/shares/{token}/import", headers=ha)
        imp3 = r.json()
        assert imp3["imported"] == 0, imp3
        assert imp3["skipped"] == 3, imp3

        # 4c. Soft-delete one of B's imported rows, then re-import: still skipped
        b_imported_one = imported_rows[0]
        del_r = await c.delete(
            f"/questions/{b_imported_one['id']}", headers=hb
        )
        assert del_r.status_code == 204
        r = await c.post(f"/shares/{token}/import", headers=hb)
        imp4 = r.json()
        assert imp4["imported"] == 0, imp4
        assert imp4["skipped"] == 3, imp4
        # Re-fetch B's list — the soft-deleted row is NOT undeleted
        b_list_after = (
            await c.get("/questions?limit=100", headers=hb)
        ).json()
        # Was 4 before; now 3 (one is hidden by soft-delete)
        assert b_list_after["total"] == 3, b_list_after

        # --- 5. My-shares + revoke ---
        r = await c.get("/shares/me", headers=ha)
        mine = r.json()
        assert len(mine["items"]) == 1, mine
        assert mine["items"][0]["token"] == token
        assert mine["items"][0]["question_count"] == 3, mine

        # 5a. B can't revoke A's share
        r = await c.delete(
            f"/shares/{mine['items'][0]['id']}", headers=hb
        )
        assert r.status_code == 404, r.text

        # 5b. A revokes
        r = await c.delete(
            f"/shares/{mine['items'][0]['id']}", headers=ha
        )
        assert r.status_code == 204, r.text

        # 5c. GET now 410
        r = await c.get(f"/shares/{token}")
        assert r.status_code == 410, r.text

        # 5d. Import now 410
        r = await c.post(f"/shares/{token}/import", headers=hb)
        assert r.status_code == 410, r.text

        # 5e. My-shares now empty
        r = await c.get("/shares/me", headers=ha)
        assert r.json()["items"] == [], r.text

        # 5f. Re-revoke same share -> 404 (already revoked)
        r = await c.delete(
            f"/shares/{mine['items'][0]['id']}", headers=ha
        )
        assert r.status_code == 404, r.text

        # --- 6. Bulk add tags ---
        # A has q1 (math, physics), q2 (math), q3 (only-a). Add 'physics'
        # + 'only-a' to all three.
        r = await c.post(
            "/questions/bulk-tags",
            json={
                "question_ids": [q1["id"], q2["id"], q3["id"]],
                "tag_ids": [tag_phys["id"], tag_only_a["id"]],
            },
            headers=ha,
        )
        assert r.status_code == 200, r.text
        bulk = r.json()
        assert bulk["questions_updated"] >= 1, bulk
        # q1 already had both tags? No — q1 had math+physics, missing only-a;
        # q2 had math, missing both; q3 had only-a, missing physics.
        # So expected new links: q1:+1, q2:+2, q3:+1 = 4 total.
        assert bulk["links_added"] == 4, bulk

        # Verify by reading back q2 — should now have math + physics + only-a
        r = await c.get(f"/questions/{q2['id']}", headers=ha)
        q2_after = r.json()
        names_after = {t["name"] for t in q2_after["tags"]}
        assert names_after == {"math", "physics", "only-a"}, q2_after
        # Other fields untouched
        assert q2_after["stem"] == q2["stem"]
        assert q2_after["type"] == q2["type"]
        assert q2_after["correct"] == q2["correct"]

        # 6a. Re-run is a no-op
        r = await c.post(
            "/questions/bulk-tags",
            json={
                "question_ids": [q1["id"], q2["id"], q3["id"]],
                "tag_ids": [tag_phys["id"], tag_only_a["id"]],
            },
            headers=ha,
        )
        bulk2 = r.json()
        assert bulk2["links_added"] == 0, bulk2

        # 6b. Foreign question_id silently dropped
        r = await c.post(
            "/questions/bulk-tags",
            json={
                "question_ids": [qb["id"]],  # B's question
                "tag_ids": [tag_math["id"]],
            },
            headers=ha,
        )
        bulk3 = r.json()
        assert bulk3["questions_updated"] == 0, bulk3
        assert bulk3["links_added"] == 0, bulk3

        print("ALL PASS — verify_phase9")


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Run the script**

```bash
cd apps/server
.venv/Scripts/python.exe scripts/verify_phase9.py
```

Expected last line: `ALL PASS — verify_phase9`.

If any assertion fails, fix the failing endpoint, re-run. Don't proceed until this script passes.

- [ ] **Step 3: Commit**

```bash
git add apps/server/scripts/verify_phase9.py
git commit -m "test(server): verify_phase9 — shares + import dedup + bulk-tags"
```

---

### Task 8: Frontend types + API wrappers

**Files:**
- Modify: `apps/web/src/lib/qbank.ts`

- [ ] **Step 1: Add the share types and wrappers**

At the bottom of `apps/web/src/lib/qbank.ts`, append:

```typescript
// --- Stage 9 — Share-link cross-account transfer + bulk operations ---

export interface SharedQuestion {
  source_id: string;
  stem: string;
  type: QuestionType;
  options: Option[];
  correct: string[];
  knowledge_summary: string | null;
  source: "manual" | "ocr" | "ai";
  tag_names: string[];
}

export interface SharePayload {
  version: 1;
  questions: SharedQuestion[];
}

export interface ShareCreateOut {
  token: string;
  share_url: string;
}

export interface SharePreviewOut {
  payload: SharePayload;
  created_at: string;
}

export interface ShareImportOut {
  imported: number;
  skipped: number;
  tags_created: number;
  tags_reused: number;
}

export interface MyShareRow {
  id: string;
  token: string;
  question_count: number;
  created_at: string;
}

export interface MyShareListOut {
  items: MyShareRow[];
}

export function createShare(
  questionIds: string[],
): Promise<ShareCreateOut> {
  return apiFetch<ShareCreateOut>("/shares", {
    method: "POST",
    body: { question_ids: questionIds },
  });
}

export function getSharePreview(token: string): Promise<SharePreviewOut> {
  return apiFetch<SharePreviewOut>(`/shares/${token}`);
}

export function importShare(token: string): Promise<ShareImportOut> {
  return apiFetch<ShareImportOut>(`/shares/${token}/import`, {
    method: "POST",
  });
}

export function listMyShares(): Promise<MyShareListOut> {
  return apiFetch<MyShareListOut>("/shares/me");
}

export async function revokeShare(id: string): Promise<void> {
  await apiFetch(`/shares/${id}`, { method: "DELETE" });
}

// --- Bulk operations ---

export interface BulkAddTagsOut {
  questions_updated: number;
  links_added: number;
}

export function bulkAddTags(
  questionIds: string[],
  tagIds: string[],
): Promise<BulkAddTagsOut> {
  return apiFetch<BulkAddTagsOut>("/questions/bulk-tags", {
    method: "POST",
    body: { question_ids: questionIds, tag_ids: tagIds },
  });
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/web
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/qbank.ts
git commit -m "feat(web): qbank client wrappers for shares + bulk-add-tags"
```

---

### Task 9: Pure helper — share-token extraction + vitest

**Files:**
- Create: `apps/web/src/lib/shareToken.ts`
- Create: `apps/web/src/lib/shareToken.test.ts`

- [ ] **Step 1: Write the helper**

Create `apps/web/src/lib/shareToken.ts`:

```typescript
// Extract a share token from a pasted string. Accepts:
//   - a full URL containing `/s/<token>` (e.g. https://fastqbank.com/s/AbC...)
//   - a bare 12-character URL-safe token
// Returns null on anything else (trimming is applied first).
//
// The regex anchors on the `/s/` segment so a URL like
// `https://example.com/path/s/AbC_-123aZ09/extra` extracts cleanly.

const TOKEN_RE = /[A-Za-z0-9_-]{12}/;
const URL_TOKEN_RE = /\/s\/([A-Za-z0-9_-]{12})\b/;

export function extractShareToken(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  const urlMatch = s.match(URL_TOKEN_RE);
  if (urlMatch) return urlMatch[1];

  // Bare-token path: the entire string must BE a 12-char token (not
  // merely contain one — otherwise pasting "see https://other.com/foo"
  // would extract "ttps://othe" from the middle).
  if (/^[A-Za-z0-9_-]{12}$/.test(s)) return s;
  return null;
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/lib/shareToken.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { extractShareToken } from "./shareToken";

describe("extractShareToken", () => {
  it("extracts from a https URL with /s/<token>", () => {
    expect(
      extractShareToken("https://fastqbank.com/s/AbCdEf123_-x"),
    ).toBe("AbCdEf123_-x");
  });

  it("extracts from a URL with extra path / query after the token", () => {
    expect(
      extractShareToken("https://fastqbank.com/s/AbCdEf123_-x?ref=foo"),
    ).toBe("AbCdEf123_-x");
  });

  it("accepts a bare 12-char token", () => {
    expect(extractShareToken("AbCdEf123_-x")).toBe("AbCdEf123_-x");
  });

  it("trims surrounding whitespace", () => {
    expect(extractShareToken("  AbCdEf123_-x  ")).toBe("AbCdEf123_-x");
  });

  it("returns null for empty string", () => {
    expect(extractShareToken("")).toBeNull();
    expect(extractShareToken("   ")).toBeNull();
  });

  it("returns null for a too-short bare string", () => {
    expect(extractShareToken("short")).toBeNull();
  });

  it("returns null for arbitrary text without /s/", () => {
    expect(
      extractShareToken("see https://example.com/AAAAAAAAAAAA"),
    ).toBeNull();
  });

  it("returns null for a URL whose token segment is the wrong length", () => {
    expect(
      extractShareToken("https://fastqbank.com/s/tooshort"),
    ).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests**

```bash
cd apps/web
pnpm vitest run src/lib/shareToken.test.ts
```

Expected: all 8 assertions pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/shareToken.ts apps/web/src/lib/shareToken.test.ts
git commit -m "feat(web): extractShareToken helper + vitest"
```

---

### Task 10: `BundleResultModal` component

**Files:**
- Create: `apps/web/src/components/share/BundleResultModal.tsx`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/share/BundleResultModal.tsx`:

```tsx
// Shown after POST /shares succeeds. Displays the full share URL, a
// [Copy] button, and a short hint about revocability. Closes on
// [Close] or backdrop click. The page's selection is NOT cleared by
// opening or closing this modal — see spec §4.4.

import { useState } from "react";

interface Props {
  url: string;
  questionCount: number;
  onClose: () => void;
}

export default function BundleResultModal({
  url,
  questionCount,
  onClose,
}: Props) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard can fail in non-secure contexts; fall back to select+copy
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold">Share link ready</h2>
        <p className="mt-1 text-sm text-gray-600">
          Anyone with this link can import these {questionCount} questions until
          you revoke it.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <input
            readOnly
            value={url}
            className="flex-1 rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            onClick={onCopy}
            className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/web
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/share/BundleResultModal.tsx
git commit -m "feat(web): BundleResultModal — URL + Copy + revoke hint"
```

---

### Task 11: `BulkAddTagModal` component

**Files:**
- Create: `apps/web/src/components/share/BulkAddTagModal.tsx`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/share/BulkAddTagModal.tsx`:

```tsx
// Bulk "add tags" modal. Wraps the existing TagPicker so the user can
// pick (or create) one or more tags; Apply unions them into every
// selected question's existing tag set via POST /questions/bulk-tags.
// Append-only — no remove-tag mode (spec §2.9).

import { useState } from "react";
import { ApiError } from "../../lib/api";
import { bulkAddTags, listTags, type Tag } from "../../lib/qbank";
import TagPicker from "../tags/TagPicker";

interface Props {
  questionIds: string[];
  initialTags: Tag[];
  onClose: () => void;
  /** Called after Apply succeeds so the parent can refetch the list. */
  onApplied: () => void;
}

export default function BulkAddTagModal({
  questionIds,
  initialTags,
  onClose,
  onApplied,
}: Props) {
  const [tags, setTags] = useState<Tag[]>(initialTags);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refetchTags() {
    try {
      const t = await listTags();
      setTags(t);
    } catch {
      /* a failed refetch shouldn't block the apply flow */
    }
  }

  async function onApply() {
    if (picked.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await bulkAddTags(questionIds, picked);
      onApplied();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Network error");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold">
          Add tags to {questionIds.length} question
          {questionIds.length === 1 ? "" : "s"}
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          Picked tags are <strong>added</strong> to each question's existing
          tags (no replacement).
        </p>
        <div className="mt-3 flex-1 overflow-y-auto">
          <TagPicker
            tags={tags}
            selectedIds={picked}
            onChangeSelected={setPicked}
            onTagCreated={refetchTags}
          />
        </div>
        {error && (
          <div className="mt-3 rounded-md border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onApply}
            disabled={picked.length === 0 || busy}
            className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/web
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/share/BulkAddTagModal.tsx
git commit -m "feat(web): BulkAddTagModal — TagPicker-wrapped append-only bulk apply"
```

---

### Task 12: `ImportModal` component (paste → preview → import)

**Files:**
- Create: `apps/web/src/components/share/ImportModal.tsx`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/share/ImportModal.tsx`:

```tsx
// Two-step import flow:
//   1. Paste textarea → extract a 12-char share token.
//   2. GET /shares/{token} → render a compact preview (stems truncated
//      to 80 chars, no LaTeX render for cheapness) + tag summary.
//   3. POST /shares/{token}/import → toast counters; parent refetches.
//
// Error → inline message in the modal (no toast):
//   404 → "Link not found."
//   410 → "This link has been revoked."
//   422 → "Couldn't read this link's contents."
//   other → "Network error — retry?"

import { useState } from "react";
import { ApiError } from "../../lib/api";
import {
  getSharePreview,
  importShare,
  listTags,
  type SharePreviewOut,
} from "../../lib/qbank";
import { extractShareToken } from "../../lib/shareToken";

interface Props {
  onClose: () => void;
  /** Called after Import succeeds with the counter summary so the
   * parent can toast and refetch. */
  onImported: (msg: string) => void;
}

function errorFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return "Link not found.";
    if (err.status === 410) return "This link has been revoked.";
    if (err.status === 422) return "Couldn't read this link's contents.";
    return err.message || "Network error — retry?";
  }
  return "Network error — retry?";
}

export default function ImportModal({ onClose, onImported }: Props) {
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<SharePreviewOut | null>(null);
  const [previewToken, setPreviewToken] = useState<string | null>(null);
  // Tag reuse/create counts vs. the current user's existing tags
  const [tagCounts, setTagCounts] = useState<{
    total: number;
    reuse: number;
    create: number;
  } | null>(null);

  const token = extractShareToken(raw);

  async function onNext() {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const [p, myTags] = await Promise.all([
        getSharePreview(token),
        listTags(),
      ]);
      const allNames = new Set<string>();
      for (const q of p.payload.questions) {
        for (const n of q.tag_names) allNames.add(n);
      }
      const mine = new Set(myTags.map((t) => t.name));
      let reuse = 0;
      let create = 0;
      for (const n of allNames) {
        if (mine.has(n)) reuse += 1;
        else create += 1;
      }
      setPreview(p);
      setPreviewToken(token);
      setTagCounts({ total: allNames.size, reuse, create });
    } catch (err: unknown) {
      setError(errorFor(err));
    } finally {
      setBusy(false);
    }
  }

  async function onImport() {
    if (!previewToken || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await importShare(previewToken);
      const summary =
        `Imported ${r.imported} · Skipped ${r.skipped} · ` +
        `Tags reused ${r.tags_reused}, created ${r.tags_created}`;
      onImported(summary);
      onClose();
    } catch (err: unknown) {
      setError(errorFor(err));
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold">Import from share link</h2>

        {preview === null ? (
          <>
            <p className="mt-1 text-sm text-gray-600">
              Paste a share link (or a 12-character token).
            </p>
            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="https://fastqbank.com/s/…"
              rows={3}
              className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
            {raw.trim().length > 0 && token === null && (
              <p className="mt-1 text-xs text-red-700">
                Couldn't find a share token in this text.
              </p>
            )}
            {error && (
              <div className="mt-3 rounded-md border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={onClose}
                disabled={busy}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={onNext}
                disabled={!token || busy}
                className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {busy ? "Loading…" : "Next"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-gray-600">
              {preview.payload.questions.length} question
              {preview.payload.questions.length === 1 ? "" : "s"}
              {tagCounts && tagCounts.total > 0 && (
                <>
                  {" · "}
                  {tagCounts.total} tag{tagCounts.total === 1 ? "" : "s"}{" "}
                  ({tagCounts.reuse} reused, {tagCounts.create} new)
                </>
              )}
            </p>
            <div className="mt-3 flex-1 overflow-y-auto rounded-md border border-gray-200 divide-y divide-gray-100">
              {preview.payload.questions.map((q) => (
                <div key={q.source_id} className="px-3 py-2 text-sm">
                  <div className="line-clamp-1 text-gray-800">
                    {q.stem.length > 80
                      ? q.stem.slice(0, 80) + "…"
                      : q.stem}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700">
                      {q.type}
                    </span>
                    {q.tag_names.map((n) => (
                      <span
                        key={n}
                        className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600"
                      >
                        {n}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {error && (
              <div className="mt-3 rounded-md border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={onClose}
                disabled={busy}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={onImport}
                disabled={busy}
                className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {busy ? "Importing…" : "Import"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/web
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/share/ImportModal.tsx
git commit -m "feat(web): ImportModal — paste → preview → import"
```

---

### Task 13: `MySharesModal` component (list + revoke)

**Files:**
- Create: `apps/web/src/components/share/MySharesModal.tsx`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/share/MySharesModal.tsx`:

```tsx
// Lists the current user's active shares with per-row Copy / Revoke.
// Read-only otherwise — no rename, no payload preview (defer to v2).

import { useEffect, useState } from "react";
import { ApiError } from "../../lib/api";
import {
  listMyShares,
  revokeShare,
  type MyShareRow,
} from "../../lib/qbank";

interface Props {
  /** Used to build the full URL when copying. Pass the same base the
   * Bundle modal uses; typically window.location.origin. */
  baseUrl: string;
  onClose: () => void;
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function MySharesModal({ baseUrl, onClose }: Props) {
  const [items, setItems] = useState<MyShareRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMyShares()
      .then((r) => {
        if (!cancelled) setItems(r.items);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Network error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onCopy(row: MyShareRow) {
    const url = `${baseUrl.replace(/\/$/, "")}/s/${row.token}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopiedId(row.id);
    setTimeout(
      () => setCopiedId((c) => (c === row.id ? null : c)),
      2000,
    );
  }

  async function onRevoke(row: MyShareRow) {
    if (
      !window.confirm(
        `Revoke this share?\n\n${row.question_count} questions · created ${relativeTime(row.created_at)}\n\nAnyone with the link will get a 410 on import.`,
      )
    ) {
      return;
    }
    setBusyId(row.id);
    setError(null);
    try {
      await revokeShare(row.id);
      setItems((prev) => (prev ?? []).filter((x) => x.id !== row.id));
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Network error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold">My share links</h2>

        <div className="mt-3 flex-1 overflow-y-auto">
          {items === null ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-gray-500">
              You haven't created any share links yet.
            </p>
          ) : (
            <div className="divide-y divide-gray-100 rounded-md border border-gray-200">
              {items.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center gap-3 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-sm text-gray-800">
                      {row.token}
                    </div>
                    <div className="text-xs text-gray-500">
                      {row.question_count} question
                      {row.question_count === 1 ? "" : "s"} ·{" "}
                      {relativeTime(row.created_at)}
                    </div>
                  </div>
                  <button
                    onClick={() => onCopy(row)}
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
                  >
                    {copiedId === row.id ? "Copied" : "Copy"}
                  </button>
                  <button
                    onClick={() => onRevoke(row)}
                    disabled={busyId === row.id}
                    className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/web
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/share/MySharesModal.tsx
git commit -m "feat(web): MySharesModal — list + copy + revoke"
```

---

### Task 14: `QuestionCard` accepts an optional `selectControl`

**Files:**
- Modify: `apps/web/src/components/QuestionCard.tsx`

- [ ] **Step 1: Read the current file to confirm shape**

```bash
cd apps/web
type src\components\QuestionCard.tsx
```

(Open in editor — note the existing prop set and where actions render.)

- [ ] **Step 2: Add an optional `selectControl` prop**

In `apps/web/src/components/QuestionCard.tsx`, find the `Props` interface for `QuestionCard` and add:

```typescript
  /** Optional icon-only checkbox (or any small control) rendered at the
   * top-left of the card. Lets QuestionListPage wire selection without
   * forking the card component. */
  selectControl?: React.ReactNode;
```

In the card's JSX, render `selectControl` (if present) in a small absolute / inline slot — adapt to the existing layout. Typical placement: inside the top row, before the stem, e.g.:

```tsx
<div className="flex items-start gap-2">
  {selectControl}
  <div className="flex-1">
    {/* existing stem / tags */}
  </div>
</div>
```

Keep the change minimal — if `selectControl` is undefined, render nothing (no extra wrapper). Do NOT alter the existing `actions` slot.

- [ ] **Step 3: Type-check**

```bash
cd apps/web
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/QuestionCard.tsx
git commit -m "feat(web): QuestionCard accepts optional selectControl slot"
```

---

### Task 15: Wire selection state + header buttons + action bar + modals into `QuestionListPage`

**Files:**
- Modify: `apps/web/src/pages/QuestionListPage.tsx`

This task replaces the page's render logic. Read the existing file (~349 lines, see `apps/web/src/pages/QuestionListPage.tsx`) to anchor the diffs — the changes below are additive: keep all existing state (`q`, `tagIds`, etc.) and existing logic (`onDelete`, `reloadTagsAndList`, etc.).

- [ ] **Step 1: Add new state at the top of the component**

After the existing `useState` calls, add:

```typescript
  // Stage-9 selection: a Set of question ids. Survives paging / filter
  // changes (intentional — spec §2.6); cleared on hard refresh.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Modal flags
  const [importOpen, setImportOpen] = useState(false);
  const [mySharesOpen, setMySharesOpen] = useState(false);
  const [bundleResult, setBundleResult] = useState<{
    url: string;
    count: number;
  } | null>(null);
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  // Lightweight toast (info / success). Bulk delete + import use this.
  const [toast, setToast] = useState<string | null>(null);
```

- [ ] **Step 2: Add the helper functions just below the state**

```typescript
  const pageIds = items.map((qq) => qq.id);
  const pageAllSelected =
    pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const pageSomeSelected = pageIds.some((id) => selected.has(id));

  function togglePageAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (pageAllSelected) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) next.add(id);
      }
      return next;
    });
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function selectAllFiltered() {
    // Reuse the existing review endpoint — it already returns every
    // live owned question id matching tag_id[] + tag_match.
    try {
      const ids = await getTagQuestionIds(
        tagIds.length > 0 ? tagIds : [],
        tagIds.length > 0 ? tagMatch : "all",
      );
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.add(id);
        return next;
      });
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Network error");
    }
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function onBulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} questions?`)) return;
    setBusy(true);
    setError(null);
    try {
      // Capped concurrency: 10 at a time. The backend tolerates 404
      // for ids the user no longer owns (e.g. deleted in another tab).
      const queue = [...ids];
      const workers = new Array(Math.min(10, queue.length))
        .fill(null)
        .map(async () => {
          while (queue.length > 0) {
            const id = queue.shift();
            if (id === undefined) break;
            try {
              await deleteQuestion(id);
            } catch {
              /* swallow — refetch reconciles */
            }
          }
        });
      await Promise.all(workers);
      // Drop deleted ids from the Set
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      setToast(`Deleted ${ids.length} question${ids.length === 1 ? "" : "s"}`);
      setTimeout(() => setToast(null), 3000);
      setTick((t) => t + 1);
    } finally {
      setBusy(false);
    }
  }

  async function onBundle() {
    const ids = [...selected];
    if (ids.length === 0 || ids.length > 99) {
      if (ids.length > 99) {
        setError(
          `Can't bundle more than 99 questions per link (you have ${ids.length} selected).`,
        );
      }
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await createShare(ids);
      setBundleResult({ url: r.share_url, count: ids.length });
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }
```

- [ ] **Step 3: Add the new imports at the top of the file**

```typescript
import {
  createShare,
  deleteQuestion,
  listQuestions,
  listTags,
  type QuestionListOut,
  type Tag,
} from "../lib/qbank";
import { getTagQuestionIds } from "../lib/review";
import BulkAddTagModal from "../components/share/BulkAddTagModal";
import BundleResultModal from "../components/share/BundleResultModal";
import ImportModal from "../components/share/ImportModal";
import MySharesModal from "../components/share/MySharesModal";
```

(Merge with the existing import block — do not duplicate names.)

- [ ] **Step 4: Add `[Import]` and `[My shares]` to the header row**

In the JSX header, modify the buttons block (currently `OCR capture` + `+ New question`) to add Import and My-shares:

```tsx
        <div className="flex gap-2">
          {getDesktop() && (
            <button
              onClick={() => getDesktop()?.ocr.trigger()}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              title="Screenshot a question on screen and import it via OCR"
            >
              OCR capture
            </button>
          )}
          <button
            onClick={() => setImportOpen(true)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Import
          </button>
          <button
            onClick={() => setMySharesOpen(true)}
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:underline"
          >
            My shares
          </button>
          <button
            onClick={() => navigate("/questions/new")}
            className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            + New question
          </button>
        </div>
```

- [ ] **Step 5: Insert the action bar + "select all filtered" banner between the tag filter and the list**

Just before the `{error && …}` block, add:

```tsx
      {/* Stage-9: bulk action bar */}
      {selected.size >= 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-slate-300 bg-slate-50 px-3 py-2">
          <span className="text-sm font-medium text-slate-700">
            {selected.size} selected
          </span>
          <button
            onClick={clearSelection}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50"
          >
            Clear
          </button>
          <span className="ml-2 h-4 w-px bg-gray-300" />
          <button
            disabled={busy}
            onClick={onBulkDelete}
            className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Bulk delete
          </button>
          <button
            disabled={busy}
            onClick={() => setBulkTagOpen(true)}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
          >
            Add tag
          </button>
          <button
            disabled={busy || selected.size > 99}
            onClick={onBundle}
            title={
              selected.size > 99
                ? "Bundle is capped at 99 questions per link"
                : undefined
            }
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
          >
            Bundle as link
          </button>
        </div>
      )}

      {/* Stage-9: "select all filtered" prompt — shown only when the
          current page is fully selected AND the global Set is still
          smaller than the total match count. */}
      {pageAllSelected && selected.size < total && (
        <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          Selected {selected.size} on this page.{" "}
          <button
            onClick={selectAllFiltered}
            className="font-medium underline hover:no-underline"
          >
            Select all {total} matching
          </button>
        </div>
      )}
```

- [ ] **Step 6: Wire the header checkbox + per-row checkbox into the list view**

In the existing `view === "list"` block, replace the per-row JSX header / row markup so the table has a header row with the 3-state checkbox, and each row has its own per-row checkbox. Replace the entire `<div className="divide-y divide-gray-100 rounded-md border border-gray-200">` block with:

```tsx
          <div className="divide-y divide-gray-100 rounded-md border border-gray-200">
            <div className="flex items-center gap-3 bg-gray-50 px-3 py-2">
              <input
                type="checkbox"
                checked={pageAllSelected}
                ref={(el) => {
                  if (el) el.indeterminate = !pageAllSelected && pageSomeSelected;
                }}
                onChange={togglePageAll}
                title="Select this page"
                className="h-4 w-4"
              />
              <span className="text-xs text-gray-500">
                {pageSomeSelected ? `${pageIds.filter((id) => selected.has(id)).length} of ${pageIds.length} on this page selected` : "Select page"}
              </span>
            </div>
            {items.map((qq) => (
              <div
                key={qq.id}
                className="flex items-start gap-3 px-3 py-3"
              >
                <input
                  type="checkbox"
                  checked={selected.has(qq.id)}
                  onChange={() => toggleOne(qq.id)}
                  title="Select this question"
                  className="mt-1 h-4 w-4 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <Latex
                    text={qq.stem}
                    className="line-clamp-2 block text-sm text-gray-800"
                  />
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700">
                      {qq.type}
                    </span>
                    {qq.tags.map((t) => (
                      <span
                        key={t.id}
                        className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600"
                      >
                        {t.name}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    disabled={busy}
                    onClick={() => navigate(`/questions/${qq.id}/edit`)}
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
                  >
                    Edit
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => onDelete(qq.id, qq.stem)}
                    className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
```

- [ ] **Step 7: Wire the per-card checkbox into the Cards view**

In the existing `view === "cards"` block, modify the `<QuestionCard>` element to pass a `selectControl`:

```tsx
              <QuestionCard
                key={qq.id}
                question={qq}
                selectControl={
                  <input
                    type="checkbox"
                    checked={selected.has(qq.id)}
                    onChange={() => toggleOne(qq.id)}
                    title="Select this question"
                    className="h-4 w-4"
                  />
                }
                actions={
                  /* existing Edit / Delete buttons unchanged */
                }
              />
```

- [ ] **Step 8: Render the modals + toast at the end of the component's JSX**

Just before the closing `</div>` of the outer container (after `<TagManageDrawer …/>`), add:

```tsx
      {importOpen && (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onImported={(msg) => {
            setToast(msg);
            setTimeout(() => setToast(null), 4000);
            setTick((t) => t + 1);
          }}
        />
      )}
      {mySharesOpen && (
        <MySharesModal
          baseUrl={window.location.origin}
          onClose={() => setMySharesOpen(false)}
        />
      )}
      {bundleResult && (
        <BundleResultModal
          url={bundleResult.url}
          questionCount={bundleResult.count}
          onClose={() => setBundleResult(null)}
        />
      )}
      {bulkTagOpen && (
        <BulkAddTagModal
          questionIds={[...selected]}
          initialTags={tags}
          onClose={() => setBulkTagOpen(false)}
          onApplied={() => {
            setToast(
              `Tagged ${selected.size} question${selected.size === 1 ? "" : "s"}`,
            );
            setTimeout(() => setToast(null), 3000);
            setTick((t) => t + 1);
          }}
        />
      )}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-md bg-slate-800 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
```

- [ ] **Step 9: Type-check + lint + vitest**

```bash
cd apps/web
pnpm tsc --noEmit
pnpm lint
pnpm vitest run
```

Expected: all three commands exit 0. (The new vitest file from Task 9 also runs and passes.)

- [ ] **Step 10: Boot the dev server and smoke-test once**

```bash
cd apps/web
pnpm dev
```

In the browser:
1. Log in.
2. Confirm `[Import]` and `[My shares]` appear in the header.
3. Confirm the page-checkbox + per-row checkbox appear in the List view.
4. Confirm checkboxes appear in the Cards view (top of each card).
5. Tick one — confirm the action bar shows `1 selected · Clear · Bulk delete · Add tag · Bundle as link`.
6. Tick the header checkbox — confirm the whole page selects; banner shows "Select all N matching".
7. Click the banner link — confirm the count climbs to the filter's total.

If any UI step fails, fix and re-run the type-check / vitest. Don't proceed until the smoke is clean.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/pages/QuestionListPage.tsx
git commit -m "feat(web): QuestionListPage — multi-select + action bar + Import/My-shares"
```

---

### Task 16: Full GUI walkthrough — exit criterion

**Files:** none

- [ ] **Step 1: Reset both backend (verify_phase9 OK) and frontend (`pnpm dev`)**

```bash
cd apps/server
.venv/Scripts/python.exe scripts/verify_phase9.py
```

Expected: `ALL PASS — verify_phase9`.

```bash
cd apps/web
pnpm dev
```

- [ ] **Step 2: Walk the exit criterion**

In two browser profiles (or one normal + one incognito) on `http://localhost:5173`:

1. **Profile A:** register `phase9a@example.com / password123`. Create 3 questions (manual) with 2 tags (`math`, `physics`); create 7 more questions tagged `physics`. Filter by `physics` (should show 10).
2. **Profile A:** tick 3 visible questions. Tick the page checkbox to select all 10 of the page (the page only has 10 — note `Select all N matching` would now equal `selected.size` so it should NOT appear). Confirm the action bar reads `10 selected`.
3. **Profile A:** click `Bundle as link`. Confirm a modal opens with a `https://…/s/XXXXXXXXXXXX` URL. Click `Copy`; confirm the button label changes to `Copied`.
4. **Profile B:** register `phase9b@example.com / password123`. The question list is empty.
5. **Profile B:** click `Import` in the header. Paste the URL from step 3. Click `Next`. The preview shows 10 question stems + `2 tags (0 reused, 2 new)`. Click `Import`.
6. **Profile B:** toast reads `Imported 10 · Skipped 0 · Tags reused 0, created 2`. The list now contains 10 questions with `physics` (and `math` on 3 of them) tags.
7. **Profile A:** open `My shares`. Confirm the share row appears with `10 questions · just now`. Click `Revoke`; confirm dialog; the row disappears.
8. **Profile B:** click `Import` again; paste the same URL. Click `Next`. Expected: inline error `This link has been revoked.`
9. **Profile A:** tick 3 of the 10 questions. Click `Bulk delete`; confirm; the questions vanish.
10. **Profile B:** refresh. The 10 imported questions remain untouched (snapshot semantics).

- [ ] **Step 3: Update Roadmap status to "已完成 / Done"**

In `docs/Roadmap_CN.md`, change the Phase 9 row of the overview table from:
```
| 9 批量操作 + 链接分享 / 导入 | ⬜ 待办 | …
```
to:
```
| 9 批量操作 + 链接分享 / 导入 | ✅ 已完成 (2026-05-19) | …
```

And under the `## 阶段 9 — 批量操作 + 链接分享 / 导入` section, prepend a status note paragraph (mirroring how phases 7/8 do it):

```
> **状态：✅ 已完成 (2026-05-19)。** 走 brainstorming → spec → 计划 → 实现 → 验收。
> `scripts/verify_phase9.py` ALL PASS + 前端 `tsc`/`lint`/`vitest` 全绿 + 跨账号 GUI 双
> Profile 走查（创建 → 分享 → 导入 → 撤销 → 重新导入 410 → 跨账号软删互不影响）通过。
> 规格 `docs/superpowers/specs/2026-05-19-phase9-share-link-bulk-ops-design.md`，计划
> `docs/superpowers/plans/2026-05-19-phase9-share-link-bulk-ops.md`。
```

Mirror the same in `docs/Roadmap_EN.md` (status row + a corresponding English note).

- [ ] **Step 4: Commit the docs**

```bash
git add docs/Roadmap_CN.md docs/Roadmap_EN.md
git commit -m "docs: mark Phase 9 done (share-link transfer + bulk ops)"
```

- [ ] **Step 5: Merge to main**

```bash
git checkout main
git pull --ff-only
git merge --no-ff phase-9-share-link
git push
```

(Skip the push unless the user has been pushing prior phases.)

---

## Coverage map (spec → plan)

| Spec section | Implemented by |
|---|---|
| §2.1 Server-side share token | Task 5 (`POST /shares`), Task 4 (token format), Task 12 (Import modal) |
| §2.2 Lifecycle: permanent + revocable + no logging | Task 5 (`_get_active_share_by_token` → 410 on revoked; `DELETE /shares/{id}` for revoke; no access log columns/queries) |
| §2.3 Dedup via `imported_from_id` | Task 1 (migration), Task 2 (model field), Task 5 (`import_share` dedup query) |
| §2.4 Tag passing by name + match-or-create | Task 5 (`import_share` tag block) |
| §2.5 Select-all = all filtered | Task 15 (`selectAllFiltered` reusing `/review/tag-question-ids`) |
| §2.6 Selection survives paging/filter | Task 15 (`selected: Set<string>` in component state, never cleared by pagination/filter effects) |
| §2.7 99-question hard cap | Task 3 (`ShareCreateIn` `max_length=99`), Task 15 (client-side guard in `onBundle`) |
| §2.8 Import via pasted link only | Task 12 (`ImportModal`), Task 9 (`extractShareToken`) |
| §2.9 Bulk add-tag = append-only via TagPicker | Task 6 (`/questions/bulk-tags`), Task 11 (`BulkAddTagModal`) |
| §4.1 Selection state details (header 3-state, banner, action bar) | Task 15 (Steps 1–8) |
| §4.2 Schema (shares + imported_from_id) | Task 1 (migration), Task 2 (ORM) |
| §4.3 5 endpoints | Task 5 |
| §4.4 Frontend buttons + 4 modals | Tasks 10, 11, 12, 13, 14, 15 |
| §4.5 Where things live | All file paths match §4.5 verbatim (modulo migration filename `0005` instead of `0004`, see plan header) |
| §5 UX edge cases | Spread across Task 5 (server dedup soft-delete-agnostic, foreign id 404), Task 6 (bulk-tag silent-drop on stale ids), Task 15 (action bar visibility, refresh behavior). Bullet "Importing under SAME account" → covered by `_get_active_share_by_token` + dedup. |
| §8 Verification | Task 7 (`verify_phase9.py`), Task 16 (GUI walkthrough) |
