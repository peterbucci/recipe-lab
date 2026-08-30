import json
from collections import Counter, defaultdict
from datetime import UTC, datetime
from decimal import Decimal
from importlib import resources
from typing import Any, cast
from uuid import UUID

import pytest
from pydantic import ValidationError

from app.core.demo_identity import DEMO_USER_ID, DEMO_USER_KEY
from app.seeds.catalog import load_bundled_catalog
from app.seeds.identifiers import (
    ACTION_NAMESPACE,
    MEASUREMENT_NAMESPACE,
    SEED_NAMESPACE,
    action_uuid,
    measurement_uuid,
    seed_uuid,
)
from app.seeds.loader import CATALOG_USER_KEY
from app.seeds.schema import RecipeSeed, SeedCatalog

EXPECTED_RECIPE_VERSIONS = 34
EXPECTED_ROOT_RECIPES = 25
EXPECTED_VARIANTS = 9
MIN_ALIASES = 10
MIN_SUBSTITUTIONS = 10

CARROT_ROOT_KEY = "carrot-walnut-snack-cake-v1"
CARROT_PECAN_KEY = "lower-sugar-pecan-carrot-cake-v2"
CARROT_BRANCH_KEY = "orange-raisin-carrot-cake-v3"
PASTA_SECOND_VERSION_KEY = "whole-wheat-spinach-spaghetti-v2"
PASTA_THIRD_VERSION_KEY = "mushroom-whole-wheat-spaghetti-v3"


@pytest.fixture(scope="module")
def seed_catalog() -> SeedCatalog:
    return load_bundled_catalog()


def _recipe_depth(recipe: RecipeSeed, recipes_by_key: dict[str, RecipeSeed]) -> int:
    depth = 1
    parent_key = recipe.parent
    while parent_key is not None:
        depth += 1
        parent_key = recipes_by_key[parent_key].parent
    return depth


def _raw_catalog(catalog: SeedCatalog) -> dict[str, Any]:
    return catalog.model_dump(mode="json")


def _record_list(raw_catalog: dict[str, Any], key: str) -> list[dict[str, Any]]:
    return cast(list[dict[str, Any]], raw_catalog[key])


def _all_seed_ids(catalog: SeedCatalog) -> list[UUID]:
    dataset_id = catalog.metadata.dataset_id
    identifiers = [
        seed_uuid(dataset_id, "user", CATALOG_USER_KEY),
        seed_uuid(dataset_id, "user", DEMO_USER_KEY),
    ]
    identifiers.extend(
        measurement_uuid("unit", unit.key) for unit in catalog.measurement_catalog.units
    )
    identifiers.extend(
        measurement_uuid("unit-alias", f"{unit.key}:{alias.key}")
        for unit in catalog.measurement_catalog.units
        for alias in unit.aliases
    )
    identifiers.extend(
        action_uuid("action-type", action_type.key)
        for action_type in catalog.action_catalog.action_types
    )
    identifiers.extend(
        seed_uuid(dataset_id, "recipe-category", category.key)
        for category in catalog.recipe_category_catalog.categories
    )
    identifiers.extend(
        seed_uuid(dataset_id, "ingredient-category", category.key)
        for category in catalog.categories
    )
    identifiers.extend(
        seed_uuid(dataset_id, "dietary-flag", dietary_flag.key)
        for dietary_flag in catalog.dietary_flags
    )
    identifiers.extend(
        seed_uuid(dataset_id, "allergen", allergen.key) for allergen in catalog.allergens
    )
    identifiers.extend(
        seed_uuid(dataset_id, "ingredient", ingredient.key) for ingredient in catalog.ingredients
    )
    identifiers.extend(
        seed_uuid(
            dataset_id,
            "ingredient-alias",
            f"{ingredient.key}:{alias.key}",
        )
        for ingredient in catalog.ingredients
        for alias in ingredient.aliases
    )
    identifiers.extend(
        seed_uuid(
            dataset_id,
            "ingredient-substitution",
            f"{substitution.source}-to-{substitution.replacement}",
        )
        for substitution in catalog.substitutions
    )

    root_keys = {catalog.root_key_for(recipe.key) for recipe in catalog.recipes}
    identifiers.extend(seed_uuid(dataset_id, "recipe-lineage", root_key) for root_key in root_keys)
    identifiers.extend(
        seed_uuid(dataset_id, "recipe-version", recipe.key) for recipe in catalog.recipes
    )
    identifiers.extend(
        seed_uuid(
            dataset_id,
            "recipe-ingredient",
            f"{recipe.key}:{ingredient.key}",
        )
        for recipe in catalog.recipes
        for ingredient in recipe.ingredients
    )
    identifiers.extend(
        seed_uuid(
            dataset_id,
            "recipe-instruction",
            f"{recipe.key}:{instruction.key}",
        )
        for recipe in catalog.recipes
        for instruction in recipe.instructions
    )
    identifiers.extend(
        seed_uuid(
            dataset_id,
            "recipe-instruction-action",
            f"{recipe.key}:{instruction.key}:{action.key}",
        )
        for recipe in catalog.recipes
        for instruction in recipe.instructions
        for action in instruction.actions
    )
    identifiers.extend(
        seed_uuid(
            dataset_id,
            "recipe-instruction-action-input",
            f"{recipe.key}:{instruction.key}:{action.key}:{input_key}",
        )
        for recipe in catalog.recipes
        for instruction in recipe.instructions
        for action in instruction.actions
        for input_key in action.inputs
    )
    return identifiers


