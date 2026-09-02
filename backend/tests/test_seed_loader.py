from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.catalog_names import catalog_name_digest, normalize_catalog_name
from app.core.demo_identity import (
    DEMO_USER_DISPLAY_NAME,
    DEMO_USER_EMAIL,
    DEMO_USER_ID,
)
from app.db.base import Base
from app.models import (
    ACCOUNT_KIND_DEMO,
    ACCOUNT_KIND_MEMBER,
    ACCOUNT_KIND_SYSTEM,
    CATALOG_REQUEST_APPROVED,
    CATALOG_REQUEST_PENDING,
    CookingActionType,
    Ingredient,
    IngredientAlias,
    IngredientCatalogAuditEvent,
    IngredientCatalogName,
    IngredientCatalogRequest,
    IngredientSubstitution,
    MeasurementConversionRule,
    MeasurementUnit,
    MeasurementUnitAlias,
    PreferenceEvent,
    RecipeIngredient,
    RecipeInstructionAction,
    RecipeInstructionActionMeasure,
    RecipeRating,
    RecipeSave,
    RecipeStructuralFingerprint,
    RecipeVersion,
    User,
)
from app.repositories.ingredients import (
    list_direct_substitutions,
    resolve_ingredient_name,
)
from app.schemas.ingredient_catalog import (
    ApproveIngredientCatalogRequest,
    IngredientCatalogRequestCreate,
)
from app.seeds import SeedConflictError, load_bundled_catalog, seed_catalog
from app.seeds.identifiers import action_uuid, measurement_uuid, seed_uuid
from app.seeds.loader import CATALOG_USER_KEY
from app.services.catalog_requests import (
    CatalogRequestConflictError,
    review_catalog_request,
    submit_catalog_request,
)

