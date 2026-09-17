"""Bind a disposable sandbox database to one immutable lifetime.

Revision ID: 20260916_0035
Revises: 20260916_0034
"""

import sqlalchemy as sa
from alembic import op

revision = "20260916_0035"
down_revision = "20260916_0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sandbox_generations",
        sa.Column("singleton", sa.Integer(), nullable=False),
        sa.Column("generation_id", sa.Uuid(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("singleton"),
        sa.UniqueConstraint("generation_id"),
        sa.CheckConstraint("singleton = 1", name="single_generation"),
        sa.CheckConstraint(
            "expires_at > started_at AND expires_at <= started_at + interval '24 hours'",
            name="bounded_lifetime",
        ),
    )
    op.execute("""
        CREATE FUNCTION reject_sandbox_generation_change() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'Sandbox generations cannot be changed or removed';
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER sandbox_generation_immutable
        BEFORE UPDATE OR DELETE OR TRUNCATE ON sandbox_generations
        FOR EACH STATEMENT EXECUTE FUNCTION reject_sandbox_generation_change();
    """)


def downgrade() -> None:
    # Serialize with first binding so an unbound check cannot race initialization.
    op.execute("LOCK TABLE sandbox_generations IN ACCESS EXCLUSIVE MODE")
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM sandbox_generations)")):
        raise RuntimeError("cannot downgrade a bound sandbox generation; replace its environment")
    op.drop_table("sandbox_generations")
    op.execute("DROP FUNCTION reject_sandbox_generation_change()")
