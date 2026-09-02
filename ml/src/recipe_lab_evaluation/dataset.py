from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Literal, cast
from uuid import UUID

from .json_codec import (
    JsonCodecError,
    JsonDocumentLimits,
    decode_json_document,
    load_json_document,
)

SNAPSHOT_SCHEMA_VERSION = "recipe-lab-evaluation-snapshot-v2"
LEGACY_SNAPSHOT_SCHEMA_VERSION = "recipe-lab-evaluation-snapshot-v1"
_SNAPSHOT_JSON_LIMITS = JsonDocumentLimits(
    maximum_utf8_bytes=512 * 1024 * 1024,
    maximum_depth=32,
    maximum_nodes=16_000_000,
)

type EventType = Literal["view", "save", "rating", "fork"]
type MeasureKind = Literal["exact", "range", "qualitative"]
type QualitativeMeasure = Literal["to_taste", "as_needed", "unspecified"]


class SnapshotValidationError(ValueError):
    """Raised when an evaluation snapshot violates the versioned contract."""


@dataclass(frozen=True, slots=True)
class SnapshotIngredientMeasure:
    ingredient_id: UUID
    kind: MeasureKind
    quantity_min: Decimal | None
    quantity_max: Decimal | None
    measurement_unit_id: UUID | None
    package_size_id: UUID | None
    qualitative_value: QualitativeMeasure | None


@dataclass(frozen=True, slots=True)
class SnapshotRecipe:
    id: UUID
    created_at: datetime
    title: str
    version_number: int
    ingredient_measures: tuple[SnapshotIngredientMeasure, ...]
    legacy_ingredient_ids: tuple[UUID, ...] = ()

    @property
    def ingredient_ids(self) -> tuple[UUID, ...]:
        """Return the distinct canonical identities consumed by identity-only models."""

        ingredient_ids = {measure.ingredient_id for measure in self.ingredient_measures}
        ingredient_ids.update(self.legacy_ingredient_ids)
        return tuple(sorted(ingredient_ids, key=lambda ingredient_id: ingredient_id.int))


@dataclass(frozen=True, slots=True)
class SnapshotEvent:
    id: UUID
    user_id: UUID
    recipe_version_id: UUID
    event_type: EventType
    occurred_at: datetime
    saved_value: bool | None
    rating_value: int | None
    related_recipe_version_id: UUID | None


@dataclass(frozen=True, slots=True)
class EvaluationSnapshot:
    schema_version: str
    dataset_id: str
    cutoff: datetime
    limitations: tuple[str, ...]
    recipes: tuple[SnapshotRecipe, ...]
    events: tuple[SnapshotEvent, ...]
    sha256: str


