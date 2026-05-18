"""ai_usage: per-user per-day AI token meter (stage 6)

Hand-written to mirror 0001 (explicit Postgres bits). One row per
(user_id, day); the unique constraint is the ON CONFLICT target the
router upserts against, and Postgres creates its backing index, so no
separate Index is needed.

Revision ID: 0002_ai_usage
Revises: 0001_initial_schema
Create Date: stage 6
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002_ai_usage"
down_revision: str | None = "0001_initial_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_usage",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column(
            "total_tokens",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "request_count",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_ai_usage_user_id"
        ),
        sa.UniqueConstraint("user_id", "day", name="uq_ai_usage_user_day"),
    )


def downgrade() -> None:
    op.drop_table("ai_usage")
