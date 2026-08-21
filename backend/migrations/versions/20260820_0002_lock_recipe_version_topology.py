"""lock recipe version topology

Revision ID: 20260820_0002
Revises: 20260820_0001
Create Date: 2026-08-20 18:31:00.000000

"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260820_0002"
down_revision: str | None = "20260820_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TOPOLOGY_CONSTRAINT = "ck_recipe_versions_topology_immutable"
TOPOLOGY_FUNCTION = "prevent_recipe_version_topology_update"
TOPOLOGY_TRIGGER = "trg_recipe_versions_topology_immutable"
CYCLE_CONSTRAINT = "ck_recipe_versions_lineage_acyclic"
CYCLE_FUNCTION = "prevent_recipe_version_cycle"
CYCLE_TRIGGER = "ctrg_recipe_versions_lineage_acyclic"


def upgrade() -> None:
    op.execute(
        f"""
        CREATE FUNCTION {TOPOLOGY_FUNCTION}()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            IF NEW.id IS DISTINCT FROM OLD.id
                OR NEW.lineage_id IS DISTINCT FROM OLD.lineage_id
                OR NEW.parent_version_id IS DISTINCT FROM OLD.parent_version_id
            THEN
                RAISE EXCEPTION USING
                    ERRCODE = '23514',
                    MESSAGE = 'recipe version topology is immutable',
                    CONSTRAINT = '{TOPOLOGY_CONSTRAINT}';
            END IF;

            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        f"""
        CREATE TRIGGER {TOPOLOGY_TRIGGER}
        BEFORE UPDATE OF id, lineage_id, parent_version_id
        ON recipe_versions
        FOR EACH ROW
        EXECUTE FUNCTION {TOPOLOGY_FUNCTION}()
        """
    )
    op.execute(
        f"""
        CREATE FUNCTION {CYCLE_FUNCTION}()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
            cycle_exists boolean;
        BEGIN
            IF NEW.parent_version_id IS NULL THEN
                RETURN NULL;
            END IF;

            WITH RECURSIVE ancestors AS (
                SELECT id, parent_version_id
                FROM recipe_versions
                WHERE id = NEW.parent_version_id

                UNION

                SELECT candidate.id, candidate.parent_version_id
                FROM recipe_versions AS candidate
                JOIN ancestors ON candidate.id = ancestors.parent_version_id
            )
            SELECT EXISTS (
                SELECT 1
                FROM ancestors
                WHERE id = NEW.id
            )
            INTO cycle_exists;

            IF cycle_exists THEN
                RAISE EXCEPTION USING
                    ERRCODE = '23514',
                    MESSAGE = 'recipe version lineage must be acyclic',
                    CONSTRAINT = '{CYCLE_CONSTRAINT}';
            END IF;

            RETURN NULL;
        END;
        $$
        """
    )
    op.execute(
        f"""
        CREATE CONSTRAINT TRIGGER {CYCLE_TRIGGER}
        AFTER INSERT
        ON recipe_versions
        DEFERRABLE INITIALLY IMMEDIATE
        FOR EACH ROW
        EXECUTE FUNCTION {CYCLE_FUNCTION}()
        """
    )


def downgrade() -> None:
    op.execute(f"DROP TRIGGER {CYCLE_TRIGGER} ON recipe_versions")
    op.execute(f"DROP FUNCTION {CYCLE_FUNCTION}()")
    op.execute(f"DROP TRIGGER {TOPOLOGY_TRIGGER} ON recipe_versions")
    op.execute(f"DROP FUNCTION {TOPOLOGY_FUNCTION}()")
