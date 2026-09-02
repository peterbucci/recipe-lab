"""Frozen catalog contracts used by structured-measure/action migrations.

The snapshots deliberately live with the migration history rather than the current
seed package. Their line-ending-normalized byte digests make accidental edits fail
before a migration can reinterpret historical data.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from functools import lru_cache
from hashlib import sha256
from pathlib import Path
from typing import Any, cast
from uuid import NAMESPACE_URL, UUID, uuid5

_DATA_DIRECTORY = Path(__file__).with_name("data")
_MEASUREMENT_SNAPSHOT = "20260824_0009_measurements.json"
_ACTION_SNAPSHOT = "20260824_0010_actions.json"
_INSTRUCTION_SNAPSHOT = "20260824_0010_instructions.json"
_SNAPSHOT_DIGESTS = {
    _MEASUREMENT_SNAPSHOT: "3523a354c12020010584334c8cb13290c53e91a8575e1cf8ae0e7497fd5e7268",
    _ACTION_SNAPSHOT: "34758fc193c855cc5fa79ff1d06b147b6d918da0a0916aee96305ccd1ce1430f",
    _INSTRUCTION_SNAPSHOT: "7df26cd15d6f66e325ac891c7bfb09607194492f7d2e63dd8d14b30fdcf312d6",
}

_SEED_NAMESPACE = uuid5(
    NAMESPACE_URL,
    "https://github.com/peterbucci/recipe-lab/deterministic-seed-data",
)
_MEASUREMENT_NAMESPACE = uuid5(
    NAMESPACE_URL,
    "https://github.com/peterbucci/recipe-lab/measurement-catalog/v1",
)
_ACTION_NAMESPACE = uuid5(
    NAMESPACE_URL,
    "https://github.com/peterbucci/recipe-lab/action-catalog/v1",
)


def seed_uuid(dataset_id: str, entity_type: str, stable_key: str) -> UUID:
    return uuid5(_SEED_NAMESPACE, f"{dataset_id}:{entity_type}:{stable_key}")


def measurement_uuid(entity_type: str, stable_key: str) -> UUID:
    return uuid5(_MEASUREMENT_NAMESPACE, f"{entity_type}:{stable_key}")


def action_uuid(entity_type: str, stable_key: str) -> UUID:
    return uuid5(_ACTION_NAMESPACE, f"{entity_type}:{stable_key}")


@dataclass(frozen=True, slots=True)
class FrozenMeasurementMetadata:
    version: int
    namespace_url: str
    published_at: datetime


@dataclass(frozen=True, slots=True)
class FrozenMeasurementAlias:
    key: str
    alias: str


@dataclass(frozen=True, slots=True)
class FrozenMeasurementConversion:
    base_unit: str
    scale_numerator: int
    scale_denominator: int
    offset_numerator: int
    offset_denominator: int
    provenance: str


@dataclass(frozen=True, slots=True)
class FrozenMeasurementUnit:
    key: str
    dimension: str
    conversion_family: str
    canonical_label: str
    plural_label: str
    symbol: str | None
    display_style: str
    active: bool
    provenance: str
    aliases: tuple[FrozenMeasurementAlias, ...]
    conversion: FrozenMeasurementConversion | None


@dataclass(frozen=True, slots=True)
class FrozenMeasurementCatalog:
    metadata: FrozenMeasurementMetadata
    units: tuple[FrozenMeasurementUnit, ...]


@dataclass(frozen=True, slots=True)
class FrozenActionMetadata:
    published_at: datetime


@dataclass(frozen=True, slots=True)
class FrozenActionType:
    key: str
    canonical_verb: str
    active: bool
    provenance: str


@dataclass(frozen=True, slots=True)
class FrozenExactActionMeasure:
    value: Decimal
    unit: str


@dataclass(frozen=True, slots=True)
class FrozenRangeActionMeasure:
    minimum: Decimal
    maximum: Decimal
    unit: str


type FrozenActionMeasure = FrozenExactActionMeasure | FrozenRangeActionMeasure


@dataclass(frozen=True, slots=True)
class FrozenAction:
    key: str
    action_type: str
    inputs: tuple[str, ...]
    duration: FrozenActionMeasure | None
    temperature: FrozenActionMeasure | None


@dataclass(frozen=True, slots=True)
class FrozenInstruction:
    key: str
    text: str
    actions: tuple[FrozenAction, ...]


@dataclass(frozen=True, slots=True)
class FrozenRecipe:
    key: str
    instructions: tuple[FrozenInstruction, ...]


@dataclass(frozen=True, slots=True)
class FrozenActionCatalog:
    metadata: FrozenActionMetadata
    action_types: tuple[FrozenActionType, ...]


@dataclass(frozen=True, slots=True)
class FrozenActionBackfillCatalog:
    dataset_id: str
    measurement_catalog: FrozenMeasurementCatalog
    action_catalog: FrozenActionCatalog
    recipes: tuple[FrozenRecipe, ...]


def _load_snapshot(filename: str) -> dict[str, Any]:
    raw = (_DATA_DIRECTORY / filename).read_bytes()
    normalized_raw = raw.replace(b"\r\n", b"\n")
    actual_digest = sha256(normalized_raw).hexdigest()
    expected_digest = _SNAPSHOT_DIGESTS[filename]
    if actual_digest != expected_digest:
        raise RuntimeError(
            f"Frozen migration snapshot {filename!r} changed: "
            f"expected_sha256={expected_digest}, actual_sha256={actual_digest}."
        )
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise RuntimeError(f"Frozen migration snapshot {filename!r} must be a JSON object.")
    return cast(dict[str, Any], payload)


def _parse_datetime(value: object) -> datetime:
    if not isinstance(value, str):
        raise RuntimeError("Frozen catalog timestamp must be a string.")
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _parse_measurement_catalog(payload: dict[str, Any]) -> FrozenMeasurementCatalog:
    metadata = cast(dict[str, Any], payload["metadata"])
    units: list[FrozenMeasurementUnit] = []
    for raw_unit in cast(list[dict[str, Any]], payload["units"]):
        raw_conversion = cast(dict[str, Any] | None, raw_unit.get("conversion"))
        conversion = (
            FrozenMeasurementConversion(
                base_unit=cast(str, raw_conversion["base_unit"]),
                scale_numerator=cast(int, raw_conversion["scale_numerator"]),
                scale_denominator=cast(int, raw_conversion["scale_denominator"]),
                offset_numerator=cast(int, raw_conversion["offset_numerator"]),
                offset_denominator=cast(int, raw_conversion["offset_denominator"]),
                provenance=cast(str, raw_conversion["provenance"]),
            )
            if raw_conversion is not None
            else None
        )
        aliases = tuple(
            FrozenMeasurementAlias(
                key=cast(str, raw_alias["key"]),
                alias=cast(str, raw_alias["alias"]),
            )
            for raw_alias in cast(list[dict[str, Any]], raw_unit["aliases"])
        )
        units.append(
            FrozenMeasurementUnit(
                key=cast(str, raw_unit["key"]),
                dimension=cast(str, raw_unit["dimension"]),
                conversion_family=cast(str, raw_unit["conversion_family"]),
                canonical_label=cast(str, raw_unit["canonical_label"]),
                plural_label=cast(str, raw_unit["plural_label"]),
                symbol=cast(str | None, raw_unit.get("symbol")),
                display_style=cast(str, raw_unit["display_style"]),
                active=cast(bool, raw_unit["active"]),
                provenance=cast(str, raw_unit["provenance"]),
                aliases=aliases,
                conversion=conversion,
            )
        )
    return FrozenMeasurementCatalog(
        metadata=FrozenMeasurementMetadata(
            version=cast(int, metadata["version"]),
            namespace_url=cast(str, metadata["namespace_url"]),
            published_at=_parse_datetime(metadata["published_at"]),
        ),
        units=tuple(units),
    )


def _parse_action_measure(payload: object) -> FrozenActionMeasure | None:
    if payload is None:
        return None
    raw_measure = cast(dict[str, Any], payload)
    kind = raw_measure["kind"]
    if kind == "exact":
        return FrozenExactActionMeasure(
            value=Decimal(cast(str, raw_measure["value"])),
            unit=cast(str, raw_measure["unit"]),
        )
    if kind == "range":
        return FrozenRangeActionMeasure(
            minimum=Decimal(cast(str, raw_measure["minimum"])),
            maximum=Decimal(cast(str, raw_measure["maximum"])),
            unit=cast(str, raw_measure["unit"]),
        )
    raise RuntimeError(f"Unsupported frozen action-measure kind: {kind!r}.")


def _parse_action(payload: dict[str, Any]) -> FrozenAction:
    return FrozenAction(
        key=cast(str, payload["key"]),
        action_type=cast(str, payload["action_type"]),
        inputs=tuple(cast(list[str], payload.get("inputs", []))),
        duration=_parse_action_measure(payload.get("duration")),
        temperature=_parse_action_measure(payload.get("temperature")),
    )


@lru_cache(maxsize=1)
def load_frozen_measurement_catalog() -> FrozenMeasurementCatalog:
    return _parse_measurement_catalog(_load_snapshot(_MEASUREMENT_SNAPSHOT))


@lru_cache(maxsize=1)
def load_frozen_action_backfill_catalog() -> FrozenActionBackfillCatalog:
    actions_payload = _load_snapshot(_ACTION_SNAPSHOT)
    instructions_payload = _load_snapshot(_INSTRUCTION_SNAPSHOT)
    action_metadata = cast(dict[str, Any], actions_payload["metadata"])
    action_types = tuple(
        FrozenActionType(
            key=cast(str, item["key"]),
            canonical_verb=cast(str, item["canonical_verb"]),
            active=cast(bool, item["active"]),
            provenance=cast(str, item["provenance"]),
        )
        for item in cast(list[dict[str, Any]], actions_payload["action_types"])
    )

    mappings: dict[tuple[str, str], tuple[FrozenAction, ...]] = {}
    for item in cast(list[dict[str, Any]], actions_payload["instruction_mappings"]):
        key = (cast(str, item["recipe"]), cast(str, item["instruction"]))
        if key in mappings:
            raise RuntimeError(f"Duplicate frozen action mapping for {key[0]}:{key[1]}.")
        mappings[key] = tuple(
            _parse_action(action) for action in cast(list[dict[str, Any]], item["actions"])
        )

    recipes: list[FrozenRecipe] = []
    expected_mapping_keys: set[tuple[str, str]] = set()
    for raw_recipe in cast(list[dict[str, Any]], instructions_payload["recipes"]):
        recipe_key = cast(str, raw_recipe["key"])
        instructions: list[FrozenInstruction] = []
        for raw_instruction in cast(list[dict[str, Any]], raw_recipe["instructions"]):
            instruction_key = cast(str, raw_instruction["key"])
            mapping_key = (recipe_key, instruction_key)
            expected_mapping_keys.add(mapping_key)
            actions = mappings.get(mapping_key)
            if actions is None:
                raise RuntimeError(
                    f"Missing frozen action mapping for {recipe_key}:{instruction_key}."
                )
            instructions.append(
                FrozenInstruction(
                    key=instruction_key,
                    text=cast(str, raw_instruction["text"]),
                    actions=actions,
                )
            )
        recipes.append(FrozenRecipe(key=recipe_key, instructions=tuple(instructions)))

    unexpected = sorted(mappings.keys() - expected_mapping_keys)
    if unexpected:
        raise RuntimeError(f"Frozen action mappings reference unknown instructions: {unexpected}.")
    return FrozenActionBackfillCatalog(
        dataset_id=cast(str, instructions_payload["dataset_id"]),
        measurement_catalog=load_frozen_measurement_catalog(),
        action_catalog=FrozenActionCatalog(
            metadata=FrozenActionMetadata(
                published_at=_parse_datetime(action_metadata["published_at"])
            ),
            action_types=action_types,
        ),
        recipes=tuple(recipes),
    )
