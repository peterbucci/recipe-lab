import json
from importlib import resources
from pathlib import Path
from typing import Any, cast

from app.seeds.schema import SeedCatalog

CATALOG_PACKAGE = "app.seeds.data"
CATALOG_FILENAME = "catalog.json"
RECIPES_FILENAME = "recipes.json"
MEASUREMENTS_FILENAME = "measurements-v1.json"
ACTIONS_FILENAME = "actions-v1.json"


def _parse_catalog(raw_catalog: object) -> SeedCatalog:
    return SeedCatalog.model_validate(cast(dict[str, Any], raw_catalog))


def load_catalog_file(path: Path) -> SeedCatalog:
    """Load and validate a catalog from an explicit JSON path."""

    with path.open("r", encoding="utf-8") as catalog_file:
        return _parse_catalog(json.load(catalog_file))


def load_bundled_catalog() -> SeedCatalog:
    """Load and validate the versioned catalog bundled with the backend package."""

    catalog_resource = resources.files(CATALOG_PACKAGE).joinpath(CATALOG_FILENAME)
    with catalog_resource.open("r", encoding="utf-8") as catalog_file:
        raw_catalog = cast(dict[str, Any], json.load(catalog_file))

    recipes_resource = resources.files(CATALOG_PACKAGE).joinpath(RECIPES_FILENAME)
    with recipes_resource.open("r", encoding="utf-8") as recipes_file:
        raw_catalog["recipes"] = json.load(recipes_file)

    measurements_resource = resources.files(CATALOG_PACKAGE).joinpath(MEASUREMENTS_FILENAME)
    with measurements_resource.open("r", encoding="utf-8") as measurements_file:
        raw_catalog["measurement_catalog"] = json.load(measurements_file)

    actions_resource = resources.files(CATALOG_PACKAGE).joinpath(ACTIONS_FILENAME)
    with actions_resource.open("r", encoding="utf-8") as actions_file:
        raw_actions = cast(dict[str, Any], json.load(actions_file))

    raw_catalog["action_catalog"] = {
        "metadata": raw_actions["metadata"],
        "action_types": raw_actions["action_types"],
    }
    mappings = cast(list[dict[str, Any]], raw_actions["instruction_mappings"])
    mappings_by_instruction: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for mapping in mappings:
        recipe_key = cast(str, mapping["recipe"])
        instruction_key = cast(str, mapping["instruction"])
        stable_key = (recipe_key, instruction_key)
        if stable_key in mappings_by_instruction:
            raise ValueError(f"duplicate action mapping for {recipe_key}:{instruction_key}")
        mappings_by_instruction[stable_key] = cast(list[dict[str, Any]], mapping["actions"])

    expected_keys: set[tuple[str, str]] = set()
    for recipe in cast(list[dict[str, Any]], raw_catalog["recipes"]):
        recipe_key = cast(str, recipe["key"])
        for instruction in cast(list[dict[str, Any]], recipe["instructions"]):
            instruction_key = cast(str, instruction["key"])
            stable_key = (recipe_key, instruction_key)
            expected_keys.add(stable_key)
            actions = mappings_by_instruction.get(stable_key)
            if actions is None:
                raise ValueError(f"missing action mapping for {recipe_key}:{instruction_key}")
            instruction["actions"] = actions

    unexpected_keys = sorted(mappings_by_instruction.keys() - expected_keys)
    if unexpected_keys:
        examples = ", ".join(f"{recipe}:{instruction}" for recipe, instruction in unexpected_keys)
        raise ValueError(f"action mappings reference unknown instructions: {examples}")
    return _parse_catalog(raw_catalog)
