"""add stable recipe editions

Revision ID: 20260914_0032
Revises: 20260911_0031
Create Date: 2026-09-14 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260914_0032"
down_revision: str | None = "20260911_0031"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD_ROOT_INDEX = "uq_recipe_versions_one_root_per_lineage"
_ORIGIN_INDEX = "uq_recipe_editions_one_origin_per_lineage"
_SUCCESSOR_INDEX = "uq_recipe_editions_one_revision_successor"
_TOPOLOGY_FUNCTION = "validate_recipe_edition_topology"
_TOPOLOGY_TRIGGER = "ctrg_recipe_editions_topology_valid"
_CURRENT_FUNCTION = "validate_recipe_current_edition"
_CURRENT_RECIPE_TRIGGER = "ctrg_recipes_current_edition_valid"
_CURRENT_EDITION_TRIGGER = "ctrg_recipe_editions_current_edition_valid"
_PUBLICATION_FUNCTION = "require_recipe_publication_edition"
_PUBLICATION_TRIGGER = "ctrg_recipe_publications_have_edition"
_EDITION_IMMUTABILITY_FUNCTION = "prevent_recipe_edition_mutation"
_EDITION_IMMUTABILITY_TRIGGER = "recipe_editions_append_only"
_EDITION_TRUNCATE_TRIGGER = "recipe_editions_no_truncate"
_RECIPE_IMMUTABILITY_FUNCTION = "prevent_stable_recipe_identity_update"
_RECIPE_IMMUTABILITY_TRIGGER = "recipes_identity_immutable"
_DEFERRED_EDITION_CONSTRAINTS = (
    "fk_recipe_editions_published_version",
    "fk_recipe_editions_previous_same_recipe",
    "fk_recipes_current_edition_same_recipe",
    _TOPOLOGY_TRIGGER,
    _CURRENT_RECIPE_TRIGGER,
    _CURRENT_EDITION_TRIGGER,
    _PUBLICATION_TRIGGER,
)


def _create_integrity_guards() -> None:
    op.execute(
        f"""
        CREATE FUNCTION {_TOPOLOGY_FUNCTION}()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
            exact_parent_version_id uuid;
            parent_recipe_id uuid;
            predecessor_edition_number integer;
        BEGIN
            SELECT version.parent_version_id
            INTO exact_parent_version_id
            FROM recipe_versions AS version
            WHERE version.id = NEW.recipe_version_id;

            IF NEW.relation_kind = 'original' THEN
                IF exact_parent_version_id IS NOT NULL THEN
                    RAISE EXCEPTION USING
                        ERRCODE = '23514',
                        MESSAGE = 'an original recipe edition cannot have an adaptation parent',
                        CONSTRAINT = 'ck_recipe_editions_original_has_no_parent';
                END IF;
            ELSIF NEW.relation_kind = 'adaptation' THEN
                IF exact_parent_version_id IS NULL THEN
                    RAISE EXCEPTION USING
                        ERRCODE = '23514',
                        MESSAGE = 'an adaptation edition requires an exact parent version',
                        CONSTRAINT = 'ck_recipe_editions_adaptation_has_parent';
                END IF;

                SELECT parent_edition.recipe_id
                INTO parent_recipe_id
                FROM recipe_editions AS parent_edition
                WHERE parent_edition.recipe_version_id = exact_parent_version_id;

                IF parent_recipe_id = NEW.recipe_id THEN
                    RAISE EXCEPTION USING
                        ERRCODE = '23514',
                        MESSAGE = 'an adaptation parent must belong to another stable recipe',
                        CONSTRAINT = 'ck_recipe_editions_adaptation_parent_cross_recipe';
                END IF;
            ELSE
                IF exact_parent_version_id IS NOT NULL THEN
                    RAISE EXCEPTION USING
                        ERRCODE = '23514',
                        MESSAGE = 'a same-recipe revision cannot have an adaptation parent',
                        CONSTRAINT = 'ck_recipe_editions_revision_has_no_parent';
                END IF;

                SELECT predecessor.edition_number
                INTO predecessor_edition_number
                FROM recipe_editions AS predecessor
                WHERE predecessor.recipe_id = NEW.recipe_id
                    AND predecessor.recipe_version_id = NEW.previous_recipe_version_id;

                IF predecessor_edition_number IS NULL
                    OR predecessor_edition_number + 1 <> NEW.edition_number
                THEN
                    RAISE EXCEPTION USING
                        ERRCODE = '23514',
                        MESSAGE = 'a revision must immediately follow its predecessor edition',
                        CONSTRAINT = 'ck_recipe_editions_previous_is_prior_edition';
                END IF;
            END IF;

            -- Historical public children may adapt an exact version that was never
            -- itself published. Absence of a parent edition is therefore supported.
            -- Validate the reverse edge too, so mapping that parent later cannot turn
            -- an existing adaptation into a same-recipe edge.
            IF EXISTS (
                SELECT 1
                FROM recipe_editions AS child_edition
                JOIN recipe_versions AS child_version
                    ON child_version.id = child_edition.recipe_version_id
                WHERE child_version.parent_version_id = NEW.recipe_version_id
                    AND child_edition.relation_kind = 'adaptation'
                    AND child_edition.recipe_id = NEW.recipe_id
            ) THEN
                RAISE EXCEPTION USING
                    ERRCODE = '23514',
                    MESSAGE = 'an adaptation parent must belong to another stable recipe',
                    CONSTRAINT = 'ck_recipe_editions_adaptation_parent_cross_recipe';
            END IF;

            RETURN NULL;
        END;
        $$
        """
    )
    op.execute(
        f"""
        CREATE CONSTRAINT TRIGGER {_TOPOLOGY_TRIGGER}
        AFTER INSERT ON recipe_editions
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW
        EXECUTE FUNCTION {_TOPOLOGY_FUNCTION}()
        """
    )

    op.execute(
        f"""
        CREATE FUNCTION {_CURRENT_FUNCTION}()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
            target_recipe_id uuid;
            selected_edition_number integer;
            latest_edition_number integer;
        BEGIN
            IF TG_TABLE_NAME = 'recipes' THEN
                target_recipe_id := NEW.id;
            ELSE
                target_recipe_id := NEW.recipe_id;
            END IF;

            SELECT current_edition.edition_number
            INTO selected_edition_number
            FROM recipes AS recipe
            JOIN recipe_editions AS current_edition
                ON current_edition.recipe_id = recipe.id
                AND current_edition.recipe_version_id = recipe.current_recipe_version_id
            WHERE recipe.id = target_recipe_id;

            SELECT max(edition.edition_number)
            INTO latest_edition_number
            FROM recipe_editions AS edition
            WHERE edition.recipe_id = target_recipe_id;

            IF selected_edition_number IS NULL
                OR latest_edition_number IS NULL
                OR selected_edition_number <> latest_edition_number
            THEN
                RAISE EXCEPTION USING
                    ERRCODE = '23514',
                    MESSAGE = 'a recipe current pointer must select its latest edition',
                    CONSTRAINT = 'ck_recipes_current_edition_is_latest';
            END IF;

            RETURN NULL;
        END;
        $$
        """
    )
    op.execute(
        f"""
        CREATE CONSTRAINT TRIGGER {_CURRENT_RECIPE_TRIGGER}
        AFTER INSERT OR UPDATE OF current_recipe_version_id ON recipes
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW
        EXECUTE FUNCTION {_CURRENT_FUNCTION}()
        """
    )
    op.execute(
        f"""
        CREATE CONSTRAINT TRIGGER {_CURRENT_EDITION_TRIGGER}
        AFTER INSERT ON recipe_editions
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW
        EXECUTE FUNCTION {_CURRENT_FUNCTION}()
        """
    )

    op.execute(
        f"""
        CREATE FUNCTION {_PUBLICATION_FUNCTION}()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM recipe_editions AS edition
                WHERE edition.recipe_version_id = NEW.recipe_version_id
            ) THEN
                RAISE EXCEPTION USING
                    ERRCODE = '23514',
                    MESSAGE = 'every recipe publication requires stable edition membership',
                    CONSTRAINT = 'ck_recipe_publications_have_edition';
            END IF;

            RETURN NULL;
        END;
        $$
        """
    )
    op.execute(
        f"""
        CREATE CONSTRAINT TRIGGER {_PUBLICATION_TRIGGER}
        AFTER INSERT ON recipe_version_publications
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW
        EXECUTE FUNCTION {_PUBLICATION_FUNCTION}()
        """
    )

    op.execute(
        f"""
        CREATE FUNCTION {_EDITION_IMMUTABILITY_FUNCTION}()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                MESSAGE = 'recipe editions are append-only',
                CONSTRAINT = 'ck_recipe_editions_append_only';
        END;
        $$
        """
    )
    op.execute(
        f"""
        CREATE TRIGGER {_EDITION_IMMUTABILITY_TRIGGER}
        BEFORE UPDATE OR DELETE ON recipe_editions
        FOR EACH ROW
        EXECUTE FUNCTION {_EDITION_IMMUTABILITY_FUNCTION}()
        """
    )
    op.execute(
        f"""
        CREATE TRIGGER {_EDITION_TRUNCATE_TRIGGER}
        BEFORE TRUNCATE ON recipe_editions
        FOR EACH STATEMENT
        EXECUTE FUNCTION {_EDITION_IMMUTABILITY_FUNCTION}()
        """
    )

    op.execute(
        f"""
        CREATE FUNCTION {_RECIPE_IMMUTABILITY_FUNCTION}()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            IF NEW.id IS DISTINCT FROM OLD.id
                OR NEW.lineage_id IS DISTINCT FROM OLD.lineage_id
                OR NEW.attributed_author_user_id IS DISTINCT FROM OLD.attributed_author_user_id
                OR NEW.created_at IS DISTINCT FROM OLD.created_at
            THEN
                RAISE EXCEPTION USING
                    ERRCODE = '23514',
                    MESSAGE = 'stable recipe identity and attribution are immutable',
                    CONSTRAINT = 'ck_recipes_identity_immutable';
            END IF;

            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        f"""
        CREATE TRIGGER {_RECIPE_IMMUTABILITY_TRIGGER}
        BEFORE UPDATE OF id, lineage_id, attributed_author_user_id, created_at
        ON recipes
        FOR EACH ROW
        EXECUTE FUNCTION {_RECIPE_IMMUTABILITY_FUNCTION}()
        """
    )


