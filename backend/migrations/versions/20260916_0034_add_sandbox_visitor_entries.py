"""add digest-only temporary sandbox visitor entry bindings

Revision ID: 20260916_0034
Revises: 20260914_0033
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260916_0034"
down_revision: str | None = "20260914_0033"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sandbox_visitor_entries",
        sa.Column("entry_digest", sa.String(64), nullable=False),
        sa.Column("generation_id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "entry_digest ~ '^[0-9a-f]{64}$'",
            name=op.f("ck_sandbox_visitor_entries_entry_digest_lowercase_sha256"),
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["user_sessions.id"],
            name=op.f("fk_sandbox_visitor_entries_session_id_user_sessions"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("entry_digest", name=op.f("pk_sandbox_visitor_entries")),
        sa.UniqueConstraint("session_id", name=op.f("uq_sandbox_visitor_entries_session_id")),
    )
    op.create_index(
        "ix_sandbox_visitor_entries_generation_id", "sandbox_visitor_entries", ["generation_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_sandbox_visitor_entries_generation_id", table_name="sandbox_visitor_entries")
    op.drop_table("sandbox_visitor_entries")
