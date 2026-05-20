"""Phase 11: account security hardening

users:
  - add google_id (nullable, unique)
  - drop NOT NULL on password_hash (Google-only accounts have no
    password)
  - add CHECK (password_hash IS NOT NULL OR google_id IS NOT NULL)
    so every row has at least one sign-in method

New tables:
  - email_verifications: 6-digit code (bcrypt-hashed) tied to an
    email + purpose, with attempts counter and expiry. One row per
    (email, purpose) is enforced by the router (DELETE-then-INSERT).
  - oauth_states: PKCE verifier + redirect_uri pinned to a state
    token, short TTL; deleted on use.

Revision ID: 0006_phase11_account_security
Revises: 0005_shares_and_imported_from
Create Date: 2026-05-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0006_phase11_account_security"
down_revision: str | None = "0005_shares_and_imported_from"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # (a) users.google_id + invariant
    op.add_column("users", sa.Column("google_id", sa.Text(), nullable=True))
    op.create_unique_constraint(
        "uq_users_google_id", "users", ["google_id"]
    )
    op.alter_column("users", "password_hash", nullable=True)
    op.create_check_constraint(
        "ck_users_auth_method",
        "users",
        "password_hash IS NOT NULL OR google_id IS NOT NULL",
    )

    # (b) email_verifications
    op.create_table(
        "email_verifications",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("code_hash", sa.Text(), nullable=False),
        sa.Column(
            "expires_at", sa.DateTime(timezone=True), nullable=False
        ),
        sa.Column(
            "attempts",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "sent_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_email_verifications_email_purpose",
        "email_verifications",
        ["email", "purpose"],
    )

    # (c) oauth_states
    op.create_table(
        "oauth_states",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("state", sa.Text(), nullable=False),
        sa.Column("code_verifier", sa.Text(), nullable=False),
        sa.Column("redirect_uri", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "expires_at", sa.DateTime(timezone=True), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("state", name="uq_oauth_states_state"),
    )


def downgrade() -> None:
    op.drop_table("oauth_states")
    op.drop_index(
        "ix_email_verifications_email_purpose",
        table_name="email_verifications",
    )
    op.drop_table("email_verifications")
    op.drop_constraint("ck_users_auth_method", "users", type_="check")
    # Best-effort: Postgres will reject this if any row has NULL
    # password_hash; that's intentional — drop Google-only rows first.
    op.alter_column("users", "password_hash", nullable=False)
    op.drop_constraint("uq_users_google_id", "users", type_="unique")
    op.drop_column("users", "google_id")
