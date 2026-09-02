from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from decimal import Decimal

from .dataset import canonical_json

_ENVELOPE_KEYS = frozenset(
    {"schema_version", "protocol_version", "run_id", "status", "reason_codes", "limitations"}
)


def report_envelope(
    *,
    schema_version: str,
    protocol_version: str,
    status: str,
    reason_codes: Sequence[str],
    limitations: Sequence[str],
    payload: Mapping[str, object],
    run_id: str | None = None,
) -> dict[str, object]:
    """Build the shared deterministic envelope used by every aggregate report."""

    collisions = _ENVELOPE_KEYS.intersection(payload)
    if collisions:
        raise ValueError(f"report payload contains envelope keys: {sorted(collisions)!r}")
    document: dict[str, object] = {
        "schema_version": schema_version,
        "protocol_version": protocol_version,
    }
    if run_id is not None:
        document["run_id"] = run_id
    document.update(payload)
    document.update(
        {
            "status": status,
            "reason_codes": list(reason_codes),
            "limitations": list(limitations),
        }
    )
    return document


def decimal_text(value: Decimal | None, *, places: int | None = None) -> str | None:
    if value is None:
        return None
    return format(value, "f" if places is None else f".{places}f")


def utc_timestamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def serialize_report_document(document: Mapping[str, object]) -> str:
    return canonical_json(document) + "\n"


__all__ = [
    "decimal_text",
    "report_envelope",
    "serialize_report_document",
    "utc_timestamp",
]
