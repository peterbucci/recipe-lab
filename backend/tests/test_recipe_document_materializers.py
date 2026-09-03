from dataclasses import replace
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from app.models import RecipeDraft
from app.services.recipe_documents import (
    RecipeDocument,
    RecipeDocumentAction,
    RecipeDocumentActionInput,
    RecipeDocumentActionMeasure,
    RecipeDocumentCategory,
    RecipeDocumentIngredient,
    RecipeDocumentIngredientMeasure,
    RecipeDocumentInstruction,
    RecipeDocumentMaterializationError,
    empty_recipe_document,
    materialize_immutable_recipe_document,
    materialize_mutable_recipe_document,
    recipe_structure_from_document,
)
from app.services.recipe_fingerprints import CanonicalUnit


def _document() -> RecipeDocument:
    catalog_id = uuid4()
    request_id = uuid4()
    gram_id = uuid4()
    minute_id = uuid4()
    gram = CanonicalUnit(
        key="g",
        dimension="mass",
        conversion_family="metric-mass",
    )
    minute = CanonicalUnit(
        key="minute",
        dimension="time",
        conversion_family="duration",
    )
    return RecipeDocument(
        title="Materialized soup",
        description=None,
        servings=Decimal("2.50"),
        total_time_minutes=None,
        active_time_minutes=None,
        difficulty=None,
        notes="Keep this optional note.",
        categories=(
            RecipeDocumentCategory(
                category_id=uuid4(),
                name="Dinner",
                slug="dinner",
                display_order=3,
            ),
        ),
        ingredients=(
            RecipeDocumentIngredient(
                ref="catalog-slot",
                selection_kind="catalog",
                ingredient_id=catalog_id,
                ingredient_request_id=None,
                name="Lentils",
                measure=RecipeDocumentIngredientMeasure(
                    mode="exact",
                    quantity_min=Decimal("125.0000"),
                    quantity_max=None,
                    measurement_unit_id=gram_id,
                    unit_display="g",
                    package_size_id=None,
                    canonical_unit=gram,
                ),
                preparation_notes=None,
                display_order=4,
            ),
            RecipeDocumentIngredient(
                ref="request-slot",
                selection_kind="request",
                ingredient_id=None,
                ingredient_request_id=request_id,
                name=None,
                measure=RecipeDocumentIngredientMeasure(
                    mode="to_taste",
                    quantity_min=None,
                    quantity_max=None,
                    measurement_unit_id=None,
                    unit_display=None,
                    package_size_id=None,
                ),
                preparation_notes="Optional unresolved garnish",
                display_order=1,
            ),
        ),
        instructions=(
            RecipeDocumentInstruction(
                ref="instruction-one",
                title=None,
                text="Simmer until tender.",
                actions=(
                    RecipeDocumentAction(
                        ref="action-one",
                        action_type_id=uuid4(),
                        action_type_key="simmer",
                        inputs=(
                            RecipeDocumentActionInput(
                                ingredient_ref="catalog-slot",
                                display_order=7,
                            ),
                        ),
                        measures=(
                            RecipeDocumentActionMeasure(
                                semantic="duration",
                                mode="exact",
                                quantity_min=Decimal("20.000000"),
                                quantity_max=None,
                                measurement_unit_id=minute_id,
                                unit_display="min",
                                canonical_unit=minute,
                            ),
                        ),
                        display_order=5,
                    ),
                ),
                display_order=2,
            ),
        ),
    )


def _draft() -> RecipeDraft:
    return RecipeDraft(
        id=uuid4(),
        author_user_id=uuid4(),
        source_version_id=None,
        status="active",
        revision=1,
        title="Old title",
        description="Old description",
        servings=None,
    )


