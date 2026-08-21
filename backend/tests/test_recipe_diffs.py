from decimal import Decimal
from uuid import UUID

from app.models import Ingredient, RecipeIngredient, RecipeInstruction, RecipeVersion
from app.schemas.recipe_diffs import RecipeDiffResponse
from app.services.recipe_diffs import build_recipe_diff

LINEAGE_ID = UUID(int=1)
AUTHOR_ID = UUID(int=2)


def _id(value: int) -> UUID:
    return UUID(int=value)


def _catalog_ingredient(value: int, canonical_name: str) -> Ingredient:
    return Ingredient(id=_id(value), canonical_name=canonical_name)


def _ingredient(
    *,
    row_id: int,
    version_id: UUID,
    catalog: Ingredient,
    display_order: int,
    name: str | None = None,
    quantity: Decimal | None = None,
    unit: str | None = None,
    preparation_notes: str | None = None,
) -> RecipeIngredient:
    return RecipeIngredient(
        id=_id(row_id),
        recipe_version_id=version_id,
        ingredient_id=catalog.id,
        ingredient=catalog,
        name=name or catalog.canonical_name,
        quantity=quantity,
        unit=unit,
        preparation_notes=preparation_notes,
        display_order=display_order,
    )


def _instruction(
    *,
    row_id: int,
    version_id: UUID,
    display_order: int,
    text: str,
) -> RecipeInstruction:
    return RecipeInstruction(
        id=_id(row_id),
        recipe_version_id=version_id,
        instruction=text,
        display_order=display_order,
    )


def _version(
    *,
    version_id: int,
    version_number: int,
    ingredients: list[RecipeIngredient],
    instructions: list[RecipeInstruction],
    title: str = "Test recipe",
    description: str | None = "A structured test recipe.",
    servings: Decimal = Decimal("4.00"),
    parent_version_id: UUID | None = None,
) -> RecipeVersion:
    version = RecipeVersion(
        id=_id(version_id),
        lineage_id=LINEAGE_ID,
        parent_version_id=parent_version_id,
        created_by_user_id=AUTHOR_ID,
        version_number=version_number,
        title=title,
        description=description,
        servings=servings,
    )
    version.ingredients = ingredients
    version.instructions = instructions
    return version


def _assert_no_content_changes(diff: RecipeDiffResponse) -> None:
    assert diff.ingredients.added == []
    assert diff.ingredients.removed == []
    assert diff.ingredients.replaced == []
    assert diff.ingredients.modified == []
    assert diff.instructions.added == []
    assert diff.instructions.removed == []
    assert diff.instructions.modified == []


def test_copied_snapshots_with_fresh_row_ids_have_no_changes() -> None:
    flour = _catalog_ingredient(10, "All-purpose flour")
    base_id = _id(100)
    target_id = _id(101)
    base = _version(
        version_id=base_id.int,
        version_number=1,
        ingredients=[
            _ingredient(
                row_id=1_000,
                version_id=base_id,
                catalog=flour,
                display_order=0,
                quantity=Decimal("220.0000"),
                unit="g",
            )
        ],
        instructions=[
            _instruction(
                row_id=1_100,
                version_id=base_id,
                display_order=0,
                text="Mix the ingredients.",
            )
        ],
    )
    target = _version(
        version_id=target_id.int,
        version_number=2,
        parent_version_id=base_id,
        ingredients=[
            _ingredient(
                row_id=2_000,
                version_id=target_id,
                catalog=flour,
                display_order=0,
                quantity=Decimal("220.0000"),
                unit="g",
            )
        ],
        instructions=[
            _instruction(
                row_id=2_100,
                version_id=target_id,
                display_order=0,
                text="Mix the ingredients.",
            )
        ],
    )

    diff = build_recipe_diff(base, target, set())

    assert base.ingredients[0].id != target.ingredients[0].id
    assert base.instructions[0].id != target.instructions[0].id
    assert diff.metadata_changes == []
    _assert_no_content_changes(diff)
    assert diff.has_changes is False


