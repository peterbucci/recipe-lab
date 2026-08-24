from datetime import UTC, datetime
from uuid import UUID

from recipe_lab_evaluation.sources.postgres import _snapshot_recipes


def test_snapshot_export_omits_unresolved_ingredient_rows_without_a_sentinel() -> None:
    linked_recipe_id = UUID(int=1)
    unlinked_recipe_id = UUID(int=2)
    ingredient_id = UUID(int=101)

    recipes = _snapshot_recipes(
        (
            (linked_recipe_id, datetime(2026, 1, 1, tzinfo=UTC), "Linked", 1),
            (unlinked_recipe_id, datetime(2026, 1, 2, tzinfo=UTC), "Unlinked", 1),
        ),
        (
            (linked_recipe_id, ingredient_id),
            (linked_recipe_id, ingredient_id),
            (linked_recipe_id, None),
            (unlinked_recipe_id, None),
        ),
    )

    by_id = {recipe.id: recipe for recipe in recipes}
    assert by_id[linked_recipe_id].ingredient_ids == (ingredient_id,)
    assert by_id[unlinked_recipe_id].ingredient_ids == ()
    assert all(None not in recipe.ingredient_ids for recipe in recipes)