def test_catalog_has_the_golden_recipe_counts_and_complete_structure(
    seed_catalog: SeedCatalog,
) -> None:
    roots = [recipe for recipe in seed_catalog.recipes if recipe.parent is None]
    variants = [recipe for recipe in seed_catalog.recipes if recipe.parent is not None]

    assert 25 <= len(seed_catalog.recipes) <= 50
    assert len(seed_catalog.recipes) == EXPECTED_RECIPE_VERSIONS
    assert len(roots) == EXPECTED_ROOT_RECIPES
    assert len(variants) == EXPECTED_VARIANTS

    ingredient_categories = {
        ingredient.key: ingredient.category for ingredient in seed_catalog.ingredients
    }
    used_categories = {
        ingredient_categories[item.ingredient]
        for recipe in seed_catalog.recipes
        for item in recipe.ingredients
        if ingredient_categories[item.ingredient] is not None
    }
    assert len(used_categories) >= 10
    assert all(len(recipe.ingredients) >= 3 for recipe in seed_catalog.recipes)
    assert all(len(recipe.instructions) >= 2 for recipe in seed_catalog.recipes)
    assert all(1 <= len(recipe.categories) <= 3 for recipe in seed_catalog.recipes)
    assert all(
        isinstance(item.quantity, Decimal) or item.quantity is None
        for recipe in seed_catalog.recipes
        for item in recipe.ingredients
    )


def test_recipe_discovery_categories_are_fixed_and_explicitly_assigned(
    seed_catalog: SeedCatalog,
) -> None:
    categories = seed_catalog.recipe_category_catalog.categories

    assert [(item.name, item.slug, item.display_order, item.active) for item in categories] == [
        ("Breakfast", "breakfast", 0, True),
        ("Lunch", "lunch", 1, True),
        ("Dinner", "dinner", 2, True),
        ("Desserts", "desserts", 3, True),
        ("Breads", "breads", 4, True),
        ("Vegetarian", "vegetarian", 5, True),
        ("Quick & Easy", "quick-easy", 6, True),
    ]
    assert sum(len(recipe.categories) for recipe in seed_catalog.recipes) == 82
    assert {category for recipe in seed_catalog.recipes for category in recipe.categories} == {
        item.key for item in categories
    }


