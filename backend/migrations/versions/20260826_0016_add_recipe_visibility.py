"""add recipe visibility lifecycle and audit evidence

Revision ID: 20260826_0016
Revises: 20260826_0015
Create Date: 2026-08-26 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260826_0016"
down_revision: str | None = "20260826_0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

EVIDENCE_FUNCTION = "prevent_recipe_publication_evidence_mutation"
VISIBILITY_INITIALIZER_FUNCTION = "initialize_recipe_publication_visibility"
VISIBILITY_AUDIT_FUNCTION = "record_recipe_publication_visibility_event"
VISIBILITY_EVENT_GUARD_FUNCTION = "prevent_recipe_visibility_event_mutation"


def _replace_publication_evidence_guard() -> None:
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION {EVIDENCE_FUNCTION}()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
                RAISE EXCEPTION USING
                    ERRCODE = '23514',
                    MESSAGE = 'recipe publication evidence is append-only',
                    CONSTRAINT = 'ck_published_recipe_snapshot_immutable';
            END IF;

            IF (
                to_jsonb(NEW) - ARRAY[
                    'state',
                    'author_withdrawn_at',
                    'moderation_hidden_at',
                    'state_changed_at',
                    'state_changed_by_user_id'
                ]
            ) IS DISTINCT FROM (
                to_jsonb(OLD) - ARRAY[
                    'state',
                    'author_withdrawn_at',
                    'moderation_hidden_at',
                    'state_changed_at',
                    'state_changed_by_user_id'
                ]
            ) THEN
                RAISE EXCEPTION USING
                    ERRCODE = '23514',
                    MESSAGE = 'recipe publication evidence is append-only',
                    CONSTRAINT = 'ck_published_recipe_snapshot_immutable';
            END IF;

            IF ROW(
                NEW.state,
                NEW.author_withdrawn_at,
                NEW.moderation_hidden_at
            ) IS NOT DISTINCT FROM ROW(
                OLD.state,
                OLD.author_withdrawn_at,
                OLD.moderation_hidden_at
            ) THEN
                IF ROW(
                    NEW.state_changed_at,
                    NEW.state_changed_by_user_id
                ) IS DISTINCT FROM ROW(
                    OLD.state_changed_at,
                    OLD.state_changed_by_user_id
                ) THEN
                    RAISE EXCEPTION USING
                        ERRCODE = '23514',
                        MESSAGE = 'visibility audit metadata requires a state change',
                        CONSTRAINT = 'ck_recipe_version_publications_visibility_audited';
                END IF;
                RETURN NEW;
            END IF;

            IF NEW.state_changed_at IS NOT DISTINCT FROM OLD.state_changed_at THEN
                RAISE EXCEPTION USING
                    ERRCODE = '23514',
                    MESSAGE = 'visibility changes require a new audit timestamp',
                    CONSTRAINT = 'ck_recipe_version_publications_visibility_audited';
            END IF;
            IF NEW.state_changed_at < OLD.state_changed_at THEN
                RAISE EXCEPTION USING
                    ERRCODE = '23514',
                    MESSAGE = 'visibility audit timestamps cannot move backward',
                    CONSTRAINT = 'ck_recipe_version_publications_visibility_audited';
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )


def _restore_publication_evidence_guard() -> None:
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION {EVIDENCE_FUNCTION}()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                MESSAGE = 'recipe publication evidence is append-only',
                CONSTRAINT = 'ck_published_recipe_snapshot_immutable';
        END;
        $$
        """
    )