def test_reorder_only_is_ignored_for_ingredients_and_instructions() -> None:
    flour = _catalog_ingredient(20, "Flour")
    salt = _catalog_ingredient(21, "Salt")
    base_id = _id(200)
    target_id = _id(201)
    base = _version(
        version_id=base_id.int,
        version_number=1,
        ingredients=[
            _ingredient(
                row_id=2_000,
                version_id=base_id,
                catalog=flour,
                display_order=0,
                quantity=Decimal("2"),
                unit="cup",
            ),
            _ingredient(
                row_id=2_001,
                version_id=base_id,
                catalog=salt,
                display_order=1,
                quantity=Decimal("1"),
                unit="tsp",
            ),
        ],
        instructions=[
            _instruction(
                row_id=2_100,
                version_id=base_id,
                display_order=0,
                text="Mix.",
            ),
            _instruction(
                row_id=2_101,
                version_id=base_id,
                display_order=1,
                text="Bake.",
            ),
        ],
    )
    target = _version(
        version_id=target_id.int,
        version_number=2,
        parent_version_id=base_id,
        ingredients=[
            _ingredient(
                row_id=2_010,
                version_id=target_id,
                catalog=salt,
                display_order=0,
                quantity=Decimal("1"),
                unit="tsp",
            ),
            _ingredient(
                row_id=2_011,
                version_id=target_id,
                catalog=flour,
                display_order=1,
                quantity=Decimal("2"),
                unit="cup",
            ),
        ],
        instructions=[
            _instruction(
                row_id=2_110,
                version_id=target_id,
                display_order=0,
                text="Bake.",
            ),
            _instruction(
                row_id=2_111,
                version_id=target_id,
                display_order=1,
                text="Mix.",
            ),
        ],
    )

    diff = build_recipe_diff(base, target, set())

    assert diff.metadata_changes == []
    _assert_no_content_changes(diff)
    assert diff.has_changes is False


def test_duplicate_ingredients_pair_exact_occurrences_before_modified_ones() -> None:
    salt = _catalog_ingredient(30, "Salt")
    base_id = _id(300)
    target_id = _id(301)
    base_first_id = _id(3_000)
    exact_base_id = _id(3_001)
    exact_target_id = _id(3_010)
    changed_target_id = _id(3_011)
    added_target_id = _id(3_012)
    base = _version(
        version_id=base_id.int,
        version_number=1,
        ingredients=[
            _ingredient(
                row_id=base_first_id.int,
                version_id=base_id,
                catalog=salt,
                display_order=0,
                quantity=Decimal("1"),
                unit="tsp",
                preparation_notes="for the batter",
            ),
            _ingredient(
                row_id=exact_base_id.int,
                version_id=base_id,
                catalog=salt,
                display_order=1,
                quantity=Decimal("2"),
                unit="tsp",
                preparation_notes="for finishing",
            ),
        ],
        instructions=[],
    )
    target = _version(
        version_id=target_id.int,
        version_number=2,
        parent_version_id=base_id,
        ingredients=[
            _ingredient(
                row_id=exact_target_id.int,
                version_id=target_id,
                catalog=salt,
                display_order=0,
                quantity=Decimal("2.0000"),
                unit="tsp",
                preparation_notes="for finishing",
            ),
            _ingredient(
                row_id=changed_target_id.int,
                version_id=target_id,
                catalog=salt,
                display_order=1,
                quantity=Decimal("0.5"),
                unit="tsp",
                preparation_notes="for the batter",
            ),
            _ingredient(
                row_id=added_target_id.int,
                version_id=target_id,
                catalog=salt,
                display_order=2,
                quantity=Decimal("3"),
                unit="tsp",
                preparation_notes="for the table",
            ),
        ],
        instructions=[],
    )

    diff = build_recipe_diff(base, target, set())

    assert [item.id for item in diff.ingredients.added] == [added_target_id]
    assert diff.ingredients.removed == []
    assert diff.ingredients.replaced == []
    assert len(diff.ingredients.modified) == 1
    change = diff.ingredients.modified[0]
    assert change.before.id == base_first_id
    assert change.after.id == changed_target_id
    assert change.changed_fields == ["quantity"]
    assert exact_base_id not in {item.before.id for item in diff.ingredients.modified}
    assert exact_target_id not in {item.after.id for item in diff.ingredients.modified}