def _drop_integrity_guards() -> None:
    op.execute(f"DROP TRIGGER {_RECIPE_IMMUTABILITY_TRIGGER} ON recipes")
    op.execute(f"DROP FUNCTION {_RECIPE_IMMUTABILITY_FUNCTION}()")
    op.execute(f"DROP TRIGGER {_EDITION_TRUNCATE_TRIGGER} ON recipe_editions")
    op.execute(f"DROP TRIGGER {_EDITION_IMMUTABILITY_TRIGGER} ON recipe_editions")
    op.execute(f"DROP FUNCTION {_EDITION_IMMUTABILITY_FUNCTION}()")
    op.execute(f"DROP TRIGGER {_PUBLICATION_TRIGGER} ON recipe_version_publications")
    op.execute(f"DROP FUNCTION {_PUBLICATION_FUNCTION}()")
    op.execute(f"DROP TRIGGER {_CURRENT_EDITION_TRIGGER} ON recipe_editions")
    op.execute(f"DROP TRIGGER {_CURRENT_RECIPE_TRIGGER} ON recipes")
    op.execute(f"DROP FUNCTION {_CURRENT_FUNCTION}()")
    op.execute(f"DROP TRIGGER {_TOPOLOGY_TRIGGER} ON recipe_editions")
    op.execute(f"DROP FUNCTION {_TOPOLOGY_FUNCTION}()")


