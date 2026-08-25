from decimal import Decimal
from uuid import UUID

from app.models import (
    ACTION_PARAMETER_DURATION,
    ACTION_PARAMETER_TEMPERATURE,
    CookingActionType,
    Ingredient,
    MeasurementUnit,
    RecipeIngredient,
    RecipeInstruction,
    RecipeInstructionAction,
    RecipeInstructionActionInput,
    RecipeInstructionActionMeasure,
    RecipeVersion,
)
from app.schemas.measurements import ExactMeasureResponse
from app.schemas.recipe_diffs import RecipeDiffResponse
from app.seeds.identifiers import action_uuid, measurement_uuid
from app.services.recipe_diffs import build_recipe_diff

LINEAGE_ID = UUID(int=1)
AUTHOR_ID = UUID(int=2)


def _id(value: int) -> UUID:
    return UUID(int=value)


def _catalog_ingredient(value: int, canonical_name: str) -> Ingredient:
    return Ingredient(id=_id(value), canonical_name=canonical_name)


def _measurement_unit(key: str) -> MeasurementUnit:
    dimensions = {
        "g": "mass",
        "cup": "volume",
        "tsp": "volume",
        "tbsp": "volume",
        "can": "package",
        "minute": "time",
        "celsius": "temperature",
    }
    labels = {
        "g": ("gram", "grams", "g", "symbol"),
        "cup": ("cup", "cups", "cup", "word"),
        "tsp": ("teaspoon", "teaspoons", "tsp", "symbol"),
        "tbsp": ("tablespoon", "tablespoons", "tbsp", "symbol"),
        "can": ("can", "cans", None, "word"),
        "minute": ("minute", "minutes", "min", "symbol"),
        "celsius": ("degree Celsius", "degrees Celsius", "°C", "symbol"),
    }
    canonical, plural, symbol, display_style = labels[key]
    return MeasurementUnit(
        id=measurement_uuid("unit", key),
        key=key,
        dimension=dimensions[key],
        conversion_family=f"test-{key}",
        canonical_label=canonical,
        plural_label=plural,
        symbol=symbol,
        display_style=display_style,
        active=True,
        provenance="Test fixture.",
    )


def _ingredient(
    *,
    row_id: int,
    version_id: UUID,
    catalog: Ingredient,
    display_order: int,
    name: str | None = None,
    quantity: Decimal | None = None,
    quantity_max: Decimal | None = None,
    unit: str | None = None,
    measure_mode: str | None = None,
    package_size_id: UUID | None = None,
    preparation_notes: str | None = None,
) -> RecipeIngredient:
    measurement_unit = _measurement_unit(unit) if unit is not None else None
    resolved_mode = measure_mode or (
        "range" if quantity_max is not None else "exact" if quantity is not None else "unspecified"
    )
    return RecipeIngredient(
        id=_id(row_id),
        recipe_version_id=version_id,
        ingredient_id=catalog.id,
        ingredient=catalog,
        name=name or catalog.canonical_name,
        measure_mode=resolved_mode,
        quantity_min=quantity,
        quantity_max=quantity_max,
        measurement_unit_id=measurement_unit.id if measurement_unit is not None else None,
        measurement_unit=measurement_unit,
        unit_display=unit,
        package_size_id=package_size_id,
        preparation_notes=preparation_notes,
        display_order=display_order,
    )


def _instruction(
    *,
    row_id: int,
    version_id: UUID,
    display_order: int,
    text: str,
    actions: list[RecipeInstructionAction] | None = None,
) -> RecipeInstruction:
    instruction = RecipeInstruction(
        id=_id(row_id),
        recipe_version_id=version_id,
        instruction=text,
        display_order=display_order,
    )
    instruction.actions = actions or []
    return instruction


def _action_type(key: str) -> CookingActionType:
    return CookingActionType(
        id=action_uuid("action-type", key),
        key=key,
        canonical_verb=key,
        active=True,
        provenance="Test fixture.",
    )


