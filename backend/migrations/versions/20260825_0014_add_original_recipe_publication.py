"""add original recipe publication state and immutable snapshots

Revision ID: 20260825_0014
Revises: 20260825_0013
Create Date: 2026-08-25 18:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260825_0014"
down_revision: str | None = "20260825_0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

IMMUTABILITY_CONSTRAINT = "ck_published_recipe_snapshot_immutable"
IMMUTABILITY_FUNCTION = "prevent_published_recipe_snapshot_mutation"
TRUNCATE_FUNCTION = "prevent_published_recipe_snapshot_truncate"
LINEAGE_FUNCTION = "prevent_published_recipe_lineage_mutation"
EVIDENCE_FUNCTION = "prevent_recipe_publication_evidence_mutation"
IMMUTABLE_TABLE_COLUMNS = {
    "recipe_versions": "id",
    "recipe_version_ingredients": "recipe_version_id",
    "recipe_version_instructions": "recipe_version_id",
    "recipe_instruction_actions": "recipe_version_id",
    "recipe_instruction_action_inputs": "recipe_version_id",
    "recipe_structural_fingerprints": "recipe_version_id",
}
ACTION_MEASURE_TABLE = "recipe_instruction_action_measures"


def _create_immutability_guards() -> None:
    op.execute(
        f"""
        CREATE FUNCTION {TRUNCATE_FUNCTION}()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                MESSAGE = 'published recipe snapshot tables cannot be truncated',
                CONSTRAINT = '{IMMUTABILITY_CONSTRAINT}';
        END;
        $$
        """
    )
    op.execute(
        f"""
        CREATE FUNCTION {IMMUTABILITY_FUNCTION}()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
            old_data jsonb;
            new_data jsonb;
            old_version_id uuid;
            new_version_id uuid;
        BEGIN
            IF TG_OP <> 'INSERT' THEN
                old_data := to_jsonb(OLD);
            END IF;
            IF TG_OP <> 'DELETE' THEN
                new_data := to_jsonb(NEW);
            END IF;

            IF TG_ARGV[0] = 'action_measure' THEN
                IF old_data IS NOT NULL THEN
                    SELECT action.recipe_version_id
                    INTO old_version_id
                    FROM recipe_instruction_actions AS action
                    WHERE action.id =
                        (old_data ->> 'recipe_instruction_action_id')::uuid;
                END IF;
                IF new_data IS NOT NULL THEN
                    SELECT action.recipe_version_id
                    INTO new_version_id
                    FROM recipe_instruction_actions AS action
                    WHERE action.id =
                        (new_data ->> 'recipe_instruction_action_id')::uuid;
                END IF;
            ELSE
                IF old_data IS NOT NULL THEN
                    old_version_id := (old_data ->> TG_ARGV[0])::uuid;
                END IF;
                IF new_data IS NOT NULL THEN
                    new_version_id := (new_data ->> TG_ARGV[0])::uuid;
                END IF;
            END IF;

            IF EXISTS (
                SELECT 1
                FROM recipe_version_publications AS publication
                WHERE publication.recipe_version_id IN (
                    old_version_id,
                    new_version_id
                )
            ) THEN
                RAISE EXCEPTION USING
                    ERRCODE = '23514',
                    MESSAGE = 'published recipe snapshots are immutable',
                    CONSTRAINT = '{IMMUTABILITY_CONSTRAINT}';
            END IF;

            IF TG_OP = 'DELETE' THEN
                RETURN OLD;
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    for table_name, version_column in IMMUTABLE_TABLE_COLUMNS.items():
        mutation_events = (
            "UPDATE OR DELETE"
            if table_name == "recipe_structural_fingerprints"
            else "INSERT OR UPDATE OR DELETE"
        )
        op.execute(
            f"""
            CREATE TRIGGER {table_name}_published_immutable
            BEFORE {mutation_events} ON {table_name}
            FOR EACH ROW
            EXECUTE FUNCTION {IMMUTABILITY_FUNCTION}('{version_column}')
            """
        )
        op.execute(
            f"""
            CREATE TRIGGER {table_name}_published_no_truncate
            BEFORE TRUNCATE ON {table_name}
            FOR EACH STATEMENT
            EXECUTE FUNCTION {TRUNCATE_FUNCTION}()
            """
        )
    op.execute(
        f"""
        CREATE TRIGGER {ACTION_MEASURE_TABLE}_published_immutable
        BEFORE INSERT OR UPDATE OR DELETE ON {ACTION_MEASURE_TABLE}
        FOR EACH ROW
        EXECUTE FUNCTION {IMMUTABILITY_FUNCTION}('action_measure')
        """
    )
    op.execute(
        f"""
        CREATE TRIGGER {ACTION_MEASURE_TABLE}_published_no_truncate
        BEFORE TRUNCATE ON {ACTION_MEASURE_TABLE}
        FOR EACH STATEMENT
        EXECUTE FUNCTION {TRUNCATE_FUNCTION}()
        """
    )
    op.execute(
        f"""
        CREATE FUNCTION {LINEAGE_FUNCTION}()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
            new_lineage_id uuid;
        BEGIN
            IF TG_OP = 'UPDATE' THEN
                new_lineage_id := NEW.id;
            END IF;
            IF EXISTS (
                SELECT 1
                FROM recipe_versions AS version
                JOIN recipe_version_publications AS publication
                    ON publication.recipe_version_id = version.id
                WHERE version.lineage_id IN (OLD.id, new_lineage_id)
            ) THEN
                RAISE EXCEPTION USING
                    ERRCODE = '23514',
                    MESSAGE = 'published recipe lineages are immutable',
                    CONSTRAINT = '{IMMUTABILITY_CONSTRAINT}';
            END IF;
            IF TG_OP = 'DELETE' THEN
                RETURN OLD;
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        f"""
        CREATE TRIGGER recipe_lineages_published_immutable
        BEFORE UPDATE OR DELETE ON recipe_lineages
        FOR EACH ROW EXECUTE FUNCTION {LINEAGE_FUNCTION}()
        """
    )
    op.execute(
        f"""
        CREATE TRIGGER recipe_lineages_published_no_truncate
        BEFORE TRUNCATE ON recipe_lineages
        FOR EACH STATEMENT EXECUTE FUNCTION {TRUNCATE_FUNCTION}()
        """
    )
    op.execute(
        f"""
        CREATE FUNCTION {EVIDENCE_FUNCTION}()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                MESSAGE = 'recipe publication evidence is append-only',
                CONSTRAINT = '{IMMUTABILITY_CONSTRAINT}';
        END;
        $$
        """
    )
    op.execute(
        f"""
        CREATE TRIGGER recipe_version_publications_append_only
        BEFORE UPDATE OR DELETE ON recipe_version_publications
        FOR EACH ROW EXECUTE FUNCTION {EVIDENCE_FUNCTION}()
        """
    )
    op.execute(
        f"""
        CREATE TRIGGER recipe_version_publications_no_truncate
        BEFORE TRUNCATE ON recipe_version_publications
        FOR EACH STATEMENT EXECUTE FUNCTION {EVIDENCE_FUNCTION}()
        """
    )


def upgrade() -> None:
    op.drop_constraint(
        op.f("ck_recipe_drafts_status_supported"),
        "recipe_drafts",
        type_="check",
    )
    op.create_check_constraint(
        op.f("ck_recipe_drafts_status_supported"),
        "recipe_drafts",
        "status IN ('active', 'published')",
    )
    op.create_unique_constraint(
        op.f("uq_recipe_versions_id_author"),
        "recipe_versions",
        ["id", "created_by_user_id"],
    )
    op.create_unique_constraint(
        op.f("uq_recipe_drafts_id_author_revision"),
        "recipe_drafts",
        ["id", "author_user_id", "revision"],
    )
    op.create_unique_constraint(
        op.f("uq_recipe_duplicate_decisions_id_preflight_actor_ack"),
        "recipe_duplicate_decisions",
        [
            "id",
            "preflight_id",
            "actor_user_id",
            "acknowledged_policy_version",
            "acknowledged_result_digest",
        ],
    )

    op.create_table(
        "recipe_version_publications",
        sa.Column("recipe_version_id", sa.Uuid(), nullable=False),
        sa.Column(
            "state",
            sa.String(length=24),
            server_default=sa.text("'published'"),
            nullable=False,
        ),
        sa.Column("source_draft_id", sa.Uuid(), nullable=True),
        sa.Column("actor_user_id", sa.Uuid(), nullable=False),
        sa.Column("action_id", sa.Uuid(), nullable=True),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=True),
        sa.Column("draft_revision", sa.Integer(), nullable=True),
        sa.Column("duplicate_preflight_id", sa.Uuid(), nullable=True),
        sa.Column("duplicate_policy_version", sa.String(length=64), nullable=True),
        sa.Column("duplicate_result_digest", sa.String(length=64), nullable=True),
        sa.Column("duplicate_decision_id", sa.Uuid(), nullable=True),
        sa.Column(
            "published_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "state = 'published'",
            name=op.f("ck_recipe_version_publications_state_supported"),
        ),
        sa.CheckConstraint(
            "request_fingerprint IS NULL OR request_fingerprint ~ '^[0-9a-f]{64}$'",
            name=op.f("ck_recipe_version_publications_request_fingerprint_sha256"),
        ),
        sa.CheckConstraint(
            "draft_revision IS NULL OR draft_revision >= 1",
            name=op.f("ck_recipe_version_publications_draft_revision_positive"),
        ),
        sa.CheckConstraint(
            "(source_draft_id IS NULL AND action_id IS NULL "
            "AND request_fingerprint IS NULL AND draft_revision IS NULL "
            "AND duplicate_preflight_id IS NULL AND duplicate_policy_version IS NULL "
            "AND duplicate_result_digest IS NULL AND duplicate_decision_id IS NULL) OR "
            "(source_draft_id IS NOT NULL AND action_id IS NOT NULL "
            "AND request_fingerprint IS NOT NULL AND draft_revision IS NOT NULL "
            "AND duplicate_preflight_id IS NOT NULL "
            "AND NULLIF(btrim(duplicate_policy_version), '') IS NOT NULL "
            "AND duplicate_result_digest ~ '^[0-9a-f]{64}$')",
            name=op.f("ck_recipe_version_publications_evidence_shape_valid"),
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            name=op.f("fk_recipe_version_publications_actor_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["recipe_version_id", "actor_user_id"],
            ["recipe_versions.id", "recipe_versions.created_by_user_id"],
            name=op.f("fk_recipe_version_publications_version_author"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["source_draft_id", "actor_user_id", "draft_revision"],
            ["recipe_drafts.id", "recipe_drafts.author_user_id", "recipe_drafts.revision"],
            name=op.f("fk_recipe_version_publications_draft_author_revision"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            [
                "duplicate_preflight_id",
                "actor_user_id",
                "duplicate_policy_version",
                "duplicate_result_digest",
            ],
            [
                "recipe_duplicate_preflights.id",
                "recipe_duplicate_preflights.actor_user_id",
                "recipe_duplicate_preflights.policy_version",
                "recipe_duplicate_preflights.result_digest",
            ],
            name=op.f("fk_recipe_version_publications_preflight_acknowledgement"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            [
                "duplicate_decision_id",
                "duplicate_preflight_id",
                "actor_user_id",
                "duplicate_policy_version",
                "duplicate_result_digest",
            ],
            [
                "recipe_duplicate_decisions.id",
                "recipe_duplicate_decisions.preflight_id",
                "recipe_duplicate_decisions.actor_user_id",
                "recipe_duplicate_decisions.acknowledged_policy_version",
                "recipe_duplicate_decisions.acknowledged_result_digest",
            ],
            name=op.f("fk_recipe_version_publications_decision_acknowledgement"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "recipe_version_id",
            name=op.f("pk_recipe_version_publications"),
        ),
        sa.UniqueConstraint(
            "actor_user_id",
            "action_id",
            name=op.f("uq_recipe_version_publications_actor_action"),
        ),
        sa.UniqueConstraint(
            "source_draft_id",
            name=op.f("uq_recipe_version_publications_source_draft"),
        ),
    )
    op.create_index(
        "ix_recipe_version_publications_state_version",
        "recipe_version_publications",
        ["state", "recipe_version_id"],
        unique=False,
    )
    op.create_index(
        "ix_recipe_version_publications_actor_published",
        "recipe_version_publications",
        ["actor_user_id", "published_at"],
        unique=False,
    )
    op.execute(
        """
        INSERT INTO recipe_version_publications (
            recipe_version_id,
            state,
            actor_user_id,
            published_at
        )
        SELECT id, 'published', created_by_user_id, created_at
        FROM recipe_versions
        """
    )
    _create_immutability_guards()


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM recipe_version_publications
                WHERE source_draft_id IS NOT NULL
            ) THEN
                RAISE EXCEPTION
                    'cannot downgrade original recipe publication after member publications';
            END IF;
        END;
        $$
        """
    )
    op.execute(
        "DROP TRIGGER recipe_version_publications_no_truncate ON recipe_version_publications"
    )
    op.execute(
        "DROP TRIGGER recipe_version_publications_append_only ON recipe_version_publications"
    )
    op.execute(f"DROP FUNCTION {EVIDENCE_FUNCTION}()")
    op.execute("DROP TRIGGER recipe_lineages_published_no_truncate ON recipe_lineages")
    op.execute("DROP TRIGGER recipe_lineages_published_immutable ON recipe_lineages")
    op.execute(f"DROP FUNCTION {LINEAGE_FUNCTION}()")
    for table_name in [*IMMUTABLE_TABLE_COLUMNS, ACTION_MEASURE_TABLE]:
        op.execute(f"DROP TRIGGER {table_name}_published_no_truncate ON {table_name}")
        op.execute(f"DROP TRIGGER {table_name}_published_immutable ON {table_name}")
    op.execute(f"DROP FUNCTION {IMMUTABILITY_FUNCTION}()")
    op.execute(f"DROP FUNCTION {TRUNCATE_FUNCTION}()")
    op.drop_index(
        "ix_recipe_version_publications_actor_published",
        table_name="recipe_version_publications",
    )
    op.drop_index(
        "ix_recipe_version_publications_state_version",
        table_name="recipe_version_publications",
    )
    op.drop_table("recipe_version_publications")
    op.drop_constraint(
        op.f("uq_recipe_duplicate_decisions_id_preflight_actor_ack"),
        "recipe_duplicate_decisions",
        type_="unique",
    )
    op.drop_constraint(
        op.f("uq_recipe_drafts_id_author_revision"),
        "recipe_drafts",
        type_="unique",
    )
    op.drop_constraint(
        op.f("uq_recipe_versions_id_author"),
        "recipe_versions",
        type_="unique",
    )
    op.drop_constraint(
        op.f("ck_recipe_drafts_status_supported"),
        "recipe_drafts",
        type_="check",
    )
    op.create_check_constraint(
        op.f("ck_recipe_drafts_status_supported"),
        "recipe_drafts",
        "status = 'active'",
    )
