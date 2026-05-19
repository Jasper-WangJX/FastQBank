# Phase 7 — Flashcards Review + Wrong-Question Set — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user build a custom question set, run it as flashcards (answer → reveal → next), log every attempt, and keep a persistent, manually-cleared wrong-question set.

**Architecture:** New `/review` FastAPI router + a `wrong_questions` table (Alembic `0003`) reusing the stage-1 `review_logs` table. Frontend adds a `/review` picker page (tag column + per-question green toggles + global selection set), a `/review/session` flashcard runner (client-held deck, one ReviewLog POST per card), with the wrong set surfaced as a special tag-column entry. Session state is client-side only (stateless server, matching the existing "fetch then operate" patterns).

**Tech Stack:** Backend FastAPI + async SQLAlchemy 2 + Alembic + Postgres 16 (PG `ON CONFLICT` upsert). Frontend React 19 + react-router-dom 7 + Tailwind 4 + KaTeX; pure logic unit-tested with vitest. Backend verified with an httpx ASGITransport script (project has no committed pytest suite — this matches the pattern used in stages 1–6).

---

## Conventions (read before starting)

- Spec: `docs/superpowers/specs/2026-05-18-phase7-flashcards-wrong-set-design.md`. The plan implements it; if they disagree, the spec wins — stop and ask.
- **Backend router conventions** (copy from `apps/server/app/routers/questions.py`): no router `prefix`, explicit paths; `user: CurrentUser`; `db: AsyncSession = Depends(get_db)`; every query scoped to `user.id` AND `deleted_at IS NULL`; a missing/foreign question id returns **404** (never 403 — don't leak existence); soft-delete only.
- **Models**: no ORM `relationship()` (async lazy-load = `MissingGreenlet`); use the `_uuid_pk()` / `_now_column()` factory helpers in `apps/server/app/models.py`.
- **Migrations**: hand-written, mirror `apps/server/alembic/versions/0002_ai_usage.py` exactly (string `revision`, `down_revision`, explicit `postgresql.UUID`).
- **Frontend API client**: thin typed wrappers over `apiFetch` (see `apps/web/src/lib/qbank.ts`); 401/ApiError handling already lives in `apps/web/src/lib/api.ts`. `apiFetch` tolerates empty 204 bodies.
- **Frontend pure logic** goes in a non-React module with a sibling `*.test.ts` (mirror `apps/web/src/lib/ocr/splitter.ts` + `splitter.test.ts`). Components stay thin.
- **Commands** (run from repo root unless noted):
  - Backend deps: `apps/server/.venv/Scripts/python.exe -m pip install -r apps/server/requirements.txt`
  - DB up: `docker compose up -d postgres`
  - Migrate: from `apps/server`, `.venv/Scripts/python.exe -m alembic upgrade head`
  - Backend verify script: from `apps/server`, `.venv/Scripts/python.exe scripts/verify_review.py`
  - Frontend tests: `pnpm --dir apps/web test`
  - Frontend typecheck/lint: `pnpm --dir apps/web build` and `pnpm --dir apps/web lint`
- **Commits**: the user manages commits and the branch. Each task ends with a `git add` + `git commit` step; if the user has said not to commit, stage only and note it. Do not push.

---

## File structure

**Backend (`apps/server/`)**

| File | Responsibility |
|---|---|
| `alembic/versions/0003_wrong_questions.py` | Create `wrong_questions` table |
| `app/models.py` (modify) | Add `WrongQuestion` ORM model |
| `app/question_query.py` (create) | Shared helpers: subtree predicate, owned-question fetch, `QuestionOut` + batched-tags builder |
| `app/routers/questions.py` (modify) | Use the shared helpers (de-dupe; behaviour unchanged) |
| `app/schemas.py` (modify) | Review request/response schemas |
| `app/routers/review.py` (create) | `/review` endpoints: deck, tag-question-ids, logs, wrong, master |
| `app/main.py` (modify) | `include_router(review.router)` |
| `scripts/verify_review.py` (create) | httpx ASGITransport verification with assertions |

**Frontend (`apps/web/src/`)**

| File | Responsibility |
|---|---|
| `lib/review.ts` (create) | Typed client: `getDeck`, `getTagQuestionIds`, `postReviewLog`, `getWrongSet`, `masterWrong` |
| `lib/review/session.ts` (create) | Pure logic: selection set, correctness, option shuffle, random cap, deck build |
| `lib/review/session.test.ts` (create) | vitest unit tests for the above |
| `pages/ReviewEntryPage.tsx` (create) | The picker (tag column + question list + selection + bottom bar) |
| `pages/ReviewSessionPage.tsx` (create) | Flashcard runner + end summary |
| `App.tsx` (modify) | Add `/review` and `/review/session` routes |
| `components/AppLayout.tsx` (modify) | Add the `Review` nav link |

---

## Task 1: Migration + `WrongQuestion` model

**Files:**
- Create: `apps/server/alembic/versions/0003_wrong_questions.py`
- Modify: `apps/server/app/models.py` (append a new model class)

- [ ] **Step 1: Write the migration**

Create `apps/server/alembic/versions/0003_wrong_questions.py`:

```python
"""wrong_questions: persistent, manually-cleared wrong-question set (stage 7)

Hand-written to mirror 0001/0002 (explicit Postgres bits). One row per
(user_id, question_id); the unique constraint is the ON CONFLICT target
the router upserts against. A partial index on the active rows backs the
"current wrong set" query. ReviewLog already exists from 0001.

Revision ID: 0003_wrong_questions
Revises: 0002_ai_usage
Create Date: stage 7
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0003_wrong_questions"
down_revision: str | None = "0002_ai_usage"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "wrong_questions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "question_id", postgresql.UUID(as_uuid=True), nullable=False
        ),
        sa.Column(
            "added_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "cleared_at", sa.DateTime(timezone=True), nullable=True
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_wrong_questions_user_id"
        ),
        sa.ForeignKeyConstraint(
            ["question_id"],
            ["questions.id"],
            name="fk_wrong_questions_question_id",
        ),
        sa.UniqueConstraint(
            "user_id", "question_id", name="uq_wrong_questions_user_question"
        ),
    )
    op.create_index(
        "ix_wrong_questions_user_active",
        "wrong_questions",
        ["user_id"],
        postgresql_where=sa.text("cleared_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_wrong_questions_user_active", table_name="wrong_questions"
    )
    op.drop_table("wrong_questions")
```

- [ ] **Step 2: Add the ORM model**

In `apps/server/app/models.py`, append after the `AiUsage` class (end of file). Keep using the existing `_uuid_pk()` / `_now_column()` helpers:

```python
class WrongQuestion(Base):
    """Persistent, manually-cleared wrong-question set (stage 7).

    One row per (user_id, question_id). A wrong answer upserts with
    cleared_at=NULL (PG ON CONFLICT, mirrors AiUsage). A correct answer
    does NOT touch this table. "Mark as mastered" sets cleared_at.
    Answering wrong again reactivates the same row. Soft-deleted
    questions are excluded by the read queries (join deleted_at IS NULL),
    not by a cleanup job here.
    """

    __tablename__ = "wrong_questions"

    id: Mapped[PyUUID] = _uuid_pk()
    user_id: Mapped[PyUUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    question_id: Mapped[PyUUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("questions.id"), nullable=False
    )
    added_at: Mapped[datetime] = _now_column()
    cleared_at: Mapped[datetime | None] = _now_column(nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "question_id",
            name="uq_wrong_questions_user_question",
        ),
        Index(
            "ix_wrong_questions_user_active",
            "user_id",
            postgresql_where=text("cleared_at IS NULL"),
        ),
    )
```

`UniqueConstraint`, `Index`, `text`, `ForeignKey`, `UUID`, `Mapped`, `mapped_column`, `datetime`, `PyUUID` are all already imported at the top of `models.py` — no new imports.

- [ ] **Step 3: Apply and verify the migration**

```
docker compose up -d postgres
cd apps/server
.venv/Scripts/python.exe -m alembic upgrade head
.venv/Scripts/python.exe -m alembic current
```

Expected: `alembic current` prints `0003_wrong_questions (head)`. Sanity-check the table exists:

```
docker compose exec postgres psql -U postgres -d aqb -c "\d wrong_questions"
```

Expected: columns `id, user_id, question_id, added_at, cleared_at`, the unique constraint `uq_wrong_questions_user_question`, and the partial index `ix_wrong_questions_user_active`. (DB name/user: confirm against `.env` `DATABASE_URL` if the psql command errors.)

- [ ] **Step 4: Verify downgrade is reversible**

```
cd apps/server
.venv/Scripts/python.exe -m alembic downgrade -1
.venv/Scripts/python.exe -m alembic upgrade head
```

Expected: both succeed with no error (table dropped then recreated).

- [ ] **Step 5: Commit**

```
git add apps/server/alembic/versions/0003_wrong_questions.py apps/server/app/models.py
git commit -m "feat(server): wrong_questions table + WrongQuestion model (phase 7)"
```

---

## Task 2: Shared question-query helpers (de-dupe with questions.py)

The subtree filter and the `QuestionOut` + batched-tags builder are currently inlined in `questions.py`. `/review` needs both. Extract them into one module, then make `questions.py` use it so there is a single implementation. Behaviour must not change.

**Files:**
- Create: `apps/server/app/question_query.py`
- Modify: `apps/server/app/routers/questions.py`

- [ ] **Step 1: Create the shared helper module**

Create `apps/server/app/question_query.py`:

```python
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
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Question, QuestionTag, Tag
from app.schemas import QuestionOut


def to_question_out(q: Question, tags: list[Tag]) -> QuestionOut:
    """Build the response model. `tags` is supplied explicitly."""
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
):
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
```

- [ ] **Step 2: Refactor `questions.py` to use the helpers**

In `apps/server/app/routers/questions.py`:

1. Replace the imports block. Remove `defaultdict` import and the now-unused `false, or_`. Add the shared import. The top of the file's imports becomes:

```python
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import CurrentUser
from app.models import Question, QuestionTag, Tag
from app.question_query import (
    get_owned_question,
    subtree_question_predicate,
    tags_by_question,
    tags_for,
    to_question_out,
)
from app.schemas import (
    QuestionIn,
    QuestionListOut,
    QuestionOut,
    QuestionUpdate,
)
```

2. Delete the local `_to_out`, `_get_owned_question`, and `_tags_for` function definitions (they now live in `question_query.py`). Keep `_validate_tag_ids` as-is (it stays local — it's only used by questions.py).

3. Replace every call: `_to_out(` → `to_question_out(`; `_get_owned_question(db, user, X)` → `get_owned_question(db, user.id, X)`; `_tags_for(` → `tags_for(`.

4. In `list_questions`, replace the inline subtree block. The `if tag_id is not None:` branch becomes:

```python
    if tag_id is not None:
        conds.append(
            await subtree_question_predicate(db, user.id, tag_id)
        )
```

and replace the inline "one query for all tags on the returned page" block with:

```python
    qids = [qq.id for qq in questions]
    tags_by_q = await tags_by_question(db, qids)
    items = [to_question_out(qq, tags_by_q.get(qq.id, [])) for qq in questions]
```

(`subtree_question_predicate` returns either a `false()` expression or an `exists()` — both are valid inside `conds` exactly as the original inline code used them.)

- [ ] **Step 3: Verify questions endpoints still behave identically**

Start the API (`cd apps/server && .venv/Scripts/python.exe -m uvicorn main:app --reload`), then in a browser do a quick regression on the existing Question Bank page: list loads, keyword search works, tag filter returns the subtree (a parent tag still shows child-tagged questions), pagination works. Also run the frontend build to ensure nothing else broke:

Run: `pnpm --dir apps/web build`
Expected: build succeeds (this is an unrelated safety net; the change is backend-only).

If anything differs from before, revert and re-extract more carefully — behaviour parity is the bar for this task.

- [ ] **Step 4: Commit**

```
git add apps/server/app/question_query.py apps/server/app/routers/questions.py
git commit -m "refactor(server): extract shared question-read helpers (phase 7 prep)"
```

---

## Task 3: Review schemas

**Files:**
- Modify: `apps/server/app/schemas.py` (append a new section at end of file)

- [ ] **Step 1: Append the review schemas**

At the end of `apps/server/app/schemas.py` add:

```python
# ---------------------------------------------------------------------------
# Stage 7 — Flashcards review + wrong-question set schemas
# ---------------------------------------------------------------------------


class DeckIn(BaseModel):
    """Body for POST /review/deck. The client sends the explicit set of
    selected question ids it built in the picker. `limit` (the optional
    "random pick" cap) draws a random sample of that many; omitted/None
    means all selected (server caps at 1000 as a sanity bound)."""

    question_ids: list[UUID] = Field(min_length=1)
    limit: int | None = Field(default=None, ge=1, le=1000)


class DeckOut(BaseModel):
    """The questions to run, as full QuestionOut (the client needs
    `correct` to score locally — these are the user's own questions, and
    GET /questions already exposes `correct`)."""

    items: list[QuestionOut]


class ReviewLogIn(BaseModel):
    """Body for POST /review/logs — one per answered card."""

    question_id: UUID
    correct: bool


class WrongListOut(BaseModel):
    """Active wrong questions + the count for the picker's tag-column
    "⚠ Wrong questions (N)" entry."""

    items: list[QuestionOut]
    total: int


class TagQuestionIdsOut(BaseModel):
    """Every live question id in a tag's subtree — backs the picker's
    per-tag "Select all" without paging."""

    question_ids: list[UUID]
```

`BaseModel`, `Field`, `UUID` are already imported at the top of `schemas.py`. `QuestionOut` is defined earlier in the same file.

- [ ] **Step 2: Verify it imports**

Run: `cd apps/server && .venv/Scripts/python.exe -c "import app.schemas"`
Expected: no output, exit 0 (no syntax/import error).

- [ ] **Step 3: Commit**

```
git add apps/server/app/schemas.py
git commit -m "feat(server): review schemas (phase 7)"
```

---

## Task 4: `/review` router — deck + tag-question-ids

**Files:**
- Create: `apps/server/app/routers/review.py`

- [ ] **Step 1: Create the router with the two read endpoints**

Create `apps/server/app/routers/review.py`:

```python
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
```

(`status`, `pg_insert`, `ReviewLog`, `WrongQuestion` are imported now but used by Task 5 — keeping one import block avoids churn. If a linter flags unused imports between tasks, that's expected and resolved in Task 5.)

- [ ] **Step 2: Temporarily register the router and smoke-test**

In `apps/server/app/main.py`, add `review` to the routers import and include it (this line stays for Task 7 too):

- Change `from app.routers import ai, auth, questions, tags` to `from app.routers import ai, auth, questions, review, tags`
- After `app.include_router(ai.router)` add `app.include_router(review.router)`

Start the API and check the OpenAPI docs list `/review/deck` and `/review/tag-question-ids`:

Run: `cd apps/server && .venv/Scripts/python.exe -c "from main import app; print([r.path for r in app.routes if '/review' in r.path])"`
Expected: prints a list containing `/review/deck` and `/review/tag-question-ids`.

- [ ] **Step 3: Commit**

```
git add apps/server/app/routers/review.py apps/server/app/main.py
git commit -m "feat(server): /review deck + tag-question-ids endpoints (phase 7)"
```

---

## Task 5: `/review/logs` — record attempt + wrong-set upsert

**Files:**
- Modify: `apps/server/app/routers/review.py` (append endpoint)

- [ ] **Step 1: Append the logs endpoint**

Add to the end of `apps/server/app/routers/review.py`:

```python
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
```

- [ ] **Step 2: Smoke-test the import**

Run: `cd apps/server && .venv/Scripts/python.exe -c "from main import app; print('/review/logs' in [r.path for r in app.routes])"`
Expected: `True`

- [ ] **Step 3: Commit**

```
git add apps/server/app/routers/review.py
git commit -m "feat(server): POST /review/logs with wrong-set upsert (phase 7)"
```

---

## Task 6: `/review/wrong` list + `/review/wrong/{id}/master`

**Files:**
- Modify: `apps/server/app/routers/review.py` (append two endpoints)

- [ ] **Step 1: Append the wrong-set endpoints**

Add to the end of `apps/server/app/routers/review.py`:

```python
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
        from fastapi import HTTPException

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="not in the active wrong set",
        )
    row.cleared_at = func.now()
    await db.commit()
```

Then hoist the `HTTPException` import to the top of the file for cleanliness: change the FastAPI import line to `from fastapi import APIRouter, Depends, HTTPException, Query, status` and delete the inline `from fastapi import HTTPException` inside `review_master`.

- [ ] **Step 2: Smoke-test the import**

Run: `cd apps/server && .venv/Scripts/python.exe -c "from main import app; ps=[r.path for r in app.routes]; print('/review/wrong' in ps and '/review/wrong/{question_id}/master' in ps)"`
Expected: `True`

- [ ] **Step 3: Commit**

```
git add apps/server/app/routers/review.py
git commit -m "feat(server): /review/wrong list + master endpoints (phase 7)"
```

---

## Task 7: Backend verification script (httpx ASGITransport)

The project has no committed pytest suite; stages 1–6 were verified with httpx ASGITransport scripts run against the real dev Postgres. Mirror that. The script registers a fresh user, exercises every `/review` behaviour, and asserts.

**Files:**
- Create: `apps/server/scripts/verify_review.py`

- [ ] **Step 1: Write the verification script (it will fail until run against the implemented server)**

Create `apps/server/scripts/verify_review.py`:

```python
"""Stage-7 verification: /review behaviours against the real dev DB.

Prereqs: `docker compose up -d postgres` and `alembic upgrade head`.
Run from apps/server:  .venv/Scripts/python.exe scripts/verify_review.py
Exits 0 on success; raises AssertionError (non-zero) on the first failure.
"""

import asyncio
import uuid

import httpx
from httpx import ASGITransport

from main import app


async def main() -> None:
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as c:
        email = f"phase7+{uuid.uuid4().hex[:8]}@example.com"
        r = await c.post(
            "/auth/register",
            json={"email": email, "password": "password123"},
        )
        assert r.status_code == 200, r.text
        token = r.json()["access_token"]
        h = {"Authorization": f"Bearer {token}"}

        # Two single-choice questions, correct = ["A"].
        def q_body(stem: str) -> dict:
            return {
                "stem": stem,
                "type": "single",
                "options": [
                    {"label": "A", "content": "right"},
                    {"label": "B", "content": "wrong"},
                ],
                "correct": ["A"],
                "tag_ids": [],
            }

        q1 = (
            await c.post("/questions", json=q_body("Q1"), headers=h)
        ).json()
        q2 = (
            await c.post("/questions", json=q_body("Q2"), headers=h)
        ).json()

        # deck: both ids -> 2 questions; includes `correct`.
        d = await c.post(
            "/review/deck",
            json={"question_ids": [q1["id"], q2["id"]]},
            headers=h,
        )
        assert d.status_code == 200, d.text
        items = d.json()["items"]
        assert len(items) == 2, items
        assert items[0]["correct"] == ["A"], items[0]

        # deck random cap of 1 -> exactly 1.
        d1 = await c.post(
            "/review/deck",
            json={"question_ids": [q1["id"], q2["id"]], "limit": 1},
            headers=h,
        )
        assert len(d1.json()["items"]) == 1, d1.text

        # wrong set empty initially.
        w = await c.get("/review/wrong", headers=h)
        assert w.json()["total"] == 0, w.text

        # log q1 wrong -> enters wrong set.
        r = await c.post(
            "/review/logs",
            json={"question_id": q1["id"], "correct": False},
            headers=h,
        )
        assert r.status_code == 204, r.text
        w = await c.get("/review/wrong", headers=h)
        assert w.json()["total"] == 1, w.text
        assert w.json()["items"][0]["id"] == q1["id"]

        # log q1 CORRECT -> still in wrong set (manual clear semantics).
        await c.post(
            "/review/logs",
            json={"question_id": q1["id"], "correct": True},
            headers=h,
        )
        assert (await c.get("/review/wrong", headers=h)).json()[
            "total"
        ] == 1

        # master q1 -> leaves the set.
        m = await c.post(
            f"/review/wrong/{q1['id']}/master", headers=h
        )
        assert m.status_code == 204, m.text
        assert (await c.get("/review/wrong", headers=h)).json()[
            "total"
        ] == 0

        # master again -> 404 (not active).
        m2 = await c.post(
            f"/review/wrong/{q1['id']}/master", headers=h
        )
        assert m2.status_code == 404, m2.text

        # wrong again after master -> reactivates the same row.
        await c.post(
            "/review/logs",
            json={"question_id": q1["id"], "correct": False},
            headers=h,
        )
        assert (await c.get("/review/wrong", headers=h)).json()[
            "total"
        ] == 1

        # ownership: logging a random/foreign id -> 404.
        bad = await c.post(
            "/review/logs",
            json={"question_id": str(uuid.uuid4()), "correct": False},
            headers=h,
        )
        assert bad.status_code == 404, bad.text

        # soft-deleted question is excluded from the wrong set.
        await c.post(
            "/review/logs",
            json={"question_id": q2["id"], "correct": False},
            headers=h,
        )
        assert (await c.get("/review/wrong", headers=h)).json()[
            "total"
        ] == 2
        await c.delete(f"/questions/{q2['id']}", headers=h)
        assert (await c.get("/review/wrong", headers=h)).json()[
            "total"
        ] == 1

    print("verify_review: ALL PASS")


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Run it**

```
docker compose up -d postgres
cd apps/server
.venv/Scripts/python.exe -m alembic upgrade head
.venv/Scripts/python.exe scripts/verify_review.py
```

Expected: prints `verify_review: ALL PASS` and exits 0. If an assertion fails, fix the offending endpoint (Tasks 4–6) before continuing — do not weaken the assertion to make it pass.

- [ ] **Step 3: Commit**

```
git add apps/server/scripts/verify_review.py
git commit -m "test(server): httpx verification for /review (phase 7)"
```

---

## Task 8: Frontend API client `lib/review.ts`

**Files:**
- Create: `apps/web/src/lib/review.ts`

- [ ] **Step 1: Write the typed client**

Create `apps/web/src/lib/review.ts`:

```ts
// Typed client for the stage-7 /review API. Thin wrappers over the
// shared apiFetch transport (auth header, ApiError, 401 handling live
// there). Question shapes are reused from qbank.ts.

import { apiFetch } from "./api";
import type { Question } from "./qbank";

export interface DeckOut {
  items: Question[];
}

export interface WrongListOut {
  items: Question[];
  total: number;
}

/** Resolve picked ids to live questions; `limit` = optional random cap. */
export function getDeck(
  questionIds: string[],
  limit?: number,
): Promise<DeckOut> {
  const body: { question_ids: string[]; limit?: number } = {
    question_ids: questionIds,
  };
  if (limit != null) body.limit = limit;
  return apiFetch<DeckOut>("/review/deck", { method: "POST", body });
}

/** Every live question id under a tag's subtree (for "Select all"). */
export function getTagQuestionIds(tagId: string): Promise<string[]> {
  return apiFetch<{ question_ids: string[] }>(
    `/review/tag-question-ids?tag_id=${encodeURIComponent(tagId)}`,
  ).then((r) => r.question_ids);
}

/** Record one answered card. correct=false enters the wrong set. */
export async function postReviewLog(
  questionId: string,
  correct: boolean,
): Promise<void> {
  await apiFetch("/review/logs", {
    method: "POST",
    body: { question_id: questionId, correct },
  });
}

/** Active wrong questions + count. */
export function getWrongSet(): Promise<WrongListOut> {
  return apiFetch<WrongListOut>("/review/wrong");
}

/** Mark a question mastered (leaves the wrong set). */
export async function masterWrong(questionId: string): Promise<void> {
  await apiFetch(`/review/wrong/${questionId}/master`, { method: "POST" });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --dir apps/web build`
Expected: build succeeds (no TS errors). The module is unused so far; this only checks it compiles against the `Question` type.

- [ ] **Step 3: Commit**

```
git add apps/web/src/lib/review.ts
git commit -m "feat(web): /review API client (phase 7)"
```

---

## Task 9: Pure session logic + vitest tests (TDD)

All non-React logic the pages need, isolated and unit-tested first (mirrors `lib/ocr/splitter.ts` + `splitter.test.ts`).

**Files:**
- Create: `apps/web/src/lib/review/session.test.ts`
- Create: `apps/web/src/lib/review/session.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/review/session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Question } from "../qbank";
import {
  allSelected,
  applyRandomCap,
  buildDeck,
  isAnswerCorrect,
  shuffleWithRng,
  toggleId,
} from "./session";

function q(id: string, partial: Partial<Question> = {}): Question {
  return {
    id,
    user_id: "u",
    stem: `stem ${id}`,
    type: "single",
    options: [
      { label: "A", content: "a" },
      { label: "B", content: "b" },
      { label: "C", content: "c" },
    ],
    correct: ["A"],
    knowledge_summary: null,
    source: "manual",
    created_at: "",
    updated_at: "",
    tags: [],
    ...partial,
  };
}

describe("toggleId / allSelected — global selection set", () => {
  it("adds then removes an id", () => {
    const s = new Set<string>();
    expect([...toggleId(s, "x")]).toEqual(["x"]);
    expect([...toggleId(new Set(["x"]), "x")]).toEqual([]);
  });

  it("allSelected is true only when every id is in the set", () => {
    expect(allSelected(["a", "b"], new Set(["a", "b", "z"]))).toBe(true);
    expect(allSelected(["a", "b"], new Set(["a"]))).toBe(false);
    expect(allSelected([], new Set())).toBe(false); // nothing to select
  });
});

describe("isAnswerCorrect — order-independent exact set", () => {
  it("single: exact one match", () => {
    expect(isAnswerCorrect(q("1", { correct: ["A"] }), ["A"])).toBe(true);
    expect(isAnswerCorrect(q("1", { correct: ["A"] }), ["B"])).toBe(false);
  });
  it("multi: set equality regardless of order", () => {
    const m = q("1", { type: "multi", correct: ["A", "C"] });
    expect(isAnswerCorrect(m, ["C", "A"])).toBe(true);
    expect(isAnswerCorrect(m, ["A"])).toBe(false);
    expect(isAnswerCorrect(m, ["A", "B", "C"])).toBe(false);
  });
  it("judge: T/F", () => {
    const j = q("1", {
      type: "judge",
      options: [
        { label: "T", content: "True" },
        { label: "F", content: "False" },
      ],
      correct: ["T"],
    });
    expect(isAnswerCorrect(j, ["T"])).toBe(true);
    expect(isAnswerCorrect(j, ["F"])).toBe(false);
  });
  it("empty selection is never correct", () => {
    expect(isAnswerCorrect(q("1"), [])).toBe(false);
  });
});

describe("shuffleWithRng — deterministic with injected rng", () => {
  it("reverses with a max rng and never mutates input", () => {
    const arr = [1, 2, 3, 4];
    // Fisher-Yates from the end with rng()->~1 always swaps j=0.
    const out = shuffleWithRng(arr, () => 0.9999);
    expect(out).toHaveLength(4);
    expect([...arr]).toEqual([1, 2, 3, 4]); // input untouched
    expect(out.slice().sort()).toEqual([1, 2, 3, 4]); // a permutation
  });
  it("rng()->0 keeps order (each swap picks itself)", () => {
    expect(shuffleWithRng([1, 2, 3], () => 0)).toEqual([1, 2, 3]);
  });
});

describe("applyRandomCap", () => {
  it("returns all when count >= length", () => {
    expect(applyRandomCap([1, 2], 5, Math.random)).toHaveLength(2);
  });
  it("returns exactly count items, all from the input", () => {
    const out = applyRandomCap([1, 2, 3, 4, 5], 3, () => 0);
    expect(out).toHaveLength(3);
    for (const x of out) expect([1, 2, 3, 4, 5]).toContain(x);
  });
});

describe("buildDeck — order + per-card option shuffle", () => {
  const qs = [q("1"), q("2"), q("3")];

  it("keeps selection order when not randomized", () => {
    const deck = buildDeck(qs, {
      randomOrder: false,
      shuffleOptions: false,
      rng: () => 0,
    });
    expect(deck.map((c) => c.question.id)).toEqual(["1", "2", "3"]);
  });

  it("shuffles options per card but never for judge", () => {
    const judge = q("j", {
      type: "judge",
      options: [
        { label: "T", content: "True" },
        { label: "F", content: "False" },
      ],
      correct: ["T"],
    });
    const deck = buildDeck([q("1"), judge], {
      randomOrder: false,
      shuffleOptions: true,
      rng: () => 0.9999,
    });
    // Judge keeps T,F order regardless of shuffle.
    expect(deck[1].options.map((o) => o.label)).toEqual(["T", "F"]);
    // Non-judge still has exactly its labels (a permutation).
    expect(deck[0].options.map((o) => o.label).sort()).toEqual([
      "A",
      "B",
      "C",
    ]);
  });

  it("does not shuffle options when the flag is off", () => {
    const deck = buildDeck([q("1")], {
      randomOrder: false,
      shuffleOptions: false,
      rng: () => 0.9999,
    });
    expect(deck[0].options.map((o) => o.label)).toEqual(["A", "B", "C"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --dir apps/web test`
Expected: FAIL — `Cannot find module './session'` / exports missing.

- [ ] **Step 3: Implement `session.ts`**

Create `apps/web/src/lib/review/session.ts`:

```ts
// Pure, React-free logic for the flashcards review session. Kept out of
// the page components so it can be unit-tested in isolation (mirrors
// lib/ocr/splitter.ts). Randomness is always an injected rng so tests
// are deterministic.

import type { Option, Question } from "../qbank";

export type Rng = () => number;

/** Toggle one id in a selection set; returns a NEW set (immutable). */
export function toggleId(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** True iff `ids` is non-empty and every id is in `set` (drives the
 *  global "Select all" vs "Deselect all" button label). */
export function allSelected(ids: string[], set: Set<string>): boolean {
  return ids.length > 0 && ids.every((id) => set.has(id));
}

/** Order-independent exact-set comparison of picked labels vs correct. */
export function isAnswerCorrect(
  question: Question,
  selected: string[],
): boolean {
  if (selected.length === 0) return false;
  const a = new Set(selected);
  const b = new Set(question.correct);
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/** Fisher–Yates using an injected rng; returns a new array. */
export function shuffleWithRng<T>(items: T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Random sample of `count` (all of them if count >= length). */
export function applyRandomCap<T>(items: T[], count: number, rng: Rng): T[] {
  if (count >= items.length) return items.slice();
  return shuffleWithRng(items, rng).slice(0, count);
}

export interface DeckCard {
  question: Question;
  /** Display order of options for THIS card (stable for the session). */
  options: Option[];
}

export interface BuildDeckOpts {
  /** True when "Random pick" was on (server already random-sampled, so
   *  order is already random — we keep it). False = selection order. */
  randomOrder: boolean;
  shuffleOptions: boolean;
  rng: Rng;
}

/** Turn the resolved questions into cards: fix each card's option order
 *  once (judge T/F is never shuffled — it must stay True,False). */
export function buildDeck(
  questions: Question[],
  opts: BuildDeckOpts,
): DeckCard[] {
  const ordered = opts.randomOrder
    ? shuffleWithRng(questions, opts.rng)
    : questions;
  return ordered.map((question) => ({
    question,
    options:
      opts.shuffleOptions && question.type !== "judge"
        ? shuffleWithRng(question.options, opts.rng)
        : question.options.slice(),
  }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --dir apps/web test`
Expected: PASS — all `session.test.ts` cases green (and the existing `splitter.test.ts` still green).

- [ ] **Step 5: Commit**

```
git add apps/web/src/lib/review/session.ts apps/web/src/lib/review/session.test.ts
git commit -m "feat(web): pure review-session logic + tests (phase 7)"
```

---

## Task 10: Routes + nav + page skeletons

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/AppLayout.tsx`
- Create: `apps/web/src/pages/ReviewEntryPage.tsx` (skeleton)
- Create: `apps/web/src/pages/ReviewSessionPage.tsx` (skeleton)

- [ ] **Step 1: Create minimal page skeletons**

Create `apps/web/src/pages/ReviewEntryPage.tsx`:

```tsx
export default function ReviewEntryPage() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h1 className="text-lg font-semibold">Review</h1>
    </div>
  );
}
```

Create `apps/web/src/pages/ReviewSessionPage.tsx`:

```tsx
import { Navigate } from "react-router-dom";

export default function ReviewSessionPage() {
  // Filled in Task 12. Without router state there is no deck — bounce.
  return <Navigate to="/review" replace />;
}
```

- [ ] **Step 2: Wire routes in `App.tsx`**

In `apps/web/src/App.tsx`, add the imports next to the other page imports:

```tsx
import ReviewEntryPage from "./pages/ReviewEntryPage";
import ReviewSessionPage from "./pages/ReviewSessionPage";
```

Inside the authenticated `<Route element={<RequireAuth><AppLayout/></RequireAuth>}>` block, add (next to the `/questions` routes):

```tsx
            <Route path="/review" element={<ReviewEntryPage />} />
            <Route path="/review/session" element={<ReviewSessionPage />} />
```

- [ ] **Step 3: Add the nav link in `AppLayout.tsx`**

In `apps/web/src/components/AppLayout.tsx`, inside the `<nav>` block, add after the Tags `NavLink`:

```tsx
            <NavLink to="/review" className={navClass}>
              Review
            </NavLink>
```

- [ ] **Step 4: Verify it builds and navigates**

Run: `pnpm --dir apps/web build`
Expected: build succeeds.

Then `pnpm --dir apps/web dev`, log in, click **Review** in the nav: the page shows the "Review" heading; visiting `/review/session` directly redirects to `/review`.

- [ ] **Step 5: Commit**

```
git add apps/web/src/App.tsx apps/web/src/components/AppLayout.tsx apps/web/src/pages/ReviewEntryPage.tsx apps/web/src/pages/ReviewSessionPage.tsx
git commit -m "feat(web): /review routes + nav + skeletons (phase 7)"
```

---

## Task 11: ReviewEntryPage — the picker

Implements spec §6.1: tag column (with a special "⚠ Wrong questions (N)" entry on top), main-area question list with green per-question toggles, a state-reflecting global Select all / Deselect all, a global selection `Set<string>` that persists across tag switches (selection follows the question, not the tag), and the bottom Submit bar (Random pick + count, Shuffle options, Fast mode, Submit).

**Files:**
- Modify: `apps/web/src/pages/ReviewEntryPage.tsx` (full implementation)

- [ ] **Step 1: Implement the page**

Replace the entire contents of `apps/web/src/pages/ReviewEntryPage.tsx` with:

```tsx
// The review picker (spec §6.1). Selection is ONE global Set<questionId>
// that survives switching tags — a question stays green wherever it
// appears (incl. multi-tagged). The tag column reuses listTags() (flat,
// rebuilt by parent_id like TagManagerPage); the main list reuses
// listQuestions({tagId}) (subtree + paginated). "Select all" uses the
// dedicated id endpoint so it covers the whole subtree, not just the
// loaded page. Selection is session-only (not persisted).

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../lib/api";
import {
  listQuestions,
  listTags,
  type Question,
  type Tag,
} from "../lib/qbank";
import {
  getDeck,
  getTagQuestionIds,
  getWrongSet,
} from "../lib/review";
import { allSelected, toggleId } from "../lib/review/session";
import Latex from "../components/Latex";

const PAGE_SIZE = 20;
const WRONG = "__wrong__"; // sentinel "tag" id for the wrong-set entry

function tagDepth(t: Tag): number {
  return t.path.split("/").length - 1;
}

export default function ReviewEntryPage() {
  const navigate = useNavigate();

  const [tags, setTags] = useState<Tag[]>([]);
  const [wrongTotal, setWrongTotal] = useState(0);
  // Active list source: a real tag id, or WRONG, or "" (nothing picked).
  const [activeId, setActiveId] = useState<string>("");
  const [items, setItems] = useState<Question[]>([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loadingList, setLoadingList] = useState(false);

  // The one global selection set.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [randomPick, setRandomPick] = useState(false);
  const [count, setCount] = useState(20);
  const [shuffleOptions, setShuffleOptions] = useState(true);
  const [fastMode, setFastMode] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Tag list + wrong count, once.
  useEffect(() => {
    let cancelled = false;
    Promise.all([listTags(), getWrongSet()])
      .then(([t, w]) => {
        if (cancelled) return;
        setTags(t);
        setWrongTotal(w.total);
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError(e instanceof ApiError ? e.message : "Network error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the active list (a tag subtree, or the wrong set).
  useEffect(() => {
    if (!activeId) {
      setItems([]);
      setTotal(0);
      return;
    }
    let cancelled = false;
    setLoadingList(true);
    const load =
      activeId === WRONG
        ? getWrongSet().then((w) => {
            if (!cancelled) {
              setWrongTotal(w.total);
              return { items: w.items, total: w.total };
            }
            return { items: [], total: 0 };
          })
        : listQuestions({
            tagId: activeId,
            limit: PAGE_SIZE,
            offset,
          }).then((r) => ({ items: r.items, total: r.total }));
    load
      .then((r) => {
        if (cancelled) return;
        setItems(r.items);
        setTotal(r.total);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError(e instanceof ApiError ? e.message : "Network error");
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, offset]);

  const sortedTags = useMemo(
    () => tags.slice().sort((a, b) => a.path.localeCompare(b.path)),
    [tags],
  );

  const listIds = items.map((q) => q.id);
  const everySelected = allSelected(listIds, selected);

  function pick(id: string) {
    setActiveId(id);
    setOffset(0);
  }

  function onToggleQuestion(id: string) {
    setSelected((s) => toggleId(s, id));
  }

  // "Select all" / "Deselect all" for the WHOLE active source (subtree
  // or wrong set), not just the visible page.
  async function onToggleAll() {
    setBusy(true);
    setError(null);
    try {
      let ids: string[];
      if (activeId === WRONG) {
        ids = (await getWrongSet()).items.map((q) => q.id);
      } else {
        ids = await getTagQuestionIds(activeId);
      }
      setSelected((s) => {
        const next = new Set(s);
        const addMode = !ids.every((id) => next.has(id));
        for (const id of ids) {
          if (addMode) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit() {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const ids = [...selected];
      const deck = await getDeck(
        ids,
        randomPick ? count : undefined,
      );
      if (deck.items.length === 0) {
        setError("None of the selected questions are available anymore.");
        return;
      }
      navigate("/review/session", {
        state: {
          reviewConfig: {
            questions: deck.items,
            requestedOrder: ids,
            randomOrder: randomPick,
            shuffleOptions,
            fastMode,
            isWrongSetSession: activeId === WRONG,
          },
        },
      });
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  const showingPager = activeId !== "" && activeId !== WRONG;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h1 className="text-lg font-semibold">Review</h1>

      {error && (
        <div className="mt-3 rounded-md border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-4 flex gap-4">
        {/* Tag column */}
        <div className="w-64 shrink-0 rounded-md border border-gray-200 p-2">
          <button
            onClick={() => pick(WRONG)}
            className={
              "block w-full rounded px-2 py-1 text-left text-sm " +
              (activeId === WRONG
                ? "bg-amber-100 font-medium text-amber-900"
                : "text-amber-800 hover:bg-amber-50")
            }
          >
            ⚠ Wrong questions ({wrongTotal})
          </button>
          <div className="my-2 border-t border-gray-100" />
          {sortedTags.length === 0 ? (
            <p className="px-2 text-xs text-gray-400">No tags yet.</p>
          ) : (
            sortedTags.map((t) => (
              <button
                key={t.id}
                onClick={() => pick(t.id)}
                style={{ paddingLeft: 8 + tagDepth(t) * 14 }}
                className={
                  "block w-full rounded px-2 py-1 text-left text-sm " +
                  (activeId === t.id
                    ? "bg-slate-800 text-white"
                    : "text-gray-700 hover:bg-gray-100")
                }
              >
                {t.name}
              </button>
            ))
          )}
        </div>

        {/* Main area: questions for the active source */}
        <div className="min-w-0 flex-1 rounded-md border border-gray-200 p-3">
          {activeId === "" ? (
            <p className="text-sm text-gray-500">
              Pick a tag or the wrong set to choose questions.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {activeId === WRONG
                    ? `Wrong questions (${total})`
                    : `Questions (${total})`}
                </span>
                <button
                  disabled={busy || items.length === 0}
                  onClick={onToggleAll}
                  className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
                >
                  {everySelected ? "Deselect all" : "Select all"}
                </button>
              </div>

              {loadingList ? (
                <p className="mt-3 text-sm text-gray-500">Loading…</p>
              ) : items.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500">
                  No questions here.
                </p>
              ) : (
                <div className="mt-3 divide-y divide-gray-100">
                  {items.map((q) => {
                    const on = selected.has(q.id);
                    return (
                      <div
                        key={q.id}
                        className="flex items-center gap-3 py-2"
                      >
                        <Latex
                          text={q.stem}
                          className="line-clamp-2 min-w-0 flex-1 text-sm text-gray-800"
                        />
                        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                          {q.type}
                        </span>
                        <button
                          onClick={() => onToggleQuestion(q.id)}
                          className={
                            "shrink-0 rounded-md px-3 py-1 text-xs font-medium " +
                            (on
                              ? "bg-green-600 text-white hover:bg-green-700"
                              : "border border-gray-300 text-gray-700 hover:bg-gray-50")
                          }
                        >
                          {on ? "✓ Selected" : "Select"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {showingPager && total > PAGE_SIZE && (
                <div className="mt-3 flex items-center justify-between text-sm text-gray-600">
                  <span>
                    {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of{" "}
                    {total}
                  </span>
                  <div className="flex gap-2">
                    <button
                      disabled={offset === 0}
                      onClick={() =>
                        setOffset((o) => Math.max(0, o - PAGE_SIZE))
                      }
                      className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Prev
                    </button>
                    <button
                      disabled={offset + PAGE_SIZE >= total}
                      onClick={() => setOffset((o) => o + PAGE_SIZE)}
                      className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Bottom Submit bar */}
      <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-gray-200 pt-4 text-sm">
        <span className="font-semibold">{selected.size} selected</span>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={randomPick}
            onChange={(e) => setRandomPick(e.target.checked)}
          />
          Random pick
        </label>
        <input
          type="number"
          min={1}
          value={count}
          disabled={!randomPick}
          onChange={(e) =>
            setCount(Math.max(1, Number(e.target.value) || 1))
          }
          className="w-16 rounded-md border border-gray-300 px-2 py-1 disabled:bg-gray-50"
          aria-label="Random pick count"
        />
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={shuffleOptions}
            onChange={(e) => setShuffleOptions(e.target.checked)}
          />
          Shuffle options
        </label>
        <label className="flex items-center gap-1" title="Single/judge reveal the moment you pick (no Check button); multiple-choice still needs Submit. Both modes score and feed the wrong set.">
          <input
            type="checkbox"
            checked={fastMode}
            onChange={(e) => setFastMode(e.target.checked)}
          />
          Fast mode
        </label>
        <button
          disabled={selected.size === 0 || busy}
          onClick={onSubmit}
          className="ml-auto rounded-md bg-slate-800 px-4 py-2 font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          Submit · Start review →
        </button>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Fast mode: single/judge reveal the moment you pick (no Check
        button); multiple-choice still needs Submit. Both modes score and
        feed the wrong set. Your selection isn’t saved between visits.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm --dir apps/web build` then `pnpm --dir apps/web lint`
Expected: both succeed (no TS errors, no lint errors).

- [ ] **Step 3: Manual smoke test**

`pnpm --dir apps/web dev`, log in (needs the backend up with some tagged questions). On **Review**: clicking a tag lists its questions; the green button toggles; switching to another tag and back keeps the green state; "Select all" flips the whole subtree and the button label reflects state; "N selected" updates; Submit is disabled at 0 selected.

- [ ] **Step 4: Commit**

```
git add apps/web/src/pages/ReviewEntryPage.tsx
git commit -m "feat(web): review picker page (phase 7)"
```

---

## Task 12: ReviewSessionPage — flashcard runner + summary

Implements spec §6.2/§6.3: per-card state machine, Fast mode, one ReviewLog POST per card (non-blocking error + Retry), "Mark as mastered" in wrong-set sessions, end summary.

**Files:**
- Modify: `apps/web/src/pages/ReviewSessionPage.tsx` (full implementation)

- [ ] **Step 1: Implement the page**

Replace the entire contents of `apps/web/src/pages/ReviewSessionPage.tsx` with:

```tsx
// The flashcard runner (spec §6.2/§6.3). Deck + flags arrive via router
// state from the picker; a direct hit / refresh has no state -> bounce
// to /review (in-memory deck is intentionally not resumable in v1).

import { useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import type { Question } from "../lib/qbank";
import { masterWrong, postReviewLog } from "../lib/review";
import {
  buildDeck,
  isAnswerCorrect,
  type DeckCard,
} from "../lib/review/session";
import Latex from "../components/Latex";

interface ReviewConfig {
  questions: Question[];
  requestedOrder: string[];
  randomOrder: boolean;
  shuffleOptions: boolean;
  fastMode: boolean;
  isWrongSetSession: boolean;
}

interface Result {
  question: Question;
  correct: boolean;
}

export default function ReviewSessionPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const config =
    (location.state as { reviewConfig?: ReviewConfig } | null)
      ?.reviewConfig ?? null;

  // Build the deck ONCE (option order must stay stable for the session).
  // Reorder to selection order unless Random pick re-randomized it.
  const deck = useMemo<DeckCard[]>(() => {
    if (!config) return [];
    let qs = config.questions;
    if (!config.randomOrder) {
      const pos = new Map(config.requestedOrder.map((id, i) => [id, i]));
      qs = qs
        .slice()
        .sort(
          (a, b) =>
            (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0),
        );
    }
    return buildDeck(qs, {
      randomOrder: config.randomOrder,
      shuffleOptions: config.shuffleOptions,
      rng: Math.random,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [mastered, setMastered] = useState<Set<string>>(new Set());
  const [logError, setLogError] = useState<string | null>(null);
  const loggedRef = useRef<Set<number>>(new Set());

  if (!config) return <Navigate to="/review" replace />;
  if (deck.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-600">
          No questions to review.{" "}
          <button
            onClick={() => navigate("/review")}
            className="text-slate-700 underline"
          >
            Back to review
          </button>
        </p>
      </div>
    );
  }

  const finished = idx >= deck.length;

  if (finished) {
    const wrong = results.filter((r) => !r.correct);
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Session complete</h1>
        <p className="mt-2 text-sm">
          ✅ {results.length - wrong.length} / {results.length} correct
          {"  "}·{"  "}❌ {wrong.length} wrong
        </p>
        {wrong.length > 0 && (
          <div className="mt-3 rounded-md border border-gray-200 p-3">
            <p className="mb-1 text-xs font-medium text-gray-500">
              Wrong this session
            </p>
            <ul className="space-y-1">
              {wrong.map((r) => (
                <li key={r.question.id}>
                  <Latex
                    text={r.question.stem}
                    className="line-clamp-1 block text-sm text-gray-700"
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => navigate("/review")}
            className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Back to review home
          </button>
        </div>
      </div>
    );
  }

  const card = deck[idx];
  const q = card.question;
  const isMulti = q.type === "multi";

  function togglePick(label: string) {
    if (revealed) return;
    if (isMulti) {
      setPicked((p) =>
        p.includes(label)
          ? p.filter((l) => l !== label)
          : [...p, label],
      );
    } else {
      // single / judge: pick is one label.
      setPicked([label]);
      if (config!.fastMode) doReveal([label]);
    }
  }

  async function doReveal(sel: string[] = picked) {
    if (revealed || sel.length === 0) return;
    setRevealed(true);
    const correct = isAnswerCorrect(q, sel);
    setResults((r) => [...r, { question: q, correct }]);
    // Post exactly once per card index.
    if (!loggedRef.current.has(idx)) {
      loggedRef.current.add(idx);
      try {
        await postReviewLog(q.id, correct);
        setLogError(null);
      } catch {
        loggedRef.current.delete(idx); // allow Retry
        setLogError(
          "Couldn't save this result. Your progress continues.",
        );
      }
    }
  }

  async function retryLog() {
    const last = results[results.length - 1];
    if (!last || loggedRef.current.has(idx)) return;
    loggedRef.current.add(idx);
    try {
      await postReviewLog(last.question.id, last.correct);
      setLogError(null);
    } catch {
      loggedRef.current.delete(idx);
      setLogError("Still couldn't save. Your progress continues.");
    }
  }

  async function onMaster() {
    try {
      await masterWrong(q.id);
      setMastered((m) => new Set(m).add(q.id));
    } catch {
      setLogError("Couldn't mark mastered.");
    }
  }

  function next() {
    setIdx((i) => i + 1);
    setPicked([]);
    setRevealed(false);
  }

  const correctSet = new Set(q.correct);
  const pickedSet = new Set(picked);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      {logError && (
        <div className="mb-3 flex items-center justify-between rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>{logError}</span>
          <button
            onClick={retryLog}
            className="rounded border border-red-300 px-2 py-0.5 text-xs hover:bg-red-100"
          >
            Retry
          </button>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>
          Card {idx + 1} / {deck.length}
        </span>
        <span>{q.type}</span>
      </div>

      <div className="mt-3 text-base text-gray-900">
        <Latex text={q.stem} />
      </div>

      <div className="mt-4 space-y-2">
        {card.options.map((o) => {
          const isPicked = pickedSet.has(o.label);
          const isCorrect = correctSet.has(o.label);
          let cls =
            "border border-gray-300 bg-white hover:bg-gray-50";
          if (revealed && isCorrect)
            cls = "border-green-500 bg-green-50";
          else if (revealed && isPicked && !isCorrect)
            cls = "border-red-500 bg-red-50";
          else if (!revealed && isPicked)
            cls = "border-blue-500 bg-blue-50";
          return (
            <button
              key={o.label}
              disabled={revealed}
              onClick={() => togglePick(o.label)}
              className={
                "flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm disabled:cursor-default " +
                cls
              }
            >
              <span className="font-medium text-gray-600">
                {o.label}.
              </span>
              <Latex text={o.content} className="flex-1" />
              {revealed && isCorrect && (
                <span className="text-green-700">✓</span>
              )}
              {revealed && isPicked && !isCorrect && (
                <span className="text-red-700">✗</span>
              )}
            </button>
          );
        })}
      </div>

      {revealed && q.knowledge_summary && (
        <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          💡 {q.knowledge_summary}
        </div>
      )}

      <div className="mt-5 flex items-center gap-2">
        {!revealed ? (
          <button
            disabled={picked.length === 0}
            onClick={() => doReveal()}
            className="rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {isMulti ? "Submit" : "Check"}
          </button>
        ) : (
          <>
            {config.isWrongSetSession && (
              <button
                disabled={mastered.has(q.id)}
                onClick={onMaster}
                className="rounded-md border border-amber-500 bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-200 disabled:opacity-50"
              >
                {mastered.has(q.id) ? "Mastered ✓" : "Mark as mastered"}
              </button>
            )}
            <button
              onClick={next}
              className="ml-auto rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              {idx + 1 >= deck.length ? "Finish" : "Next →"}
            </button>
          </>
        )}
        <button
          onClick={() => navigate("/review")}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
        >
          Quit
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint + unit tests**

Run: `pnpm --dir apps/web build` then `pnpm --dir apps/web lint` then `pnpm --dir apps/web test`
Expected: all three succeed (build/lint clean; `session.test.ts` + `splitter.test.ts` green).

- [ ] **Step 3: Commit**

```
git add apps/web/src/pages/ReviewSessionPage.tsx
git commit -m "feat(web): flashcard session runner + summary (phase 7)"
```

---

## Task 13: End-to-end acceptance (exit criteria)

No new code — verify the spec's exit criteria against the running stack, fix any defect found in the relevant task before declaring done.

**Prereqs:** `docker compose up -d postgres`; backend running (`cd apps/server && .venv/Scripts/python.exe -m uvicorn main:app --reload`); `pnpm --dir apps/web dev`; logged in with ≥ 25 questions across ≥ 2 tags (some multi-tagged), mixed single/multi/judge.

- [ ] **Step 1: Re-run the automated checks**

```
cd apps/server && .venv/Scripts/python.exe scripts/verify_review.py
```
then from repo root:
```
pnpm --dir apps/web test
pnpm --dir apps/web build
pnpm --dir apps/web lint
```
Expected: `verify_review: ALL PASS`; vitest all green; build + lint clean.

- [ ] **Step 2: Exit criterion — selection across tags**

On **Review**: select a parent tag → "Select all" (covers the subtree). Switch to another tag, toggle a few individually. Open a multi-tagged question's other tag — it shows green there too. The "N selected" count is the de-duplicated total. ✅ if all hold.

- [ ] **Step 3: Exit criterion — run 20 cards, Fast mode behaviour**

Set Random pick on, count 20, Submit. Without Fast mode: picking shows Check/Submit, then reveal. Re-run with Fast mode on: single/judge reveal instantly on pick; multi still needs Submit. Every card writes a log (watch the network tab: one `POST /review/logs` per card). ✅ if all hold.

- [ ] **Step 4: Exit criterion — wrong set fills, master, re-add**

After a run with some wrong answers, the tag column "⚠ Wrong questions (N)" count increased; opening it lists them. Start a wrong-set review (select the Wrong entry → Select all → Submit): each card shows **Mark as mastered**; mastering one and finishing → it's gone from the Wrong list (N decremented). Review it again and answer wrong → it returns to the Wrong list. ✅ if all hold.

- [ ] **Step 5: Edge behaviours**

Submit with 0 selected → disabled. Stop the backend, answer a card → red non-blocking banner + Retry, session continues; restart backend, Retry → banner clears. Refresh mid-session → lands on `/review` (no crash); previously answered cards are still logged (their wrong ones are in the Wrong list). ✅ if all hold.

- [ ] **Step 6: Final commit**

```
git add -A
git commit -m "chore: phase 7 flashcards review + wrong set complete"
```

---

## Self-review (completed during planning)

- **Spec coverage:** §2.1 wrong-set persistence → Tasks 1,5,6; §2.2 clear in two places → Task 6 (endpoint) + Task 11 (list/Select-all via wrong entry) + Task 12 (card "Mark as mastered"); §2.3 Fast mode → Task 12; §2.4 nav → Task 10; §2.5 picker/global selection set incl. cross-tag → Tasks 9,11; §2.6 bottom bar → Task 11; §2.7 summary → Task 12; §4 data model → Task 1; §5 API → Tasks 2–6; §6 frontend → Tasks 8–12; §7 edge cases → Tasks 11,12 + verified Task 13; §8 testing → Tasks 7,9,13; §10 exit criteria → Task 13. No gaps.
- **Placeholder scan:** none — every code step has full content.
- **Type/name consistency:** `to_question_out`, `get_owned_question`, `tags_for`, `tags_by_question`, `subtree_question_predicate` consistent across Tasks 2/4/5/6; frontend `getDeck/getTagQuestionIds/postReviewLog/getWrongSet/masterWrong` consistent across Tasks 8/11/12; `buildDeck/isAnswerCorrect/allSelected/toggleId/shuffleWithRng/applyRandomCap` consistent Tasks 9/11/12; router state key `reviewConfig` consistent Tasks 11/12; `WRONG` sentinel local to Task 11.