def test_mutable_materializer_stages_complete_graph_without_a_flush() -> None:
    document = _document()
    draft = _draft()
    with Session() as session:
        rows = materialize_mutable_recipe_document(
            session,
            draft=draft,
            document=document,
        )

        assert draft.title == document.title
        assert draft.description is None
        assert draft.servings == Decimal("2.50")
        assert draft.total_time_minutes is None
        assert [item.display_order for item in rows.categories] == [3]
        assert [item.display_order for item in rows.ingredients] == [4, 1]
        assert [item.display_order for item in rows.instructions] == [2]
        assert [item.display_order for item in rows.actions] == [5]
        assert [item.display_order for item in rows.action_inputs] == [7]
        assert rows.actions[0].recipe_draft_instruction_id == rows.instructions[0].id
        assert rows.action_inputs[0].recipe_draft_instruction_action_id == rows.actions[0].id
        assert rows.action_inputs[0].recipe_draft_ingredient_id == rows.ingredients[0].id
        assert rows.action_measures[0].recipe_draft_instruction_action_id == rows.actions[0].id
        assert rows.ingredients[1].ingredient_request_id == (
            document.ingredients[1].ingredient_request_id
        )
        assert rows.ingredients[1].name is None
        assert all(row.id is not None for row in rows.ingredients)
        assert all(row.id is not None for row in rows.instructions)
        assert all(row.id is not None for row in rows.actions)
        assert all(row.id is not None for row in rows.action_inputs)
        assert len(session.new) == len(rows.all_rows)


def test_immutable_materializer_remaps_same_document_to_fresh_ordered_rows() -> None:
    mutable_document = _document()
    document = replace(mutable_document, ingredients=(mutable_document.ingredients[0],))
    recipe_version_id = uuid4()
    with Session() as session:
        rows = materialize_immutable_recipe_document(
            session,
            recipe_version_id=recipe_version_id,
            document=document,
        )

        assert rows.categories[0].category_name == "Dinner"
        assert rows.categories[0].category_slug == "dinner"
        assert [item.display_order for item in rows.ingredients] == [4]
        assert [item.display_order for item in rows.instructions] == [2]
        assert [item.display_order for item in rows.actions] == [5]
        assert [item.display_order for item in rows.action_inputs] == [7]
        assert rows.actions[0].recipe_instruction_id == rows.instructions[0].id
        assert rows.action_inputs[0].recipe_instruction_action_id == rows.actions[0].id
        assert rows.action_inputs[0].recipe_ingredient_id == rows.ingredients[0].id
        assert rows.action_measures[0].recipe_instruction_action_id == rows.actions[0].id
        assert {item.recipe_version_id for item in rows.ingredients} == {recipe_version_id}
        assert {item.recipe_version_id for item in rows.instructions} == {recipe_version_id}
        assert len(session.new) == len(rows.all_rows)


def test_empty_mutable_document_clears_optional_header_and_stages_no_children() -> None:
    draft = _draft()
    with Session() as session:
        rows = materialize_mutable_recipe_document(
            session,
            draft=draft,
            document=empty_recipe_document(),
        )

        assert rows.all_rows == ()
        assert len(session.new) == 0
        assert draft.title == ""
        assert draft.description is None
        assert draft.servings is None
        assert draft.notes is None


def test_immutable_materializer_rejects_unresolved_ingredients_before_staging() -> None:
    document = _document()
    with Session() as session:
        with pytest.raises(
            RecipeDocumentMaterializationError,
            match="catalog-backed ingredients",
        ):
            materialize_immutable_recipe_document(
                session,
                recipe_version_id=uuid4(),
                document=document,
            )
        assert len(session.new) == 0


def test_pending_materialization_is_removed_by_transaction_rollback() -> None:
    document = _document()
    draft = _draft()
    with Session() as session:
        with pytest.raises(RuntimeError, match="injected failure"):
            with session.begin_nested():
                rows = materialize_mutable_recipe_document(
                    session,
                    draft=draft,
                    document=document,
                )
                assert len(session.new) == len(rows.all_rows)
                raise RuntimeError("injected failure")
        assert len(session.new) == 0


def test_document_structure_preserves_local_order_and_omits_prose() -> None:
    base = _document()
    document = replace(base, ingredients=(base.ingredients[0],))
    structure = recipe_structure_from_document(document)

    assert structure.ingredients[0].occurrence_key == "catalog-slot"
    assert structure.ingredients[0].measure is not None
    assert structure.ingredients[0].measure.quantity_min == Decimal("125.0000")
    assert structure.instructions[0].actions[0].ingredient_occurrence_keys == ("catalog-slot",)
    assert structure.instructions[0].actions[0].duration is not None
    assert structure.instructions[0].actions[0].duration.quantity_min == Decimal("20.000000")