def upgrade() -> None:
    op.create_table(
        "recipes",
        sa.Column("lineage_id", sa.Uuid(), nullable=False),
        sa.Column("attributed_author_user_id", sa.Uuid(), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=True),
        sa.Column("current_recipe_version_id", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "owner_user_id IS NULL OR owner_user_id = attributed_author_user_id",
            name=op.f("ck_recipes_owner_matches_attributed_author"),
        ),
        sa.ForeignKeyConstraint(
            ["lineage_id"],
            ["recipe_lineages.id"],
            name=op.f("fk_recipes_lineage_id_recipe_lineages"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["attributed_author_user_id"],
            ["users.id"],
            name=op.f("fk_recipes_attributed_author_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["owner_user_id"],
            ["users.id"],
            name=op.f("fk_recipes_owner_user_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_recipes")),
        sa.UniqueConstraint("id", "lineage_id", name="uq_recipes_id_lineage_id"),
        sa.UniqueConstraint(
            "id",
            "attributed_author_user_id",
            name="uq_recipes_id_attributed_author",
        ),
    )
    op.create_index("ix_recipes_lineage_id", "recipes", ["lineage_id"], unique=False)
    op.create_index(
        "ix_recipes_attributed_author_user_id",
        "recipes",
        ["attributed_author_user_id"],
        unique=False,
    )
    op.create_index("ix_recipes_owner_user_id", "recipes", ["owner_user_id"], unique=False)

    op.create_table(
        "recipe_editions",
        sa.Column("recipe_version_id", sa.Uuid(), nullable=False),
        sa.Column("recipe_id", sa.Uuid(), nullable=False),
        sa.Column("lineage_id", sa.Uuid(), nullable=False),
        sa.Column("attributed_author_user_id", sa.Uuid(), nullable=False),
        sa.Column("edition_number", sa.Integer(), nullable=False),
        sa.Column("relation_kind", sa.String(length=24), nullable=False),
        sa.Column("previous_recipe_version_id", sa.Uuid(), nullable=True),
        sa.Column("declared_change_reason", sa.String(length=16), nullable=True),
        sa.CheckConstraint(
            "edition_number >= 1",
            name=op.f("ck_recipe_editions_edition_number_positive"),
        ),
        sa.CheckConstraint(
            "relation_kind IN ('original', 'adaptation', 'revision')",
            name=op.f("ck_recipe_editions_relation_kind_supported"),
        ),
        sa.CheckConstraint(
            "declared_change_reason IS NULL OR (relation_kind = 'revision' "
            "AND declared_change_reason IN ('correction', 'update'))",
            name=op.f("ck_recipe_editions_declared_change_reason_supported"),
        ),
        sa.CheckConstraint(
            "(relation_kind IN ('original', 'adaptation') AND edition_number = 1 "
            "AND previous_recipe_version_id IS NULL) OR "
            "(relation_kind = 'revision' AND edition_number > 1 "
            "AND previous_recipe_version_id IS NOT NULL)",
            name=op.f("ck_recipe_editions_topology_shape_valid"),
        ),
        sa.ForeignKeyConstraint(
            ["recipe_id", "lineage_id"],
            ["recipes.id", "recipes.lineage_id"],
            name="fk_recipe_editions_recipe_same_lineage",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["recipe_id", "attributed_author_user_id"],
            ["recipes.id", "recipes.attributed_author_user_id"],
            name="fk_recipe_editions_recipe_same_author",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["lineage_id", "recipe_version_id"],
            ["recipe_versions.lineage_id", "recipe_versions.id"],
            name="fk_recipe_editions_version_same_lineage",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["recipe_version_id", "attributed_author_user_id"],
            ["recipe_versions.id", "recipe_versions.created_by_user_id"],
            name="fk_recipe_editions_version_same_author",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["recipe_version_id"],
            ["recipe_version_publications.recipe_version_id"],
            name="fk_recipe_editions_published_version",
            ondelete="RESTRICT",
            deferrable=True,
            initially="DEFERRED",
        ),
        sa.ForeignKeyConstraint(
            ["recipe_id", "previous_recipe_version_id"],
            ["recipe_editions.recipe_id", "recipe_editions.recipe_version_id"],
            name="fk_recipe_editions_previous_same_recipe",
            ondelete="RESTRICT",
            deferrable=True,
            initially="DEFERRED",
        ),
        sa.PrimaryKeyConstraint("recipe_version_id", name=op.f("pk_recipe_editions")),
        sa.UniqueConstraint(
            "recipe_id",
            "recipe_version_id",
            name="uq_recipe_editions_recipe_id_version_id",
        ),
        sa.UniqueConstraint(
            "recipe_id",
            "edition_number",
            name="uq_recipe_editions_recipe_id_edition_number",
        ),
    )
    op.create_index(
        _SUCCESSOR_INDEX,
        "recipe_editions",
        ["recipe_id", "previous_recipe_version_id"],
        unique=True,
        postgresql_where=sa.text("previous_recipe_version_id IS NOT NULL"),
    )
    op.create_index(
        _ORIGIN_INDEX,
        "recipe_editions",
        ["lineage_id"],
        unique=True,
        postgresql_where=sa.text("relation_kind = 'original'"),
    )

    op.create_foreign_key(
        "fk_recipes_current_edition_same_recipe",
        "recipes",
        "recipe_editions",
        ["id", "current_recipe_version_id"],
        ["recipe_id", "recipe_version_id"],
        ondelete="RESTRICT",
        deferrable=True,
        initially="DEFERRED",
    )
    # The imported rows must pass the same deferred topology and completeness
    # checks as every later write. Deferral permits the cyclic aggregate to be
    # assembled in either insert order within this migration transaction.
    _create_integrity_guards()

    op.execute(
        """
        INSERT INTO recipes (
            id,
            lineage_id,
            attributed_author_user_id,
            owner_user_id,
            current_recipe_version_id,
            created_at
        )
        SELECT
            publication.recipe_version_id,
            version.lineage_id,
            version.created_by_user_id,
            CASE WHEN author.status = 'deleted' THEN NULL ELSE version.created_by_user_id END,
            publication.recipe_version_id,
            publication.published_at
        FROM recipe_version_publications AS publication
        JOIN recipe_versions AS version ON version.id = publication.recipe_version_id
        JOIN users AS author ON author.id = version.created_by_user_id
        ORDER BY publication.recipe_version_id
        """
    )
    op.execute(
        """
        INSERT INTO recipe_editions (
            recipe_version_id,
            recipe_id,
            lineage_id,
            attributed_author_user_id,
            edition_number,
            relation_kind,
            previous_recipe_version_id,
            declared_change_reason
        )
        SELECT
            version.id,
            version.id,
            version.lineage_id,
            version.created_by_user_id,
            1,
            CASE WHEN version.parent_version_id IS NULL THEN 'original' ELSE 'adaptation' END,
            NULL,
            NULL
        FROM recipe_versions AS version
        JOIN recipe_version_publications AS publication
            ON publication.recipe_version_id = version.id
        ORDER BY version.id
        """
    )

    op.drop_index(_OLD_ROOT_INDEX, table_name="recipe_versions")


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM recipe_versions
                WHERE parent_version_id IS NULL
                GROUP BY lineage_id
                HAVING count(*) > 1
            ) THEN
                RAISE EXCEPTION '%',
                    'cannot downgrade stable recipe editions with multiple '
                    || 'parent-null versions in one lineage';
            ELSIF EXISTS (
                SELECT 1
                FROM recipe_editions
                WHERE edition_number <> 1
                    OR previous_recipe_version_id IS NOT NULL
                    OR declared_change_reason IS NOT NULL
                    OR relation_kind NOT IN ('original', 'adaptation')
            ) OR EXISTS (
                SELECT 1
                FROM recipe_editions
                GROUP BY recipe_id
                HAVING count(*) <> 1
            ) OR EXISTS (
                SELECT 1
                FROM recipes AS recipe
                JOIN recipe_editions AS edition ON edition.recipe_id = recipe.id
                JOIN recipe_version_publications AS publication
                    ON publication.recipe_version_id = edition.recipe_version_id
                JOIN recipe_versions AS version ON version.id = edition.recipe_version_id
                JOIN users AS author ON author.id = version.created_by_user_id
                WHERE recipe.id <> version.id
                    OR recipe.current_recipe_version_id <> version.id
                    OR recipe.lineage_id <> version.lineage_id
                    OR recipe.attributed_author_user_id <> version.created_by_user_id
                    OR recipe.created_at <> publication.published_at
                    OR recipe.owner_user_id IS DISTINCT FROM (
                        CASE WHEN author.status = 'deleted'
                            THEN NULL
                            ELSE version.created_by_user_id
                        END
                    )
                    OR edition.lineage_id <> version.lineage_id
                    OR edition.attributed_author_user_id <> version.created_by_user_id
                    OR edition.relation_kind <> (
                        CASE WHEN version.parent_version_id IS NULL
                            THEN 'original'
                            ELSE 'adaptation'
                        END
                    )
            ) OR EXISTS (
                SELECT 1
                FROM recipe_version_publications AS publication
                LEFT JOIN recipe_editions AS edition
                    ON edition.recipe_version_id = publication.recipe_version_id
                WHERE edition.recipe_version_id IS NULL
            ) THEN
                RAISE EXCEPTION
                    'cannot downgrade stable recipe editions after edition history diverges';
            END IF;
        END;
        $$
        """
    )

    # PostgreSQL will not alter a table while it still has queued events from
    # these deferred foreign keys and constraint triggers. Drain only the
    # stable-edition guards, then restore their initially-deferred mode so an
    # enclosing transaction can safely downgrade and re-upgrade this revision.
    constraint_names = ", ".join(_DEFERRED_EDITION_CONSTRAINTS)
    op.execute(f"SET CONSTRAINTS {constraint_names} IMMEDIATE")
    op.execute(f"SET CONSTRAINTS {constraint_names} DEFERRED")

    _drop_integrity_guards()
    op.create_index(
        _OLD_ROOT_INDEX,
        "recipe_versions",
        ["lineage_id"],
        unique=True,
        postgresql_where=sa.text("parent_version_id IS NULL"),
    )
    op.drop_constraint(
        "fk_recipes_current_edition_same_recipe",
        "recipes",
        type_="foreignkey",
    )
    op.drop_index(_ORIGIN_INDEX, table_name="recipe_editions")
    op.drop_index(_SUCCESSOR_INDEX, table_name="recipe_editions")
    op.drop_table("recipe_editions")
    op.drop_index("ix_recipes_owner_user_id", table_name="recipes")
    op.drop_index("ix_recipes_attributed_author_user_id", table_name="recipes")
    op.drop_index("ix_recipes_lineage_id", table_name="recipes")
    op.drop_table("recipes")