def _action(
    *,
    row_id: int,
    version_id: UUID,
    instruction_id: int,
    display_order: int,
    action_type: CookingActionType,
    inputs: list[RecipeIngredient] | None = None,
    duration: Decimal | None = None,
    temperature: Decimal | None = None,
) -> RecipeInstructionAction:
    action_id = _id(row_id)
    action = RecipeInstructionAction(
        id=action_id,
        recipe_version_id=version_id,
        recipe_instruction_id=_id(instruction_id),
        action_type_id=action_type.id,
        action_type=action_type,
        display_order=display_order,
    )
    action.inputs = [
        RecipeInstructionActionInput(
            id=_id(row_id * 10 + index + 1),
            recipe_version_id=version_id,
            recipe_instruction_action_id=action_id,
            recipe_ingredient_id=ingredient.id,
            display_order=index,
        )
        for index, ingredient in enumerate(inputs or [])
    ]
    measures: list[RecipeInstructionActionMeasure] = []
    if duration is not None:
        unit = _measurement_unit("minute")
        measures.append(
            RecipeInstructionActionMeasure(
                recipe_instruction_action_id=action_id,
                semantic=ACTION_PARAMETER_DURATION,
                measure_mode="exact",
                quantity_min=duration,
                quantity_max=None,
                measurement_unit_id=unit.id,
                measurement_unit=unit,
                unit_display="minute",
            )
        )
    if temperature is not None:
        unit = _measurement_unit("celsius")
        measures.append(
            RecipeInstructionActionMeasure(
                recipe_instruction_action_id=action_id,
                semantic=ACTION_PARAMETER_TEMPERATURE,
                measure_mode="exact",
                quantity_min=temperature,
                quantity_max=None,
                measurement_unit_id=unit.id,
                measurement_unit=unit,
                unit_display="°C",
            )
        )
    action.measures = measures
    return action


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
    mix = _action_type("mix")
    base.instructions[0].actions = [
        _action(
            row_id=1_200,
            version_id=base_id,
            instruction_id=1_100,
            display_order=0,
            action_type=mix,
            inputs=[base.ingredients[0]],
            duration=Decimal("5"),
        )
    ]
    target.instructions[0].actions = [
        _action(
            row_id=2_200,
            version_id=target_id,
            instruction_id=2_100,
            display_order=0,
            action_type=mix,
            inputs=[target.ingredients[0]],
            duration=Decimal("5.0000"),
        )
    ]

    diff = build_recipe_diff(base, target, set())

    assert base.ingredients[0].id != target.ingredients[0].id
    assert base.instructions[0].id != target.instructions[0].id
    assert base.instructions[0].actions[0].id != target.instructions[0].actions[0].id
    assert (
        base.instructions[0].actions[0].inputs[0].id
        != target.instructions[0].actions[0].inputs[0].id
    )
    assert diff.metadata_changes == []
    _assert_no_content_changes(diff)
    assert [item.id for item in diff.ingredient_context.base] == [base.ingredients[0].id]
    assert [item.id for item in diff.ingredient_context.target] == [target.ingredients[0].id]
    assert diff.has_changes is False


