"""add community moderation, publication attestations, and abuse limits

Revision ID: 20260826_0018
Revises: 20260826_0017
Create Date: 2026-08-26 18:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260826_0018"
down_revision: str | None = "20260826_0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MODERATION_AUDIT_GUARD = "prevent_recipe_moderation_audit_event_mutation"


def upgrade() -> None:
    op.add_column(
        "recipe_version_publications",
        sa.Column("community_rules_version", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "recipe_version_publications",
        sa.Column(
            "publication_rights_confirmed_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.create_check_constraint(
        op.f("ck_recipe_version_publications_publication_attestations"),
        "recipe_version_publications",
        "(community_rules_version IS NULL "
        "AND publication_rights_confirmed_at IS NULL) OR "
        "(NULLIF(btrim(community_rules_version), '') IS NOT NULL "
        "AND publication_rights_confirmed_at IS NOT NULL)",
    )

    op.create_table(
        "community_moderators",
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
            name=op.f("fk_community_moderators_granted_by_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_community_moderators_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_community_moderators")),
    )

    op.create_table(
        "recipe_moderation_cases",
        sa.Column("recipe_version_id", sa.Uuid(), nullable=False),
        sa.Column(
            "status",
            sa.String(length=16),
            server_default=sa.text("'open'"),
            nullable=False,
        ),
        sa.Column(
            "opened_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reporter_count", sa.Integer(), nullable=False),
        sa.Column("last_reported_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('open', 'resolved')",
            name=op.f("ck_recipe_moderation_cases_status_supported"),
        ),
        sa.CheckConstraint(
            "(status = 'open' AND resolved_at IS NULL) OR "
            "(status = 'resolved' AND resolved_at IS NOT NULL)",
            name=op.f("ck_recipe_moderation_cases_resolution_consistent"),
        ),
        sa.CheckConstraint(
            "reporter_count >= 1",
            name=op.f("ck_recipe_moderation_cases_reporter_count_positive"),
        ),
        sa.ForeignKeyConstraint(
            ["recipe_version_id"],
            ["recipe_version_publications.recipe_version_id"],
            name=op.f("fk_recipe_moderation_cases_recipe_version_id_recipe_version_publications"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "recipe_version_id",
            name=op.f("pk_recipe_moderation_cases"),
        ),
    )
    op.create_index(
        "ix_recipe_moderation_cases_status_updated",
        "recipe_moderation_cases",
        ["status", "updated_at"],
        unique=False,
    )

    op.create_table(
        "recipe_reports",
        sa.Column("recipe_version_id", sa.Uuid(), nullable=False),
        sa.Column("reporter_user_id", sa.Uuid(), nullable=False),
        sa.Column("reason", sa.String(length=32), nullable=False),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("action_id", sa.Uuid(), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "reason IN ('spam', 'harassment', 'dangerous_content', "
            "'intellectual_property', 'other')",
            name=op.f("ck_recipe_reports_reason_supported"),
        ),
        sa.CheckConstraint(
            "details IS NULL OR (btrim(details) <> '' AND char_length(details) <= 1000)",
            name=op.f("ck_recipe_reports_details_bounded"),
        ),
        sa.CheckConstraint(
            "request_fingerprint ~ '^[0-9a-f]{64}$'",
            name=op.f("ck_recipe_reports_request_fingerprint_sha256"),
        ),
        sa.ForeignKeyConstraint(
            ["recipe_version_id"],
            ["recipe_moderation_cases.recipe_version_id"],
            name=op.f("fk_recipe_reports_recipe_version_id_recipe_moderation_cases"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["reporter_user_id"],
            ["users.id"],
            name=op.f("fk_recipe_reports_reporter_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_recipe_reports")),
        sa.UniqueConstraint(
            "recipe_version_id",
            "reporter_user_id",
            name="uq_recipe_reports_version_reporter",
        ),
        sa.UniqueConstraint(
            "reporter_user_id",
            "action_id",
            name="uq_recipe_reports_reporter_action",
        ),
    )
    op.create_index(
        op.f("ix_recipe_reports_reporter_user_id"),
        "recipe_reports",
        ["reporter_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_recipe_reports_version_created",
        "recipe_reports",
        ["recipe_version_id", "created_at"],
        unique=False,
    )

    op.create_table(
        "recipe_moderation_audit_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("recipe_version_id", sa.Uuid(), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=False),
        sa.Column("action", sa.String(length=16), nullable=False),
        sa.Column("previous_status", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("visibility_state", sa.String(length=24), nullable=False),
        sa.Column("private_note", sa.Text(), nullable=True),
        sa.Column("action_id", sa.Uuid(), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "action IN ('hide', 'restore', 'resolve')",
            name=op.f("ck_recipe_moderation_audit_events_action_supported"),
        ),
        sa.CheckConstraint(
            "previous_status IN ('open', 'resolved')",
            name=op.f("ck_recipe_moderation_audit_events_previous_status_supported"),
        ),
        sa.CheckConstraint(
            "status IN ('open', 'resolved')",
            name=op.f("ck_recipe_moderation_audit_events_status_supported"),
        ),
        sa.CheckConstraint(
            "visibility_state IN ('published', 'author_withdrawn', 'moderation_hidden')",
            name=op.f("ck_recipe_moderation_audit_events_visibility_state_supported"),
        ),
        sa.CheckConstraint(
            "private_note IS NULL OR ("
            "btrim(private_note) <> '' AND char_length(private_note) <= 1000)",
            name=op.f("ck_recipe_moderation_audit_events_private_note_bounded"),
        ),
        sa.CheckConstraint(
            "request_fingerprint ~ '^[0-9a-f]{64}$'",
            name=op.f("ck_recipe_moderation_audit_events_request_fingerprint_sha256"),
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            name=op.f("fk_recipe_moderation_audit_events_actor_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["recipe_version_id"],
            ["recipe_moderation_cases.recipe_version_id"],
            name=op.f(
                "fk_recipe_moderation_audit_events_recipe_version_id_recipe_moderation_cases"
            ),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_recipe_moderation_audit_events")),
        sa.UniqueConstraint(
            "actor_user_id",
            "action_id",
            name="uq_recipe_moderation_audit_events_actor_action",
        ),
    )
    op.create_index(
        op.f("ix_recipe_moderation_audit_events_actor_user_id"),
        "recipe_moderation_audit_events",
        ["actor_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_recipe_moderation_audit_events_case_occurred_id",
        "recipe_moderation_audit_events",
        ["recipe_version_id", "occurred_at", "id"],
        unique=False,
    )
    op.execute(
        f"""
        CREATE FUNCTION {MODERATION_AUDIT_GUARD}()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                MESSAGE = 'recipe moderation audit events are append-only',
                CONSTRAINT = 'ck_recipe_moderation_audit_events_append_only';
        END;
        $$
        """
    )
    op.execute(
        f"""
        CREATE TRIGGER recipe_moderation_audit_events_append_only
        BEFORE UPDATE OR DELETE ON recipe_moderation_audit_events
        FOR EACH ROW EXECUTE FUNCTION {MODERATION_AUDIT_GUARD}()
        """
    )
    op.execute(
        f"""
        CREATE TRIGGER recipe_moderation_audit_events_no_truncate
        BEFORE TRUNCATE ON recipe_moderation_audit_events
        FOR EACH STATEMENT EXECUTE FUNCTION {MODERATION_AUDIT_GUARD}()
        """
    )

    op.create_table(
        "abuse_rate_limit_buckets",
        sa.Column("operation", sa.String(length=32), nullable=False),
        sa.Column("dimension", sa.String(length=16), nullable=False),
        sa.Column("subject_digest", sa.String(length=64), nullable=False),
        sa.Column("account_user_id", sa.Uuid(), nullable=True),
        sa.Column("window_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("request_count", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "btrim(operation) <> ''",
            name=op.f("ck_abuse_rate_limit_buckets_operation_not_blank"),
        ),
        sa.CheckConstraint(
            "dimension IN ('account', 'identity', 'network')",
            name=op.f("ck_abuse_rate_limit_buckets_dimension_supported"),
        ),
        sa.CheckConstraint(
            "subject_digest ~ '^[0-9a-f]{64}$'",
            name=op.f("ck_abuse_rate_limit_buckets_subject_digest_sha256"),
        ),
        sa.CheckConstraint(
            "request_count >= 1",
            name=op.f("ck_abuse_rate_limit_buckets_request_count_positive"),
        ),
        sa.CheckConstraint(
            "expires_at > window_started_at",
            name=op.f("ck_abuse_rate_limit_buckets_expires_after_window_start"),
        ),
        sa.CheckConstraint(
            "(dimension = 'account' AND account_user_id IS NOT NULL) OR "
            "(dimension IN ('identity', 'network') AND account_user_id IS NULL)",
            name=op.f("ck_abuse_rate_limit_buckets_account_binding_consistent"),
        ),
        sa.ForeignKeyConstraint(
            ["account_user_id"],
            ["users.id"],
            name=op.f("fk_abuse_rate_limit_buckets_account_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "operation",
            "dimension",
            "subject_digest",
            "window_started_at",
            name=op.f("pk_abuse_rate_limit_buckets"),
        ),
    )
    op.create_index(
        "ix_abuse_rate_limit_buckets_expires_at",
        "abuse_rate_limit_buckets",
        ["expires_at"],
        unique=False,
    )
    op.create_index(
        "ix_abuse_rate_limit_buckets_account_user_id",
        "abuse_rate_limit_buckets",
        ["account_user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM community_moderators)
               OR EXISTS (SELECT 1 FROM recipe_moderation_cases)
               OR EXISTS (SELECT 1 FROM recipe_reports)
               OR EXISTS (SELECT 1 FROM recipe_moderation_audit_events)
               OR EXISTS (
                    SELECT 1
                    FROM recipe_version_publications
                    WHERE community_rules_version IS NOT NULL
                       OR publication_rights_confirmed_at IS NOT NULL
               ) THEN
                RAISE EXCEPTION
                    'cannot downgrade community moderation while durable evidence exists';
            END IF;
        END;
        $$
        """
    )

    op.drop_index(
        "ix_abuse_rate_limit_buckets_account_user_id",
        table_name="abuse_rate_limit_buckets",
    )
    op.drop_index(
        "ix_abuse_rate_limit_buckets_expires_at",
        table_name="abuse_rate_limit_buckets",
    )
    op.drop_table("abuse_rate_limit_buckets")

    op.execute(
        "DROP TRIGGER recipe_moderation_audit_events_no_truncate ON recipe_moderation_audit_events"
    )
    op.execute(
        "DROP TRIGGER recipe_moderation_audit_events_append_only ON recipe_moderation_audit_events"
    )
    op.execute(f"DROP FUNCTION {MODERATION_AUDIT_GUARD}()")
    op.drop_index(
        "ix_recipe_moderation_audit_events_case_occurred_id",
        table_name="recipe_moderation_audit_events",
    )
    op.drop_index(
        op.f("ix_recipe_moderation_audit_events_actor_user_id"),
        table_name="recipe_moderation_audit_events",
    )
    op.drop_table("recipe_moderation_audit_events")

    op.drop_index("ix_recipe_reports_version_created", table_name="recipe_reports")
    op.drop_index(
        op.f("ix_recipe_reports_reporter_user_id"),
        table_name="recipe_reports",
    )
    op.drop_table("recipe_reports")
    op.drop_index(
        "ix_recipe_moderation_cases_status_updated",
        table_name="recipe_moderation_cases",
    )
    op.drop_table("recipe_moderation_cases")
    op.drop_table("community_moderators")

    op.drop_constraint(
        op.f("ck_recipe_version_publications_publication_attestations"),
        "recipe_version_publications",
        type_="check",
    )
    op.drop_column("recipe_version_publications", "publication_rights_confirmed_at")
    op.drop_column("recipe_version_publications", "community_rules_version")
