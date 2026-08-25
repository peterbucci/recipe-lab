from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Literal, cast
from uuid import UUID

from app.models import (
    PreferenceEvent,
    RecipeIngredient,
    RecipeVersion,
)
from sqlalchemy import Engine, create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError
from sqlalchemy.orm import Session

from ..dataset import (
    EvaluationSnapshot,
    MeasureKind,
    QualitativeMeasure,
    SnapshotEvent,
    SnapshotIngredientMeasure,
    SnapshotRecipe,
    create_snapshot,
)

type EventType = Literal["view", "save", "rating", "fork"]


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


def _extract(engine: Engine) -> tuple[tuple[SnapshotRecipe, ...], tuple[SnapshotEvent, ...]]:
    if engine.dialect.name != "postgresql":
        raise SnapshotExportError("snapshot export requires PostgreSQL")

    # Both queries run in one point-in-time PostgreSQL snapshot. Only contract fields and
    # the two non-exported ingredient ordering keys are selected; request fingerprints,
    # user profile data, recipe descriptions, instructions, and ingredient display text
    # never leave the database. Ingredient rows remain occurrence-preserving and are
    # ordered by their authored position before the versioned measure fields are projected.
    with engine.connect().execution_options(isolation_level="REPEATABLE READ") as connection:
        with connection.begin(), Session(bind=connection) as session:
            recipe_rows = session.execute(
                select(
                    RecipeVersion.id,
                    RecipeVersion.created_at,
                    RecipeVersion.title,
                    RecipeVersion.version_number,
                ).order_by(RecipeVersion.id)
            ).all()
            ingredient_rows = session.execute(
                select(
                    RecipeIngredient.recipe_version_id,
                    RecipeIngredient.ingredient_id,
                    RecipeIngredient.measure_mode,
                    RecipeIngredient.quantity_min,
                    RecipeIngredient.quantity_max,
                    RecipeIngredient.measurement_unit_id,
                    RecipeIngredient.package_size_id,
                    RecipeIngredient.display_order,
                    RecipeIngredient.id,
                ).order_by(
                    RecipeIngredient.recipe_version_id,
                    RecipeIngredient.display_order,
                    RecipeIngredient.id,
                )
            ).all()
            event_rows = session.execute(
                select(
                    PreferenceEvent.id,
                    PreferenceEvent.user_id,
                    PreferenceEvent.recipe_version_id,
                    PreferenceEvent.event_type,
                    PreferenceEvent.occurred_at,
                    PreferenceEvent.saved_value,
                    PreferenceEvent.rating_value,
                    PreferenceEvent.related_recipe_version_id,
                ).order_by(PreferenceEvent.occurred_at, PreferenceEvent.id)
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

    recipes = tuple(
        SnapshotRecipe(
            id=recipe_id,
            created_at=_utc(created_at, field="recipe created_at"),
            title=title,
            version_number=version_number,
            ingredient_measures=tuple(measures_by_recipe[recipe_id]),
        )
        for recipe_id, created_at, title, version_number in recipe_rows
    )
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
        recipes, events = _extract(engine)
    finally:
        engine.dispose()
    return create_snapshot(
        dataset_id=dataset_id,
        cutoff=cutoff.astimezone(UTC),
        limitations=limitations,
        recipes=recipes,
        events=events,
    )
