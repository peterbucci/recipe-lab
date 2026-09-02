from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from math import gcd
from uuid import UUID, uuid5

from .dataset import (
    EvaluationSnapshot,
    EventType,
    SnapshotEvent,
    SnapshotRecipe,
    SnapshotValidationError,
    canonical_json,
    create_snapshot,
    validate_snapshot,
)

SIMULATION_ASSUMPTIONS = (
    "Profiles are opaque synthetic identifiers and do not represent real people.",
    "Training catalog exposure uses a deterministic round-robin; saves and ratings follow "
    "a fixed ingredient-affinity heuristic rather than observed behavior.",
    "Holdout actions are deliberately positive and unseen before the cutoff so temporal "
    "evaluation plumbing can be exercised.",
    "Fork events are not simulated because the catalog snapshot does not encode recipe "
    "lineage and ancestry must not be fabricated.",
    "Synthetic readiness is engineering evidence only and is not evidence of recommendation "
    "quality for real users.",
)

_SIMULATOR_NAMESPACE = UUID("ca0b9c4f-8b8a-5b31-a22c-1e9cc6a462a4")
_DATASET_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\Z")
_MAX_GENERATED_EVENTS = 1_000_000
_PROJECTION_DATASET_ID = "recipe-lab-simulator-available-catalog-v1"
_PROJECTION_LIMITATION = "Internal simulator projection; not an exported activity dataset."


class CohortSimulationError(ValueError):
    """Raised when a catalog or simulator configuration cannot produce a safe cohort."""


@dataclass(frozen=True, slots=True)
class CohortSimulationConfig:
    """Validated controls for one deterministic synthetic preference cohort."""

    seed: int
    profile_count: int = 64
    training_items_per_profile: int = 5
    holdout_items_per_profile: int = 2
    training_window_days: int = 28
    holdout_window_days: int = 7
    dataset_id: str | None = None

    def __post_init__(self) -> None:
        _bounded_integer("seed", self.seed, minimum=0, maximum=(2**63) - 1)
        _bounded_integer("profile_count", self.profile_count, minimum=2, maximum=100_000)
        _bounded_integer(
            "training_items_per_profile",
            self.training_items_per_profile,
            minimum=2,
            maximum=10_000,
        )
        _bounded_integer(
            "holdout_items_per_profile",
            self.holdout_items_per_profile,
            minimum=1,
            maximum=10_000,
        )
        _bounded_integer(
            "training_window_days",
            self.training_window_days,
            minimum=1,
            maximum=3_650,
        )
        _bounded_integer(
            "holdout_window_days",
            self.holdout_window_days,
            minimum=1,
            maximum=365,
        )
        if self.dataset_id is not None and (
            not isinstance(self.dataset_id, str)
            or not _DATASET_ID_PATTERN.fullmatch(self.dataset_id)
        ):
            raise CohortSimulationError(
                "dataset_id must be 1-128 identifier characters: letters, digits, '.', '_', "
                "':' or '-'"
            )
        generated_events = (
            self.profile_count
            * (self.training_items_per_profile + self.holdout_items_per_profile)
            * 2
        )
        if generated_events > _MAX_GENERATED_EVENTS:
            raise CohortSimulationError(
                f"configuration would generate {generated_events} events; "
                f"the safety limit is {_MAX_GENERATED_EVENTS}"
            )


@dataclass(frozen=True, slots=True)
class _EventDraft:
    user_id: UUID
    recipe_version_id: UUID
    event_type: EventType
    saved_value: bool | None = None
    rating_value: int | None = None


def _bounded_integer(name: str, value: int, *, minimum: int, maximum: int) -> None:
    if isinstance(value, bool) or not isinstance(value, int):
        raise CohortSimulationError(f"{name} must be an integer")
    if not minimum <= value <= maximum:
        raise CohortSimulationError(f"{name} must be between {minimum} and {maximum}")


def _config_document(config: CohortSimulationConfig) -> dict[str, object]:
    return {
        "seed": config.seed,
        "profile_count": config.profile_count,
        "training_items_per_profile": config.training_items_per_profile,
        "holdout_items_per_profile": config.holdout_items_per_profile,
        "training_window_days": config.training_window_days,
        "holdout_window_days": config.holdout_window_days,
        "dataset_id": config.dataset_id,
    }


def _digest_int(*parts: object) -> int:
    material = "\0".join(str(part) for part in parts).encode("utf-8")
    return int.from_bytes(hashlib.sha256(material).digest(), byteorder="big")


def _opaque_uuid(run_digest: str, kind: str, index: int) -> UUID:
    name = hashlib.sha256(f"{run_digest}\0{kind}\0{index}".encode()).hexdigest()
    return uuid5(_SIMULATOR_NAMESPACE, name)


def _coprime_stride(item_count: int, *, run_digest: str) -> int:
    candidate = 1 + (_digest_int(run_digest, "catalog-stride") % (item_count - 1))
    while gcd(candidate, item_count) != 1:
        candidate = 1 if candidate + 1 >= item_count else candidate + 1
    return candidate


