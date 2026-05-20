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

from datetime import date, datetime
from uuid import UUID as PyUUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
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
    # NOT unique at the column level — uniqueness is enforced by the
    # two partial indexes below, so a password account and a Google
    # account that share an email can coexist as independent rows.
    email: Mapped[str] = mapped_column(Text, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    # google_id uniqueness is enforced via a partial index (only
    # non-null rows must be unique); same pattern as email.
    google_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = _now_column()

    __table_args__ = (
        CheckConstraint(
            "password_hash IS NOT NULL OR google_id IS NOT NULL",
            name="ck_users_auth_method",
        ),
        Index(
            "uq_users_email_password",
            "email",
            unique=True,
            postgresql_where=text("google_id IS NULL"),
        ),
        Index(
            "uq_users_email_google",
            "email",
            unique=True,
            postgresql_where=text("google_id IS NOT NULL"),
        ),
        Index(
            "uq_users_google_id_notnull",
            "google_id",
            unique=True,
            postgresql_where=text("google_id IS NOT NULL"),
        ),
    )


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[PyUUID] = _uuid_pk()
    user_id: Mapped[PyUUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = _now_column()
    updated_at: Mapped[datetime] = _now_column()
    deleted_at: Mapped[datetime | None] = _now_column(nullable=True)

    # Flat tags. (user_id, name) is unique among LIVE rows only —
    # soft-deleted rows are excluded so a name can be reused after
    # a delete. Reads already filter `deleted_at IS NULL` everywhere.
    __table_args__ = (
        Index("ix_tags_user_id", "user_id"),
        Index(
            "uq_tags_user_name",
            "user_id",
            "name",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
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
    # Stage 9: written once at import time, never updated. Refers to the
    # creator's question.id from the source share's payload — no FK, the
    # creator may have deleted that row by now. NULL on rows the user
    # entered directly (manual / OCR / AI).
    imported_from_id: Mapped[PyUUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )

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


class AiUsage(Base):
    """Per-user, per-UTC-day AI token meter (stage 6).

    One row per (user_id, day); the router upserts with PG ON CONFLICT
    (`uq_ai_usage_user_day`), adding tokens and bumping request_count.
    This backs both the per-user daily token cap and the /ai/usage
    counter the stage-6 exit criterion requires. The unique constraint
    creates the index used for the today-lookup, so no extra Index().
    """

    __tablename__ = "ai_usage"

    id: Mapped[PyUUID] = _uuid_pk()
    user_id: Mapped[PyUUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    day: Mapped[date] = mapped_column(Date, nullable=False)
    total_tokens: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    request_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    updated_at: Mapped[datetime] = _now_column()

    __table_args__ = (
        UniqueConstraint("user_id", "day", name="uq_ai_usage_user_day"),
    )


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


class EmailVerification(Base):
    """Pending email-verification record for the register flow
    (and any future password-reset flow via the `purpose` column).

    Only ONE row exists per (email, purpose) at a time: the router
    DELETEs any prior row before INSERTing a fresh one. A successful
    /auth/register also deletes the matching row, so the table never
    accumulates expired or "consumed but lingering" data.
    """

    __tablename__ = "email_verifications"

    id: Mapped[PyUUID] = _uuid_pk()
    email: Mapped[str] = mapped_column(Text, nullable=False)
    # bcrypt hash of the 6-digit code (never store the code itself).
    code_hash: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    sent_at: Mapped[datetime] = _now_column()
    purpose: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        Index(
            "ix_email_verifications_email_purpose",
            "email",
            "purpose",
        ),
    )


class OAuthState(Base):
    """Per-attempt PKCE state for Google sign-in.

    Inserted by /auth/google/start, deleted by /auth/google/callback
    on use. `redirect_uri` is recorded at start time because Google's
    token exchange validates that exchange's redirect_uri equals the
    authorize_url's; for desktop loopback the value is per-attempt.
    """

    __tablename__ = "oauth_states"

    id: Mapped[PyUUID] = _uuid_pk()
    state: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    code_verifier: Mapped[str] = mapped_column(Text, nullable=False)
    redirect_uri: Mapped[str] = mapped_column(Text, nullable=False)
    # 'web' or 'desktop'. The DB CHECK constraint ck_oauth_states_platform
    # (migration 0008) restricts the value; the router writes it
    # explicitly on every insert.
    platform: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = _now_column()
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


class DeletedUser(Base):
    """Cooldown record for password-account cancellation.

    /auth/request-code queries this table to block password
    re-registration of an email for 24 hours after the previous
    password account at that email was deleted. Google sign-in is
    unaffected; this table is not consulted for the Google flow.
    Composite PK so the same email can appear multiple times over
    the project lifetime.
    """

    __tablename__ = "deleted_users"

    email: Mapped[str] = mapped_column(Text, primary_key=True)
    deleted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        primary_key=True,
        server_default=text("now()"),
    )
