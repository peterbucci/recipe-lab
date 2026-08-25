"""Read-only audit of legacy recipe quantities before structured-measure migration."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tempfile
from collections import Counter
from collections.abc import Mapping
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from sqlalchemy import Connection, text
from sqlalchemy.exc import SQLAlchemyError

from app.seeds.catalog import load_bundled_catalog
from app.seeds.identifiers import measurement_uuid
from app.seeds.schema import MeasurementCatalogSeed, MeasurementUnitSeed

AUDIT_SCHEMA_VERSION = 1
MAX_MIGRATION_EXAMPLES = 10
INGREDIENT_MEASUREMENT_DIMENSIONS = frozenset({"mass", "volume", "count", "package"})


class MeasurementAuditError(RuntimeError):
    """Raised when the database cannot be audited safely."""


def normalize_legacy_unit(value: str) -> str:
    """Normalize only case and outer whitespace; never guess at punctuation."""

    return value.strip().lower()


def _catalog() -> MeasurementCatalogSeed:
    return load_bundled_catalog().measurement_catalog


def _lookup_tokens(unit: MeasurementUnitSeed) -> set[str]:
    values = {
        unit.key,
        unit.canonical_label,
        unit.plural_label,
        *(alias.alias for alias in unit.aliases),
    }
    if unit.symbol is not None:
        values.add(unit.symbol)
    return {normalize_legacy_unit(value) for value in values}


def _catalog_lookup(
    catalog: MeasurementCatalogSeed,
) -> tuple[dict[str, MeasurementUnitSeed], dict[str, tuple[str, ...]], str]:
    units_by_key = {unit.key: unit for unit in catalog.units}
    token_owners: dict[str, set[str]] = {}
    for unit in catalog.units:
        for token in _lookup_tokens(unit):
            token_owners.setdefault(token, set()).add(unit.key)
    lookup = {token: tuple(sorted(owners)) for token, owners in token_owners.items()}
    digest_payload = {
        "namespace_url": catalog.metadata.namespace_url,
        "units": [
            {
                "active": unit.active,
                "id": str(measurement_uuid("unit", unit.key)),
                "key": unit.key,
                "tokens": sorted(_lookup_tokens(unit)),
            }
            for unit in sorted(catalog.units, key=lambda item: item.key)
        ],
    }
    digest = hashlib.sha256(
        json.dumps(digest_payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return units_by_key, lookup, digest


def _database_columns(connection: Connection) -> set[str]:
    return set(
        connection.scalars(
            text(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = 'recipe_version_ingredients'
                """
            )
        )
    )


def _decimal_text(value: object) -> str | None:
    if value is None:
        return None
    try:
        decimal_value = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return str(value)
    return format(decimal_value, "f")


def _reason_action(reason: str) -> str:
    return {
        "ambiguous_unit_label": "Replace the legacy unit with one unambiguous catalog key.",
        "blank_unit_label": "Supply a curated unit key or clear both quantity and unit.",
        "incompatible_unit_dimension": (
            "Replace the time or temperature unit with a curated ingredient-amount unit."
        ),
        "inactive_unit_label": "Replace the inactive unit with an active catalog key.",
        "invalid_quantity": "Replace the quantity with a positive finite decimal.",
        "missing_unit_label": "Supply a curated unit key or clear both quantity and unit.",
        "quantity_missing": "Supply a positive quantity or clear the unit.",
        "unknown_unit_label": "Map the legacy label to a curated unit key explicitly.",
    }[reason]


def _classify_row(
    row: Mapping[str, Any],
    *,
    units_by_key: Mapping[str, MeasurementUnitSeed],
    lookup: Mapping[str, tuple[str, ...]],
) -> tuple[str, str | None, str | None]:
    quantity = row["quantity"]
    raw_unit = row["unit"]
    if quantity is None and raw_unit is None:
        return "unspecified", None, None
    if quantity is None:
        return "unresolved", "quantity_missing", normalize_legacy_unit(str(raw_unit))

    try:
        decimal_quantity = Decimal(str(quantity))
    except (InvalidOperation, ValueError):
        return "unresolved", "invalid_quantity", None
    if not decimal_quantity.is_finite() or decimal_quantity <= 0:
        return "unresolved", "invalid_quantity", None

    if raw_unit is None:
        return "unresolved", "missing_unit_label", None
    normalized = normalize_legacy_unit(str(raw_unit))
    if not normalized:
        return "unresolved", "blank_unit_label", normalized
    owners = lookup.get(normalized, ())
    if not owners:
        return "unresolved", "unknown_unit_label", normalized
    if len(owners) != 1:
        return "unresolved", "ambiguous_unit_label", normalized
    if not units_by_key[owners[0]].active:
        return "unresolved", "inactive_unit_label", normalized
    if units_by_key[owners[0]].dimension not in INGREDIENT_MEASUREMENT_DIMENSIONS:
        return "unresolved", "incompatible_unit_dimension", normalized
    return "exact", owners[0], normalized