def _profile_recipe_order(
    recipes: tuple[SnapshotRecipe, ...],
    *,
    profile_index: int,
    training_items_per_profile: int,
    selected_item_count: int,
    run_digest: str,
) -> tuple[SnapshotRecipe, ...]:
    item_count = len(recipes)
    stride = _coprime_stride(item_count, run_digest=run_digest)
    seed_offset = _digest_int(run_digest, "catalog-offset") % item_count
    start = (seed_offset + (profile_index * training_items_per_profile * stride)) % item_count
    return tuple(
        recipes[(start + (position * stride)) % item_count]
        for position in range(selected_item_count)
    )


def _has_ingredient_affinity(anchor: SnapshotRecipe, recipe: SnapshotRecipe) -> bool:
    return bool(frozenset(anchor.ingredient_ids).intersection(recipe.ingredient_ids))


def _training_action(
    *,
    user_id: UUID,
    anchor: SnapshotRecipe,
    recipe: SnapshotRecipe,
    position: int,
    run_digest: str,
) -> _EventDraft:
    affinity = _has_ingredient_affinity(anchor, recipe)
    signal = _digest_int(run_digest, user_id, recipe.id, "training-signal")
    if (signal + position) % 2 == 0:
        saved_value = affinity or signal % 5 != 0
        return _EventDraft(
            user_id=user_id,
            recipe_version_id=recipe.id,
            event_type="save",
            saved_value=saved_value,
        )
    if affinity:
        rating_value = 4 + (signal % 2)
    else:
        rating_value = 2 + (signal % 3)
    return _EventDraft(
        user_id=user_id,
        recipe_version_id=recipe.id,
        event_type="rating",
        rating_value=rating_value,
    )


def _holdout_action(
    *,
    user_id: UUID,
    recipe: SnapshotRecipe,
    position: int,
    run_digest: str,
) -> _EventDraft:
    signal = _digest_int(run_digest, user_id, recipe.id, "holdout-signal")
    if (signal + position) % 2 == 0:
        return _EventDraft(
            user_id=user_id,
            recipe_version_id=recipe.id,
            event_type="save",
            saved_value=True,
        )
    return _EventDraft(
        user_id=user_id,
        recipe_version_id=recipe.id,
        event_type="rating",
        rating_value=4 + (signal % 2),
    )


def _draft_profile_events(
    *,
    recipes: tuple[SnapshotRecipe, ...],
    profile_index: int,
    config: CohortSimulationConfig,
    run_digest: str,
) -> tuple[tuple[_EventDraft, ...], tuple[_EventDraft, ...]]:
    user_id = _opaque_uuid(run_digest, "profile", profile_index)
    ordered = _profile_recipe_order(
        recipes,
        profile_index=profile_index,
        training_items_per_profile=config.training_items_per_profile,
        selected_item_count=(config.training_items_per_profile + config.holdout_items_per_profile),
        run_digest=run_digest,
    )
    training_recipes = ordered[: config.training_items_per_profile]
    holdout_recipes = ordered[
        config.training_items_per_profile : (
            config.training_items_per_profile + config.holdout_items_per_profile
        )
    ]
    anchor = ordered[0]
    training: list[_EventDraft] = []
    holdout: list[_EventDraft] = []
    for position, recipe in enumerate(training_recipes):
        training.append(
            _EventDraft(user_id=user_id, recipe_version_id=recipe.id, event_type="view")
        )
        training.append(
            _training_action(
                user_id=user_id,
                anchor=anchor,
                recipe=recipe,
                position=position,
                run_digest=run_digest,
            )
        )
    for position, recipe in enumerate(holdout_recipes):
        holdout.append(_EventDraft(user_id=user_id, recipe_version_id=recipe.id, event_type="view"))
        holdout.append(
            _holdout_action(
                user_id=user_id,
                recipe=recipe,
                position=position,
                run_digest=run_digest,
            )
        )
    return tuple(training), tuple(holdout)


def _microseconds(delta: timedelta) -> int:
    return ((delta.days * 86_400) + delta.seconds) * 1_000_000 + delta.microseconds