def test_measurement_catalog_is_complete_and_legacy_mapping_is_exact(
    seed_catalog: SeedCatalog,
) -> None:
    measurement_catalog = seed_catalog.measurement_catalog
    units = {unit.key: unit for unit in measurement_catalog.units}
    distribution = Counter(
        item.unit for recipe in seed_catalog.recipes for item in recipe.ingredients
    )

    assert measurement_catalog.metadata.version == 1
    assert measurement_catalog.metadata.namespace_url == (
        "https://github.com/peterbucci/recipe-lab/measurement-catalog/v1"
    )
    assert set(units) == {
        "mg",
        "g",
        "kg",
        "ml",
        "l",
        "tsp",
        "tbsp",
        "cup",
        "count",
        "clove",
        "slice",
        "second",
        "minute",
        "hour",
        "celsius",
        "fahrenheit",
        "can",
        "bunch",
        "package",
    }
    assert {unit.dimension for unit in units.values()} == {
        "mass",
        "volume",
        "count",
        "time",
        "temperature",
        "package",
    }
    assert sum(unit.conversion is not None for unit in units.values()) == 10
    assert units["fahrenheit"].conversion is not None
    assert units["fahrenheit"].conversion.offset_numerator == -32
    assert units["fahrenheit"].conversion.scale_numerator == 5
    assert units["fahrenheit"].conversion.scale_denominator == 9
    assert units["tsp"].conversion is None
    assert units["tbsp"].conversion is None
    assert units["cup"].conversion is None
    assert {alias.alias for alias in units["g"].aliases} >= {"grams"}
    assert distribution == {
        "g": 166,
        "ml": 58,
        "tsp": 25,
        "clove": 15,
        "count": 10,
        "tbsp": 6,
        "slice": 1,
    }
    assert None not in distribution
    assert sum(distribution.values()) == 281


def test_action_catalog_has_explicit_complete_reviewed_instruction_mappings(
    seed_catalog: SeedCatalog,
) -> None:
    action_catalog = seed_catalog.action_catalog
    action_types = {action_type.key: action_type for action_type in action_catalog.action_types}
    instructions = [
        instruction for recipe in seed_catalog.recipes for instruction in recipe.instructions
    ]
    actions = [action for instruction in instructions for action in instruction.actions]

    assert action_catalog.metadata.version == 1
    assert action_catalog.metadata.namespace_url == (
        "https://github.com/peterbucci/recipe-lab/action-catalog/v1"
    )
    assert len(action_types) == 54
    assert {"mix", "knead", "chop", "slice", "dice", "mince"} <= action_types.keys()
    assert all(action_type.active for action_type in action_types.values())
    assert all(action_type.provenance for action_type in action_types.values())
    assert len(instructions) == 116
    assert len(actions) == 252
    assert all(instruction.actions for instruction in instructions)
    assert any(len(instruction.actions) > 1 for instruction in instructions)
    assert any(not action.inputs for action in actions)
    assert sum(len(action.inputs) for action in actions) == 815
    assert (
        sum(
            int(action.duration is not None) + int(action.temperature is not None)
            for action in actions
        )
        == 24
    )

    raw_actions = json.loads(
        resources.files("app.seeds.data").joinpath("actions-v1.json").read_text(encoding="utf-8")
    )
    mappings = cast(list[dict[str, Any]], raw_actions["instruction_mappings"])
    assert len(mappings) == len(instructions)
    assert len({(item["recipe"], item["instruction"]) for item in mappings}) == len(mappings)

    for recipe in seed_catalog.recipes:
        ingredient_keys = {ingredient.key for ingredient in recipe.ingredients}
        for instruction in recipe.instructions:
            assert len({action.key for action in instruction.actions}) == len(instruction.actions)
            for action in instruction.actions:
                assert action.action_type in action_types
                assert set(action.inputs) <= ingredient_keys
                assert len(action.inputs) == len(set(action.inputs))


