"""Phase 11.3: oauth_states.platform

Add a `platform` text column to oauth_states so /auth/google/callback
can look up which OAuth client (web vs desktop) was used at start
time and pick the right client_id/secret pair for token exchange.

The DEFAULT 'web' keeps the migration safe for any in-flight rows
present at upgrade time; the router always sets `platform` explicitly
going forward, so the default is also a harmless fallback if a future
code path forgets to set it.

Revision ID: 0008_oauth_states_platform
Revises: 0007_account_independence
Create Date: 2026-05-20
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0008_oauth_states_platform"
down_revision: str | None = "0007_account_independence"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "oauth_states",
        sa.Column(
            "platform",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'web'"),
        ),
    )
    op.create_check_constraint(
        "ck_oauth_states_platform",
        "oauth_states",
        "platform IN ('web', 'desktop')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_oauth_states_platform", "oauth_states", type_="check"
    )
    op.drop_column("oauth_states", "platform")
