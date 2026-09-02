from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, load_only, raiseload, selectinload

from app.models import (
    MeasurementConversionRule,
    MeasurementUnit,
    RecipeIngredient,
    RecipeInstruction,
    RecipeInstructionAction,
    RecipeInstructionActionMeasure,
    RecipeStructuralFingerprint,
    RecipeVersion,
)
from app.repositories.recipe_fingerprints import (
    StructuralFingerprintStorageConflictError,
    get_recipe_structural_fingerprint,
    store_recipe_structural_fingerprint,
)
from app.services.recipe_fingerprints import (
    STRUCTURAL_FINGERPRINT_STORAGE_VERSION,
    CanonicalUnit,
    RecipeStructure,
    ReviewedAffineConversion,
    StructuralAction,
    StructuralIngredient,
    StructuralInstruction,
    StructuralMeasure,
    build_structural_fingerprint,
)

MAX_FINGERPRINT_BACKFILL_BATCH_SIZE = 500
DEFAULT_FINGERPRINT_BACKFILL_BATCH_SIZE = 100

type FingerprintPersistenceState = Literal["created", "reused", "incomplete"]


@dataclass(frozen=True, slots=True)
class FingerprintPersistenceResult:
    recipe_version_id: UUID
    state: FingerprintPersistenceState
    fingerprint: RecipeStructuralFingerprint | None


@dataclass(frozen=True, slots=True)
class FingerprintBackfillPage:
    scanned: int
    created: int
    reused: int
    incomplete: int
    next_cursor: UUID | None


@dataclass(frozen=True, slots=True)
class FingerprintBackfillSummary:
    scanned: int
    created: int
    reused: int
    incomplete: int


def _load_recipe_version_for_fingerprint(
    session: Session,
    recipe_version_id: UUID,
) -> RecipeVersion | None:
    ingredient_unit = (
        joinedload(RecipeIngredient.measurement_unit)
        .joinedload(MeasurementUnit.conversion_rule)
        .joinedload(MeasurementConversionRule.base_unit)
    )
    action_measure_unit = (
        joinedload(RecipeInstructionActionMeasure.measurement_unit)
        .joinedload(MeasurementUnit.conversion_rule)
        .joinedload(MeasurementConversionRule.base_unit)
    )

    statement = (
        select(RecipeVersion)
        .options(
            # Structural fingerprints depend only on the version identity and its
            # ingredient/action graph. Keeping the version projection deliberately
            # narrow also makes the migration-0011 backfill safe when a newer ORM
            # model has columns that the historical schema does not have yet.
            load_only(RecipeVersion.id),
            selectinload(RecipeVersion.ingredients).options(
                ingredient_unit,
            ),
            selectinload(RecipeVersion.instructions)
            .selectinload(RecipeInstruction.actions)
            .options(
                joinedload(RecipeInstructionAction.action_type),
                selectinload(RecipeInstructionAction.inputs),
                selectinload(RecipeInstructionAction.measures).options(action_measure_unit),
            ),
            raiseload("*"),
        )
        .where(RecipeVersion.id == recipe_version_id)
        .execution_options(populate_existing=True)
    )
    return session.scalar(statement)


def _canonical_unit(unit: MeasurementUnit | None) -> CanonicalUnit | None:
    if unit is None:
        return None
    rule = unit.conversion_rule
    conversion = None
    if rule is not None:
        conversion = ReviewedAffineConversion(
            base_unit_key=rule.base_unit.key,
            base_dimension=rule.base_unit.dimension,
            base_conversion_family=rule.base_unit.conversion_family,
            scale_numerator=rule.scale_numerator,
            scale_denominator=rule.scale_denominator,
            offset_numerator=rule.offset_numerator,
            offset_denominator=rule.offset_denominator,
            reviewed=True,
            active=rule.active,
        )
    return CanonicalUnit(
        key=unit.key,
        dimension=unit.dimension,
        conversion_family=unit.conversion_family,
        conversion=conversion,
    )


def _ingredient_measure(ingredient: RecipeIngredient) -> StructuralMeasure:
    return StructuralMeasure(
        mode=ingredient.measure_mode,
        quantity_min=ingredient.quantity_min,
        quantity_max=ingredient.quantity_max,
        unit=_canonical_unit(ingredient.measurement_unit),
        package_size_identity=(
            str(ingredient.package_size_id) if ingredient.package_size_id is not None else None
        ),
    )


def _action_measure(
    measure: RecipeInstructionActionMeasure | None,
) -> StructuralMeasure | None:
    if measure is None:
        return None
    return StructuralMeasure(
        mode=measure.measure_mode,
        quantity_min=measure.quantity_min,
        quantity_max=measure.quantity_max,
        unit=_canonical_unit(measure.measurement_unit),
    )