def _multiple_change_versions() -> tuple[
    RecipeVersion,
    RecipeVersion,
    set[tuple[UUID, UUID]],
]:
    flour = _catalog_ingredient(40, "Flour")
    sugar = _catalog_ingredient(41, "Granulated sugar")
    walnut = _catalog_ingredient(42, "Walnut")
    baking_soda = _catalog_ingredient(43, "Baking soda")
    pecan = _catalog_ingredient(44, "Pecan")
    orange_zest = _catalog_ingredient(45, "Orange zest")
    base_id = _id(400)
    target_id = _id(401)
    base = _version(
        version_id=base_id.int,
        version_number=1,
        ingredients=[
            _ingredient(
                row_id=4_000,
                version_id=base_id,
                catalog=flour,
                display_order=0,
                quantity=Decimal("220"),
                unit="g",
            ),
            _ingredient(
                row_id=4_001,
                version_id=base_id,
                catalog=sugar,
                display_order=1,
                name="White sugar",
                quantity=Decimal("180"),
                unit="g",
            ),
            _ingredient(
                row_id=4_002,
                version_id=base_id,
                catalog=walnut,
                display_order=2,
                quantity=Decimal("100"),
                unit="g",
                preparation_notes="roughly chopped",
            ),
            _ingredient(
                row_id=4_003,
                version_id=base_id,
                catalog=baking_soda,
                display_order=3,
                quantity=Decimal("0.5"),
                unit="tsp",
            ),
        ],
        instructions=[
            _instruction(
                row_id=4_100,
                version_id=base_id,
                display_order=0,
                text="Mix the batter.",
            ),
            _instruction(
                row_id=4_101,
                version_id=base_id,
                display_order=1,
                text="Bake until set.",
            ),
            _instruction(
                row_id=4_102,
                version_id=base_id,
                display_order=2,
                text="Cool completely.",
            ),
        ],
    )
    target = _version(
        version_id=target_id.int,
        version_number=2,
        parent_version_id=base_id,
        ingredients=[
            _ingredient(
                row_id=4_010,
                version_id=target_id,
                catalog=flour,
                display_order=0,
                quantity=Decimal("220.0000"),
                unit="g",
            ),
            _ingredient(
                row_id=4_011,
                version_id=target_id,
                catalog=sugar,
                display_order=1,
                name="Granulated sugar",
                quantity=Decimal("1.25"),
                unit="cup",
                preparation_notes="packed",
            ),
            _ingredient(
                row_id=4_012,
                version_id=target_id,
                catalog=pecan,
                display_order=2,
                quantity=Decimal("1"),
                unit="cup",
                preparation_notes="finely chopped",
            ),
            _ingredient(
                row_id=4_013,
                version_id=target_id,
                catalog=orange_zest,
                display_order=3,
                quantity=Decimal("1"),
                unit="tbsp",
            ),
        ],
        instructions=[
            _instruction(
                row_id=4_110,
                version_id=target_id,
                display_order=0,
                text="Mix the batter.",
            ),
            _instruction(
                row_id=4_111,
                version_id=target_id,
                display_order=1,
                text="Bake gently until set.",
            ),
        ],
    )
    return base, target, {(walnut.id, pecan.id)}


def test_multiple_changes_are_classified_with_fixed_changed_field_order() -> None:
    base, target, substitution_pairs = _multiple_change_versions()

    diff = build_recipe_diff(base, target, substitution_pairs)

    assert [item.canonical_name for item in diff.ingredients.added] == ["Orange zest"]
    assert [item.canonical_name for item in diff.ingredients.removed] == ["Baking soda"]
    assert len(diff.ingredients.modified) == 1
    sugar_change = diff.ingredients.modified[0]
    assert sugar_change.before.display_name == "White sugar"
    assert sugar_change.after.display_name == "Granulated sugar"
    assert sugar_change.changed_fields == [
        "display_name",
        "quantity",
        "unit",
        "preparation_notes",
    ]

    assert len(diff.ingredients.replaced) == 1
    nut_change = diff.ingredients.replaced[0]
    assert nut_change.before.canonical_name == "Walnut"
    assert nut_change.after.canonical_name == "Pecan"
    assert nut_change.changed_fields == [
        "ingredient",
        "display_name",
        "quantity",
        "unit",
        "preparation_notes",
    ]

    assert len(diff.instructions.modified) == 1
    assert diff.instructions.modified[0].before.text == "Bake until set."
    assert diff.instructions.modified[0].after.text == "Bake gently until set."
    assert diff.instructions.modified[0].changed_fields == ["text"]
    assert [item.text for item in diff.instructions.removed] == ["Cool completely."]
    assert diff.instructions.added == []
    assert diff.has_changes is True