def upgrade() -> None:
    op.add_column(
        "recipe_version_publications",
        sa.Column("author_withdrawn_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "recipe_version_publications",
        sa.Column("moderation_hidden_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "recipe_version_publications",
        sa.Column("state_changed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "recipe_version_publications",
        sa.Column("state_changed_by_user_id", sa.Uuid(), nullable=True),
    )
    # The 0014 trigger rejects every update. Remove only its row-level trigger while
    # this transaction backfills the new lifecycle metadata; its function and the
    # independent no-truncate trigger remain installed throughout the migration.
    op.execute(
        "DROP TRIGGER recipe_version_publications_append_only ON recipe_version_publications"
    )
    op.execute(
        """
        UPDATE recipe_version_publications
        SET state_changed_at = published_at,
            state_changed_by_user_id = actor_user_id
        """
    )
    op.alter_column(
        "recipe_version_publications",
        "state_changed_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("CURRENT_TIMESTAMP"),
    )
    op.alter_column(
        "recipe_version_publications",
        "state_changed_by_user_id",
        existing_type=sa.Uuid(),
        nullable=False,
    )
    op.create_foreign_key(
        op.f("fk_recipe_version_publications_state_changed_by_user_id_users"),
        "recipe_version_publications",
        "users",
        ["state_changed_by_user_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        op.f("ix_recipe_version_publications_state_changed_by_user_id"),
        "recipe_version_publications",
        ["state_changed_by_user_id"],
        unique=False,
    )
    op.drop_constraint(
        op.f("ck_recipe_version_publications_state_supported"),
        "recipe_version_publications",
        type_="check",
    )
    op.create_check_constraint(
        op.f("ck_recipe_version_publications_state_supported"),
        "recipe_version_publications",
        "state IN ('published', 'author_withdrawn', 'moderation_hidden')",
    )
    op.create_check_constraint(
        op.f("ck_recipe_version_publications_visibility_shape_valid"),
        "recipe_version_publications",
        "(state = 'published' "
        "AND author_withdrawn_at IS NULL AND moderation_hidden_at IS NULL) OR "
        "(state = 'author_withdrawn' "
        "AND author_withdrawn_at IS NOT NULL AND moderation_hidden_at IS NULL) OR "
        "(state = 'moderation_hidden' AND moderation_hidden_at IS NOT NULL)",
    )

    op.create_table(
        "recipe_version_visibility_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("recipe_version_id", sa.Uuid(), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=False),
        sa.Column("previous_state", sa.String(length=24), nullable=True),
        sa.Column("state", sa.String(length=24), nullable=False),
        sa.Column("author_withdrawn_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("moderation_hidden_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "previous_state IS NULL OR "
            "previous_state IN ('published', 'author_withdrawn', 'moderation_hidden')",
            name=op.f("ck_recipe_version_visibility_events_previous_state_supported"),
        ),
        sa.CheckConstraint(
            "state IN ('published', 'author_withdrawn', 'moderation_hidden')",
            name=op.f("ck_recipe_version_visibility_events_state_supported"),
        ),
        sa.CheckConstraint(
            "(state = 'published' "
            "AND author_withdrawn_at IS NULL AND moderation_hidden_at IS NULL) OR "
            "(state = 'author_withdrawn' "
            "AND author_withdrawn_at IS NOT NULL AND moderation_hidden_at IS NULL) OR "
            "(state = 'moderation_hidden' AND moderation_hidden_at IS NOT NULL)",
            name=op.f("ck_recipe_version_visibility_events_visibility_shape_valid"),
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            name=op.f("fk_recipe_version_visibility_events_actor_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["recipe_version_id"],
            ["recipe_version_publications.recipe_version_id"],
            name=op.f(
                "fk_recipe_version_visibility_events_recipe_version_id_recipe_version_publications"
            ),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "id",
            name=op.f("pk_recipe_version_visibility_events"),
        ),
    )
    op.create_index(
        "ix_recipe_version_visibility_events_version_occurred_id",
        "recipe_version_visibility_events",
        ["recipe_version_id", "occurred_at", "id"],
        unique=False,
    )
    op.execute(
        """
        INSERT INTO recipe_version_visibility_events (
            recipe_version_id,
            actor_user_id,
            previous_state,
            state,
            author_withdrawn_at,
            moderation_hidden_at,
            occurred_at
        )
        SELECT
            recipe_version_id,
            state_changed_by_user_id,
            NULL,
            state,
            author_withdrawn_at,
            moderation_hidden_at,
            state_changed_at
        FROM recipe_version_publications
        """
    )

    op.execute(
        f"""
        CREATE FUNCTION {VISIBILITY_INITIALIZER_FUNCTION}()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            IF NEW.state_changed_at IS NULL THEN
                NEW.state_changed_at := COALESCE(NEW.published_at, clock_timestamp());
            END IF;
            IF NEW.state_changed_by_user_id IS NULL THEN
                NEW.state_changed_by_user_id := NEW.actor_user_id;
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        f"""
        CREATE TRIGGER recipe_version_publications_visibility_initialized
        BEFORE INSERT ON recipe_version_publications
        FOR EACH ROW EXECUTE FUNCTION {VISIBILITY_INITIALIZER_FUNCTION}()
        """
    )
    op.execute(
        f"""
        CREATE FUNCTION {VISIBILITY_AUDIT_FUNCTION}()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            IF TG_OP = 'INSERT' OR ROW(
                NEW.state,
                NEW.author_withdrawn_at,
                NEW.moderation_hidden_at
            ) IS DISTINCT FROM ROW(
                OLD.state,
                OLD.author_withdrawn_at,
                OLD.moderation_hidden_at
            ) THEN
                INSERT INTO recipe_version_visibility_events (
                    recipe_version_id,
                    actor_user_id,
                    previous_state,
                    state,
                    author_withdrawn_at,
                    moderation_hidden_at,
                    occurred_at
                ) VALUES (
                    NEW.recipe_version_id,
                    NEW.state_changed_by_user_id,
                    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.state END,
                    NEW.state,
                    NEW.author_withdrawn_at,
                    NEW.moderation_hidden_at,
                    NEW.state_changed_at
                );
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        f"""
        CREATE TRIGGER recipe_version_publications_visibility_audited
        AFTER INSERT OR UPDATE OF state, author_withdrawn_at, moderation_hidden_at
        ON recipe_version_publications
        FOR EACH ROW EXECUTE FUNCTION {VISIBILITY_AUDIT_FUNCTION}()
        """
    )
    op.execute(
        f"""
        CREATE FUNCTION {VISIBILITY_EVENT_GUARD_FUNCTION}()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                MESSAGE = 'recipe visibility audit events are append-only',
                CONSTRAINT = 'ck_recipe_version_visibility_events_append_only';
        END;
        $$
        """
    )
    op.execute(
        f"""
        CREATE TRIGGER recipe_version_visibility_events_append_only
        BEFORE UPDATE OR DELETE ON recipe_version_visibility_events
        FOR EACH ROW EXECUTE FUNCTION {VISIBILITY_EVENT_GUARD_FUNCTION}()
        """
    )
    op.execute(
        f"""
        CREATE TRIGGER recipe_version_visibility_events_no_truncate
        BEFORE TRUNCATE ON recipe_version_visibility_events
        FOR EACH STATEMENT EXECUTE FUNCTION {VISIBILITY_EVENT_GUARD_FUNCTION}()
        """
    )
    _replace_publication_evidence_guard()
    op.execute(
        f"""
        CREATE TRIGGER recipe_version_publications_append_only
        BEFORE UPDATE OR DELETE ON recipe_version_publications
        FOR EACH ROW EXECUTE FUNCTION {EVIDENCE_FUNCTION}()
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM recipe_version_publications
                WHERE state <> 'published'
                   OR author_withdrawn_at IS NOT NULL
                   OR moderation_hidden_at IS NOT NULL
            ) THEN
                RAISE EXCEPTION
                    'cannot downgrade recipe visibility while unavailable versions exist';
            END IF;
        END;
        $$
        """
    )
    op.execute(
        "DROP TRIGGER recipe_version_visibility_events_no_truncate "
        "ON recipe_version_visibility_events"
    )
    op.execute(
        "DROP TRIGGER recipe_version_visibility_events_append_only "
        "ON recipe_version_visibility_events"
    )
    op.execute(f"DROP FUNCTION {VISIBILITY_EVENT_GUARD_FUNCTION}()")
    op.execute(
        "DROP TRIGGER recipe_version_publications_visibility_audited ON recipe_version_publications"
    )
    op.execute(f"DROP FUNCTION {VISIBILITY_AUDIT_FUNCTION}()")
    op.execute(
        "DROP TRIGGER recipe_version_publications_visibility_initialized "
        "ON recipe_version_publications"
    )
    op.execute(f"DROP FUNCTION {VISIBILITY_INITIALIZER_FUNCTION}()")
    _restore_publication_evidence_guard()

    op.drop_index(
        "ix_recipe_version_visibility_events_version_occurred_id",
        table_name="recipe_version_visibility_events",
    )
    op.drop_table("recipe_version_visibility_events")
    op.drop_constraint(
        op.f("ck_recipe_version_publications_visibility_shape_valid"),
        "recipe_version_publications",
        type_="check",
    )
    op.drop_constraint(
        op.f("ck_recipe_version_publications_state_supported"),
        "recipe_version_publications",
        type_="check",
    )
    op.create_check_constraint(
        op.f("ck_recipe_version_publications_state_supported"),
        "recipe_version_publications",
        "state = 'published'",
    )
    op.drop_index(
        op.f("ix_recipe_version_publications_state_changed_by_user_id"),
        table_name="recipe_version_publications",
    )
    op.drop_constraint(
        op.f("fk_recipe_version_publications_state_changed_by_user_id_users"),
        "recipe_version_publications",
        type_="foreignkey",
    )
    op.drop_column("recipe_version_publications", "state_changed_by_user_id")
    op.drop_column("recipe_version_publications", "state_changed_at")
    op.drop_column("recipe_version_publications", "moderation_hidden_at")
    op.drop_column("recipe_version_publications", "author_withdrawn_at")
