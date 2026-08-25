from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import (
    IngredientDensityRule,
    IngredientPackageSize,
    MeasurementConversionRule,
    MeasurementUnit,
    MeasurementUnitAlias,
)
from app.schemas.measurements import SEMANTIC_DIMENSIONS, MeasurementDimension, MeasurementSemantic


def list_active_measurement_units(
    session: Session,
    *,
    semantic: MeasurementSemantic,
    limit: int,
) -> list[MeasurementUnit]:
    """Return a bounded, deterministic catalog subset for one measure context."""

    dimensions: frozenset[MeasurementDimension] = SEMANTIC_DIMENSIONS[semantic]
    statement = (
        select(MeasurementUnit)
        .options(selectinload(MeasurementUnit.aliases))
        .where(
            MeasurementUnit.active.is_(True),
            MeasurementUnit.dimension.in_(dimensions),
        )
        .order_by(
            MeasurementUnit.dimension,
            func.lower(func.btrim(MeasurementUnit.canonical_label)),
            MeasurementUnit.id,
        )
        .limit(limit)
    )
    return list(session.scalars(statement))


def get_measurement_unit(
    session: Session,
    measurement_unit_id: UUID,
    *,
    active_only: bool = False,
) -> MeasurementUnit | None:
    statement = (
        select(MeasurementUnit)
        .options(selectinload(MeasurementUnit.aliases))
        .where(MeasurementUnit.id == measurement_unit_id)
    )
    if active_only:
        statement = statement.where(MeasurementUnit.active.is_(True))
    return session.scalar(statement)


def resolve_measurement_unit_label(
    session: Session,
    raw_label: str,
    *,
    active_only: bool = True,
) -> MeasurementUnit | None:
    """Resolve an exact curated label without fuzzy matching or record creation."""

    label = raw_label.strip()
    if not label:
        return None
    normalized = label.casefold()
    statement = (
        select(MeasurementUnit)
        .outerjoin(MeasurementUnitAlias)
        .options(selectinload(MeasurementUnit.aliases))
        .where(
            or_(
                func.lower(func.btrim(MeasurementUnit.canonical_label)) == normalized,
                func.lower(func.btrim(MeasurementUnit.plural_label)) == normalized,
                func.lower(func.btrim(MeasurementUnit.symbol)) == normalized,
                func.lower(func.btrim(MeasurementUnitAlias.alias)) == normalized,
            )
        )
        .order_by(MeasurementUnit.id)
    )
    if active_only:
        statement = statement.where(MeasurementUnit.active.is_(True))
    matches = list(session.scalars(statement).unique())
    if len(matches) > 1:
        raise RuntimeError(f"Curated measurement label {raw_label!r} resolves ambiguously.")
    return matches[0] if matches else None


def get_measurement_conversion_rule(
    session: Session,
    unit_id: UUID,
    *,
    active_only: bool = True,
) -> MeasurementConversionRule | None:
    statement = select(MeasurementConversionRule).where(
        MeasurementConversionRule.unit_id == unit_id
    )
    if active_only:
        statement = statement.where(MeasurementConversionRule.active.is_(True))
    return session.scalar(statement)


def get_active_ingredient_density_rules(
    session: Session,
    ingredient_id: UUID,
) -> list[IngredientDensityRule]:
    statement = (
        select(IngredientDensityRule)
        .options(
            joinedload(IngredientDensityRule.mass_unit),
            joinedload(IngredientDensityRule.volume_unit),
        )
        .where(
            IngredientDensityRule.ingredient_id == ingredient_id,
            IngredientDensityRule.active.is_(True),
        )
        .order_by(IngredientDensityRule.id)
    )
    return list(session.scalars(statement))


def get_ingredient_package_size(
    session: Session,
    package_size_id: UUID,
    *,
    active_only: bool = False,
) -> IngredientPackageSize | None:
    statement = (
        select(IngredientPackageSize)
        .options(
            joinedload(IngredientPackageSize.package_unit),
            joinedload(IngredientPackageSize.content_unit),
        )
        .where(IngredientPackageSize.id == package_size_id)
    )
    if active_only:
        statement = statement.where(IngredientPackageSize.active.is_(True))
    return session.scalar(statement)
