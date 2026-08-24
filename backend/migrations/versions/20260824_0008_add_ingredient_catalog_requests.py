"""add ingredient catalog requests and curator grants

Revision ID: 20260824_0008
Revises: 20260823_0006
Create Date: 2026-08-24 17:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260824_0008"
down_revision: str | None = "20260823_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "catalog_curators",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("granted_by_user_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["granted_by_user_id"],
            ["users.id"],
            name=op.f("fk_catalog_curators_granted_by_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_catalog_curators_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_catalog_curators")),
    )
    op.create_table(
        "ingredient_catalog_requests",
        sa.Column("requester_user_id", sa.Uuid(), nullable=False),
        sa.Column("proposed_name", sa.String(length=200), nullable=False),
        sa.Column("normalized_name", sa.Text(), nullable=False),
        sa.Column("normalized_name_digest", sa.String(length=64), nullable=False),
        sa.Column("context", sa.String(length=500), nullable=True),
        sa.Column(
            "status",
            sa.String(length=16),
            server_default=sa.text("'pending'"),
            nullable=False,
        ),
        sa.Column("reviewer_user_id", sa.Uuid(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decision_reason", sa.String(length=1000), nullable=True),
        sa.Column("resolved_ingredient_id", sa.Uuid(), nullable=True),
        sa.Column("duplicate_of_request_id", sa.Uuid(), nullable=True),
        sa.Column("approved_canonical_name", sa.String(length=200), nullable=True),
        sa.Column("approved_aliases", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("approval_provenance", sa.Text(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "btrim(proposed_name) <> ''",
            name=op.f("ck_ingredient_catalog_requests_proposed_name_not_blank"),
        ),
        sa.CheckConstraint(
            "btrim(normalized_name) <> ''",
            name=op.f("ck_ingredient_catalog_requests_normalized_name_not_blank"),
        ),
        sa.CheckConstraint(
            "normalized_name_digest ~ '^[0-9a-f]{64}$'",
            name=op.f("ck_ingredient_catalog_requests_name_digest_sha256"),
        ),
        sa.CheckConstraint(
            "context IS NULL OR btrim(context) <> ''",
            name=op.f("ck_ingredient_catalog_requests_context_not_blank"),
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected', 'duplicate')",
            name=op.f("ck_ingredient_catalog_requests_status_supported"),
        ),
        sa.CheckConstraint(
            "decision_reason IS NULL OR btrim(decision_reason) <> ''",
            name=op.f("ck_ingredient_catalog_requests_decision_reason_not_blank"),
        ),
        sa.CheckConstraint(
            "approved_canonical_name IS NULL OR btrim(approved_canonical_name) <> ''",
            name=op.f("ck_ingredient_catalog_requests_approved_name_not_blank"),
        ),
        sa.CheckConstraint(
            "approved_aliases IS NULL OR jsonb_typeof(approved_aliases) = 'array'",
            name=op.f("ck_ingredient_catalog_requests_approved_aliases_array"),
        ),
        sa.CheckConstraint(
            "approval_provenance IS NULL OR btrim(approval_provenance) <> ''",
            name=op.f("ck_ingredient_catalog_requests_approval_provenance_not_blank"),
        ),
        sa.CheckConstraint(
            "duplicate_of_request_id IS NULL OR duplicate_of_request_id <> id",
            name=op.f("ck_ingredient_catalog_requests_duplicate_not_self"),
        ),
        sa.CheckConstraint(
            "(status = 'pending' AND reviewer_user_id IS NULL AND reviewed_at IS NULL "
            "AND decision_reason IS NULL AND resolved_ingredient_id IS NULL "
            "AND duplicate_of_request_id IS NULL AND approved_canonical_name IS NULL "
            "AND approved_aliases IS NULL AND approval_provenance IS NULL) OR "
            "(status = 'approved' AND reviewer_user_id IS NOT NULL AND reviewed_at IS NOT NULL "
            "AND decision_reason IS NOT NULL AND resolved_ingredient_id IS NOT NULL "
            "AND duplicate_of_request_id IS NULL AND approved_canonical_name IS NOT NULL "
            "AND approved_aliases IS NOT NULL AND approval_provenance IS NOT NULL) OR "
            "(status = 'rejected' AND reviewer_user_id IS NOT NULL AND reviewed_at IS NOT NULL "
            "AND decision_reason IS NOT NULL AND resolved_ingredient_id IS NULL "
            "AND duplicate_of_request_id IS NULL AND approved_canonical_name IS NULL "
            "AND approved_aliases IS NULL AND approval_provenance IS NULL) OR "
            "(status = 'duplicate' AND reviewer_user_id IS NOT NULL AND reviewed_at IS NOT NULL "
            "AND decision_reason IS NOT NULL AND resolved_ingredient_id IS NOT NULL "
            "AND approved_canonical_name IS NULL AND approved_aliases IS NULL "
            "AND approval_provenance IS NULL)",
            name=op.f("ck_ingredient_catalog_requests_review_state_consistent"),
        ),
        sa.ForeignKeyConstraint(
            ["duplicate_of_request_id"],
            ["ingredient_catalog_requests.id"],
            name=op.f(
                "fk_ingredient_catalog_requests_duplicate_of_request_id_ingredient_catalog_requests"
            ),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["requester_user_id"],
            ["users.id"],
            name=op.f("fk_ingredient_catalog_requests_requester_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["resolved_ingredient_id"],
            ["ingredients.id"],
            name=op.f("fk_ingredient_catalog_requests_resolved_ingredient_id_ingredients"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["reviewer_user_id"],
            ["users.id"],
            name=op.f("fk_ingredient_catalog_requests_reviewer_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ingredient_catalog_requests")),
    )
    op.create_index(
        op.f("ix_ingredient_catalog_requests_requester_user_id"),
        "ingredient_catalog_requests",
        ["requester_user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_ingredient_catalog_requests_reviewer_user_id"),
        "ingredient_catalog_requests",
        ["reviewer_user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_ingredient_catalog_requests_resolved_ingredient_id"),
        "ingredient_catalog_requests",
        ["resolved_ingredient_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_ingredient_catalog_requests_duplicate_of_request_id"),
        "ingredient_catalog_requests",
        ["duplicate_of_request_id"],
        unique=False,
    )
    op.create_index(
        "ix_ingredient_catalog_requests_status_created_at",
        "ingredient_catalog_requests",
        ["status", "created_at"],
        unique=False,
    )
    op.create_index(
        "uq_ingredient_catalog_requests_pending_name_normalized",
        "ingredient_catalog_requests",
        ["normalized_name_digest"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_table(
        "ingredient_catalog_audit_events",
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(length=16), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "event_type IN ('submitted', 'approved', 'rejected', 'duplicate')",
            name=op.f("ck_ingredient_catalog_audit_events_event_type_supported"),
        ),
        sa.CheckConstraint(
            "jsonb_typeof(payload) = 'object'",
            name=op.f("ck_ingredient_catalog_audit_events_payload_object"),
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            name=op.f("fk_ingredient_catalog_audit_events_actor_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["request_id"],
            ["ingredient_catalog_requests.id"],
            name=op.f("fk_ingredient_catalog_audit_events_request_id_ingredient_catalog_requests"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ingredient_catalog_audit_events")),
    )
    op.create_index(
        op.f("ix_ingredient_catalog_audit_events_actor_user_id"),
        "ingredient_catalog_audit_events",
        ["actor_user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_ingredient_catalog_audit_events_request_id"),
        "ingredient_catalog_audit_events",
        ["request_id"],
        unique=False,
    )
    op.create_index(
        "ix_ingredient_catalog_audit_events_request_created_at",
        "ingredient_catalog_audit_events",
        ["request_id", "created_at"],
        unique=False,
    )
    op.execute(
        sa.text(
            """
            CREATE FUNCTION prevent_ingredient_catalog_audit_event_mutation()
            RETURNS trigger AS $$
            BEGIN
                RAISE EXCEPTION 'ingredient catalog audit events are append-only';
            END;
            $$ LANGUAGE plpgsql
            """
        )
    )
    op.execute(
        sa.text(
            """
            CREATE TRIGGER ingredient_catalog_audit_events_append_only
            BEFORE UPDATE OR DELETE ON ingredient_catalog_audit_events
            FOR EACH ROW EXECUTE FUNCTION prevent_ingredient_catalog_audit_event_mutation()
            """
        )
    )
    op.execute(
        sa.text(
            """
            CREATE TRIGGER ingredient_catalog_audit_events_no_truncate
            BEFORE TRUNCATE ON ingredient_catalog_audit_events
            FOR EACH STATEMENT EXECUTE FUNCTION prevent_ingredient_catalog_audit_event_mutation()
            """
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "DROP TRIGGER ingredient_catalog_audit_events_no_truncate "
            "ON ingredient_catalog_audit_events"
        )
    )
    op.execute(
        sa.text(
            "DROP TRIGGER ingredient_catalog_audit_events_append_only "
            "ON ingredient_catalog_audit_events"
        )
    )
    op.execute(sa.text("DROP FUNCTION prevent_ingredient_catalog_audit_event_mutation()"))
    op.drop_index(
        "ix_ingredient_catalog_audit_events_request_created_at",
        table_name="ingredient_catalog_audit_events",
    )
    op.drop_index(
        op.f("ix_ingredient_catalog_audit_events_request_id"),
        table_name="ingredient_catalog_audit_events",
    )
    op.drop_index(
        op.f("ix_ingredient_catalog_audit_events_actor_user_id"),
        table_name="ingredient_catalog_audit_events",
    )
    op.drop_table("ingredient_catalog_audit_events")
    op.drop_index(
        "uq_ingredient_catalog_requests_pending_name_normalized",
        table_name="ingredient_catalog_requests",
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.drop_index(
        "ix_ingredient_catalog_requests_status_created_at",
        table_name="ingredient_catalog_requests",
    )
    op.drop_index(
        op.f("ix_ingredient_catalog_requests_duplicate_of_request_id"),
        table_name="ingredient_catalog_requests",
    )
    op.drop_index(
        op.f("ix_ingredient_catalog_requests_resolved_ingredient_id"),
        table_name="ingredient_catalog_requests",
    )
    op.drop_index(
        op.f("ix_ingredient_catalog_requests_reviewer_user_id"),
        table_name="ingredient_catalog_requests",
    )
    op.drop_index(
        op.f("ix_ingredient_catalog_requests_requester_user_id"),
        table_name="ingredient_catalog_requests",
    )
    op.drop_table("ingredient_catalog_requests")
    op.drop_table("catalog_curators")