def test_only_direct_forward_substitutions_are_replacements() -> None:
    walnut = _catalog_ingredient(50, "Walnut")
    pecan = _catalog_ingredient(51, "Pecan")
    base_id = _id(500)
    target_id = _id(501)
    base = _version(
        version_id=base_id.int,
        version_number=1,
        ingredients=[
            _ingredient(
                row_id=5_000,
                version_id=base_id,
                catalog=walnut,
                display_order=0,
                quantity=Decimal("100"),
                unit="g",
            )
        ],
        instructions=[],
    )
    target = _version(
        version_id=target_id.int,
        version_number=2,
        parent_version_id=base_id,
        ingredients=[
            _ingredient(
                row_id=5_001,
                version_id=target_id,
                catalog=pecan,
                display_order=0,
                quantity=Decimal("100"),
                unit="g",
            )
        ],
        instructions=[],
    )
    directed_edges = {(walnut.id, pecan.id)}

    forward = build_recipe_diff(base, target, directed_edges)
    reverse = build_recipe_diff(target, base, directed_edges)

    assert len(forward.ingredients.replaced) == 1
    assert forward.ingredients.replaced[0].changed_fields == [
        "ingredient",
        "display_name",
    ]
    assert forward.ingredients.added == []
    assert forward.ingredients.removed == []

    assert reverse.ingredients.replaced == []
    assert [item.canonical_name for item in reverse.ingredients.removed] == ["Pecan"]
    assert [item.canonical_name for item in reverse.ingredients.added] == ["Walnut"]


def test_reordered_duplicate_replacements_preserve_equal_nonidentity_content() -> None:
    walnut = _catalog_ingredient(55, "Walnut")
    pecan = _catalog_ingredient(56, "Pecan")
    base_id = _id(550)
    target_id = _id(551)
    base = _version(
        version_id=base_id.int,
        version_number=1,
        ingredients=[
            _ingredient(
                row_id=5_500,
                version_id=base_id,
                catalog=walnut,
                display_order=0,
                quantity=Decimal("1"),
                unit="cup",
                preparation_notes="ground",
            ),
            _ingredient(
                row_id=5_501,
                version_id=base_id,
                catalog=walnut,
                display_order=1,
                quantity=Decimal("2"),
                unit="cup",
                preparation_notes="chopped",
            ),
        ],
        instructions=[],
    )
    target = _version(
        version_id=target_id.int,
        version_number=2,
        parent_version_id=base_id,
        ingredients=[
            _ingredient(
                row_id=5_510,
                version_id=target_id,
                catalog=pecan,
                display_order=0,
                quantity=Decimal("2.0000"),
                unit="cup",
                preparation_notes="chopped",
            ),
            _ingredient(
                row_id=5_511,
                version_id=target_id,
                catalog=pecan,
                display_order=1,
                quantity=Decimal("1.0000"),
                unit="cup",
                preparation_notes="ground",
            ),
        ],
        instructions=[],
    )

    diff = build_recipe_diff(base, target, {(walnut.id, pecan.id)})

    assert diff.ingredients.added == []
    assert diff.ingredients.removed == []
    assert diff.ingredients.modified == []
    assert [
        (
            change.before.quantity,
            change.before.unit,
            change.before.preparation_notes,
            change.after.quantity,
            change.after.unit,
            change.after.preparation_notes,
            change.changed_fields,
        )
        for change in diff.ingredients.replaced
    ] == [
        (
            Decimal("1"),
            "cup",
            "ground",
            Decimal("1.0000"),
            "cup",
            "ground",
            ["ingredient", "display_name"],
        ),
        (
            Decimal("2"),
            "cup",
            "chopped",
            Decimal("2.0000"),
            "cup",
            "chopped",
            ["ingredient", "display_name"],
        ),
    ]


