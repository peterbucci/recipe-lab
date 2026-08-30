"""add curated recipe discovery categories

Revision ID: 20260830_0021
Revises: 20260828_0020
Create Date: 2026-08-30 12:00:00.000000

"""

from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import NAMESPACE_URL, UUID, uuid5

import sqlalchemy as sa
from alembic import op

revision: str = "20260830_0021"
down_revision: str | None = "20260828_0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DATASET_ID = "recipe-lab-demo-v1"
SEED_NAMESPACE = uuid5(
    NAMESPACE_URL,
    "https://github.com/peterbucci/recipe-lab/deterministic-seed-data",
)
CATEGORY_PUBLISHED_AT = datetime(2026, 8, 30, tzinfo=UTC)
MAX_RECIPE_CATEGORIES = 3

CATEGORIES: tuple[tuple[str, str, str, int], ...] = (
    ("breakfast", "Breakfast", "breakfast", 0),
    ("lunch", "Lunch", "lunch", 1),
    ("dinner", "Dinner", "dinner", 2),
    ("desserts", "Desserts", "desserts", 3),
    ("breads", "Breads", "breads", 4),
    ("vegetarian", "Vegetarian", "vegetarian", 5),
    ("quick-easy", "Quick & Easy", "quick-easy", 6),
)

# These assignments are a manually reviewed content decision. They deliberately do not
# inspect titles, ingredients, actions, or other recipe text during migration.
RECIPE_CATEGORY_ASSIGNMENTS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("banana-oat-pancakes-v1", ("breakfast", "vegetarian", "quick-easy")),
    ("blueberry-banana-oat-pancakes-v2", ("breakfast", "vegetarian", "quick-easy")),
    ("apple-cinnamon-overnight-oats-v1", ("breakfast", "vegetarian", "quick-easy")),
    ("oat-milk-apple-overnight-oats-v2", ("breakfast", "vegetarian", "quick-easy")),
    ("spinach-tomato-egg-skillet-v1", ("breakfast", "vegetarian", "quick-easy")),
    ("lemon-chickpea-toast-v1", ("lunch", "breads", "vegetarian")),
    ("peanut-butter-apple-oat-bites-v1", ("breakfast", "vegetarian", "quick-easy")),
    ("red-lentil-coconut-stew-v1", ("dinner", "vegetarian")),
    ("sweet-potato-red-lentil-stew-v2", ("dinner", "vegetarian")),
    ("tomato-white-bean-soup-v1", ("lunch", "vegetarian", "quick-easy")),
    ("black-bean-sweet-potato-chili-v1", ("dinner", "vegetarian")),
    ("chicken-ginger-rice-soup-v1", ("lunch", "dinner")),
    ("mushroom-barley-soup-v1", ("lunch", "vegetarian")),
    ("lemon-herb-chickpea-quinoa-bowl-v1", ("lunch", "vegetarian", "quick-easy")),
    ("brown-rice-chickpea-bowl-v2", ("lunch", "vegetarian", "quick-easy")),
    ("sesame-tofu-broccoli-rice-bowl-v1", ("dinner", "vegetarian")),
    ("sesame-tempeh-broccoli-rice-bowl-v2", ("dinner", "vegetarian")),
    ("roasted-vegetable-couscous-salad-v1", ("lunch", "vegetarian")),
    ("tuna-white-bean-salad-v1", ("lunch", "quick-easy")),
    ("lentil-beet-walnut-salad-v1", ("lunch", "vegetarian")),
    ("tomato-basil-spaghetti-v1", ("dinner", "vegetarian", "quick-easy")),
    ("whole-wheat-spinach-spaghetti-v2", ("dinner", "vegetarian", "quick-easy")),
    ("mushroom-whole-wheat-spaghetti-v3", ("dinner", "vegetarian", "quick-easy")),
    ("mushroom-pea-risotto-v1", ("dinner", "vegetarian")),
    ("sheet-pan-lemon-chicken-vegetables-v1", ("dinner", "quick-easy")),
    ("baked-dill-salmon-potatoes-v1", ("dinner",)),
    ("turkey-meatballs-tomato-spaghetti-v1", ("dinner",)),
    ("black-bean-tacos-v1", ("dinner", "vegetarian", "quick-easy")),
    ("vegetable-fried-rice-v1", ("dinner", "vegetarian", "quick-easy")),
    ("herbed-chickpea-patties-tahini-v1", ("dinner", "vegetarian")),
    ("carrot-walnut-snack-cake-v1", ("desserts", "vegetarian")),
    ("lower-sugar-pecan-carrot-cake-v2", ("desserts", "vegetarian")),
    ("orange-raisin-carrot-cake-v3", ("desserts", "vegetarian")),
    ("blueberry-oat-muffins-v1", ("breakfast", "breads", "vegetarian")),
)