def build_recipe_structure(version: RecipeVersion) -> RecipeStructure:
    """Adapt a fully loaded immutable ORM snapshot into the pure v1 input."""

    ingredients = tuple(
        StructuralIngredient(
            occurrence_key=str(ingredient.id),
            ingredient_identity=str(ingredient.ingredient_id),
            measure=_ingredient_measure(ingredient),
        )
        for ingredient in version.ingredients
    )
    instructions: list[StructuralInstruction] = []
    for instruction in version.instructions:
        actions: list[StructuralAction] = []
        for action in instruction.actions:
            measures = {measure.semantic: measure for measure in action.measures}
            actions.append(
                StructuralAction(
                    action_type_key=action.action_type.key,
                    ingredient_occurrence_keys=tuple(
                        str(action_input.recipe_ingredient_id) for action_input in action.inputs
                    ),
                    duration=_action_measure(measures.get("duration")),
                    temperature=_action_measure(measures.get("temperature")),
                )
            )
        instructions.append(StructuralInstruction(actions=tuple(actions)))
    return RecipeStructure(
        ingredients=ingredients,
        instructions=tuple(instructions),
    )


def fingerprint_and_store_recipe_version(
    session: Session,
    recipe_version_id: UUID,
) -> FingerprintPersistenceResult:
    """Compute and store the current exact fingerprint without committing."""

    version = _load_recipe_version_for_fingerprint(session, recipe_version_id)
    if version is None:
        raise LookupError(f"Recipe version {recipe_version_id} does not exist.")
    computed = build_structural_fingerprint(build_recipe_structure(version))
    if computed is None:
        existing = get_recipe_structural_fingerprint(
            session,
            recipe_version_id=recipe_version_id,
            algorithm_version=STRUCTURAL_FINGERPRINT_STORAGE_VERSION,
        )
        if existing is not None:
            raise StructuralFingerprintStorageConflictError(
                "A stored structural fingerprint now resolves to incomplete recipe "
                f"version {recipe_version_id}."
            )
        return FingerprintPersistenceResult(
            recipe_version_id=recipe_version_id,
            state="incomplete",
            fingerprint=None,
        )

    existing = get_recipe_structural_fingerprint(
        session,
        recipe_version_id=recipe_version_id,
        algorithm_version=computed.algorithm_version,
    )
    stored = store_recipe_structural_fingerprint(
        session,
        recipe_version_id=recipe_version_id,
        algorithm_version=computed.algorithm_version,
        digest=computed.digest,
        canonical_payload=computed.canonical_json,
    )
    return FingerprintPersistenceResult(
        recipe_version_id=recipe_version_id,
        state="created" if existing is None else "reused",
        fingerprint=stored,
    )


def backfill_recipe_structural_fingerprints(
    session: Session,
    *,
    after_recipe_version_id: UUID | None = None,
    limit: int = DEFAULT_FINGERPRINT_BACKFILL_BATCH_SIZE,
) -> FingerprintBackfillPage:
    """Fingerprint one bounded UUID-ordered page for resumable operator use."""

    if limit < 1 or limit > MAX_FINGERPRINT_BACKFILL_BATCH_SIZE:
        raise ValueError(
            "Fingerprint backfill limit must be between 1 and "
            f"{MAX_FINGERPRINT_BACKFILL_BATCH_SIZE}."
        )
    statement = select(RecipeVersion.id).order_by(RecipeVersion.id).limit(limit + 1)
    if after_recipe_version_id is not None:
        statement = statement.where(RecipeVersion.id > after_recipe_version_id)
    candidate_ids = list(session.scalars(statement))
    has_more = len(candidate_ids) > limit
    recipe_version_ids = candidate_ids[:limit]

    created = 0
    reused = 0
    incomplete = 0
    for recipe_version_id in recipe_version_ids:
        result = fingerprint_and_store_recipe_version(session, recipe_version_id)
        if result.state == "created":
            created += 1
        elif result.state == "reused":
            reused += 1
        else:
            incomplete += 1

    return FingerprintBackfillPage(
        scanned=len(recipe_version_ids),
        created=created,
        reused=reused,
        incomplete=incomplete,
        next_cursor=recipe_version_ids[-1] if has_more else None,
    )


def backfill_all_recipe_structural_fingerprints(
    session: Session,
    *,
    batch_size: int = DEFAULT_FINGERPRINT_BACKFILL_BATCH_SIZE,
) -> FingerprintBackfillSummary:
    """Run the bounded backfill to completion inside the caller's transaction."""

    cursor: UUID | None = None
    scanned = 0
    created = 0
    reused = 0
    incomplete = 0
    while True:
        page = backfill_recipe_structural_fingerprints(
            session,
            after_recipe_version_id=cursor,
            limit=batch_size,
        )
        scanned += page.scanned
        created += page.created
        reused += page.reused
        incomplete += page.incomplete
        if page.next_cursor is None:
            break
        cursor = page.next_cursor
    return FingerprintBackfillSummary(
        scanned=scanned,
        created=created,
        reused=reused,
        incomplete=incomplete,
    )