def test_recipe_graph_has_branching_depth_and_the_carrot_cake_demo(
    seed_catalog: SeedCatalog,
) -> None:
    recipes_by_key = {recipe.key: recipe for recipe in seed_catalog.recipes}
    parent_first_keys = [recipe.key for recipe in seed_catalog.recipes_in_parent_first_order()]
    parent_first_positions = {
        recipe_key: position for position, recipe_key in enumerate(parent_first_keys)
    }
    children_by_parent: dict[str, set[str]] = defaultdict(set)

    for recipe in seed_catalog.recipes:
        if recipe.parent is not None:
            children_by_parent[recipe.parent].add(recipe.key)
            assert parent_first_positions[recipe.parent] < parent_first_positions[recipe.key]
        root_key = seed_catalog.root_key_for(recipe.key)
        assert recipes_by_key[root_key].parent is None

    assert children_by_parent[CARROT_ROOT_KEY] == {
        CARROT_PECAN_KEY,
        CARROT_BRANCH_KEY,
    }
    assert max(_recipe_depth(recipe, recipes_by_key) for recipe in seed_catalog.recipes) == 3
    assert recipes_by_key[PASTA_THIRD_VERSION_KEY].parent == PASTA_SECOND_VERSION_KEY
    assert _recipe_depth(recipes_by_key[PASTA_THIRD_VERSION_KEY], recipes_by_key) == 3

    carrot_root = recipes_by_key[CARROT_ROOT_KEY]
    carrot_pecan = recipes_by_key[CARROT_PECAN_KEY]
    root_ingredients = {item.ingredient: item for item in carrot_root.ingredients}
    pecan_ingredients = {item.ingredient: item for item in carrot_pecan.ingredients}
    root_rows_by_key = {item.key: item for item in carrot_root.ingredients}
    pecan_rows_by_key = {item.key: item for item in carrot_pecan.ingredients}

    assert carrot_pecan.parent == carrot_root.key
    assert root_ingredients["granulated-sugar"].quantity == Decimal("180")
    assert pecan_ingredients["granulated-sugar"].quantity == Decimal("140")
    assert "walnut" in root_ingredients
    assert "walnut" not in pecan_ingredients
    assert "pecan" not in root_ingredients
    assert "pecan" in pecan_ingredients
    assert pecan_rows_by_key["sugar"] == root_rows_by_key["sugar"].model_copy(
        update={"quantity": Decimal("140")}
    )
    assert pecan_rows_by_key["nuts"] == root_rows_by_key["nuts"].model_copy(
        update={"ingredient": "pecan", "name": "Pecan"}
    )
    assert {
        key: value for key, value in root_rows_by_key.items() if key not in {"sugar", "nuts"}
    } == {key: value for key, value in pecan_rows_by_key.items() if key not in {"sugar", "nuts"}}
    assert carrot_pecan.instructions == carrot_root.instructions


def test_catalog_provenance_license_and_timestamp_are_fixed(
    seed_catalog: SeedCatalog,
) -> None:
    metadata = seed_catalog.metadata

    assert metadata.dataset_id == "recipe-lab-demo-v1"
    assert metadata.version == 1
    assert metadata.source == "Recipe Lab original demo data"
    assert "independently authored" in metadata.provenance
    assert metadata.license == "CC0-1.0"
    assert metadata.license_url == "https://creativecommons.org/publicdomain/zero/1.0/"
    assert metadata.published_at == datetime(2026, 8, 20, tzinfo=UTC)

    provenance_document = (
        resources.files("app.seeds.data").joinpath("PROVENANCE.md").read_text(encoding="utf-8")
    )
    assert metadata.dataset_id in provenance_document
    assert metadata.license_url in provenance_document
    assert "not copied or adapted from published recipes" in provenance_document