IMMUTABILITY_CONSTRAINT = "ck_recipe_version_categories_immutable"
IMMUTABILITY_FUNCTION = "prevent_recipe_version_category_mutation"
IMMUTABILITY_TRIGGER = "trg_recipe_version_categories_immutable"


def _seed_uuid(entity_type: str, stable_key: str) -> UUID:
    return uuid5(SEED_NAMESPACE, f"{DATASET_ID}:{entity_type}:{stable_key}")


def upgrade() -> None:
    op.create_table(
        "recipe_categories",
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("slug", sa.String(length=64), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "btrim(name) <> ''",
            name=op.f("ck_recipe_categories_name_not_blank"),
        ),
        sa.CheckConstraint(
            "slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'",
            name=op.f("ck_recipe_categories_slug_supported"),
        ),
        sa.CheckConstraint(
            "display_order >= 0",
            name=op.f("ck_recipe_categories_display_order_nonnegative"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_recipe_categories")),
        sa.UniqueConstraint("slug", name="uq_recipe_categories_slug"),
        sa.UniqueConstraint("display_order", name="uq_recipe_categories_display_order"),
    )
    op.create_table(
        "recipe_draft_categories",
        sa.Column("recipe_draft_id", sa.Uuid(), nullable=False),
        sa.Column("recipe_category_id", sa.Uuid(), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            f"display_order >= 0 AND display_order < {MAX_RECIPE_CATEGORIES}",
            name=op.f("ck_recipe_draft_categories_display_order_bounded"),
        ),
        sa.ForeignKeyConstraint(
            ["recipe_category_id"],
            ["recipe_categories.id"],
            name=op.f("fk_recipe_draft_categories_recipe_category_id_recipe_categories"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["recipe_draft_id"],
            ["recipe_drafts.id"],
            name=op.f("fk_recipe_draft_categories_recipe_draft_id_recipe_drafts"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "recipe_draft_id",
            "recipe_category_id",
            name=op.f("pk_recipe_draft_categories"),
        ),
        sa.UniqueConstraint(
            "recipe_draft_id",
            "display_order",
            name="uq_recipe_draft_categories_draft_display_order",
        ),
    )
    op.create_table(
        "recipe_version_categories",
        sa.Column("recipe_version_id", sa.Uuid(), nullable=False),
        sa.Column("recipe_category_id", sa.Uuid(), nullable=False),
        sa.Column("category_name", sa.String(length=80), nullable=False),
        sa.Column("category_slug", sa.String(length=64), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "btrim(category_name) <> ''",
            name=op.f("ck_recipe_version_categories_category_name_not_blank"),
        ),
        sa.CheckConstraint(
            "category_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'",
            name=op.f("ck_recipe_version_categories_category_slug_supported"),
        ),
        sa.CheckConstraint(
            f"display_order >= 0 AND display_order < {MAX_RECIPE_CATEGORIES}",
            name=op.f("ck_recipe_version_categories_display_order_bounded"),
        ),
        sa.ForeignKeyConstraint(
            ["recipe_category_id"],
            ["recipe_categories.id"],
            name=op.f("fk_recipe_version_categories_recipe_category_id_recipe_categories"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["recipe_version_id"],
            ["recipe_versions.id"],
            name=op.f("fk_recipe_version_categories_recipe_version_id_recipe_versions"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "recipe_version_id",
            "recipe_category_id",
            name=op.f("pk_recipe_version_categories"),
        ),
        sa.UniqueConstraint(
            "recipe_version_id",
            "display_order",
            name="uq_recipe_version_categories_version_display_order",
        ),
    )

    category_table = sa.table(
        "recipe_categories",
        sa.column("id", sa.Uuid()),
        sa.column("name", sa.String()),
        sa.column("slug", sa.String()),
        sa.column("display_order", sa.Integer()),
        sa.column("active", sa.Boolean()),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )
    op.bulk_insert(
        category_table,
        [
            {
                "id": _seed_uuid("recipe-category", key),
                "name": name,
                "slug": slug,
                "display_order": display_order,
                "active": True,
                "created_at": CATEGORY_PUBLISHED_AT,
            }
            for key, name, slug, display_order in CATEGORIES
        ],
    )

    categories_by_key = {
        key: (_seed_uuid("recipe-category", key), name, slug)
        for key, name, slug, _display_order in CATEGORIES
    }
    connection = op.get_bind()
    insert_snapshot = sa.text(
        """
        INSERT INTO recipe_version_categories (
            recipe_version_id,
            recipe_category_id,
            category_name,
            category_slug,
            display_order
        )
        SELECT
            CAST(:recipe_version_id AS uuid),
            CAST(:recipe_category_id AS uuid),
            :category_name,
            :category_slug,
            :display_order
        WHERE EXISTS (
            SELECT 1 FROM recipe_versions
            WHERE id = CAST(:recipe_version_id AS uuid)
        )
        ON CONFLICT DO NOTHING
        """
    )
    for recipe_key, category_keys in RECIPE_CATEGORY_ASSIGNMENTS:
        for display_order, category_key in enumerate(category_keys):
            category_id, category_name, category_slug = categories_by_key[category_key]
            connection.execute(
                insert_snapshot,
                {
                    "recipe_version_id": str(_seed_uuid("recipe-version", recipe_key)),
                    "recipe_category_id": str(category_id),
                    "category_name": category_name,
                    "category_slug": category_slug,
                    "display_order": display_order,
                },
            )

    op.execute(
        f"""
        CREATE FUNCTION {IMMUTABILITY_FUNCTION}()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            IF TG_OP = 'INSERT' THEN
                IF EXISTS (
                    SELECT 1
                    FROM recipe_version_publications
                    WHERE recipe_version_id = NEW.recipe_version_id
                ) THEN
                    RAISE EXCEPTION USING
                        ERRCODE = '23514',
                        MESSAGE = 'published recipe category snapshots are immutable',
                        CONSTRAINT = '{IMMUTABILITY_CONSTRAINT}';
                END IF;
                RETURN NEW;
            END IF;

            RAISE EXCEPTION USING
                ERRCODE = '23514',
                MESSAGE = 'recipe category snapshots are immutable',
                CONSTRAINT = '{IMMUTABILITY_CONSTRAINT}';
        END;
        $$
        """
    )
    op.execute(
        f"""
        CREATE TRIGGER {IMMUTABILITY_TRIGGER}
        BEFORE INSERT OR UPDATE OR DELETE
        ON recipe_version_categories
        FOR EACH ROW
        EXECUTE FUNCTION {IMMUTABILITY_FUNCTION}()
        """
    )


def downgrade() -> None:
    op.execute(f"DROP TRIGGER {IMMUTABILITY_TRIGGER} ON recipe_version_categories")
    op.execute(f"DROP FUNCTION {IMMUTABILITY_FUNCTION}()")
    op.drop_table("recipe_version_categories")
    op.drop_table("recipe_draft_categories")
    op.drop_table("recipe_categories")
