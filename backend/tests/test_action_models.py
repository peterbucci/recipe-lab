from decimal import Decimal
from typing import cast
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    CookingActionType,
    Ingredient,
    MeasurementUnit,
    RecipeIngredient,
    RecipeInstruction,
    RecipeInstructionAction,
    RecipeInstructionActionInput,
    RecipeInstructionActionMeasure,
    RecipeLineage,
    RecipeVersion,
    User,
)


def _constraint_name(error: IntegrityError) -> str | None:
    diagnostic = getattr(error.orig, "diag", None)
    return cast(str | None, getattr(diagnostic, "constraint_name", None))


def _version_snapshot(
    session: Session,
    *,
    suffix: str,
) -> tuple[RecipeVersion, RecipeIngredient, RecipeInstruction]:
    user = User(
        email=f"action-model-{suffix}@example.com",
        display_name="Action model test",
    )
    ingredient = Ingredient(canonical_name=f"Action model ingredient {suffix}")
    session.add_all([user, ingredient])
    session.flush()
    lineage = RecipeLineage(created_by_user_id=user.id)
    session.add(lineage)
    session.flush()
    version = RecipeVersion(
        lineage_id=lineage.id,
        parent_version_id=None,
        created_by_user_id=user.id,
        version_number=1,
        title=f"Action model recipe {suffix}",
        description=None,
        servings=Decimal("1.00"),
    )
    session.add(version)
    session.flush()
    recipe_ingredient = RecipeIngredient(
        recipe_version_id=version.id,
        ingredient_id=ingredient.id,
        name=ingredient.canonical_name,
        measure_mode="unspecified",
        quantity_min=None,
        quantity_max=None,
        measurement_unit_id=None,
        unit_display=None,
        package_size_id=None,
        preparation_notes=None,
        display_order=0,
    )
    instruction = RecipeInstruction(
        recipe_version_id=version.id,
        instruction="Mix thoroughly.",
        display_order=0,
    )
    session.add_all([recipe_ingredient, instruction])
    session.flush()
    return version, recipe_ingredient, instruction


def _action_type(session: Session, suffix: str) -> CookingActionType:
    action_type = CookingActionType(
        key=f"model-mix-{suffix}",
        canonical_verb=f"Model mix {suffix}",
        active=True,
        provenance="Reviewed action model-test metadata.",
    )
    session.add(action_type)
    session.flush()
    return action_type


def test_action_input_database_contract_enforces_same_recipe_version(
    db_session: Session,
) -> None:
    suffix = uuid4().hex[:8]
    first_version, first_ingredient, first_instruction = _version_snapshot(
        db_session,
        suffix=f"first-{suffix}",
    )
    _second_version, second_ingredient, second_instruction = _version_snapshot(
        db_session,
        suffix=f"second-{suffix}",
    )
    action_type = _action_type(db_session, suffix)
    cross_version_action = RecipeInstructionAction(
        recipe_version_id=first_version.id,
        recipe_instruction_id=second_instruction.id,
        action_type_id=action_type.id,
        display_order=0,
    )
    with pytest.raises(IntegrityError) as action_error:
        with db_session.begin_nested():
            db_session.add(cross_version_action)
            db_session.flush()
    assert _constraint_name(action_error.value) == (
        "fk_recipe_instruction_actions_instruction_same_version"
    )

    action = RecipeInstructionAction(
        recipe_version_id=first_version.id,
        recipe_instruction_id=first_instruction.id,
        action_type_id=action_type.id,
        display_order=0,
    )
    db_session.add(action)
    db_session.flush()
    valid = RecipeInstructionActionInput(
        recipe_version_id=first_version.id,
        recipe_instruction_action_id=action.id,
        recipe_ingredient_id=first_ingredient.id,
        display_order=0,
    )
    db_session.add(valid)
    db_session.flush()

    invalid = RecipeInstructionActionInput(
        recipe_version_id=first_version.id,
        recipe_instruction_action_id=action.id,
        recipe_ingredient_id=second_ingredient.id,
        display_order=1,
    )
    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            db_session.add(invalid)
            db_session.flush()

    assert _constraint_name(error.value) == (
        "fk_recipe_instruction_action_inputs_ingredient_same_version"
    )


def test_action_and_input_order_are_unique_and_deterministic(db_session: Session) -> None:
    suffix = uuid4().hex[:8]
    version, ingredient, instruction = _version_snapshot(db_session, suffix=suffix)
    action_type = _action_type(db_session, suffix)
    first = RecipeInstructionAction(
        recipe_version_id=version.id,
        recipe_instruction_id=instruction.id,
        action_type_id=action_type.id,
        display_order=0,
    )
    db_session.add(first)
    db_session.flush()

    duplicate_order = RecipeInstructionAction(
        recipe_version_id=version.id,
        recipe_instruction_id=instruction.id,
        action_type_id=action_type.id,
        display_order=0,
    )
    with pytest.raises(IntegrityError) as action_error:
        with db_session.begin_nested():
            db_session.add(duplicate_order)
            db_session.flush()
    assert _constraint_name(action_error.value) == (
        "uq_recipe_instruction_actions_instruction_display_order"
    )

    first_input = RecipeInstructionActionInput(
        recipe_version_id=version.id,
        recipe_instruction_action_id=first.id,
        recipe_ingredient_id=ingredient.id,
        display_order=0,
    )
    db_session.add(first_input)
    db_session.flush()
    duplicate_input = RecipeInstructionActionInput(
        recipe_version_id=version.id,
        recipe_instruction_action_id=first.id,
        recipe_ingredient_id=ingredient.id,
        display_order=1,
    )
    with pytest.raises(IntegrityError) as input_error:
        with db_session.begin_nested():
            db_session.add(duplicate_input)
            db_session.flush()
    assert _constraint_name(input_error.value) == (
        "uq_recipe_instruction_action_inputs_action_ingredient"
    )


def test_action_measure_database_contract_rejects_nonpositive_duration(
    db_session: Session,
) -> None:
    suffix = uuid4().hex[:8]
    version, _ingredient, instruction = _version_snapshot(db_session, suffix=suffix)
    action_type = _action_type(db_session, suffix)
    minute = MeasurementUnit(
        key=f"model-minute-{suffix}",
        dimension="time",
        conversion_family=f"model-time-{suffix}",
        canonical_label=f"model minute {suffix}",
        plural_label=f"model minutes {suffix}",
        symbol=None,
        display_style="word",
        active=True,
        provenance="Reviewed action model-test unit.",
    )
    db_session.add(minute)
    db_session.flush()
    action = RecipeInstructionAction(
        recipe_version_id=version.id,
        recipe_instruction_id=instruction.id,
        action_type_id=action_type.id,
        display_order=0,
    )
    db_session.add(action)
    db_session.flush()

    invalid = RecipeInstructionActionMeasure(
        recipe_instruction_action_id=action.id,
        semantic="duration",
        measure_mode="exact",
        quantity_min=Decimal("0"),
        quantity_max=None,
        measurement_unit_id=minute.id,
        unit_display=minute.canonical_label,
    )
    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            db_session.add(invalid)
            db_session.flush()

    assert _constraint_name(error.value) == (
        "ck_recipe_instruction_action_measures_duration_positive"
    )