def test_aliases_and_substitutions_have_minimum_coverage_and_valid_references(
    seed_catalog: SeedCatalog,
) -> None:
    ingredient_keys = {ingredient.key for ingredient in seed_catalog.ingredients}
    category_keys = {category.key for category in seed_catalog.categories}
    dietary_flag_keys = {flag.key for flag in seed_catalog.dietary_flags}
    allergen_keys = {allergen.key for allergen in seed_catalog.allergens}
    alias_count = sum(len(ingredient.aliases) for ingredient in seed_catalog.ingredients)
    substitution_pairs = {
        (substitution.source, substitution.replacement)
        for substitution in seed_catalog.substitutions
    }

    assert alias_count >= MIN_ALIASES
    assert len(seed_catalog.substitutions) >= MIN_SUBSTITUTIONS
    assert len(substitution_pairs) == len(seed_catalog.substitutions)
    assert any(
        substitution.quantity_ratio is not None for substitution in seed_catalog.substitutions
    )
    assert any(substitution.guidance is not None for substitution in seed_catalog.substitutions)

    canonical_names = {
        ingredient.key: ingredient.canonical_name for ingredient in seed_catalog.ingredients
    }
    authored_alias_rows = [
        item
        for recipe in seed_catalog.recipes
        for item in recipe.ingredients
        if item.name.casefold() != canonical_names[item.ingredient].casefold()
    ]
    assert len(authored_alias_rows) >= 6

    for ingredient in seed_catalog.ingredients:
        assert ingredient.category is None or ingredient.category in category_keys
        assert set(ingredient.dietary_flags) <= dietary_flag_keys
        assert set(ingredient.allergens) <= allergen_keys
    for substitution in seed_catalog.substitutions:
        assert substitution.source in ingredient_keys
        assert substitution.replacement in ingredient_keys
        assert substitution.source != substitution.replacement
        assert substitution.quantity_ratio is not None or substitution.guidance is not None
        assert substitution.provenance is not None


def test_catalog_uses_conservative_metadata_and_safe_finish_directions(
    seed_catalog: SeedCatalog,
) -> None:
    ingredients_by_key = {ingredient.key: ingredient for ingredient in seed_catalog.ingredients}
    recipes_by_key = {recipe.key: recipe for recipe in seed_catalog.recipes}

    assert "wheat" not in ingredients_by_key["pearl-barley"].allergens
    assert "vegetarian" not in ingredients_by_key["feta"].dietary_flags
    assert "vegetarian" not in ingredients_by_key["parmesan"].dietary_flags

    instruction_text = {
        recipe_key: " ".join(instruction.text for instruction in recipe.instructions)
        for recipe_key, recipe in recipes_by_key.items()
    }
    assert "fully set" in instruction_text["spinach-tomato-egg-skillet-v1"]
    assert "165°F (74°C)" in instruction_text["chicken-ginger-rice-soup-v1"]
    assert "165°F (74°C)" in instruction_text["sheet-pan-lemon-chicken-vegetables-v1"]
    assert "165°F (74°C)" in instruction_text["turkey-meatballs-tomato-spaghetti-v1"]
    assert "145°F (63°C)" in instruction_text["baked-dill-salmon-potatoes-v1"]


def test_all_seed_owned_ids_are_unique_uuid5_values_with_stable_sentinels(
    seed_catalog: SeedCatalog,
) -> None:
    identifiers = _all_seed_ids(seed_catalog)

    assert SEED_NAMESPACE == UUID("f3d73e68-808e-501b-bd50-2ec5181abd92")
    assert MEASUREMENT_NAMESPACE == UUID("3f63d3c0-bb27-5540-92aa-c8b23cf95a13")
    assert ACTION_NAMESPACE == UUID("50a2e3b3-dab9-5076-8998-3513f206182b")
    assert identifiers == _all_seed_ids(seed_catalog)
    assert all(identifier.version == 5 for identifier in identifiers)
    assert len(identifiers) == len(set(identifiers))

    dataset_id = seed_catalog.metadata.dataset_id
    assert seed_uuid(dataset_id, "user", CATALOG_USER_KEY) == UUID(
        "16746db2-8776-5937-856c-252b72442671"
    )
    assert seed_uuid(dataset_id, "user", DEMO_USER_KEY) == DEMO_USER_ID
    assert seed_uuid(dataset_id, "ingredient", "walnut") == UUID(
        "67a0963f-33ad-58ba-ac2b-3998d2e18757"
    )
    assert seed_uuid(
        dataset_id,
        "ingredient-substitution",
        "walnut-to-pecan",
    ) == UUID("0d3ee5d4-6c38-5ac9-bdc7-14250ecda171")
    assert seed_uuid(dataset_id, "recipe-lineage", CARROT_ROOT_KEY) == UUID(
        "c6da3ff2-27bf-514f-bc26-3d8909c160e3"
    )
    assert seed_uuid(dataset_id, "recipe-version", CARROT_PECAN_KEY) == UUID(
        "1494c532-7bec-5208-8bf7-e5f48057697b"
    )
    assert measurement_uuid("unit", "g") == UUID("4a4df044-7982-5ad0-9afd-96ca25b2691f")
    assert measurement_uuid("unit-alias", "g:grams") == UUID("224daafa-bb7b-5f4d-aa17-198efafdf264")
    assert action_uuid("action-type", "mix") == UUID("24d11ddf-d76e-524a-a458-20ff4852b5bc")


