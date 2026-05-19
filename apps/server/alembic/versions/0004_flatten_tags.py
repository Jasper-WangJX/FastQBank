"""flatten tags

Revision ID: 0004_flatten_tags
Revises: 0003_wrong_questions
Create Date: 2026-05-19 12:00:00.000000

Drops tag hierarchy (parent_id, path) and adds a per-user partial unique
index on `name`. This is a one-way data wipe: `tags` and `question_tags`
are truncated as part of `upgrade()` because hierarchical data cannot be
mapped 1:1 onto a flat schema. Questions themselves are kept; they just
end up with zero tags.

downgrade() recreates the dropped columns and FK but cannot restore the
truncated rows.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0004_flatten_tags"
down_revision = "0003_wrong_questions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Drop the self-FK first so we can truncate without CASCADE.
    op.drop_constraint("fk_tags_parent_id", "tags", type_="foreignkey")

    # 2. Now drop old indexes referencing the dropped columns.
    op.drop_index("ix_tags_parent_id", table_name="tags")
    op.drop_index("ix_tags_path", table_name="tags")

    # 3. Wipe rows that depend on the old hierarchy.
    # CASCADE will truncate question_tags since it FK references tags.
    op.execute("TRUNCATE TABLE tags CASCADE;")

    # 4. Drop the old hierarchy columns.
    op.drop_column("tags", "parent_id")
    op.drop_column("tags", "path")

    # 5. Add the partial unique index for (user_id, name) on live rows.
    op.create_index(
        "uq_tags_user_name",
        "tags",
        ["user_id", "name"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_tags_user_name", table_name="tags")
    op.add_column(
        "tags",
        sa.Column("path", sa.Text(), nullable=True),
    )
    op.add_column(
        "tags",
        sa.Column("parent_id", UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_tags_parent_id",
        "tags",
        "tags",
        ["parent_id"],
        ["id"],
    )
    op.create_index("ix_tags_path", "tags", ["path"])
    op.create_index("ix_tags_parent_id", "tags", ["parent_id"])
    # NOTE: row data is not restored.
