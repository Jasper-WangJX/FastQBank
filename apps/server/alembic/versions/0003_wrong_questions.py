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
