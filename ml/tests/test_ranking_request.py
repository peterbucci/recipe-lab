from uuid import UUID

import pytest

from recipe_lab_evaluation.models._ranking import validate_ranking_request


def test_valid_ranking_request_returns_the_requested_id_set() -> None:
    first = UUID(int=1)
    second = UUID(int=2)

    requested = validate_ranking_request(
        candidate_ids=(second, first),
        limit=1,
        fitted_recipe_ids={first, second, UUID(int=3)},
    )

    assert requested == frozenset({first, second})


@pytest.mark.parametrize("invalid_limit", [-1, 3, True])
def test_ranking_request_rejects_invalid_limits(invalid_limit: int) -> None:
    with pytest.raises(ValueError, match="candidate count"):
        validate_ranking_request(
            candidate_ids=(UUID(int=1), UUID(int=2)),
            limit=invalid_limit,
            fitted_recipe_ids={UUID(int=1), UUID(int=2)},
        )


def test_ranking_request_rejects_duplicate_and_unknown_candidates() -> None:
    recipe_id = UUID(int=1)
    with pytest.raises(ValueError, match="duplicates"):
        validate_ranking_request(
            candidate_ids=(recipe_id, recipe_id),
            limit=1,
            fitted_recipe_ids={recipe_id},
        )
    with pytest.raises(ValueError, match="outside the fitted catalog"):
        validate_ranking_request(
            candidate_ids=(UUID(int=2),),
            limit=1,
            fitted_recipe_ids={recipe_id},
        )
