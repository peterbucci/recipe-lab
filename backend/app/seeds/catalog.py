import json
from importlib import resources
from pathlib import Path
from typing import Any, cast

from app.seeds.schema import SeedCatalog

CATALOG_PACKAGE = "app.seeds.data"
CATALOG_FILENAME = "catalog.json"
RECIPES_FILENAME = "recipes.json"


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
    return _parse_catalog(raw_catalog)
