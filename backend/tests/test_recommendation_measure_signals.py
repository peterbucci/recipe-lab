from decimal import Decimal
from uuid import UUID, uuid4

import pytest

from app.models import RecipeIngredient
from app.repositories.recommendations import recommendation_ingredient_measure
from app.services.recommendation_scoring import (
    BaselineCandidate,
    RecommendationIngredientMeasure,
)


def _ingredient(
    *,
    ingredient_id: UUID,
    mode: str,
    minimum: Decimal | None,
    maximum: Decimal | None,
    unit_id: UUID | None,
    package_size_id: UUID | None = None,
) -> RecipeIngredient:
    return RecipeIngredient(
        id=uuid4(),
        recipe_version_id=uuid4(),
        ingredient_id=ingredient_id,
        name="Display text is not a signal",
        measure_mode=mode,
        quantity_min=minimum,
        quantity_max=maximum,
        measurement_unit_id=unit_id,
        unit_display="ignored" if unit_id is not None else None,
        package_size_id=package_size_id,
        preparation_notes=None,
        display_order=0,
    )


def test_storage_adapter_retains_all_structured_measure_shapes() -> None:
    ingredient_id = uuid4()
    unit_id = uuid4()
    package_size_id = uuid4()

    exact = recommendation_ingredient_measure(
        _ingredient(
            ingredient_id=ingredient_id,
            mode="exact",
            minimum=Decimal("1.2500"),
            maximum=None,
            unit_id=unit_id,
            package_size_id=package_size_id,
        )
    )
    ranged = recommendation_ingredient_measure(
        _ingredient(
            ingredient_id=ingredient_id,
            mode="range",
            minimum=Decimal("2.0000"),
            maximum=Decimal("3.5000"),
            unit_id=unit_id,
        )
    )
    qualitative = recommendation_ingredient_measure(
        _ingredient(
            ingredient_id=ingredient_id,
            mode="to_taste",
            minimum=None,
            maximum=None,
            unit_id=None,
        )
    )

    assert exact == RecommendationIngredientMeasure(
        ingredient_id=ingredient_id,
        kind="exact",
        value=Decimal("1.2500"),
        unit_id=unit_id,
        package_size_id=package_size_id,
    )
    assert ranged == RecommendationIngredientMeasure(
        ingredient_id=ingredient_id,
        kind="range",
        minimum=Decimal("2.0000"),
        maximum=Decimal("3.5000"),
        unit_id=unit_id,
    )
    assert qualitative == RecommendationIngredientMeasure(
        ingredient_id=ingredient_id,
        kind="qualitative",
        qualitative_value="to_taste",
    )


def test_baseline_derives_distinct_ids_without_losing_occurrences() -> None:
    ingredient_id = uuid4()
    unit_id = uuid4()
    first = RecommendationIngredientMeasure(
        ingredient_id=ingredient_id,
        kind="exact",
        value=Decimal("1"),
        unit_id=unit_id,
    )
    second = RecommendationIngredientMeasure(
        ingredient_id=ingredient_id,
        kind="range",
        minimum=Decimal("2"),
        maximum=Decimal("3"),
        unit_id=unit_id,
    )
    candidate = BaselineCandidate(
        recipe_version_id=uuid4(),
        title="Occurrence-preserving candidate",
        version_number=1,
        ingredient_measures=(first, second),
        rating_sum=0,
        rating_count=0,
        save_count=0,
        fork_count=0,
        view_count=0,
    )

    assert candidate.ingredient_measures == (first, second)
    assert candidate.ingredient_ids == frozenset({ingredient_id})
    assert candidate.legacy_ingredient_ids == frozenset()


def test_measure_signal_rejects_incomplete_or_mixed_shapes() -> None:
    with pytest.raises(ValueError, match="invalid structured shape"):
        RecommendationIngredientMeasure(
            ingredient_id=uuid4(),
            kind="exact",
            value=Decimal("1"),
            unit_id=None,
        )
    with pytest.raises(ValueError, match="invalid structured shape"):
        RecommendationIngredientMeasure(
            ingredient_id=uuid4(),
            kind="qualitative",
            unit_id=uuid4(),
            qualitative_value="as_needed",
        )
