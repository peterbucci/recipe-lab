from collections.abc import Iterator
from decimal import Decimal
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from app.core.demo_identity import (
    DEMO_USER_DISPLAY_NAME,
    DEMO_USER_EMAIL,
    DEMO_USER_ID,
)
from app.db.base import Base
from app.models import (
    ACCOUNT_KIND_DEMO,
    ACCOUNT_KIND_SYSTEM,
    Ingredient,
    IngredientAlias,
    IngredientSubstitution,
    PreferenceEvent,
    RecipeIngredient,
    RecipeRating,
    RecipeSave,
    RecipeVersion,
    User,
)
from app.repositories.ingredients import (
    list_direct_substitutions,
    resolve_ingredient_name,
)
from app.seeds import SeedConflictError, load_bundled_catalog, seed_catalog
from app.seeds.identifiers import seed_uuid
from app.seeds.loader import CATALOG_USER_KEY

SEEDED_TABLE_COUNTS = {
    "allergens": 8,
    "dietary_flags": 3,
    "ingredient_aliases": 15,
    "ingredient_allergens": 26,
    "ingredient_categories": 14,
    "ingredient_dietary_flags": 243,
    "ingredient_substitutions": 12,
    "ingredients": 99,
    "preference_events": 0,
    "recipe_lineages": 25,
    "recipe_version_ingredients": 281,
    "recipe_version_instructions": 116,
    "recipe_versions": 34,
    "users": 2,
}

SEEDED_TABLES = tuple(SEEDED_TABLE_COUNTS)
DatabaseSnapshot = dict[str, tuple[tuple[object, ...], ...]]


@pytest.fixture
def seed_engine(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> Iterator[Engine]:
    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "head")
    yield empty_postgres_engine


def database_snapshot(session: Session) -> DatabaseSnapshot:
    snapshot: DatabaseSnapshot = {}
    for table_name in SEEDED_TABLES:
        table = Base.metadata.tables[table_name]
        statement = select(table).order_by(*table.primary_key.columns)
        snapshot[table_name] = tuple(tuple(row) for row in session.execute(statement))
    return snapshot


def table_counts(session: Session) -> dict[str, int]:
    return {
        table_name: session.execute(
            select(func.count()).select_from(Base.metadata.tables[table_name])
        ).scalar_one()
        for table_name in SEEDED_TABLES
    }


def test_fresh_seed_load_creates_expected_catalog_and_relationships(
    seed_engine: Engine,
) -> None:
    catalog = load_bundled_catalog()
    with Session(seed_engine) as session, session.begin():
        report = seed_catalog(session, catalog)

    assert report.created_total == sum(SEEDED_TABLE_COUNTS.values())
    assert report.reused_total == 0

    dataset_id = catalog.metadata.dataset_id
    carrot_root_id = seed_uuid(
        dataset_id,
        "recipe-version",
        "carrot-walnut-snack-cake-v1",
    )
    lower_sugar_id = seed_uuid(
        dataset_id,
        "recipe-version",
        "lower-sugar-pecan-carrot-cake-v2",
    )
    orange_raisin_id = seed_uuid(
        dataset_id,
        "recipe-version",
        "orange-raisin-carrot-cake-v3",
    )
    pasta_v2_id = seed_uuid(
        dataset_id,
        "recipe-version",
        "whole-wheat-spinach-spaghetti-v2",
    )
    pasta_v3_id = seed_uuid(
        dataset_id,
        "recipe-version",
        "mushroom-whole-wheat-spaghetti-v3",
    )

    with Session(seed_engine) as session:
        assert table_counts(session) == SEEDED_TABLE_COUNTS

        catalog_user_id = seed_uuid(dataset_id, "user", CATALOG_USER_KEY)
        catalog_user = session.get(User, catalog_user_id)
        demo_user = session.get(User, DEMO_USER_ID)
        carrot_root = session.get(RecipeVersion, carrot_root_id)
        lower_sugar = session.get(RecipeVersion, lower_sugar_id)
        orange_raisin = session.get(RecipeVersion, orange_raisin_id)
        pasta_v2 = session.get(RecipeVersion, pasta_v2_id)
        pasta_v3 = session.get(RecipeVersion, pasta_v3_id)
        assert carrot_root is not None
        assert catalog_user is not None
        assert catalog_user.account_kind == ACCOUNT_KIND_SYSTEM
        assert demo_user is not None
        assert demo_user.email == DEMO_USER_EMAIL
        assert demo_user.display_name == DEMO_USER_DISPLAY_NAME
        assert demo_user.account_kind == ACCOUNT_KIND_DEMO
        assert demo_user.id != catalog_user_id
        assert carrot_root.created_by_user_id == catalog_user_id
        assert lower_sugar is not None
        assert orange_raisin is not None
        assert pasta_v2 is not None
        assert pasta_v3 is not None

        assert lower_sugar.parent_version_id == carrot_root.id
        assert orange_raisin.parent_version_id == carrot_root.id
        assert lower_sugar.lineage_id == carrot_root.lineage_id
        assert orange_raisin.lineage_id == carrot_root.lineage_id
        assert pasta_v3.parent_version_id == pasta_v2.id
        assert pasta_v3.lineage_id == pasta_v2.lineage_id

        chickpea = resolve_ingredient_name(session, "  GARBANZO BEANS ")
        assert chickpea is not None
        assert chickpea.canonical_name == "Chickpea"

        walnut = resolve_ingredient_name(session, "walnut")
        assert walnut is not None
        substitutions = list_direct_substitutions(session, walnut.id)
        assert len(substitutions) == 1
        assert substitutions[0].replacement_ingredient.canonical_name == "Pecan"
        assert substitutions[0].quantity_ratio == Decimal("1.0000")
        assert substitutions[0].provenance is not None