def canonical_json(document: object) -> str:
    """Return the stable JSON representation used for snapshot and report hashes."""

    return json.dumps(
        document,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def _timestamp(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() != timedelta(0):
        raise SnapshotValidationError("snapshot timestamps must use an explicit UTC offset")
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _decimal_text(value: Decimal | None) -> str | None:
    if value is None:
        return None
    normalized = format(value, "f")
    if "." in normalized:
        normalized = normalized.rstrip("0").rstrip(".")
    return normalized or "0"


def _measure_document(measure: SnapshotIngredientMeasure) -> dict[str, object]:
    return {
        "ingredient_id": str(measure.ingredient_id),
        "kind": measure.kind,
        "quantity_min": _decimal_text(measure.quantity_min),
        "quantity_max": _decimal_text(measure.quantity_max),
        "measurement_unit_id": (
            str(measure.measurement_unit_id) if measure.measurement_unit_id is not None else None
        ),
        "package_size_id": (
            str(measure.package_size_id) if measure.package_size_id is not None else None
        ),
        "qualitative_value": measure.qualitative_value,
    }


def _normalized_document(
    *,
    schema_version: str,
    dataset_id: str,
    cutoff: datetime,
    limitations: tuple[str, ...],
    recipes: tuple[SnapshotRecipe, ...],
    events: tuple[SnapshotEvent, ...],
) -> dict[str, object]:
    recipes_document: list[dict[str, object]]
    if schema_version == LEGACY_SNAPSHOT_SCHEMA_VERSION:
        recipes_document = [
            {
                "id": str(recipe.id),
                "created_at": _timestamp(recipe.created_at),
                "title": recipe.title,
                "version_number": recipe.version_number,
                "ingredient_ids": [
                    str(ingredient_id) for ingredient_id in recipe.legacy_ingredient_ids
                ],
            }
            for recipe in recipes
        ]
    else:
        recipes_document = [
            {
                "id": str(recipe.id),
                "created_at": _timestamp(recipe.created_at),
                "title": recipe.title,
                "version_number": recipe.version_number,
                "ingredient_measures": [
                    _measure_document(measure) for measure in recipe.ingredient_measures
                ],
            }
            for recipe in recipes
        ]
    return {
        "schema_version": schema_version,
        "dataset_id": dataset_id,
        "cutoff": _timestamp(cutoff),
        "limitations": list(limitations),
        "recipes": recipes_document,
        "events": [
            {
                "id": str(event.id),
                "user_id": str(event.user_id),
                "recipe_version_id": str(event.recipe_version_id),
                "event_type": event.event_type,
                "occurred_at": _timestamp(event.occurred_at),
                "saved_value": event.saved_value,
                "rating_value": event.rating_value,
                "related_recipe_version_id": (
                    str(event.related_recipe_version_id)
                    if event.related_recipe_version_id is not None
                    else None
                ),
            }
            for event in events
        ],
    }


def _object(value: object, *, path: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise SnapshotValidationError(f"{path} must be an object")
    return cast(dict[str, object], value)


def _exact_keys(
    value: dict[str, object],
    *,
    expected: frozenset[str],
    path: str,
) -> None:
    actual = frozenset(value)
    if actual == expected:
        return
    missing = sorted(expected - actual)
    extra = sorted(actual - expected)
    details: list[str] = []
    if missing:
        details.append(f"missing {missing}")
    if extra:
        details.append(f"unexpected {extra}")
    raise SnapshotValidationError(f"{path} has invalid keys: {', '.join(details)}")


def _string(value: object, *, path: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise SnapshotValidationError(f"{path} must be a non-blank string")
    return value


def _uuid(value: object, *, path: str) -> UUID:
    raw = _string(value, path=path)
    try:
        return UUID(raw)
    except ValueError as error:
        raise SnapshotValidationError(f"{path} must be a UUID") from error


def _utc_datetime(value: object, *, path: str) -> datetime:
    raw = _string(value, path=path)
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as error:
        raise SnapshotValidationError(f"{path} must be an ISO-8601 UTC timestamp") from error
    if parsed.tzinfo is None or parsed.utcoffset() != timedelta(0):
        raise SnapshotValidationError(f"{path} must include an explicit UTC offset")
    return parsed.astimezone(UTC)


def _integer(value: object, *, path: str, minimum: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise SnapshotValidationError(f"{path} must be an integer")
    if minimum is not None and value < minimum:
        raise SnapshotValidationError(f"{path} must be at least {minimum}")
    return value


def _array(value: object, *, path: str) -> list[object]:
    if not isinstance(value, list):
        raise SnapshotValidationError(f"{path} must be an array")
    return cast(list[object], value)


def _optional_bool(value: object, *, path: str) -> bool | None:
    if value is None or isinstance(value, bool):
        return value
    raise SnapshotValidationError(f"{path} must be a boolean or null")


def _optional_rating(value: object, *, path: str) -> int | None:
    if value is None:
        return None
    rating = _integer(value, path=path)
    if not 1 <= rating <= 5:
        raise SnapshotValidationError(f"{path} must be between 1 and 5")
    return rating


def _optional_uuid(value: object, *, path: str) -> UUID | None:
    return None if value is None else _uuid(value, path=path)


def _optional_decimal(value: object, *, path: str) -> Decimal | None:
    if value is None:
        return None
    raw = _string(value, path=path)
    try:
        parsed = Decimal(raw)
    except InvalidOperation as error:
        raise SnapshotValidationError(f"{path} must be a decimal string or null") from error
    if not parsed.is_finite():
        raise SnapshotValidationError(f"{path} must be finite")
    if parsed <= 0:
        raise SnapshotValidationError(f"{path} must be greater than zero")
    return parsed


_TOP_LEVEL_KEYS = frozenset(
    {"schema_version", "dataset_id", "cutoff", "limitations", "recipes", "events"}
)
_RECIPE_V1_KEYS = frozenset({"id", "created_at", "title", "version_number", "ingredient_ids"})
_RECIPE_V2_KEYS = frozenset({"id", "created_at", "title", "version_number", "ingredient_measures"})
_INGREDIENT_MEASURE_KEYS = frozenset(
    {
        "ingredient_id",
        "kind",
        "quantity_min",
        "quantity_max",
        "measurement_unit_id",
        "package_size_id",
        "qualitative_value",
    }
)
_EVENT_KEYS = frozenset(
    {
        "id",
        "user_id",
        "recipe_version_id",
        "event_type",
        "occurred_at",
        "saved_value",
        "rating_value",
        "related_recipe_version_id",
    }
)


def _parse_ingredient_measure(value: object, *, path: str) -> SnapshotIngredientMeasure:
    item = _object(value, path=path)
    _exact_keys(item, expected=_INGREDIENT_MEASURE_KEYS, path=path)
    kind_raw = _string(item["kind"], path=f"{path}.kind")
    if kind_raw not in {"exact", "range", "qualitative"}:
        raise SnapshotValidationError(f"{path}.kind is unsupported")
    kind = cast(MeasureKind, kind_raw)
    quantity_min = _optional_decimal(item["quantity_min"], path=f"{path}.quantity_min")
    quantity_max = _optional_decimal(item["quantity_max"], path=f"{path}.quantity_max")
    measurement_unit_id = _optional_uuid(
        item["measurement_unit_id"], path=f"{path}.measurement_unit_id"
    )
    package_size_id = _optional_uuid(item["package_size_id"], path=f"{path}.package_size_id")
    qualitative_raw = item["qualitative_value"]
    if qualitative_raw is None:
        qualitative_value = None
    else:
        qualitative_text = _string(qualitative_raw, path=f"{path}.qualitative_value")
        if qualitative_text not in {"to_taste", "as_needed", "unspecified"}:
            raise SnapshotValidationError(f"{path}.qualitative_value is unsupported")
        qualitative_value = cast(QualitativeMeasure, qualitative_text)

    valid_shape = (
        (
            kind == "exact"
            and quantity_min is not None
            and quantity_max is None
            and measurement_unit_id is not None
            and qualitative_value is None
        )
        or (
            kind == "range"
            and quantity_min is not None
            and quantity_max is not None
            and quantity_max > quantity_min
            and measurement_unit_id is not None
            and qualitative_value is None
        )
        or (
            kind == "qualitative"
            and quantity_min is None
            and quantity_max is None
            and measurement_unit_id is None
            and package_size_id is None
            and qualitative_value is not None
        )
    )
    if not valid_shape:
        raise SnapshotValidationError(f"{path} fields do not match its kind")
    return SnapshotIngredientMeasure(
        ingredient_id=_uuid(item["ingredient_id"], path=f"{path}.ingredient_id"),
        kind=kind,
        quantity_min=quantity_min,
        quantity_max=quantity_max,
        measurement_unit_id=measurement_unit_id,
        package_size_id=package_size_id,
        qualitative_value=qualitative_value,
    )


def _parse_recipe(value: object, index: int, *, schema_version: str) -> SnapshotRecipe:
    path = f"recipes[{index}]"
    item = _object(value, path=path)
    if schema_version == LEGACY_SNAPSHOT_SCHEMA_VERSION:
        _exact_keys(item, expected=_RECIPE_V1_KEYS, path=path)
        ingredient_values = _array(item["ingredient_ids"], path=f"{path}.ingredient_ids")
        ingredient_ids = tuple(
            _uuid(raw, path=f"{path}.ingredient_ids[{ingredient_index}]")
            for ingredient_index, raw in enumerate(ingredient_values)
        )
        if len(ingredient_ids) != len(set(ingredient_ids)):
            raise SnapshotValidationError(f"{path}.ingredient_ids must not contain duplicates")
        ingredient_measures: tuple[SnapshotIngredientMeasure, ...] = ()
        legacy_ingredient_ids = tuple(
            sorted(ingredient_ids, key=lambda ingredient_id: ingredient_id.int)
        )
    else:
        _exact_keys(item, expected=_RECIPE_V2_KEYS, path=path)
        ingredient_measures = tuple(
            _parse_ingredient_measure(raw, path=f"{path}.ingredient_measures[{measure_index}]")
            for measure_index, raw in enumerate(
                _array(item["ingredient_measures"], path=f"{path}.ingredient_measures")
            )
        )
        legacy_ingredient_ids = ()
    return SnapshotRecipe(
        id=_uuid(item["id"], path=f"{path}.id"),
        created_at=_utc_datetime(item["created_at"], path=f"{path}.created_at"),
        title=_string(item["title"], path=f"{path}.title"),
        version_number=_integer(item["version_number"], path=f"{path}.version_number", minimum=1),
        ingredient_measures=ingredient_measures,
        legacy_ingredient_ids=legacy_ingredient_ids,
    )


def _parse_event(value: object, index: int) -> SnapshotEvent:
    path = f"events[{index}]"
    item = _object(value, path=path)
    _exact_keys(item, expected=_EVENT_KEYS, path=path)
    event_type_raw = _string(item["event_type"], path=f"{path}.event_type")
    if event_type_raw not in {"view", "save", "rating", "fork"}:
        raise SnapshotValidationError(f"{path}.event_type is unsupported")
    event_type = cast(EventType, event_type_raw)
    saved_value = _optional_bool(item["saved_value"], path=f"{path}.saved_value")
    rating_value = _optional_rating(item["rating_value"], path=f"{path}.rating_value")
    related_raw = item["related_recipe_version_id"]
    related_recipe_version_id = (
        None
        if related_raw is None
        else _uuid(related_raw, path=f"{path}.related_recipe_version_id")
    )

    valid_shape = (
        (
            event_type == "view"
            and saved_value is None
            and rating_value is None
            and related_recipe_version_id is None
        )
        or (
            event_type == "save"
            and saved_value is not None
            and rating_value is None
            and related_recipe_version_id is None
        )
        or (
            event_type == "rating"
            and saved_value is None
            and rating_value is not None
            and related_recipe_version_id is None
        )
        or (
            event_type == "fork"
            and saved_value is None
            and rating_value is None
            and related_recipe_version_id is not None
        )
    )
    if not valid_shape:
        raise SnapshotValidationError(f"{path} context does not match its event_type")

    recipe_version_id = _uuid(item["recipe_version_id"], path=f"{path}.recipe_version_id")
    if related_recipe_version_id == recipe_version_id:
        raise SnapshotValidationError(f"{path} fork source and child must differ")
    return SnapshotEvent(
        id=_uuid(item["id"], path=f"{path}.id"),
        user_id=_uuid(item["user_id"], path=f"{path}.user_id"),
        recipe_version_id=recipe_version_id,
        event_type=event_type,
        occurred_at=_utc_datetime(item["occurred_at"], path=f"{path}.occurred_at"),
        saved_value=saved_value,
        rating_value=rating_value,
        related_recipe_version_id=related_recipe_version_id,
    )


def _parse_snapshot_document(raw: object) -> EvaluationSnapshot:
    document = _object(raw, path="snapshot")
    _exact_keys(document, expected=_TOP_LEVEL_KEYS, path="snapshot")

    schema_version = _string(document["schema_version"], path="schema_version")
    if schema_version not in {SNAPSHOT_SCHEMA_VERSION, LEGACY_SNAPSHOT_SCHEMA_VERSION}:
        raise SnapshotValidationError(
            f"unsupported schema_version {schema_version!r}; expected "
            f"{SNAPSHOT_SCHEMA_VERSION!r} or {LEGACY_SNAPSHOT_SCHEMA_VERSION!r}"
        )
    dataset_id = _string(document["dataset_id"], path="dataset_id")
    cutoff = _utc_datetime(document["cutoff"], path="cutoff")

    limitation_values = _array(document["limitations"], path="limitations")
    limitations = tuple(
        sorted(
            _string(value, path=f"limitations[{index}]")
            for index, value in enumerate(limitation_values)
        )
    )
    if not limitations:
        raise SnapshotValidationError("limitations must contain at least one entry")
    if len(limitations) != len(set(limitations)):
        raise SnapshotValidationError("limitations must not contain duplicates")

    recipes = tuple(
        _parse_recipe(value, index, schema_version=schema_version)
        for index, value in enumerate(_array(document["recipes"], path="recipes"))
    )
    recipes_by_id = {recipe.id: recipe for recipe in recipes}
    recipe_ids = frozenset(recipes_by_id)
    if len(recipe_ids) != len(recipes):
        raise SnapshotValidationError("recipe IDs must be unique")

    events = tuple(
        _parse_event(value, index)
        for index, value in enumerate(_array(document["events"], path="events"))
    )
    event_ids = {event.id for event in events}
    if len(event_ids) != len(events):
        raise SnapshotValidationError("event IDs must be unique")
    for index, event in enumerate(events):
        if event.recipe_version_id not in recipe_ids:
            raise SnapshotValidationError(f"events[{index}] references an unknown recipe")
        if recipes_by_id[event.recipe_version_id].created_at > event.occurred_at:
            raise SnapshotValidationError(
                f"events[{index}] occurs before its source recipe was created"
            )
        if (
            event.related_recipe_version_id is not None
            and event.related_recipe_version_id not in recipe_ids
        ):
            raise SnapshotValidationError(f"events[{index}] references an unknown fork child")
        if (
            event.related_recipe_version_id is not None
            and recipes_by_id[event.related_recipe_version_id].created_at > event.occurred_at
        ):
            raise SnapshotValidationError(
                f"events[{index}] occurs before its fork child was created"
            )

    normalized_recipes = tuple(sorted(recipes, key=lambda recipe: recipe.id.int))
    normalized_events = tuple(sorted(events, key=lambda event: (event.occurred_at, event.id.int)))
    normalized_document = _normalized_document(
        schema_version=schema_version,
        dataset_id=dataset_id,
        cutoff=cutoff,
        limitations=limitations,
        recipes=normalized_recipes,
        events=normalized_events,
    )
    return EvaluationSnapshot(
        schema_version=schema_version,
        dataset_id=dataset_id,
        cutoff=cutoff,
        limitations=limitations,
        recipes=normalized_recipes,
        events=normalized_events,
        sha256=hashlib.sha256(canonical_json(normalized_document).encode("utf-8")).hexdigest(),
    )


def parse_snapshot_json(text: str) -> EvaluationSnapshot:
    """Parse and fully validate the strict, versioned evaluation snapshot format."""

    try:
        raw = decode_json_document(
            text,
            limits=_SNAPSHOT_JSON_LIMITS,
            document_name="snapshot",
        )
    except JsonCodecError as error:
        raise SnapshotValidationError(str(error)) from error
    return _parse_snapshot_document(raw)


def load_snapshot(path: str | Path) -> EvaluationSnapshot:
    try:
        raw = load_json_document(
            path,
            limits=_SNAPSHOT_JSON_LIMITS,
            document_name="snapshot",
        )
    except JsonCodecError as error:
        raise SnapshotValidationError(str(error)) from error
    return _parse_snapshot_document(raw)


def create_snapshot(
    *,
    dataset_id: str,
    cutoff: datetime,
    limitations: tuple[str, ...],
    recipes: tuple[SnapshotRecipe, ...],
    events: tuple[SnapshotEvent, ...],
) -> EvaluationSnapshot:
    """Create a validated snapshot from trusted extraction records."""

    if any(recipe.legacy_ingredient_ids for recipe in recipes):
        raise SnapshotValidationError(
            "cannot create a v2 snapshot from legacy ID-only recipes; recapture the "
            "source so structured ingredient measures are available"
        )
    document = _normalized_document(
        schema_version=SNAPSHOT_SCHEMA_VERSION,
        dataset_id=dataset_id,
        cutoff=cutoff,
        limitations=tuple(sorted(limitations)),
        recipes=tuple(sorted(recipes, key=lambda recipe: recipe.id.int)),
        events=tuple(sorted(events, key=lambda event: (event.occurred_at, event.id.int))),
    )
    return parse_snapshot_json(canonical_json(document))


def snapshot_to_json(snapshot: EvaluationSnapshot) -> str:
    document = _normalized_document(
        schema_version=snapshot.schema_version,
        dataset_id=snapshot.dataset_id,
        cutoff=snapshot.cutoff,
        limitations=tuple(sorted(snapshot.limitations)),
        recipes=tuple(sorted(snapshot.recipes, key=lambda recipe: recipe.id.int)),
        events=tuple(sorted(snapshot.events, key=lambda event: (event.occurred_at, event.id.int))),
    )
    return canonical_json(document) + "\n"
