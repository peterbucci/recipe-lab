from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Literal, cast
from uuid import UUID

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import Connection, make_url
from sqlalchemy.exc import ArgumentError

from ..dataset import (
    SNAPSHOT_SCHEMA_VERSION,
    DeclaredChangeReason,
    EvaluationSnapshot,
    MeasureKind,
    QualitativeMeasure,
    RecipeRelationKind,
    SnapshotEvent,
    SnapshotIngredientMeasure,
    SnapshotRecipe,
    SnapshotStructuralFingerprint,
    create_snapshot,
)

type EventType = Literal["view", "save", "rating", "fork"]

_ELIGIBLE_RECIPE_VERSIONS_CTE = """
    WITH eligible_recipe_versions AS (
        SELECT version.id
        FROM recipe_versions AS version
        JOIN recipe_version_publications AS publication
            ON publication.recipe_version_id = version.id
        JOIN recipe_editions AS edition
            ON edition.recipe_version_id = version.id
        WHERE publication.state = 'published'
            AND (
                publication.published_at > :cutoff
                OR (
                    SELECT visibility.state
                    FROM recipe_version_visibility_events AS visibility
                    WHERE visibility.recipe_version_id = version.id
                        AND visibility.occurred_at <= :cutoff
                    ORDER BY visibility.occurred_at DESC, visibility.id DESC
                    LIMIT 1
                ) = 'published'
            )
    )
"""


class SnapshotExportError(RuntimeError):
    """Raised when a database cannot provide the required snapshot semantics."""


def _utc(value: datetime, *, field: str) -> datetime:
    offset = value.utcoffset()
    if value.tzinfo is None or offset is None:
        raise SnapshotExportError(f"database returned a timezone-naive {field}")
    return value.astimezone(UTC)


def _event_type(value: str) -> EventType:
    if value not in {"view", "save", "rating", "fork"}:
        raise SnapshotExportError("database returned an unsupported preference event type")
    return cast(EventType, value)


def _recipe_relation(
    *,
    recipe_version_id: UUID,
    edition_number: int,
    parent_version_id: UUID | None,
    previous_recipe_version_id: UUID | None,
    declared_change_reason: str | None,
) -> tuple[RecipeRelationKind, UUID | None, DeclaredChangeReason | None]:
    """Derive governed semantics from immutable topology, never from user activity."""

    if edition_number == 1 and previous_recipe_version_id is None:
        if declared_change_reason is not None:
            raise SnapshotExportError(
                "database returned a declared revision reason for an initial edition"
            )
        if parent_version_id is None:
            return "original", None, None
        if parent_version_id == recipe_version_id:
            raise SnapshotExportError("database returned a self-referential adaptation")
        return "adaptation", parent_version_id, None
    if edition_number > 1 and parent_version_id is None and previous_recipe_version_id is not None:
        if previous_recipe_version_id == recipe_version_id:
            raise SnapshotExportError("database returned a self-referential revision")
        if declared_change_reason not in {None, "correction", "update"}:
            raise SnapshotExportError("database returned an unsupported declared revision reason")
        return (
            "revision",
            previous_recipe_version_id,
            cast(DeclaredChangeReason | None, declared_change_reason),
        )
    raise SnapshotExportError("database returned an invalid stable recipe edition topology")


def _ingredient_measure(
    *,
    ingredient_id: UUID,
    measure_mode: str,
    quantity_min: Decimal | None,
    quantity_max: Decimal | None,
    measurement_unit_id: UUID | None,
    package_size_id: UUID | None,
) -> SnapshotIngredientMeasure:
    if measure_mode in {"exact", "range"}:
        return SnapshotIngredientMeasure(
            ingredient_id=ingredient_id,
            kind=cast(MeasureKind, measure_mode),
            quantity_min=quantity_min,
            quantity_max=quantity_max,
            measurement_unit_id=measurement_unit_id,
            package_size_id=package_size_id,
            qualitative_value=None,
        )
    if measure_mode in {"to_taste", "as_needed", "unspecified"}:
        return SnapshotIngredientMeasure(
            ingredient_id=ingredient_id,
            kind="qualitative",
            quantity_min=None,
            quantity_max=None,
            measurement_unit_id=None,
            package_size_id=None,
            qualitative_value=cast(QualitativeMeasure, measure_mode),
        )
    raise SnapshotExportError("database returned an unsupported ingredient measure mode")


