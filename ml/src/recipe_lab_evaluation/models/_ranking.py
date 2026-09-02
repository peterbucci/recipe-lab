from __future__ import annotations

from collections.abc import Collection
from uuid import UUID


def validate_ranking_request(
    *,
    candidate_ids: tuple[UUID, ...],
    limit: int,
    fitted_recipe_ids: Collection[UUID],
) -> frozenset[UUID]:
    """Validate the request shared by every fitted ranking model."""

    if (
        isinstance(limit, bool)
        or not isinstance(limit, int)
        or not 0 <= limit <= len(candidate_ids)
    ):
        raise ValueError("limit must be between zero and the candidate count")
    requested_ids = frozenset(candidate_ids)
    if len(candidate_ids) != len(requested_ids):
        raise ValueError("candidate_ids must not contain duplicates")
    if any(recipe_id not in fitted_recipe_ids for recipe_id in requested_ids):
        raise ValueError("candidate_ids contains a recipe outside the fitted catalog")
    return requested_ids
