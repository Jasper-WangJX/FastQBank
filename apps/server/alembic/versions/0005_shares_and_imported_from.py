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