SEEDED_TABLE_COUNTS = {
    "allergens": 8,
    "cooking_action_types": 54,
    "dietary_flags": 3,
    "ingredient_aliases": 15,
    "ingredient_catalog_names": 114,
    "ingredient_allergens": 26,
    "ingredient_categories": 14,
    "ingredient_dietary_flags": 243,
    "ingredient_substitutions": 12,
    "ingredients": 99,
    "ingredient_density_rules": 0,
    "ingredient_package_sizes": 0,
    "measurement_conversion_rules": 10,
    "measurement_unit_aliases": 21,
    "measurement_units": 19,
    "preference_events": 0,
    "recipe_lineages": 25,
    "recipe_categories": 7,
    "recipe_version_categories": 82,
    "recipe_version_ingredients": 281,
    "recipe_version_instructions": 116,
    "recipe_instruction_actions": 252,
    "recipe_instruction_action_inputs": 815,
    "recipe_instruction_action_measures": 24,
    "recipe_structural_fingerprints": 34,
    "recipe_version_publications": 34,
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


def test_seed_loader_remains_compatible_with_the_pre_namespace_schema(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    catalog = load_bundled_catalog()
    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260902_0027")

    with Session(empty_postgres_engine) as session, session.begin():
        legacy_report = seed_catalog(session, catalog)
    assert legacy_report.created["ingredients"] == 99
    assert legacy_report.created["ingredient_aliases"] == 15
    assert legacy_report.created["ingredient_catalog_names"] == 0

    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "head")

    with Session(empty_postgres_engine) as session, session.begin():
        upgraded_report = seed_catalog(session, catalog)
    assert upgraded_report.created_total == 0
    assert upgraded_report.reused["ingredient_catalog_names"] == 114


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

    migration_seeded_catalog_rows = 19 + 21 + 10 + 54 + 7
    assert report.created_total == sum(SEEDED_TABLE_COUNTS.values()) - migration_seeded_catalog_rows
    assert report.reused_total == migration_seeded_catalog_rows

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
        catalog_names = list(session.scalars(select(IngredientCatalogName)))
        assert len(catalog_names) == 114
        assert all(
            catalog_name.normalized_name_digest == catalog_name_digest(catalog_name.normalized_name)
            for catalog_name in catalog_names
        )

        gram = session.get(MeasurementUnit, measurement_uuid("unit", "g"))
        grams_alias = session.get(
            MeasurementUnitAlias,
            measurement_uuid("unit-alias", "g:grams"),
        )
        fahrenheit_rule = session.get(
            MeasurementConversionRule,
            measurement_uuid("unit", "fahrenheit"),
        )
        assert gram is not None
        assert gram.key == "g"
        assert gram.canonical_label == "gram"
        assert grams_alias is not None
        assert grams_alias.measurement_unit_id == gram.id
        assert fahrenheit_rule is not None
        assert fahrenheit_rule.base_unit_id == measurement_uuid("unit", "celsius")
        assert fahrenheit_rule.offset_numerator == -32
        assert fahrenheit_rule.scale_numerator == 5
        assert fahrenheit_rule.scale_denominator == 9

        mix_action_type = session.get(CookingActionType, action_uuid("action-type", "mix"))
        assert mix_action_type is not None
        assert mix_action_type.canonical_verb == "mix"
        assert mix_action_type.active is True

        carrot_bake_action_id = seed_uuid(
            dataset_id,
            "recipe-instruction-action",
            "carrot-walnut-snack-cake-v1:bake:bake-cake",
        )
        carrot_bake_action = session.get(RecipeInstructionAction, carrot_bake_action_id)
        carrot_bake_temperature = session.get(
            RecipeInstructionActionMeasure,
            (carrot_bake_action_id, "temperature"),
        )
        assert carrot_bake_action is not None
        assert carrot_bake_action.action_type_id == action_uuid("action-type", "bake")
        assert carrot_bake_temperature is not None
        assert carrot_bake_temperature.quantity_min == Decimal("180")
        assert carrot_bake_temperature.measurement_unit_id == measurement_uuid("unit", "celsius")

        catalog_user_id = seed_uuid(dataset_id, "user", CATALOG_USER_KEY)
        catalog_user = session.get(User, catalog_user_id)
        demo_user = session.get(User, DEMO_USER_ID)
        carrot_root = session.get(RecipeVersion, carrot_root_id)
        carrot_fingerprint = session.get(
            RecipeStructuralFingerprint,
            (carrot_root_id, "recipe-structure-v1"),
        )
        lower_sugar = session.get(RecipeVersion, lower_sugar_id)
        orange_raisin = session.get(RecipeVersion, orange_raisin_id)
        pasta_v2 = session.get(RecipeVersion, pasta_v2_id)
        pasta_v3 = session.get(RecipeVersion, pasta_v3_id)
        assert carrot_root is not None
        assert carrot_fingerprint is not None
        assert len(carrot_fingerprint.digest) == 64
        assert carrot_fingerprint.canonical_payload.startswith('{"ingredients":')
        assert catalog_user is not None
        assert catalog_user.account_kind == ACCOUNT_KIND_SYSTEM
        assert catalog_user.handle == "recipe-lab-catalog"
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

        carrot_ingredients = list(
            session.scalars(
                select(RecipeIngredient)
                .where(RecipeIngredient.recipe_version_id == carrot_root.id)
                .order_by(RecipeIngredient.display_order)
            )
        )
        assert carrot_ingredients
        assert all(item.measure_mode == "exact" for item in carrot_ingredients)
        assert all(item.quantity_min is not None for item in carrot_ingredients)
        assert all(item.quantity_max is None for item in carrot_ingredients)
        assert all(item.measurement_unit_id is not None for item in carrot_ingredients)
        assert all(item.unit_display is not None for item in carrot_ingredients)
        assert all(item.package_size_id is None for item in carrot_ingredients)

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


def test_seed_loader_recreates_missing_measurement_catalog_deterministically(
    seed_engine: Engine,
) -> None:
    with seed_engine.begin() as connection:
        connection.execute(Base.metadata.tables["measurement_conversion_rules"].delete())
        connection.execute(Base.metadata.tables["measurement_unit_aliases"].delete())
        connection.execute(Base.metadata.tables["measurement_units"].delete())

    catalog = load_bundled_catalog()
    with Session(seed_engine) as session, session.begin():
        report = seed_catalog(session, catalog)

    assert report.created["measurement_units"] == 19
    assert report.created["measurement_unit_aliases"] == 21
    assert report.created["measurement_conversion_rules"] == 10
    assert report.reused["measurement_units"] == 0
    with Session(seed_engine) as session:
        assert table_counts(session) == SEEDED_TABLE_COUNTS
        assert session.get(MeasurementUnit, measurement_uuid("unit", "g")) is not None


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


def test_catalog_public_handle_collision_fails_before_seed_identity_creation(
    seed_engine: Engine,
) -> None:
    catalog = load_bundled_catalog()
    conflicting_user_id = uuid4()
    with Session(seed_engine) as session, session.begin():
        session.add(
            User(
                id=conflicting_user_id,
                email="reserved-handle-owner@example.test",
                display_name="Reserved Handle Owner",
                handle="recipe-lab-catalog",
                account_kind=ACCOUNT_KIND_MEMBER,
            )
        )

    with Session(seed_engine) as session:
        with pytest.raises(
            SeedConflictError,
            match="user 'catalog-author': public handle belongs to another user",
        ):
            with session.begin():
                seed_catalog(session, catalog)

    with Session(seed_engine) as session:
        assert session.get(User, conflicting_user_id) is not None
        assert (
            session.get(
                User,
                seed_uuid(catalog.metadata.dataset_id, "user", CATALOG_USER_KEY),
            )
            is None
        )


def test_measurement_catalog_drift_fails_atomically(seed_engine: Engine) -> None:
    catalog = load_bundled_catalog()
    with Session(seed_engine) as session, session.begin():
        seed_catalog(session, catalog)
    with Session(seed_engine) as session, session.begin():
        gram = session.get(MeasurementUnit, measurement_uuid("unit", "g"))
        assert gram is not None
        gram.provenance = "Conflicting runtime measurement provenance."
    with Session(seed_engine) as session:
        before = database_snapshot(session)

    with Session(seed_engine) as session:
        with pytest.raises(
            SeedConflictError,
            match="measurement unit 'g': stored fields differ from the catalog",
        ):
            with session.begin():
                seed_catalog(session, catalog)

    with Session(seed_engine) as session:
        assert database_snapshot(session) == before


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


def test_published_recipe_snapshot_drift_is_blocked_atomically(
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
    with Session(seed_engine) as session:
        original_snapshot = database_snapshot(session)

    with pytest.raises(IntegrityError, match="published recipe snapshots are immutable"):
        with Session(seed_engine) as session, session.begin():
            version = session.get(RecipeVersion, drifted_version_id)
            alias = session.get(IngredientAlias, removed_alias_id)
            assert version is not None
            assert alias is not None
            version.description = "Locally changed after the seed load."
            session.delete(alias)

    with Session(seed_engine) as session:
        assert database_snapshot(session) == original_snapshot
        assert session.get(IngredientAlias, removed_alias_id) is not None

    with Session(seed_engine) as session, session.begin():
        report = seed_catalog(session, catalog)
    assert report.created_total == 0


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


def test_seed_canonical_name_collision_with_runtime_alias_is_atomic(
    seed_engine: Engine,
) -> None:
    catalog = load_bundled_catalog()
    with Session(seed_engine) as session, session.begin():
        runtime_ingredient = Ingredient(canonical_name="Runtime bean")
        session.add(runtime_ingredient)
        session.flush()
        session.add(
            IngredientAlias(
                ingredient_id=runtime_ingredient.id,
                alias="ＣＨＩＣＫＰＥＡ",
            )
        )

    with Session(seed_engine) as session:
        before = database_snapshot(session)

    with Session(seed_engine) as session:
        with pytest.raises(
            SeedConflictError,
            match="canonical name collides with an existing ingredient alias",
        ):
            with session.begin():
                seed_catalog(session, catalog)

    with Session(seed_engine) as session:
        assert database_snapshot(session) == before
        assert session.scalar(select(func.count()).select_from(Ingredient)) == 1
        assert session.scalar(select(func.count()).select_from(IngredientAlias)) == 1


@pytest.mark.parametrize(
    "runtime_name",
    ["ＣＨＩＣＫＰＥＡ", "Granulated   sugar"],
)
def test_seed_normalized_canonical_candidate_is_not_silently_reused(
    seed_engine: Engine,
    runtime_name: str,
) -> None:
    catalog = load_bundled_catalog()
    runtime_ingredient_id = uuid4()
    with Session(seed_engine) as session, session.begin():
        session.add(
            Ingredient(
                id=runtime_ingredient_id,
                canonical_name=runtime_name,
            )
        )

    with Session(seed_engine) as session:
        before = database_snapshot(session)

    with Session(seed_engine) as session:
        with pytest.raises(
            SeedConflictError,
            match="normalized catalog candidate that cannot establish identity",
        ):
            with session.begin():
                seed_catalog(session, catalog)

    with Session(seed_engine) as session:
        assert database_snapshot(session) == before
        assert session.get(Ingredient, runtime_ingredient_id) is not None
        assert session.scalar(select(func.count()).select_from(Ingredient)) == 1


def test_seed_and_runtime_review_serialize_the_normalized_name_namespace(
    seed_engine: Engine,
) -> None:
    catalog = load_bundled_catalog()
    requester_id = uuid4()
    reviewer_id = uuid4()
    with Session(seed_engine) as session, session.begin():
        session.add_all(
            [
                User(
                    id=requester_id,
                    email=f"{requester_id}@example.test",
                    display_name="Seed Race Requester",
                    account_kind=ACCOUNT_KIND_MEMBER,
                ),
                User(
                    id=reviewer_id,
                    email=f"{reviewer_id}@example.test",
                    display_name="Seed Race Curator",
                    account_kind=ACCOUNT_KIND_MEMBER,
                ),
            ]
        )
        session.flush()
        request = submit_catalog_request(
            session,
            requester_user_id=requester_id,
            payload=IngredientCatalogRequestCreate(
                proposed_name="Seed concurrency proposal",
                context=None,
            ),
        )
        request_id = request.id

    barrier = Barrier(2)
    approval_payload = ApproveIngredientCatalogRequest(
        decision="approve",
        canonical_name="Ｃｈｉｃｋｐｅａ",
        aliases=["Ｇａｒｂａｎｚｏ   beans"],
        reason="Approved during the seed concurrency regression.",
        provenance="RCP-25A seed/runtime serialization test.",
    )

    def run_review() -> str:
        try:
            with Session(seed_engine) as session:
                barrier.wait()
                with session.begin():
                    reviewed = review_catalog_request(
                        session,
                        request_id=request_id,
                        reviewer_user_id=reviewer_id,
                        payload=approval_payload,
                    )
                    assert reviewed is not None
            return "approved"
        except CatalogRequestConflictError:
            return "review-conflict"

    def run_seed() -> str:
        try:
            with Session(seed_engine) as session:
                barrier.wait()
                with session.begin():
                    seed_catalog(session, catalog)
            return "seeded"
        except SeedConflictError:
            return "seed-conflict"

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(run_review), executor.submit(run_seed)]
        outcomes = {future.result() for future in futures}

    assert outcomes in (
        {"approved", "seed-conflict"},
        {"review-conflict", "seeded"},
    )

    with Session(seed_engine) as session:
        chickpeas = [
            ingredient
            for ingredient in session.scalars(select(Ingredient)).all()
            if normalize_catalog_name(ingredient.canonical_name) == "chickpea"
        ]
        garbanzo_aliases = [
            alias
            for alias in session.scalars(select(IngredientAlias)).all()
            if normalize_catalog_name(alias.alias) == "garbanzo beans"
        ]
        stored_request = session.get(IngredientCatalogRequest, request_id)
        events = list(
            session.scalars(
                select(IngredientCatalogAuditEvent)
                .where(IngredientCatalogAuditEvent.request_id == request_id)
                .order_by(IngredientCatalogAuditEvent.created_at)
            )
        )

        assert len(chickpeas) == 1
        assert len(garbanzo_aliases) == 1
        assert garbanzo_aliases[0].ingredient_id == chickpeas[0].id
        namespace_rows = list(
            session.scalars(
                select(IngredientCatalogName).where(
                    IngredientCatalogName.normalized_name.in_(["chickpea", "garbanzo beans"])
                )
            )
        )
        assert len(namespace_rows) == 2
        assert stored_request is not None
        if "approved" in outcomes:
            assert stored_request.status == CATALOG_REQUEST_APPROVED
            assert stored_request.resolved_ingredient_id == chickpeas[0].id
            assert [event.event_type for event in events] == ["submitted", "approved"]
        else:
            assert stored_request.status == CATALOG_REQUEST_PENDING
            assert stored_request.resolved_ingredient_id is None
            assert [event.event_type for event in events] == ["submitted"]


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