def test_second_committed_seed_load_is_an_exact_no_op(seed_engine: Engine) -> None:
    catalog = load_bundled_catalog()
    with Session(seed_engine) as session, session.begin():
        seed_catalog(session, catalog)
    with Session(seed_engine) as session:
        first_snapshot = database_snapshot(session)

    with Session(seed_engine) as session, session.begin():
        second_report = seed_catalog(session, catalog)
    with Session(seed_engine) as session:
        second_snapshot = database_snapshot(session)

    assert second_report.created_total == 0
    assert second_report.reused_total == sum(SEEDED_TABLE_COUNTS.values())
    assert second_snapshot == first_snapshot


def test_seed_rerun_preserves_demo_user_interactions(seed_engine: Engine) -> None:
    catalog = load_bundled_catalog()
    recipe_version_id = seed_uuid(
        catalog.metadata.dataset_id,
        "recipe-version",
        "carrot-walnut-snack-cake-v1",
    )
    event_id = uuid4()
    with Session(seed_engine) as session, session.begin():
        seed_catalog(session, catalog)
        session.add_all(
            [
                RecipeSave(
                    user_id=DEMO_USER_ID,
                    recipe_version_id=recipe_version_id,
                ),
                RecipeRating(
                    user_id=DEMO_USER_ID,
                    recipe_version_id=recipe_version_id,
                    rating=4,
                ),
                PreferenceEvent(
                    id=event_id,
                    user_id=DEMO_USER_ID,
                    recipe_version_id=recipe_version_id,
                    event_type="view",
                ),
            ]
        )

    with Session(seed_engine) as session:
        original_save = session.get(
            RecipeSave,
            {
                "user_id": DEMO_USER_ID,
                "recipe_version_id": recipe_version_id,
            },
        )
        original_rating = session.get(
            RecipeRating,
            {
                "user_id": DEMO_USER_ID,
                "recipe_version_id": recipe_version_id,
            },
        )
        original_event = session.get(PreferenceEvent, event_id)
        assert original_save is not None
        assert original_rating is not None
        assert original_event is not None
        original_save_created_at = original_save.created_at
        original_rating_created_at = original_rating.created_at
        original_event_occurred_at = original_event.occurred_at

    with Session(seed_engine) as session, session.begin():
        report = seed_catalog(session, catalog)

    assert report.created_total == 0
    assert report.reused_total == sum(SEEDED_TABLE_COUNTS.values())
    with Session(seed_engine) as session:
        preserved_demo_user = session.get(User, DEMO_USER_ID)
        preserved_save = session.get(
            RecipeSave,
            {
                "user_id": DEMO_USER_ID,
                "recipe_version_id": recipe_version_id,
            },
        )
        preserved_rating = session.get(
            RecipeRating,
            {
                "user_id": DEMO_USER_ID,
                "recipe_version_id": recipe_version_id,
            },
        )
        preserved_event = session.get(PreferenceEvent, event_id)
        assert preserved_demo_user is not None
        assert preserved_demo_user.account_kind == ACCOUNT_KIND_DEMO
        assert preserved_save is not None
        assert preserved_save.created_at == original_save_created_at
        assert preserved_rating is not None
        assert preserved_rating.rating == 4
        assert preserved_rating.created_at == original_rating_created_at
        assert preserved_event is not None
        assert preserved_event.occurred_at == original_event_occurred_at