def test_decimal_equivalence_is_unchanged_and_null_transitions_are_explicit() -> None:
    flour = _catalog_ingredient(60, "Flour")
    salt = _catalog_ingredient(61, "Salt")
    base_id = _id(600)
    target_id = _id(601)
    base = _version(
        version_id=base_id.int,
        version_number=1,
        servings=Decimal("4.0"),
        ingredients=[
            _ingredient(
                row_id=6_000,
                version_id=base_id,
                catalog=flour,
                display_order=0,
                quantity=Decimal("1.0"),
                unit="cup",
            ),
            _ingredient(
                row_id=6_001,
                version_id=base_id,
                catalog=salt,
                display_order=1,
                quantity=None,
                unit=None,
            ),
        ],
        instructions=[],
    )
    target = _version(
        version_id=target_id.int,
        version_number=2,
        parent_version_id=base_id,
        servings=Decimal("4.00"),
        ingredients=[
            _ingredient(
                row_id=6_010,
                version_id=target_id,
                catalog=flour,
                display_order=0,
                quantity=Decimal("1.0000"),
                unit="cup",
            ),
            _ingredient(
                row_id=6_011,
                version_id=target_id,
                catalog=salt,
                display_order=1,
                quantity=Decimal("0.5000"),
                unit="tsp",
            ),
        ],
        instructions=[],
    )

    diff = build_recipe_diff(base, target, set())

    assert diff.metadata_changes == []
    assert len(diff.ingredients.modified) == 1
    change = diff.ingredients.modified[0]
    assert change.before.canonical_name == "Salt"
    assert change.before.quantity is None
    assert change.after.quantity == Decimal("0.5000")
    assert change.before.unit is None
    assert change.after.unit == "tsp"
    assert change.changed_fields == ["quantity", "unit"]


def test_output_is_deterministic_when_relationship_collections_are_shuffled() -> None:
    base, target, substitution_pairs = _multiple_change_versions()

    expected = build_recipe_diff(base, target, substitution_pairs).model_dump(mode="json")
    base.ingredients = list(reversed(base.ingredients))
    base.instructions = list(reversed(base.instructions))
    target.ingredients = list(reversed(target.ingredients))
    target.instructions = list(reversed(target.instructions))
    actual = build_recipe_diff(base, target, set(reversed(sorted(substitution_pairs)))).model_dump(
        mode="json"
    )

    assert actual == expected


def test_metadata_changes_use_a_fixed_order_and_contribute_to_has_changes() -> None:
    base = _version(
        version_id=700,
        version_number=1,
        title="Original title",
        description=None,
        servings=Decimal("4.00"),
        ingredients=[],
        instructions=[],
    )
    target = _version(
        version_id=701,
        version_number=2,
        parent_version_id=base.id,
        title="Updated title",
        description="A new description.",
        servings=Decimal("6.00"),
        ingredients=[],
        instructions=[],
    )

    diff = build_recipe_diff(base, target, set())

    assert [change.field for change in diff.metadata_changes] == [
        "title",
        "description",
        "servings",
    ]
    assert [change.model_dump(mode="json") for change in diff.metadata_changes] == [
        {"field": "title", "before": "Original title", "after": "Updated title"},
        {"field": "description", "before": None, "after": "A new description."},
        {"field": "servings", "before": "4.00", "after": "6.00"},
    ]
    _assert_no_content_changes(diff)
    assert diff.has_changes is True


def test_instruction_additions_and_removals_remain_separate_from_ingredient_changes() -> None:
    base_id = _id(800)
    target_id = _id(801)
    base = _version(
        version_id=base_id.int,
        version_number=1,
        ingredients=[],
        instructions=[
            _instruction(
                row_id=8_000,
                version_id=base_id,
                display_order=0,
                text="Mix.",
            )
        ],
    )
    target = _version(
        version_id=target_id.int,
        version_number=2,
        parent_version_id=base_id,
        ingredients=[],
        instructions=[
            _instruction(
                row_id=8_010,
                version_id=target_id,
                display_order=0,
                text="Mix.",
            ),
            _instruction(
                row_id=8_011,
                version_id=target_id,
                display_order=1,
                text="Serve.",
            ),
        ],
    )

    forward = build_recipe_diff(base, target, set())
    reverse = build_recipe_diff(target, base, set())

    assert forward.ingredients.model_dump() == {
        "added": [],
        "removed": [],
        "replaced": [],
        "modified": [],
    }
    assert [item.text for item in forward.instructions.added] == ["Serve."]
    assert forward.instructions.removed == []
    assert forward.instructions.modified == []
    assert [item.text for item in reverse.instructions.removed] == ["Serve."]
    assert reverse.instructions.added == []
    assert reverse.instructions.modified == []