def _extract_from_connection(
    connection: Connection,
    *,
    cutoff: datetime,
) -> tuple[tuple[SnapshotRecipe, ...], tuple[SnapshotEvent, ...]]:
    parameters = {"cutoff": cutoff}
    recipe_rows = connection.execute(
        text(
            _ELIGIBLE_RECIPE_VERSIONS_CTE
            + """
            SELECT
                version.id,
                edition.recipe_id,
                version.created_at,
                publication.published_at,
                version.title,
                version.version_number,
                edition.edition_number,
                version.parent_version_id,
                edition.previous_recipe_version_id,
                edition.declared_change_reason
            FROM eligible_recipe_versions AS eligible
            JOIN recipe_versions AS version ON version.id = eligible.id
            JOIN recipe_version_publications AS publication
                ON publication.recipe_version_id = version.id
            JOIN recipe_editions AS edition
                ON edition.recipe_version_id = version.id
            ORDER BY version.id
            """
        ),
        parameters,
    ).all()
    ingredient_rows = connection.execute(
        text(
            _ELIGIBLE_RECIPE_VERSIONS_CTE
            + """
            SELECT
                ingredient.recipe_version_id,
                ingredient.ingredient_id,
                ingredient.measure_mode,
                ingredient.quantity_min,
                ingredient.quantity_max,
                ingredient.measurement_unit_id,
                ingredient.package_size_id,
                ingredient.display_order,
                ingredient.id
            FROM recipe_version_ingredients AS ingredient
            JOIN eligible_recipe_versions AS eligible
                ON eligible.id = ingredient.recipe_version_id
            ORDER BY
                ingredient.recipe_version_id,
                ingredient.display_order,
                ingredient.id
            """
        ),
        parameters,
    ).all()
    fingerprint_rows = connection.execute(
        text(
            _ELIGIBLE_RECIPE_VERSIONS_CTE
            + """
            SELECT
                fingerprint.recipe_version_id,
                fingerprint.algorithm_version,
                fingerprint.digest
            FROM recipe_structural_fingerprints AS fingerprint
            JOIN eligible_recipe_versions AS eligible
                ON eligible.id = fingerprint.recipe_version_id
            ORDER BY fingerprint.recipe_version_id, fingerprint.algorithm_version
            """
        ),
        parameters,
    ).all()
    event_rows = connection.execute(
        text(
            _ELIGIBLE_RECIPE_VERSIONS_CTE
            + """
            SELECT
                event.id,
                event.user_id,
                event.recipe_version_id,
                event.event_type,
                event.occurred_at,
                event.saved_value,
                event.rating_value,
                event.related_recipe_version_id
            FROM preference_events AS event
            JOIN users AS actor ON actor.id = event.user_id
            JOIN eligible_recipe_versions AS source
                ON source.id = event.recipe_version_id
            JOIN recipe_version_publications AS source_publication
                ON source_publication.recipe_version_id = source.id
            LEFT JOIN eligible_recipe_versions AS child
                ON child.id = event.related_recipe_version_id
            LEFT JOIN recipe_version_publications AS child_publication
                ON child_publication.recipe_version_id = child.id
            LEFT JOIN recipe_versions AS child_version
                ON child_version.id = child.id
            LEFT JOIN recipe_editions AS source_edition
                ON source_edition.recipe_version_id = source.id
            LEFT JOIN recipe_editions AS child_edition
                ON child_edition.recipe_version_id = child.id
            WHERE actor.status = 'active'
                AND actor.account_kind = 'member'
                AND event.occurred_at >= source_publication.published_at
                AND (
                    event.event_type <> 'fork'
                    OR (
                        child.id IS NOT NULL
                        AND event.occurred_at >= child_publication.published_at
                        AND child_edition.relation_kind = 'adaptation'
                        AND child_edition.edition_number = 1
                        AND child_edition.previous_recipe_version_id IS NULL
                        AND child_edition.recipe_id <> source_edition.recipe_id
                        AND child_version.parent_version_id = event.recipe_version_id
                    )
                )
            ORDER BY event.occurred_at, event.id
            """
        ),
        parameters,
    ).all()

    measures_by_recipe: defaultdict[UUID, list[SnapshotIngredientMeasure]] = defaultdict(list)
    for (
        recipe_version_id,
        ingredient_id,
        measure_mode,
        quantity_min,
        quantity_max,
        measurement_unit_id,
        package_size_id,
        _display_order,
        _recipe_ingredient_id,
    ) in ingredient_rows:
        measures_by_recipe[recipe_version_id].append(
            _ingredient_measure(
                ingredient_id=ingredient_id,
                measure_mode=measure_mode,
                quantity_min=quantity_min,
                quantity_max=quantity_max,
                measurement_unit_id=measurement_unit_id,
                package_size_id=package_size_id,
            )
        )

    fingerprints_by_recipe: defaultdict[UUID, list[SnapshotStructuralFingerprint]] = defaultdict(
        list
    )
    for recipe_version_id, algorithm_version, digest in fingerprint_rows:
        fingerprints_by_recipe[recipe_version_id].append(
            SnapshotStructuralFingerprint(
                algorithm_version=algorithm_version,
                digest=digest,
            )
        )

    recipes_list: list[SnapshotRecipe] = []
    for (
        recipe_version_id,
        stable_recipe_id,
        created_at,
        published_at,
        title,
        version_number,
        edition_number,
        parent_version_id,
        previous_recipe_version_id,
        declared_change_reason,
    ) in recipe_rows:
        relation_kind, base_recipe_version_id, governed_reason = _recipe_relation(
            recipe_version_id=recipe_version_id,
            edition_number=edition_number,
            parent_version_id=parent_version_id,
            previous_recipe_version_id=previous_recipe_version_id,
            declared_change_reason=declared_change_reason,
        )
        recipes_list.append(
            SnapshotRecipe(
                id=recipe_version_id,
                recipe_id=stable_recipe_id,
                created_at=_utc(created_at, field="recipe created_at"),
                published_at=_utc(published_at, field="recipe published_at"),
                title=title,
                version_number=version_number,
                edition_number=edition_number,
                base_recipe_version_id=base_recipe_version_id,
                relation_kind=relation_kind,
                declared_change_reason=governed_reason,
                structural_fingerprints=tuple(fingerprints_by_recipe[recipe_version_id]),
                ingredient_measures=tuple(measures_by_recipe[recipe_version_id]),
            )
        )
    recipes = tuple(recipes_list)
    events = tuple(
        SnapshotEvent(
            id=event_id,
            user_id=user_id,
            recipe_version_id=recipe_version_id,
            event_type=_event_type(event_type),
            occurred_at=_utc(occurred_at, field="event occurred_at"),
            saved_value=saved_value,
            rating_value=rating_value,
            related_recipe_version_id=related_recipe_version_id,
        )
        for (
            event_id,
            user_id,
            recipe_version_id,
            event_type,
            occurred_at,
            saved_value,
            rating_value,
            related_recipe_version_id,
        ) in event_rows
    )
    return recipes, events