def test_catalog_rejects_untrusted_or_invalid_action_mappings(
    seed_catalog: SeedCatalog,
) -> None:
    unknown_action = _raw_catalog(seed_catalog)
    recipes = _record_list(unknown_action, "recipes")
    instructions = cast(list[dict[str, Any]], recipes[0]["instructions"])
    actions = cast(list[dict[str, Any]], instructions[0]["actions"])
    actions[0]["action_type"] = "invented-from-prose"
    with pytest.raises(ValidationError, match="unknown cooking action"):
        SeedCatalog.model_validate(unknown_action)

    unknown_input = _raw_catalog(seed_catalog)
    recipes = _record_list(unknown_input, "recipes")
    instructions = cast(list[dict[str, Any]], recipes[0]["instructions"])
    actions = cast(list[dict[str, Any]], instructions[0]["actions"])
    cast(list[str], actions[0]["inputs"]).append("missing-occurrence")
    with pytest.raises(ValidationError, match="unknown ingredient rows"):
        SeedCatalog.model_validate(unknown_input)

    wrong_duration_unit = _raw_catalog(seed_catalog)
    recipes = _record_list(wrong_duration_unit, "recipes")
    action = next(
        action
        for recipe in recipes
        for instruction in cast(list[dict[str, Any]], recipe["instructions"])
        for action in cast(list[dict[str, Any]], instruction["actions"])
        if action["duration"] is not None
    )
    cast(dict[str, Any], action["duration"])["unit"] = "celsius"
    with pytest.raises(ValidationError, match="invalid duration unit"):
        SeedCatalog.model_validate(wrong_duration_unit)

    missing_mapping = _raw_catalog(seed_catalog)
    recipes = _record_list(missing_mapping, "recipes")
    instructions = cast(list[dict[str, Any]], recipes[0]["instructions"])
    instructions[0]["actions"] = []
    with pytest.raises(ValidationError):
        SeedCatalog.model_validate(missing_mapping)


def test_catalog_rejects_unknown_and_ambiguous_measurement_references(
    seed_catalog: SeedCatalog,
) -> None:
    unknown_unit = _raw_catalog(seed_catalog)
    recipes = _record_list(unknown_unit, "recipes")
    ingredients = cast(list[dict[str, Any]], recipes[0]["ingredients"])
    ingredients[0]["unit"] = "missing-unit"
    with pytest.raises(ValidationError, match="references unknown measurement unit"):
        SeedCatalog.model_validate(unknown_unit)

    ambiguous_alias = _raw_catalog(seed_catalog)
    measurement_catalog = cast(dict[str, Any], ambiguous_alias["measurement_catalog"])
    units = cast(list[dict[str, Any]], measurement_catalog["units"])
    first_aliases = cast(list[dict[str, Any]], units[0]["aliases"])
    first_aliases[0]["alias"] = units[1]["canonical_label"]
    with pytest.raises(
        ValidationError,
        match="measurement unit lookup labels must identify exactly one unit",
    ):
        SeedCatalog.model_validate(ambiguous_alias)


