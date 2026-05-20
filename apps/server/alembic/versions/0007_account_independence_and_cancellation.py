"""Phase 11.1: account independence + cancellation

Replace the global UNIQUE(email) on users with two partial unique
indexes so a password account and a Google account that happen to
share an email can coexist as independent rows. Also swap 0006's
`uq_users_google_id` for a partial unique index so the naming is
consistent ("only unique where the column has a value").

Add `deleted_users (email, deleted_at)` to enforce a 24-hour
password-re-registration cooldown after `/auth/delete-account`.

Revision ID: 0007_account_independence_and_cancellation
Revises: 0006_phase11_account_security
Create Date: 2026-05-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0007_account_independence_and_cancellation"
down_revision: str | None = "0006_phase11_account_security"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # (a) Drop the global UNIQUE on users.email (named in 0001) and
    # 0006's UNIQUE on users.google_id. Replace both with partial
    # unique indexes that only enforce uniqueness for the relevant
    # subset of rows.
    op.drop_constraint("uq_users_email", "users", type_="unique")
    op.drop_constraint("uq_users_google_id", "users", type_="unique")

    op.create_index(
        "uq_users_email_password",
        "users",
        ["email"],
        unique=True,
        postgresql_where=sa.text("google_id IS NULL"),
    )
    op.create_index(
        "uq_users_email_google",
        "users",
        ["email"],
        unique=True,
        postgresql_where=sa.text("google_id IS NOT NULL"),
    )
    op.create_index(
        "uq_users_google_id_notnull",
        "users",
        ["google_id"],
        unique=True,
        postgresql_where=sa.text("google_id IS NOT NULL"),
    )

    # (b) deleted_users cooldown table.
    op.create_table(
        "deleted_users",
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column(
            "deleted_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("email", "deleted_at"),
    )


def downgrade() -> None:
    op.drop_table("deleted_users")
    op.drop_index("uq_users_google_id_notnull", table_name="users")
    op.drop_index("uq_users_email_google", table_name="users")
    op.drop_index("uq_users_email_password", table_name="users")
    # Best-effort: will fail if two rows share an email/google_id.
    op.create_unique_constraint(
        "uq_users_google_id", "users", ["google_id"]
    )
    op.create_unique_constraint("uq_users_email", "users", ["email"])
