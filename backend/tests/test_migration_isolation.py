"""Guards for immutable migration code and its frozen data contracts."""

from __future__ import annotations

import ast
from pathlib import Path
from uuid import UUID

from migrations.frozen.catalog_20260824 import (
    action_uuid,
    load_frozen_action_backfill_catalog,
    load_frozen_measurement_catalog,
    measurement_uuid,
    seed_uuid,
)

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_MIGRATION_IMPLEMENTATION_ROOTS = (
    _BACKEND_ROOT / "migrations" / "versions",
    _BACKEND_ROOT / "migrations" / "frozen",
)


def _live_app_imports(path: Path) -> list[tuple[int, str]]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    imports: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules = tuple(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module is not None:
            modules = (node.module,)
        else:
            continue
        imports.extend(
            (node.lineno, module)
            for module in modules
            if module == "app" or module.startswith("app.")
        )
    return imports


def test_migration_implementations_do_not_import_the_live_application() -> None:
    violations = [
        f"{path.relative_to(_BACKEND_ROOT)}:{line}: {module}"
        for root in _MIGRATION_IMPLEMENTATION_ROOTS
        for path in sorted(root.rglob("*.py"))
        for line, module in _live_app_imports(path)
    ]

    assert violations == [], (
        "Migration revisions must be replayable from their frozen implementation and data; "
        f"live application imports found: {violations}"
    )


def test_frozen_0009_and_0010_catalog_contract_is_stable() -> None:
    measurement_catalog = load_frozen_measurement_catalog()
    action_catalog = load_frozen_action_backfill_catalog()

    assert measurement_catalog.metadata.version == 1
    assert len(measurement_catalog.units) == 19
    assert action_catalog.dataset_id == "recipe-lab-demo-v1"
    assert len(action_catalog.action_catalog.action_types) == 54
    assert len(action_catalog.recipes) == 34
    assert sum(len(recipe.instructions) for recipe in action_catalog.recipes) == 116
    assert (
        sum(
            len(instruction.actions)
            for recipe in action_catalog.recipes
            for instruction in recipe.instructions
        )
        == 252
    )
    assert measurement_uuid("unit", "g") == UUID("4a4df044-7982-5ad0-9afd-96ca25b2691f")
    assert action_uuid("action-type", "mix") == UUID("24d11ddf-d76e-524a-a458-20ff4852b5bc")
    assert seed_uuid(
        action_catalog.dataset_id,
        "recipe-version",
        "banana-oat-pancakes:v1",
    ) == UUID("288cd98b-44af-576d-8080-1e0987a5c922")
