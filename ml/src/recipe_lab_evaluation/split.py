from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from .dataset import EvaluationSnapshot, SnapshotEvent, SnapshotRecipe


@dataclass(frozen=True, slots=True)
class UserEvaluationCase:
    user_id: UUID
    candidate_ids: tuple[UUID, ...]
    relevant_ids: frozenset[UUID]


@dataclass(frozen=True, slots=True)
class EvaluationSplitCounts:
    available_recipes: int
    training_events: int
    holdout_events: int
    raw_relevant_items: int
    eligible_relevant_items: int
    eligible_users: int
    filtered_already_interacted: int
    filtered_unavailable: int


@dataclass(frozen=True, slots=True)
class EvaluationSplit:
    cutoff: datetime
    recipes: tuple[SnapshotRecipe, ...]
    training_events: tuple[SnapshotEvent, ...]
    holdout_events: tuple[SnapshotEvent, ...]
    cases: tuple[UserEvaluationCase, ...]
    counts: EvaluationSplitCounts


def _training_interactions(
    events: tuple[SnapshotEvent, ...],
) -> dict[UUID, set[UUID]]:
    interactions: dict[UUID, set[UUID]] = {}
    for event in events:
        user_items = interactions.setdefault(event.user_id, set())
        user_items.add(event.recipe_version_id)
        if event.related_recipe_version_id is not None:
            user_items.add(event.related_recipe_version_id)
    return interactions


def _holdout_relevance(events: tuple[SnapshotEvent, ...]) -> dict[UUID, set[UUID]]:
    fork_sources: set[tuple[UUID, UUID]] = set()
    latest_saves: dict[tuple[UUID, UUID], SnapshotEvent] = {}
    latest_ratings: dict[tuple[UUID, UUID], SnapshotEvent] = {}
    for event in events:
        key = (event.user_id, event.recipe_version_id)
        if event.event_type == "fork":
            fork_sources.add(key)
        elif event.event_type == "save":
            latest_saves[key] = event
        elif event.event_type == "rating":
            latest_ratings[key] = event

    relevant_pairs = set(fork_sources)
    relevant_pairs.update(key for key, event in latest_saves.items() if event.saved_value is True)
    relevant_pairs.update(
        key
        for key, event in latest_ratings.items()
        if event.rating_value is not None and event.rating_value >= 4
    )
    by_user: dict[UUID, set[UUID]] = {}
    for user_id, recipe_version_id in relevant_pairs:
        by_user.setdefault(user_id, set()).add(recipe_version_id)
    return by_user


def split_snapshot(snapshot: EvaluationSnapshot) -> EvaluationSplit:
    """Build one strict temporal split without exposing holdout data to models."""

    ordered_recipes = tuple(sorted(snapshot.recipes, key=lambda recipe: recipe.id.int))
    ordered_events = tuple(
        sorted(snapshot.events, key=lambda event: (event.occurred_at, event.id.int))
    )
    available_recipes = tuple(
        recipe for recipe in ordered_recipes if recipe.created_at < snapshot.cutoff
    )
    available_ids = frozenset(recipe.id for recipe in available_recipes)
    training_events = tuple(
        event for event in ordered_events if event.occurred_at < snapshot.cutoff
    )
    holdout_events = tuple(
        event for event in ordered_events if event.occurred_at >= snapshot.cutoff
    )
    interactions_by_user = _training_interactions(training_events)
    relevance_by_user = _holdout_relevance(holdout_events)

    cases: list[UserEvaluationCase] = []
    raw_relevant_items = 0
    filtered_already_interacted = 0
    filtered_unavailable = 0
    for user_id in sorted(relevance_by_user, key=lambda value: value.int):
        raw_relevance = relevance_by_user[user_id]
        raw_relevant_items += len(raw_relevance)
        interacted = interactions_by_user.get(user_id, set())
        filtered_unavailable += len(raw_relevance - available_ids)
        available_relevance = raw_relevance & available_ids
        filtered_already_interacted += len(available_relevance & interacted)
        relevant = frozenset(available_relevance - interacted)
        candidate_ids = tuple(sorted(available_ids - interacted, key=lambda value: value.int))
        if relevant and candidate_ids:
            cases.append(
                UserEvaluationCase(
                    user_id=user_id,
                    candidate_ids=candidate_ids,
                    relevant_ids=relevant,
                )
            )

    counts = EvaluationSplitCounts(
        available_recipes=len(available_recipes),
        training_events=len(training_events),
        holdout_events=len(holdout_events),
        raw_relevant_items=raw_relevant_items,
        eligible_relevant_items=sum(len(case.relevant_ids) for case in cases),
        eligible_users=len(cases),
        filtered_already_interacted=filtered_already_interacted,
        filtered_unavailable=filtered_unavailable,
    )
    return EvaluationSplit(
        cutoff=snapshot.cutoff,
        recipes=available_recipes,
        training_events=training_events,
        holdout_events=holdout_events,
        cases=tuple(cases),
        counts=counts,
    )
