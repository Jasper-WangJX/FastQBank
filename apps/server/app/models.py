"""All 6 core ORM models (Proposal_CN.md §6).

Only `User` is exercised in stage 1, but the whole schema is defined now
so Alembic (B3) creates every table in one baseline migration and stage 2+
can autogenerate diffs against this metadata.

Design notes:
- UUID primary keys everywhere: import/export dedupes questions by UUID
  (Proposal §3.6), so Question.id must be a UUID; the rest follow suit
  for consistency. `gen_random_uuid()` is built into Postgres 16 core.
- No ORM `relationship()` is declared yet: async lazy-loading is a common
  footgun (MissingGreenlet). FK columns are enough for stage 1; explicit
  relationships get added in stage 2 where they are actually traversed.
- `type` / `source` use CHECK constraints instead of a PG ENUM — adding
  a value later is a one-line CHECK change vs a fragile ALTER TYPE.
"""

from datetime import datetime
from uuid import UUID as PyUUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# Reused column fragments as FACTORY FUNCTIONS. A single mapped_column()
# object MUST NOT be shared across mapped classes — SQLAlchemy needs a
# fresh Column per class, so each helper returns a new instance.
def _uuid_pk() -> Mapped[PyUUID]:
    """UUID primary key, generated DB-side by Postgres."""
    return mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )


def _now_column(nullable: bool = False) -> Mapped[datetime]:
    """A TIMESTAMPTZ column defaulting to the DB clock."""
    return mapped_column(
        DateTime(timezone=True),
        nullable=nullable,
        server_default=text("now()") if not nullable else None,
    )


class User(Base):
    __tablename__ = "users"

    id: Mapped[PyUUID] = _uuid_pk()
    # unique=True creates the unique constraint + index used for both
    # login lookup and the duplicate-email check on register.
    email: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = _now_column()


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[PyUUID] = _uuid_pk()
    user_id: Mapped[PyUUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    # Self-referential parent; NULL means a root tag.
    parent_id: Mapped[PyUUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tags.id"), nullable=True
    )
    # Materialized path, e.g. "数学/微积分/极限" — enables prefix queries.
    path: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = _now_column()
    updated_at: Mapped[datetime] = _now_column()
    deleted_at: Mapped[datetime | None] = _now_column(nullable=True)

    __table_args__ = (
        Index("ix_tags_user_id", "user_id"),
        Index("ix_tags_parent_id", "parent_id"),
        Index("ix_tags_path", "path"),
    )


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[PyUUID] = _uuid_pk()
    user_id: Mapped[PyUUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    stem: Mapped[str] = mapped_column(Text, nullable=False)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    # options: [{"label": "A", "content": "..."}, ...]
    options: Mapped[list] = mapped_column(JSONB, nullable=False)
    # correct: ["A", "C"] — labels of the correct option(s)
    correct: Mapped[list] = mapped_column(JSONB, nullable=False)
    knowledge_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = _now_column()
    updated_at: Mapped[datetime] = _now_column()
    deleted_at: Mapped[datetime | None] = _now_column(nullable=True)

    __table_args__ = (
        CheckConstraint(
            "type IN ('single', 'multi', 'judge')", name="ck_questions_type"
        ),
        CheckConstraint(
            "source IN ('manual', 'ocr', 'ai')", name="ck_questions_source"
        ),
        Index("ix_questions_user_id", "user_id"),
    )


class QuestionTag(Base):
    __tablename__ = "question_tags"

    # Natural composite PK — no surrogate id for a pure join table.
    # CASCADE so deleting a question/tag clears its link rows.
    question_id: Mapped[PyUUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("questions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    tag_id: Mapped[PyUUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tags.id", ondelete="CASCADE"),
        primary_key=True,
    )

    __table_args__ = (Index("ix_question_tags_tag_id", "tag_id"),)


class ReviewLog(Base):
    __tablename__ = "review_logs"

    id: Mapped[PyUUID] = _uuid_pk()
    user_id: Mapped[PyUUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    question_id: Mapped[PyUUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("questions.id"), nullable=False
    )
    correct: Mapped[bool] = mapped_column(Boolean, nullable=False)
    answered_at: Mapped[datetime] = _now_column()

    # Stage-7 "wrong questions" aggregates recent logs per user by time.
    __table_args__ = (
        Index("ix_review_logs_user_answered", "user_id", "answered_at"),
    )


class GenSession(Base):
    __tablename__ = "gen_sessions"

    id: Mapped[PyUUID] = _uuid_pk()
    user_id: Mapped[PyUUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    # A flat list of seed question ids — native PG array fits exactly.
    seed_question_ids: Mapped[list[PyUUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)), nullable=False
    )
    created_at: Mapped[datetime] = _now_column()

    __table_args__ = (Index("ix_gen_sessions_user_id", "user_id"),)
