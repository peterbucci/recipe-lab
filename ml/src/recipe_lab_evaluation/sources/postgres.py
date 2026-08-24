from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
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
    SnapshotEvent,
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


def _linked_ingredients_by_recipe(
    rows: Iterable[tuple[UUID, UUID | None]],
) -> defaultdict[UUID, set[UUID]]:
    """Group only trusted catalog identities for recommendation snapshots."""

    linked: defaultdict[UUID, set[UUID]] = defaultdict(set)
    for recipe_version_id, ingredient_id in rows:
        if ingredient_id is not None:
            linked[recipe_version_id].add(ingredient_id)
    return linked


def _snapshot_recipes(
    recipe_rows: Iterable[tuple[UUID, datetime, str, int]],
    ingredient_rows: Iterable[tuple[UUID, UUID | None]],
) -> tuple[SnapshotRecipe, ...]:
    ingredients_by_recipe = _linked_ingredients_by_recipe(ingredient_rows)
    return tuple(
        SnapshotRecipe(
            id=recipe_id,
            created_at=_utc(created_at, field="recipe created_at"),
            title=title,
            version_number=version_number,
            ingredient_ids=tuple(
                sorted(
                    ingredients_by_recipe[recipe_id],
                    key=lambda ingredient_id: ingredient_id.int,
                )
            ),
        )
        for recipe_id, created_at, title, version_number in recipe_rows
    )


def _extract(engine: Engine) -> tuple[tuple[SnapshotRecipe, ...], tuple[SnapshotEvent, ...]]:
    if engine.dialect.name != "postgresql":
        raise SnapshotExportError("snapshot export requires PostgreSQL")

    # Both queries run in one point-in-time PostgreSQL snapshot. Only the columns in
    # the public evaluation contract are selected; request fingerprints, user profile
    # data, recipe descriptions, instructions, and ingredient display text never leave
    # the database.
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
                )
                .where(RecipeIngredient.ingredient_id.is_not(None))
                .order_by(
                    RecipeIngredient.recipe_version_id,
                    RecipeIngredient.ingredient_id,
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

    recipes = _snapshot_recipes(
        (
            (recipe_id, created_at, title, version_number)
            for recipe_id, created_at, title, version_number in recipe_rows
        ),
        (
            (recipe_version_id, ingredient_id)
            for recipe_version_id, ingredient_id in ingredient_rows
        ),
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