def build_legacy_measurement_audit(connection: Connection) -> dict[str, Any]:
    """Return a deterministic, safe report without modifying the database."""

    catalog = _catalog()
    units_by_key, lookup, mapping_digest = _catalog_lookup(catalog)
    columns = _database_columns(connection)
    if not columns:
        raise MeasurementAuditError("recipe_version_ingredients table does not exist")
    if {"quantity", "unit"} <= columns:
        schema_state = "legacy"
    elif {"measure_mode", "quantity_min", "unit_display"} <= columns:
        schema_state = "structured"
    else:
        raise MeasurementAuditError(
            "recipe_version_ingredients has neither the supported legacy nor structured shape"
        )

    rows: list[Mapping[str, Any]] = []
    if schema_state == "legacy":
        rows = [
            dict(row)
            for row in connection.execute(
                text(
                    """
                    SELECT
                        rvi.id,
                        rvi.recipe_version_id,
                        rvi.ingredient_id,
                        rvi.name,
                        rvi.display_order,
                        rvi.quantity,
                        rvi.unit,
                        rv.lineage_id,
                        rv.title AS recipe_title,
                        rv.version_number
                    FROM recipe_version_ingredients AS rvi
                    JOIN recipe_versions AS rv ON rv.id = rvi.recipe_version_id
                    ORDER BY rvi.recipe_version_id, rvi.display_order, rvi.id
                    """
                )
            ).mappings()
        ]

    exact = 0
    unspecified = 0
    unit_counts: Counter[str] = Counter()
    reason_counts: Counter[str] = Counter()
    unresolved: list[dict[str, Any]] = []
    for row in rows:
        classification, detail, normalized = _classify_row(
            row,
            units_by_key=units_by_key,
            lookup=lookup,
        )
        if classification == "exact":
            exact += 1
            assert detail is not None
            unit_counts[detail] += 1
            continue
        if classification == "unspecified":
            unspecified += 1
            continue

        assert detail is not None
        reason_counts[detail] += 1
        unresolved.append(
            {
                "display_order": row["display_order"],
                "ingredient_id": str(row["ingredient_id"]),
                "ingredient_name": row["name"],
                "legacy_quantity": _decimal_text(row["quantity"]),
                "legacy_unit": row["unit"],
                "lineage_id": str(row["lineage_id"]),
                "normalized_unit": normalized,
                "reason": detail,
                "recipe_title": row["recipe_title"],
                "recipe_version_id": str(row["recipe_version_id"]),
                "recipe_version_number": row["version_number"],
                "row_id": str(row["id"]),
                "suggested_action": _reason_action(detail),
            }
        )

    unresolved.sort(
        key=lambda item: (
            item["recipe_version_id"],
            item["display_order"],
            item["row_id"],
        )
    )
    return {
        "measurement_catalog_version": catalog.metadata.version,
        "measurement_mapping_digest": mapping_digest,
        "schema_state": schema_state,
        "schema_version": AUDIT_SCHEMA_VERSION,
        "summary": {
            "exact_rows": exact,
            "reason_counts": dict(sorted(reason_counts.items())),
            "total_rows": len(rows),
            "unresolved_rows": len(unresolved),
            "unspecified_rows": unspecified,
        },
        "unit_mappings": [
            {
                "measurement_unit_id": str(measurement_uuid("unit", key)),
                "rows": count,
                "unit_key": key,
            }
            for key, count in sorted(unit_counts.items())
        ],
        "unresolved": unresolved,
    }


def canonical_audit_json(report: Mapping[str, Any]) -> str:
    return (
        json.dumps(
            report,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        + "\n"
    )


def bounded_migration_failure(report: Mapping[str, Any]) -> str:
    summary = report["summary"]
    unresolved = report["unresolved"]
    assert isinstance(summary, Mapping)
    assert isinstance(unresolved, list)
    examples = [str(item["row_id"]) for item in unresolved[:MAX_MIGRATION_EXAMPLES]]
    return (
        "structured-measure migration refused unresolved legacy rows: "
        f"count={summary['unresolved_rows']}, reasons={summary['reason_counts']}, "
        f"example_row_ids={examples}. Run "
        "`recipe-lab-measurements audit-legacy --format json` for the safe full report."
    )


def _write_output(path: Path, payload: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            handle.write(payload)
            temporary_path = Path(handle.name)
        temporary_path.replace(path)
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Audit legacy Recipe Lab measurements.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    audit = subparsers.add_parser(
        "audit-legacy",
        help="Produce a deterministic read-only legacy quantity/unit report.",
    )
    audit.add_argument("--format", choices=("json",), default="json")
    audit.add_argument("--output", type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        from app.db.session import engine

        with engine.connect() as connection:
            report = build_legacy_measurement_audit(connection)
        payload = canonical_audit_json(report)
        if args.output is None:
            sys.stdout.write(payload)
        else:
            _write_output(args.output, payload)
        return 2 if report["summary"]["unresolved_rows"] else 0
    except (MeasurementAuditError, OSError, SQLAlchemyError) as error:
        print(f"Measurement audit failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
