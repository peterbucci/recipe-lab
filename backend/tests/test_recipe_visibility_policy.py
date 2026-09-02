"""Architecture and behavior guards for the shared recipe-visibility policy."""

from __future__ import annotations

import ast
from datetime import UTC, datetime
from pathlib import Path

from app.models import RecipeVersionPublication
from app.policies.recipe_visibility import (
    effective_recipe_visibility_state,
    publicly_readable_recipe_publication_filter,
    publicly_readable_recipe_version_filter,
)
from app.repositories import recipes
from app.services import recipe_visibility

_APP_ROOT = Path(__file__).resolve().parents[1] / "app"
_POLICY_DEFINITIONS = {
    "effective_recipe_visibility_state": Path("policies/recipe_visibility.py"),
    "publicly_readable_recipe_publication_filter": Path("policies/recipe_visibility.py"),
    "publicly_readable_recipe_version_filter": Path("policies/recipe_visibility.py"),
}


def _function_definitions() -> dict[str, list[Path]]:
    definitions: dict[str, list[Path]] = {name: [] for name in _POLICY_DEFINITIONS}
    for path in sorted(_APP_ROOT.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if node.name in definitions:
                    definitions[node.name].append(path.relative_to(_APP_ROOT))
    return definitions


def test_shared_visibility_functions_have_one_authoritative_definition() -> None:
    assert _function_definitions() == {name: [path] for name, path in _POLICY_DEFINITIONS.items()}


def test_legacy_import_surfaces_reexport_the_canonical_visibility_objects() -> None:
    assert (
        recipes.publicly_readable_recipe_version_filter is publicly_readable_recipe_version_filter
    )
    assert recipe_visibility.effective_recipe_visibility_state is effective_recipe_visibility_state


def test_public_read_predicates_compile_to_the_same_publication_state_boundary() -> None:
    compile_options = {"literal_binds": True}
    publication_sql = str(
        publicly_readable_recipe_publication_filter().compile(
            compile_kwargs=compile_options,
        )
    )
    version_sql = str(
        publicly_readable_recipe_version_filter().compile(
            compile_kwargs=compile_options,
        )
    )

    assert publication_sql == "recipe_version_publications.state = 'published'"
    assert "EXISTS" in version_sql
    assert publication_sql in version_sql


def test_effective_visibility_gives_moderation_precedence_over_author_withdrawal() -> None:
    now = datetime.now(UTC)
    publication = RecipeVersionPublication(
        author_withdrawn_at=None,
        moderation_hidden_at=None,
    )
    assert effective_recipe_visibility_state(publication) == "published"

    publication.author_withdrawn_at = now
    assert effective_recipe_visibility_state(publication) == "author_withdrawn"

    publication.moderation_hidden_at = now
    assert effective_recipe_visibility_state(publication) == "moderation_hidden"