def test_package_size_only_change_is_visible_in_measure_snapshots() -> None:
    tomatoes = _catalog_ingredient(11, "Tomatoes")
    base_id = _id(110)
    target_id = _id(111)
    base_package_id = _id(112)
    target_package_id = _id(113)
    base = _version(
        version_id=base_id.int,
        version_number=1,
        ingredients=[
            _ingredient(
                row_id=1_100,
                version_id=base_id,
                catalog=tomatoes,
                display_order=0,
                quantity=Decimal("2"),
                unit="can",
                package_size_id=base_package_id,
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
                row_id=1_101,
                version_id=target_id,
                catalog=tomatoes,
                display_order=0,
                quantity=Decimal("2"),
                unit="can",
                package_size_id=target_package_id,
            )
        ],
        instructions=[],
    )

    diff = build_recipe_diff(base, target, set())

    assert len(diff.ingredients.modified) == 1
    change = diff.ingredients.modified[0]
    assert change.changed_fields == ["measure"]
    assert isinstance(change.before.measure, ExactMeasureResponse)
    assert isinstance(change.after.measure, ExactMeasureResponse)
    assert change.before.measure.package_size_id == base_package_id
    assert change.after.measure.package_size_id == target_package_id


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
    assert change.changed_fields == ["measure"]
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
        "measure",
        "preparation_notes",
    ]

    assert len(diff.ingredients.replaced) == 1
    nut_change = diff.ingredients.replaced[0]
    assert nut_change.before.canonical_name == "Walnut"
    assert nut_change.after.canonical_name == "Pecan"
    assert nut_change.changed_fields == [
        "ingredient",
        "display_name",
        "measure",
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
            change.before.measure.display,
            change.before.preparation_notes,
            change.after.measure.display,
            change.after.preparation_notes,
            change.changed_fields,
        )
        for change in diff.ingredients.replaced
    ] == [
        (
            "1 cup",
            "ground",
            "1 cup",
            "ground",
            ["ingredient", "display_name"],
        ),
        (
            "2 cups",
            "chopped",
            "2 cups",
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
    assert change.before.measure.kind == "qualitative"
    assert change.before.measure.value == "unspecified"
    assert change.after.measure.kind == "exact"
    assert change.after.measure.value == Decimal("0.5000")
    assert change.after.measure.unit.key == "tsp"
    assert change.changed_fields == ["measure"]


def test_exact_to_range_transition_is_one_atomic_measure_change() -> None:
    flour = _catalog_ingredient(65, "Flour")
    base_id = _id(650)
    target_id = _id(651)
    base = _version(
        version_id=base_id.int,
        version_number=1,
        ingredients=[
            _ingredient(
                row_id=6_500,
                version_id=base_id,
                catalog=flour,
                display_order=0,
                quantity=Decimal("1.0000"),
                unit="cup",
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
                row_id=6_501,
                version_id=target_id,
                catalog=flour,
                display_order=0,
                quantity=Decimal("1.0000"),
                quantity_max=Decimal("1.5000"),
                unit="cup",
            )
        ],
        instructions=[],
    )

    diff = build_recipe_diff(base, target, set())

    assert len(diff.ingredients.modified) == 1
    change = diff.ingredients.modified[0]
    assert change.changed_fields == ["measure"]
    assert change.before.measure.kind == "exact"
    assert change.before.measure.display == "1 cup"
    assert change.after.measure.kind == "range"
    assert change.after.measure.minimum == Decimal("1.0000")
    assert change.after.measure.maximum == Decimal("1.5000")
    assert change.after.measure.display == "1–1.5 cups"


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


def test_structured_action_changes_use_granular_fixed_field_order() -> None:
    flour = _catalog_ingredient(90, "Flour")
    salt = _catalog_ingredient(91, "Salt")
    mix = _action_type("mix")
    bake = _action_type("bake")
    base_id = _id(900)
    target_id = _id(901)
    base_ingredients = [
        _ingredient(
            row_id=9_000,
            version_id=base_id,
            catalog=flour,
            display_order=0,
            quantity=Decimal("2"),
            unit="cup",
        ),
        _ingredient(
            row_id=9_001,
            version_id=base_id,
            catalog=salt,
            display_order=1,
            quantity=Decimal("1"),
            unit="tsp",
        ),
    ]
    target_ingredients = [
        _ingredient(
            row_id=9_010,
            version_id=target_id,
            catalog=flour,
            display_order=0,
            quantity=Decimal("2"),
            unit="cup",
        ),
        _ingredient(
            row_id=9_011,
            version_id=target_id,
            catalog=salt,
            display_order=1,
            quantity=Decimal("1"),
            unit="tsp",
        ),
    ]
    base_instruction = _instruction(
        row_id=9_100,
        version_id=base_id,
        display_order=0,
        text="Mix, then bake.",
        actions=[
            _action(
                row_id=9_200,
                version_id=base_id,
                instruction_id=9_100,
                display_order=0,
                action_type=mix,
                inputs=[base_ingredients[0]],
            ),
            _action(
                row_id=9_201,
                version_id=base_id,
                instruction_id=9_100,
                display_order=1,
                action_type=bake,
                inputs=[base_ingredients[0]],
                duration=Decimal("30"),
                temperature=Decimal("180"),
            ),
        ],
    )
    target_instruction = _instruction(
        row_id=9_110,
        version_id=target_id,
        display_order=0,
        text="Mix carefully, then bake.",
        actions=[
            _action(
                row_id=9_210,
                version_id=target_id,
                instruction_id=9_110,
                display_order=1,
                action_type=mix,
                inputs=[target_ingredients[1]],
            ),
            _action(
                row_id=9_211,
                version_id=target_id,
                instruction_id=9_110,
                display_order=0,
                action_type=bake,
                inputs=[target_ingredients[0]],
                duration=Decimal("35"),
                temperature=Decimal("190"),
            ),
        ],
    )
    base = _version(
        version_id=base_id.int,
        version_number=1,
        ingredients=base_ingredients,
        instructions=[base_instruction],
    )
    target = _version(
        version_id=target_id.int,
        version_number=2,
        parent_version_id=base_id,
        ingredients=target_ingredients,
        instructions=[target_instruction],
    )

    diff = build_recipe_diff(base, target, set())

    assert len(diff.instructions.modified) == 1
    assert diff.instructions.modified[0].changed_fields == [
        "text",
        "inputs",
        "action_order",
        "duration",
        "temperature",
    ]
    assert diff.instructions.modified[0].before.actions[0].ingredient_occurrence_ids == [
        base_ingredients[0].id
    ]
    assert diff.instructions.modified[0].after.actions[1].ingredient_occurrence_ids == [
        target_ingredients[1].id
    ]


def test_action_membership_and_action_order_are_distinct_changes() -> None:
    flour = _catalog_ingredient(92, "Flour")
    mix = _action_type("mix")
    bake = _action_type("bake")
    base_id = _id(920)
    reordered_id = _id(921)
    added_id = _id(922)
    base_ingredient = _ingredient(
        row_id=9_200,
        version_id=base_id,
        catalog=flour,
        display_order=0,
        quantity=Decimal("2"),
        unit="cup",
    )
    reordered_ingredient = _ingredient(
        row_id=9_210,
        version_id=reordered_id,
        catalog=flour,
        display_order=0,
        quantity=Decimal("2"),
        unit="cup",
    )
    added_ingredient = _ingredient(
        row_id=9_220,
        version_id=added_id,
        catalog=flour,
        display_order=0,
        quantity=Decimal("2"),
        unit="cup",
    )

    def instruction_with_actions(
        *,
        row_id: int,
        version_id: UUID,
        ingredient: RecipeIngredient,
        action_types: list[CookingActionType],
    ) -> RecipeInstruction:
        return _instruction(
            row_id=row_id,
            version_id=version_id,
            display_order=0,
            text="Prepare the batter.",
            actions=[
                _action(
                    row_id=row_id + 100 + index,
                    version_id=version_id,
                    instruction_id=row_id,
                    display_order=index,
                    action_type=action_type,
                    inputs=[ingredient],
                )
                for index, action_type in enumerate(action_types)
            ],
        )

    base = _version(
        version_id=base_id.int,
        version_number=1,
        ingredients=[base_ingredient],
        instructions=[
            instruction_with_actions(
                row_id=9_300,
                version_id=base_id,
                ingredient=base_ingredient,
                action_types=[mix, bake],
            )
        ],
    )
    reordered = _version(
        version_id=reordered_id.int,
        version_number=2,
        parent_version_id=base_id,
        ingredients=[reordered_ingredient],
        instructions=[
            instruction_with_actions(
                row_id=9_310,
                version_id=reordered_id,
                ingredient=reordered_ingredient,
                action_types=[bake, mix],
            )
        ],
    )
    added = _version(
        version_id=added_id.int,
        version_number=2,
        parent_version_id=base_id,
        ingredients=[added_ingredient],
        instructions=[
            instruction_with_actions(
                row_id=9_320,
                version_id=added_id,
                ingredient=added_ingredient,
                action_types=[mix, bake, _action_type("rest")],
            )
        ],
    )

    reordered_diff = build_recipe_diff(base, reordered, set())
    added_diff = build_recipe_diff(base, added, set())

    assert reordered_diff.instructions.modified[0].changed_fields == ["action_order"]
    assert added_diff.instructions.modified[0].changed_fields == ["actions"]


def test_repeated_ingredient_content_convergence_does_not_change_action_input() -> None:
    salt = _catalog_ingredient(93, "Salt")
    mix = _action_type("mix")
    base_id = _id(930)
    target_id = _id(931)
    base_ingredients = [
        _ingredient(
            row_id=9_300,
            version_id=base_id,
            catalog=salt,
            display_order=0,
            quantity=Decimal("1"),
            unit="tsp",
        ),
        _ingredient(
            row_id=9_301,
            version_id=base_id,
            catalog=salt,
            display_order=1,
            quantity=Decimal("2"),
            unit="tsp",
        ),
    ]
    target_ingredients = [
        _ingredient(
            row_id=9_310,
            version_id=target_id,
            catalog=salt,
            display_order=0,
            quantity=Decimal("2"),
            unit="tsp",
        ),
        _ingredient(
            row_id=9_311,
            version_id=target_id,
            catalog=salt,
            display_order=1,
            quantity=Decimal("2"),
            unit="tsp",
        ),
    ]
    base = _version(
        version_id=base_id.int,
        version_number=1,
        ingredients=base_ingredients,
        instructions=[
            _instruction(
                row_id=9_320,
                version_id=base_id,
                display_order=0,
                text="Mix in the first salt portion.",
                actions=[
                    _action(
                        row_id=9_330,
                        version_id=base_id,
                        instruction_id=9_320,
                        display_order=0,
                        action_type=mix,
                        inputs=[base_ingredients[0]],
                    )
                ],
            )
        ],
    )
    target = _version(
        version_id=target_id.int,
        version_number=2,
        parent_version_id=base_id,
        ingredients=target_ingredients,
        instructions=[
            _instruction(
                row_id=9_321,
                version_id=target_id,
                display_order=0,
                text="Mix in the first salt portion.",
                actions=[
                    _action(
                        row_id=9_331,
                        version_id=target_id,
                        instruction_id=9_321,
                        display_order=0,
                        action_type=mix,
                        inputs=[target_ingredients[0]],
                    )
                ],
            )
        ],
    )

    diff = build_recipe_diff(base, target, set())

    assert [item.changed_fields for item in diff.ingredients.modified] == [["measure"]]
    assert diff.instructions.modified == []


def test_repeated_action_content_convergence_does_not_change_action_order() -> None:
    flour = _catalog_ingredient(94, "Flour")
    mix = _action_type("mix")
    base_id = _id(940)
    target_id = _id(941)
    base_ingredient = _ingredient(
        row_id=9_400,
        version_id=base_id,
        catalog=flour,
        display_order=0,
        quantity=Decimal("2"),
        unit="cup",
    )
    target_ingredient = _ingredient(
        row_id=9_410,
        version_id=target_id,
        catalog=flour,
        display_order=0,
        quantity=Decimal("2"),
        unit="cup",
    )
    base = _version(
        version_id=base_id.int,
        version_number=1,
        ingredients=[base_ingredient],
        instructions=[
            _instruction(
                row_id=9_420,
                version_id=base_id,
                display_order=0,
                text="Mix twice.",
                actions=[
                    _action(
                        row_id=9_430,
                        version_id=base_id,
                        instruction_id=9_420,
                        display_order=0,
                        action_type=mix,
                        inputs=[base_ingredient],
                        duration=Decimal("5"),
                    ),
                    _action(
                        row_id=9_431,
                        version_id=base_id,
                        instruction_id=9_420,
                        display_order=1,
                        action_type=mix,
                        inputs=[base_ingredient],
                        duration=Decimal("10"),
                    ),
                ],
            )
        ],
    )
    target = _version(
        version_id=target_id.int,
        version_number=2,
        parent_version_id=base_id,
        ingredients=[target_ingredient],
        instructions=[
            _instruction(
                row_id=9_421,
                version_id=target_id,
                display_order=0,
                text="Mix twice.",
                actions=[
                    _action(
                        row_id=9_440,
                        version_id=target_id,
                        instruction_id=9_421,
                        display_order=0,
                        action_type=mix,
                        inputs=[target_ingredient],
                        duration=Decimal("10"),
                    ),
                    _action(
                        row_id=9_441,
                        version_id=target_id,
                        instruction_id=9_421,
                        display_order=1,
                        action_type=mix,
                        inputs=[target_ingredient],
                        duration=Decimal("10"),
                    ),
                ],
            )
        ],
    )

    diff = build_recipe_diff(base, target, set())

    assert diff.instructions.modified[0].changed_fields == ["duration"]