def test_recipe_snapshot_drift_fails_and_rolls_back_repairs(
    seed_engine: Engine,
) -> None:
    catalog = load_bundled_catalog()
    with Session(seed_engine) as session, session.begin():
        seed_catalog(session, catalog)

    dataset_id = catalog.metadata.dataset_id
    drifted_version_id = seed_uuid(
        dataset_id,
        "recipe-version",
        "carrot-walnut-snack-cake-v1",
    )
    removed_alias_id = seed_uuid(
        dataset_id,
        "ingredient-alias",
        "scallion:green-onion",
    )
    with Session(seed_engine) as session, session.begin():
        version = session.get(RecipeVersion, drifted_version_id)
        alias = session.get(IngredientAlias, removed_alias_id)
        assert version is not None
        assert alias is not None
        version.description = "Locally changed after the seed load."
        session.delete(alias)

    with Session(seed_engine) as session:
        drifted_snapshot = database_snapshot(session)
        assert session.get(IngredientAlias, removed_alias_id) is None

    with Session(seed_engine) as session:
        with pytest.raises(SeedConflictError, match="stored fields differ"):
            with session.begin():
                seed_catalog(session, catalog)

    with Session(seed_engine) as session:
        assert database_snapshot(session) == drifted_snapshot
        assert session.get(IngredientAlias, removed_alias_id) is None


def test_seed_reuses_and_enriches_preexisting_canonical_ingredient(
    seed_engine: Engine,
) -> None:
    catalog = load_bundled_catalog()
    legacy_ingredient_id = uuid4()
    with Session(seed_engine) as session, session.begin():
        session.add(
            Ingredient(
                id=legacy_ingredient_id,
                canonical_name="CHICKPEA",
            )
        )

    with Session(seed_engine) as session, session.begin():
        report = seed_catalog(session, catalog)

    deterministic_id = seed_uuid(
        catalog.metadata.dataset_id,
        "ingredient",
        "chickpea",
    )
    with Session(seed_engine) as session:
        chickpea = session.get(Ingredient, legacy_ingredient_id)
        assert chickpea is not None
        assert session.get(Ingredient, deterministic_id) is None
        assert chickpea.category is not None
        assert chickpea.category.name == "Legumes and soy"
        assert {flag.name for flag in chickpea.dietary_flags} == {
            "Gluten-free",
            "Vegan",
            "Vegetarian",
        }
        assert {alias.alias for alias in chickpea.aliases} == {
            "Garbanzo bean",
            "Garbanzo beans",
        }
        assert resolve_ingredient_name(session, "garbanzo bean") is chickpea

        recipe_reference_count = session.execute(
            select(func.count())
            .select_from(RecipeIngredient)
            .where(RecipeIngredient.ingredient_id == legacy_ingredient_id)
        ).scalar_one()
        assert recipe_reference_count > 0
        assert table_counts(session) == SEEDED_TABLE_COUNTS

    assert report.created["ingredients"] == SEEDED_TABLE_COUNTS["ingredients"] - 1
    assert report.reused["ingredients"] == 1
    assert report.created["ingredient_category_assignments"] == 1


def test_existing_substitution_explanation_conflict_is_atomic(
    seed_engine: Engine,
) -> None:
    catalog = load_bundled_catalog()
    source = Ingredient(canonical_name="Walnut")
    replacement = Ingredient(canonical_name="Pecan")
    with Session(seed_engine) as session, session.begin():
        session.add_all([source, replacement])
        session.flush()
        session.add(
            IngredientSubstitution(
                source_ingredient_id=source.id,
                replacement_ingredient_id=replacement.id,
                quantity_ratio=Decimal("0.5000"),
                provenance="Pre-existing conflicting guidance.",
            )
        )

    with Session(seed_engine) as session:
        before = database_snapshot(session)

    with Session(seed_engine) as session:
        with pytest.raises(SeedConflictError, match="explanation differs"):
            with session.begin():
                seed_catalog(session, catalog)

    with Session(seed_engine) as session:
        assert database_snapshot(session) == before