def test_catalog_rejects_an_unknown_recipe_parent(seed_catalog: SeedCatalog) -> None:
    raw_catalog = _raw_catalog(seed_catalog)
    recipes = _record_list(raw_catalog, "recipes")
    recipes[0]["parent"] = "missing-parent"

    with pytest.raises(ValidationError, match="references unknown parent"):
        SeedCatalog.model_validate(raw_catalog)


def test_catalog_rejects_an_unknown_recipe_ingredient(seed_catalog: SeedCatalog) -> None:
    raw_catalog = _raw_catalog(seed_catalog)
    recipes = _record_list(raw_catalog, "recipes")
    recipe_ingredients = cast(list[dict[str, Any]], recipes[0]["ingredients"])
    recipe_ingredients[0]["ingredient"] = "missing-ingredient"

    with pytest.raises(ValidationError, match="references unknown ingredient"):
        SeedCatalog.model_validate(raw_catalog)


def test_catalog_does_not_infer_recipe_display_label_identity_from_nfkc(
    seed_catalog: SeedCatalog,
) -> None:
    raw_catalog = _raw_catalog(seed_catalog)
    recipes = _record_list(raw_catalog, "recipes")
    recipe_ingredients = cast(list[dict[str, Any]], recipes[0]["ingredients"])
    original_name = cast(str, recipe_ingredients[0]["name"])
    recipe_ingredients[0]["name"] = "".join(
        chr(ord(character) + 0xFEE0) if "!" <= character <= "~" else character
        for character in original_name
    )

    with pytest.raises(ValidationError, match="is not a canonical name or alias"):
        SeedCatalog.model_validate(raw_catalog)


def test_catalog_rejects_a_canonical_alias_collision(seed_catalog: SeedCatalog) -> None:
    raw_catalog = _raw_catalog(seed_catalog)
    ingredients = _record_list(raw_catalog, "ingredients")
    alias_owner = next(ingredient for ingredient in ingredients if ingredient.get("aliases"))
    aliases = cast(list[dict[str, Any]], alias_owner["aliases"])
    different_ingredient = next(
        ingredient for ingredient in ingredients if ingredient["key"] != alias_owner["key"]
    )
    aliases[0]["name"] = different_ingredient["canonical_name"]

    with pytest.raises(ValidationError, match="canonical ingredient names and aliases"):
        SeedCatalog.model_validate(raw_catalog)


def test_catalog_rejects_an_unexplained_substitution(seed_catalog: SeedCatalog) -> None:
    raw_catalog = _raw_catalog(seed_catalog)
    substitutions = _record_list(raw_catalog, "substitutions")
    substitutions[0]["quantity_ratio"] = None
    substitutions[0]["guidance"] = None

    with pytest.raises(ValidationError, match="requires a quantity ratio or guidance"):
        SeedCatalog.model_validate(raw_catalog)


def test_catalog_rejects_duplicate_ingredient_metadata(seed_catalog: SeedCatalog) -> None:
    raw_catalog = _raw_catalog(seed_catalog)
    ingredient = _record_list(raw_catalog, "ingredients")[0]
    dietary_flags = cast(list[str], ingredient["dietary_flags"])
    assert dietary_flags
    dietary_flags.append(dietary_flags[0])

    with pytest.raises(ValidationError, match="repeats a dietary flag"):
        SeedCatalog.model_validate(raw_catalog)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("servings", "1.001"),
        ("quantity", "1.00001"),
    ],
)
def test_catalog_rejects_decimal_precision_the_database_cannot_preserve(
    seed_catalog: SeedCatalog,
    field: str,
    value: str,
) -> None:
    raw_catalog = _raw_catalog(seed_catalog)
    first_recipe = _record_list(raw_catalog, "recipes")[0]
    target = (
        first_recipe
        if field == "servings"
        else cast(list[dict[str, Any]], first_recipe["ingredients"])[0]
    )
    target[field] = value

    with pytest.raises(ValidationError):
        SeedCatalog.model_validate(raw_catalog)