def _training_timestamps(
    *,
    ready_at: datetime,
    cutoff: datetime,
    configured_start: datetime,
    count: int,
) -> tuple[datetime, ...]:
    start = max(ready_at, configured_start)
    span_microseconds = _microseconds(cutoff - start)
    if span_microseconds <= 0:
        raise CohortSimulationError(
            "available recipes must be created before the cutoff to schedule training events"
        )
    return tuple(
        start + timedelta(microseconds=((index + 1) * span_microseconds) // (count + 1))
        for index in range(count)
    )


def _holdout_timestamps(
    *,
    cutoff: datetime,
    holdout_window_days: int,
    count: int,
) -> tuple[datetime, ...]:
    span_microseconds = _microseconds(timedelta(days=holdout_window_days))
    return tuple(
        cutoff + timedelta(microseconds=(index * span_microseconds) // count)
        for index in range(count)
    )


def _configured_training_start(
    *,
    cutoff: datetime,
    training_window_days: int,
    holdout_window_days: int,
) -> datetime:
    try:
        training_start = cutoff - timedelta(days=training_window_days)
        _ = cutoff + timedelta(days=holdout_window_days)
    except OverflowError as error:
        raise CohortSimulationError(
            "catalog cutoff cannot accommodate the configured training and holdout windows"
        ) from error
    return training_start


def _available_catalog_sha256(
    catalog: EvaluationSnapshot,
    available_recipes: tuple[SnapshotRecipe, ...],
) -> str:
    projection = create_snapshot(
        dataset_id=_PROJECTION_DATASET_ID,
        cutoff=catalog.cutoff,
        limitations=(_PROJECTION_LIMITATION,),
        recipes=available_recipes,
        events=(),
    )
    return projection.sha256


def _materialize_events(
    drafts: tuple[_EventDraft, ...],
    timestamps: tuple[datetime, ...],
    *,
    phase: str,
    run_digest: str,
) -> tuple[SnapshotEvent, ...]:
    return tuple(
        SnapshotEvent(
            id=_opaque_uuid(run_digest, f"{phase}-event", index),
            user_id=draft.user_id,
            recipe_version_id=draft.recipe_version_id,
            event_type=draft.event_type,
            occurred_at=timestamps[index],
            saved_value=draft.saved_value,
            rating_value=draft.rating_value,
            related_recipe_version_id=None,
        )
        for index, draft in enumerate(drafts)
    )


def simulate_preference_cohort(
    catalog: EvaluationSnapshot,
    config: CohortSimulationConfig,
) -> EvaluationSnapshot:
    """Generate deterministic, privacy-safe typed events from an immutable catalog snapshot.

    Catalogs with existing events are rejected so recorded and simulated activity can never be
    silently combined. Only recipes created before the cutoff receive events; all catalog rows,
    including future recipes, are retained unchanged in the returned snapshot.
    """

    try:
        normalized_catalog = validate_snapshot(catalog)
    except SnapshotValidationError as error:
        raise CohortSimulationError("catalog snapshot violates the evaluation contract") from error
    if normalized_catalog.events:
        raise CohortSimulationError(
            "catalog snapshot must not contain events; simulated and recorded activity "
            "cannot be mixed"
        )
    available_recipes = tuple(
        recipe
        for recipe in normalized_catalog.recipes
        if recipe.created_at < normalized_catalog.cutoff
    )
    required_items = config.training_items_per_profile + config.holdout_items_per_profile
    if len(available_recipes) < required_items:
        raise CohortSimulationError(
            f"catalog has {len(available_recipes)} recipes available before the cutoff; "
            f"configuration requires at least {required_items}"
        )
    available_recipes = tuple(sorted(available_recipes, key=lambda recipe: recipe.id.int))
    configured_training_start = _configured_training_start(
        cutoff=normalized_catalog.cutoff,
        training_window_days=config.training_window_days,
        holdout_window_days=config.holdout_window_days,
    )

    run_document = {
        "simulator": "recipe-lab-preference-cohort-v1",
        "available_catalog_sha256": _available_catalog_sha256(
            normalized_catalog,
            available_recipes,
        ),
        "config": _config_document(config),
    }
    run_digest = hashlib.sha256(canonical_json(run_document).encode("utf-8")).hexdigest()
    dataset_id = config.dataset_id or f"recipe-lab-simulated-preferences-v1-{run_digest[:16]}"

    training_drafts: list[_EventDraft] = []
    holdout_drafts: list[_EventDraft] = []
    for profile_index in range(config.profile_count):
        profile_training, profile_holdout = _draft_profile_events(
            recipes=available_recipes,
            profile_index=profile_index,
            config=config,
            run_digest=run_digest,
        )
        training_drafts.extend(profile_training)
        holdout_drafts.extend(profile_holdout)

    ready_at = max(recipe.created_at for recipe in available_recipes)
    training_draft_tuple = tuple(training_drafts)
    holdout_draft_tuple = tuple(holdout_drafts)
    training_events = _materialize_events(
        training_draft_tuple,
        _training_timestamps(
            ready_at=ready_at,
            cutoff=normalized_catalog.cutoff,
            configured_start=configured_training_start,
            count=len(training_draft_tuple),
        ),
        phase="training",
        run_digest=run_digest,
    )
    holdout_events = _materialize_events(
        holdout_draft_tuple,
        _holdout_timestamps(
            cutoff=normalized_catalog.cutoff,
            holdout_window_days=config.holdout_window_days,
            count=len(holdout_draft_tuple),
        ),
        phase="holdout",
        run_digest=run_digest,
    )
    limitations = tuple(sorted(set(normalized_catalog.limitations).union(SIMULATION_ASSUMPTIONS)))
    return create_snapshot(
        dataset_id=dataset_id,
        cutoff=normalized_catalog.cutoff,
        limitations=limitations,
        recipes=normalized_catalog.recipes,
        events=training_events + holdout_events,
    )