def _extract(
    engine: Engine,
    *,
    cutoff: datetime,
) -> tuple[tuple[SnapshotRecipe, ...], tuple[SnapshotEvent, ...]]:
    if engine.dialect.name != "postgresql":
        raise SnapshotExportError("snapshot export requires PostgreSQL")

    # Every query runs in one point-in-time PostgreSQL snapshot. Eligibility is applied in
    # SQL before private events or withdrawn content are materialized in the exporter.
    # Request fingerprints, user profile data, recipe prose beyond the already-governed
    # title, canonical fingerprint payloads, and ingredient display text never leave the
    # database.
    with engine.connect().execution_options(isolation_level="REPEATABLE READ") as connection:
        with connection.begin():
            return _extract_from_connection(connection, cutoff=cutoff)


def export_postgres_snapshot(
    *,
    database_url: str,
    dataset_id: str,
    cutoff: datetime,
    limitations: tuple[str, ...],
) -> EvaluationSnapshot:
    """Export a privacy-minimized, repeatable-read evaluation snapshot."""

    if cutoff.tzinfo is None or cutoff.utcoffset() != timedelta(0):
        raise SnapshotExportError("cutoff must include an explicit UTC offset")

    try:
        parsed_url = make_url(database_url)
        _ = parsed_url.port
    except (ArgumentError, ValueError) as error:
        raise SnapshotExportError("database URL is invalid") from error
    if parsed_url.drivername != "postgresql+psycopg":
        raise SnapshotExportError("database URL must use the postgresql+psycopg driver")
    try:
        engine = create_engine(parsed_url, pool_pre_ping=True)
    except (ArgumentError, ModuleNotFoundError, ValueError) as error:
        raise SnapshotExportError("database URL or driver is invalid") from error
    try:
        recipes, events = _extract(engine, cutoff=cutoff.astimezone(UTC))
    finally:
        engine.dispose()
    return create_snapshot(
        dataset_id=dataset_id,
        cutoff=cutoff.astimezone(UTC),
        limitations=limitations,
        recipes=recipes,
        events=events,
        schema_version=SNAPSHOT_SCHEMA_VERSION,
    )
