"""Atomic publication of complete private recipe drafts."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.domain_errors import (
    DomainConflictError,
    DomainNotFoundError,
    DomainValidationError,
)
from app.core.idempotency import (
    IdempotencyConflictError,
    canonical_request_fingerprint,
    require_same_request,
)
from app.models import (
    RECIPE_DRAFT_SELECTION_CATALOG,
    RECIPE_DRAFT_STATUS_ACTIVE,
    RECIPE_DRAFT_STATUS_PUBLISHED,
    RECIPE_PUBLICATION_STATE_PUBLISHED,
    MeasurementUnit,
    RecipeDraft,
    RecipeDraftIngredient,
    RecipeDraftInstructionAction,
    RecipeDraftInstructionActionMeasure,
    RecipeDuplicateDecision,
    RecipeDuplicatePreflight,
    RecipeVersion,
    RecipeVersionPublication,
)
from app.policies.recipe_visibility import publicly_readable_recipe_version_filter
from app.repositories.ingredients import curated_display_label, get_ingredient
from app.repositories.preference_events import get_preference_event
from app.repositories.recipe_drafts import get_owned_recipe_draft_for_publication
from app.repositories.recipe_publications import (
    get_recipe_publication_by_action,
    get_recipe_publication_by_draft,
    lock_recipe_publication_guard,
)
from app.schemas.actions import AddedIngredientOccurrenceReference, StructuredActionInput
from app.schemas.measurements import (
    ExactMeasureInput,
    QualitativeMeasureInput,
    RangeMeasureInput,
    StructuredMeasureInput,
)
from app.schemas.recipe_duplicates import RecipeDuplicatePreflightResponse
from app.schemas.recipe_publications import RecipeDraftPublicationRequest
from app.services.actions import ActionContractError, validate_structured_actions
from app.services.measurements import (
    MeasurementError,
    measurement_unit_snapshot_label,
    validate_measure_input,
)
from app.services.preference_events import PreferenceEventIntent, record_preference_event
from app.services.recipe_duplicate_preflights import (
    RecipeDuplicatePreflightServiceResult,
    RecipeDuplicatePreflightUnavailableError,
    revalidate_recipe_duplicate_publication_evidence,
    run_structural_recipe_duplicate_preflight,
)
from app.services.recipe_fingerprint_persistence import (
    canonical_unit_from_measurement,
    fingerprint_and_store_recipe_version,
)
from app.services.recipe_fingerprints import (
    RecipeStructure,
    StructuralAction,
    StructuralFingerprint,
    StructuralIngredient,
    StructuralInstruction,
    StructuralMeasure,
    build_structural_fingerprint,
)
from app.services.recipe_publication_snapshots import (
    RecipeForkSourceUnavailableError as RecipeForkSourceUnavailableError,
)
from app.services.recipe_publication_snapshots import (
    copy_recipe_version_action_inputs,
    copy_recipe_version_action_measures,
    copy_recipe_version_actions,
    copy_recipe_version_categories,
    copy_recipe_version_ingredients,
    copy_recipe_version_instructions,
    create_recipe_version_identity,
)

CURRENT_COMMUNITY_RULES_VERSION = "community-rules-v1"

type PublicationWritePhase = Literal[
    "duplicate_evidence",
    "version_identity",
    "categories",
    "ingredients",
    "instructions",
    "actions",
    "action_inputs",
    "action_measures",
    "structural_fingerprint",
    "publication_receipt",
    "fork_preference_event",
    "draft_terminal_state",
]

_PUBLICATION_WRITE_PHASES: tuple[PublicationWritePhase, ...] = (
    "duplicate_evidence",
    "version_identity",
    "categories",
    "ingredients",
    "instructions",
    "actions",
    "action_inputs",
    "action_measures",
    "structural_fingerprint",
    "publication_receipt",
    "fork_preference_event",
    "draft_terminal_state",
)


def _test_publication_write_checkpoint(_phase: PublicationWritePhase) -> None:
    """Private no-op seam that rollback tests replace with one injected failure."""


def _finish_publication_write_phase(
    session: Session,
    phase: PublicationWritePhase,
) -> None:
    """Flush one named write boundary before the test-only failure checkpoint."""

    session.flush()
    _test_publication_write_checkpoint(phase)


class RecipePublicationNotFoundError(DomainNotFoundError):
    """Raised without revealing whether another member owns a draft."""

    code = "recipe_draft_not_found"

    def __init__(self, draft_id: UUID) -> None:
        super().__init__(
            "Private recipe draft not found.",
            public_message=f"Recipe draft {draft_id} was not found.",
        )


class RecipePublicationRevisionConflictError(DomainConflictError):
    """Raised when publication references an obsolete draft revision."""

    code = "recipe_draft_revision_conflict"
    public_message = "This draft has a newer saved revision. Reload it before trying again."


class InvalidRecipeDraftPublicationError(DomainValidationError):
    """Raised when a draft cannot become one complete public recipe snapshot."""

    code = "invalid_recipe_draft"

    def __init__(self, detail: str) -> None:
        super().__init__(detail, public_message=detail)


class InvalidOriginalRecipePublicationError(InvalidRecipeDraftPublicationError):
    """Preserve the RCP-27 error contract for invalid source-less drafts."""

    code = "invalid_original_recipe_draft"


class RecipeDraftAlreadyPublishedError(DomainConflictError):
    """Raised when duplicate evidence is requested for a completed draft."""

    code = "recipe_draft_already_published"
    public_message = "This private draft has already completed publication."


class RecipePublicationIdempotencyConflictError(IdempotencyConflictError):
    """Raised when an action or completed draft is bound to another request."""

    public_message = "The Idempotency-Key or completed draft conflicts with another request."


class PublishedRecipeFingerprintMismatchError(RuntimeError):
    """Raised when fresh snapshot rows differ from their validated draft structure."""


@dataclass(frozen=True, slots=True)
class PreparedRecipeDraft:
    draft: RecipeDraft
    structure: RecipeStructure
    structural_fingerprint: StructuralFingerprint
    preflight_request_fingerprint: str


@dataclass(frozen=True, slots=True)
class RecipeDraftPublicationResult:
    recipe_version_id: UUID
    state: Literal["created", "reused"]

    @property
    def location(self) -> str:
        return f"/recipes/{self.recipe_version_id}"


@dataclass(frozen=True, slots=True)
class RevalidatedPublicationEvidence:
    preflight: RecipeDuplicatePreflight
    decision: RecipeDuplicateDecision | None


def _invalid(message: str) -> InvalidRecipeDraftPublicationError:
    return InvalidRecipeDraftPublicationError(message)


def _stored_measure_input(
    *,
    mode: str,
    quantity_min: Decimal | None,
    quantity_max: Decimal | None,
    measurement_unit_id: UUID | None,
    package_size_id: UUID | None,
) -> StructuredMeasureInput:
    if mode == "exact":
        if quantity_min is None or quantity_max is not None or measurement_unit_id is None:
            raise _invalid("An exact measurement is incomplete.")
        return ExactMeasureInput(
            kind="exact",
            value=quantity_min,
            unit_id=measurement_unit_id,
            package_size_id=package_size_id,
        )
    if mode == "range":
        if quantity_min is None or quantity_max is None or measurement_unit_id is None:
            raise _invalid("A range measurement is incomplete.")
        return RangeMeasureInput(
            kind="range",
            minimum=quantity_min,
            maximum=quantity_max,
            unit_id=measurement_unit_id,
            package_size_id=package_size_id,
        )
    if mode in {"to_taste", "as_needed", "unspecified"}:
        if (
            quantity_min is not None
            or quantity_max is not None
            or measurement_unit_id is not None
            or package_size_id is not None
        ):
            raise _invalid("A qualitative measurement contains numeric metadata.")
        return QualitativeMeasureInput(kind="qualitative", value=mode)  # type: ignore[arg-type]
    raise _invalid(f"Unsupported measurement mode {mode!r}.")


def _action_measure_input(
    measure: RecipeDraftInstructionActionMeasure | None,
) -> ExactMeasureInput | RangeMeasureInput | None:
    if measure is None:
        return None
    structured = _stored_measure_input(
        mode=measure.measure_mode,
        quantity_min=measure.quantity_min,
        quantity_max=measure.quantity_max,
        measurement_unit_id=measure.measurement_unit_id,
        package_size_id=None,
    )
    if isinstance(structured, QualitativeMeasureInput):
        raise _invalid("Cooking-action measurements must be numeric.")
    return structured


def _validate_ingredient_identity(
    session: Session,
    item: RecipeDraftIngredient,
) -> None:
    if (
        item.selection_kind != RECIPE_DRAFT_SELECTION_CATALOG
        or item.ingredient_id is None
        or item.name is None
    ):
        raise _invalid(
            "Every published ingredient must resolve to a curated catalog identity; "
            "pending or rejected ingredient requests remain private draft state."
        )
    ingredient = get_ingredient(session, item.ingredient_id)
    if ingredient is None:
        raise _invalid("A selected ingredient is no longer in the curated catalog.")
    current_name = curated_display_label(ingredient, item.name)
    if current_name is None or current_name != item.name:
        raise _invalid("A selected ingredient label is no longer authoritative.")

    measure = _stored_measure_input(
        mode=item.measure_mode,
        quantity_min=item.quantity_min,
        quantity_max=item.quantity_max,
        measurement_unit_id=item.measurement_unit_id,
        package_size_id=item.package_size_id,
    )
    try:
        unit = validate_measure_input(
            session,
            semantic="ingredient_amount",
            measure=measure,
            ingredient_id=item.ingredient_id,
        )
    except MeasurementError as error:
        raise _invalid(f"{error.code}: {error}") from error
    if unit is None:
        if item.unit_display is not None:
            raise _invalid("A qualitative ingredient measure has stale unit metadata.")
    elif item.unit_display != measurement_unit_snapshot_label(
        unit.symbol,
        unit.canonical_label,
    ):
        raise _invalid("An ingredient measurement label is no longer authoritative.")


def _validate_action_contract(
    session: Session,
    action: RecipeDraftInstructionAction,
    catalog_ingredient_ids: set[UUID],
) -> None:
    referenced_ids = [item.recipe_draft_ingredient_id for item in action.inputs]
    if any(ingredient_id not in catalog_ingredient_ids for ingredient_id in referenced_ids):
        raise _invalid("Structured actions may reference only resolved catalog ingredient slots.")
    measures = {measure.semantic: measure for measure in action.measures}
    if len(measures) != len(action.measures) or set(measures) - {"duration", "temperature"}:
        raise _invalid("A structured action contains unsupported measurement semantics.")
    translated = StructuredActionInput(
        action_type_id=action.action_type_id,
        ingredient_refs=[
            AddedIngredientOccurrenceReference(
                kind="added",
                ingredient_edit_ref=str(ingredient_id),
            )
            for ingredient_id in referenced_ids
        ],
        duration=_action_measure_input(measures.get("duration")),
        temperature=_action_measure_input(measures.get("temperature")),
    )
    try:
        validated = validate_structured_actions(session, [translated])[0]
    except ActionContractError as error:
        raise _invalid(str(error)) from error
    stored_measures = {measure.semantic: measure for measure in action.measures}
    for measure in validated.measures:
        stored = stored_measures.get(measure.semantic)
        if (
            stored is None
            or stored.measure_mode != measure.measure_mode
            or stored.quantity_min != measure.quantity_min
            or stored.quantity_max != measure.quantity_max
            or stored.measurement_unit_id != measure.measurement_unit_id
            or stored.unit_display != measure.unit_display
        ):
            raise _invalid("A structured action measurement is no longer authoritative.")


def _structural_measure(
    *,
    mode: str,
    quantity_min: Decimal | None,
    quantity_max: Decimal | None,
    unit: MeasurementUnit | None,
    package_size_id: UUID | None,
) -> StructuralMeasure:
    return StructuralMeasure(
        mode=mode,
        quantity_min=quantity_min,
        quantity_max=quantity_max,
        unit=canonical_unit_from_measurement(unit),
        package_size_identity=str(package_size_id) if package_size_id is not None else None,
    )


def _build_draft_structure(draft: RecipeDraft) -> RecipeStructure:
    occurrence_keys = {
        item.id: f"draft-ingredient:{index:04d}" for index, item in enumerate(draft.ingredients)
    }
    ingredients = tuple(
        StructuralIngredient(
            occurrence_key=occurrence_keys[item.id],
            ingredient_identity=str(item.ingredient_id) if item.ingredient_id else None,
            measure=_structural_measure(
                mode=item.measure_mode,
                quantity_min=item.quantity_min,
                quantity_max=item.quantity_max,
                unit=item.measurement_unit,
                package_size_id=item.package_size_id,
            ),
        )
        for item in draft.ingredients
    )
    instructions: list[StructuralInstruction] = []
    for instruction in draft.instructions:
        actions: list[StructuralAction] = []
        for action in instruction.actions:
            measures = {measure.semantic: measure for measure in action.measures}
            duration = measures.get("duration")
            temperature = measures.get("temperature")
            actions.append(
                StructuralAction(
                    action_type_key=action.action_type.key,
                    ingredient_occurrence_keys=tuple(
                        occurrence_keys[item.recipe_draft_ingredient_id] for item in action.inputs
                    ),
                    duration=(
                        _structural_measure(
                            mode=duration.measure_mode,
                            quantity_min=duration.quantity_min,
                            quantity_max=duration.quantity_max,
                            unit=duration.measurement_unit,
                            package_size_id=None,
                        )
                        if duration is not None
                        else None
                    ),
                    temperature=(
                        _structural_measure(
                            mode=temperature.measure_mode,
                            quantity_min=temperature.quantity_min,
                            quantity_max=temperature.quantity_max,
                            unit=temperature.measurement_unit,
                            package_size_id=None,
                        )
                        if temperature is not None
                        else None
                    ),
                )
            )
        instructions.append(StructuralInstruction(actions=tuple(actions)))
    return RecipeStructure(ingredients=ingredients, instructions=tuple(instructions))


def _preflight_request_fingerprint(
    draft: RecipeDraft,
    structural_fingerprint: StructuralFingerprint,
) -> str:
    fields = {
        "draft_id": str(draft.id),
        "revision": draft.revision,
        "structural_algorithm": structural_fingerprint.algorithm_version,
        "structural_digest": structural_fingerprint.digest,
        "title": draft.title,
        "description": draft.description,
        "category_ids": [str(item.recipe_category_id) for item in draft.categories],
        "servings": str(draft.servings),
        "total_time_minutes": draft.total_time_minutes,
        "active_time_minutes": draft.active_time_minutes,
        "difficulty": draft.difficulty,
        "notes": draft.notes,
    }
    if draft.source_version_id is not None:
        fields["source_version_id"] = str(draft.source_version_id)
    return canonical_request_fingerprint(
        schema=(
            "recipe-lab.original-draft-preflight-request"
            if draft.source_version_id is None
            else "recipe-lab.variant-draft-preflight-request"
        ),
        version=2,
        fields=fields,
    )


def recipe_draft_publication_request_fingerprint(
    draft_id: UUID,
    payload: RecipeDraftPublicationRequest,
    *,
    source_version_id: UUID | None = None,
) -> str:
    fields = {
        "draft_id": str(draft_id),
        "payload": payload.model_dump(mode="json"),
    }
    if source_version_id is not None:
        fields["source_version_id"] = str(source_version_id)
    return canonical_request_fingerprint(
        schema=(
            "recipe-lab.original-recipe-publication-request"
            if source_version_id is None
            else "recipe-lab.variant-recipe-publication-request"
        ),
        version=1,
        fields=fields,
    )


# Preserve the RCP-27 helper import and its exact fingerprint bytes for source-less
# publications.
original_publication_request_fingerprint = recipe_draft_publication_request_fingerprint


def _prepare_locked_recipe_draft_content(
    session: Session,
    *,
    draft: RecipeDraft,
    expected_revision: int,
) -> PreparedRecipeDraft:
    if draft.status != RECIPE_DRAFT_STATUS_ACTIVE:
        raise RecipeDraftAlreadyPublishedError(
            "This private draft has already completed publication."
        )
    if draft.revision != expected_revision:
        raise RecipePublicationRevisionConflictError("The draft has a newer saved revision.")
    if not draft.title.strip():
        raise _invalid("A published recipe requires a title.")
    if draft.servings is None:
        raise _invalid("A published recipe requires a serving quantity.")
    if not draft.ingredients:
        raise _invalid("A published recipe requires at least one ingredient.")
    if not draft.instructions:
        raise _invalid("A published recipe requires at least one instruction.")
    if any(not item.category.active for item in draft.categories):
        raise _invalid("Select only active curated recipe categories before publishing.")

    for ingredient in draft.ingredients:
        _validate_ingredient_identity(session, ingredient)
    catalog_ingredient_ids = {item.id for item in draft.ingredients}
    for instruction in draft.instructions:
        if not instruction.actions:
            raise _invalid(
                "Add at least one confirmed cooking action in the cooking details for every "
                "instruction so Recipe Lab can compare similar recipes before publishing."
            )
        for action in instruction.actions:
            _validate_action_contract(session, action, catalog_ingredient_ids)

    structure = _build_draft_structure(draft)
    structural_fingerprint = build_structural_fingerprint(structure)
    if structural_fingerprint is None:
        raise _invalid("The draft does not contain a complete canonical recipe structure.")
    return PreparedRecipeDraft(
        draft=draft,
        structure=structure,
        structural_fingerprint=structural_fingerprint,
        preflight_request_fingerprint=_preflight_request_fingerprint(
            draft,
            structural_fingerprint,
        ),
    )


def _prepare_locked_recipe_draft(
    session: Session,
    *,
    draft: RecipeDraft,
    expected_revision: int,
) -> PreparedRecipeDraft:
    try:
        return _prepare_locked_recipe_draft_content(
            session,
            draft=draft,
            expected_revision=expected_revision,
        )
    except InvalidRecipeDraftPublicationError as error:
        if draft.source_version_id is None:
            raise InvalidOriginalRecipePublicationError(str(error)) from error
        raise


def run_recipe_draft_duplicate_preflight(
    session: Session,
    *,
    author_user_id: UUID,
    draft_id: UUID,
    expected_revision: int,
    action_id: UUID,
) -> RecipeDuplicatePreflightServiceResult:
    draft = get_owned_recipe_draft_for_publication(
        session,
        author_user_id=author_user_id,
        draft_id=draft_id,
    )
    if draft is None:
        raise RecipePublicationNotFoundError(draft_id)
    prepared = _prepare_locked_recipe_draft(
        session,
        draft=draft,
        expected_revision=expected_revision,
    )
    try:
        return run_structural_recipe_duplicate_preflight(
            session,
            subject_fingerprint=prepared.structural_fingerprint,
            source_version_id=draft.source_version_id,
            actor_user_id=author_user_id,
            action_id=action_id,
            request_fingerprint=prepared.preflight_request_fingerprint,
        )
    except RecipeDuplicatePreflightUnavailableError as error:
        raise RecipeForkSourceUnavailableError(
            "The public source recipe is no longer available."
        ) from error


run_original_recipe_draft_duplicate_preflight = run_recipe_draft_duplicate_preflight


def _copy_draft_snapshot_phases(
    session: Session,
    *,
    draft: RecipeDraft,
    author_user_id: UUID,
) -> RecipeVersion:
    version = create_recipe_version_identity(
        session,
        draft=draft,
        author_user_id=author_user_id,
    )
    _finish_publication_write_phase(session, "version_identity")
    copy_recipe_version_categories(
        session,
        draft=draft,
        recipe_version_id=version.id,
    )
    _finish_publication_write_phase(session, "categories")
    ingredient_ids = copy_recipe_version_ingredients(
        session,
        draft=draft,
        recipe_version_id=version.id,
    )
    _finish_publication_write_phase(session, "ingredients")
    instruction_ids = copy_recipe_version_instructions(
        session,
        draft=draft,
        recipe_version_id=version.id,
    )
    _finish_publication_write_phase(session, "instructions")
    action_ids = copy_recipe_version_actions(
        session,
        draft=draft,
        recipe_version_id=version.id,
        instruction_ids=instruction_ids,
    )
    _finish_publication_write_phase(session, "actions")
    copy_recipe_version_action_inputs(
        session,
        draft=draft,
        recipe_version_id=version.id,
        action_ids=action_ids,
        ingredient_ids=ingredient_ids,
    )
    _finish_publication_write_phase(session, "action_inputs")
    copy_recipe_version_action_measures(
        session,
        draft=draft,
        action_ids=action_ids,
    )
    _finish_publication_write_phase(session, "action_measures")
    return version


def _find_reused_publication(
    session: Session,
    *,
    author_user_id: UUID,
    action_id: UUID,
    draft: RecipeDraft,
    request_fingerprint: str,
) -> RecipeDraftPublicationResult | None:
    replay = get_recipe_publication_by_action(
        session,
        actor_user_id=author_user_id,
        action_id=action_id,
    )
    if replay is not None:
        return _reused_publication(
            session,
            replay,
            request_fingerprint=request_fingerprint,
            draft=draft,
        )
    completed = get_recipe_publication_by_draft(
        session,
        actor_user_id=author_user_id,
        draft_id=draft.id,
    )
    if completed is None:
        return None
    return _reused_publication(
        session,
        completed,
        request_fingerprint=request_fingerprint,
        draft=draft,
    )


def _reused_publication(
    session: Session,
    publication: RecipeVersionPublication,
    *,
    request_fingerprint: str,
    draft: RecipeDraft,
) -> RecipeDraftPublicationResult:
    if publication.source_draft_id != draft.id:
        raise RecipePublicationIdempotencyConflictError(
            "The publication action or completed draft is bound to another request."
        )
    require_same_request(
        publication.request_fingerprint,
        request_fingerprint,
        conflict_error=RecipePublicationIdempotencyConflictError,
        detail="The publication action or completed draft is bound to another request.",
    )
    if draft.source_version_id is not None:
        if publication.action_id is None:
            raise RuntimeError("A published recipe fork is missing its operation identifier.")
        event = get_preference_event(
            session,
            user_id=publication.actor_user_id,
            event_type="fork",
            action_id=publication.action_id,
        )
        if (
            event is None
            or event.recipe_version_id != draft.source_version_id
            or event.related_recipe_version_id != publication.recipe_version_id
            or event.request_fingerprint != publication.request_fingerprint
        ):
            raise RuntimeError(
                "A published recipe fork is missing its exact immutable preference event."
            )
    return RecipeDraftPublicationResult(
        recipe_version_id=publication.recipe_version_id,
        state="reused",
    )


def _revalidate_duplicate_evidence_phase(
    session: Session,
    *,
    author_user_id: UUID,
    action_id: UUID,
    draft: RecipeDraft,
    prepared: PreparedRecipeDraft,
    payload: RecipeDraftPublicationRequest,
) -> RevalidatedPublicationEvidence:
    review = payload.duplicate_review
    try:
        preflight, decision = revalidate_recipe_duplicate_publication_evidence(
            session,
            preflight_id=review.preflight_id,
            actor_user_id=author_user_id,
            request_fingerprint=prepared.preflight_request_fingerprint,
            subject_fingerprint=prepared.structural_fingerprint,
            source_version_id=draft.source_version_id,
            acknowledged_policy_version=review.policy_version,
            acknowledged_result_digest=review.result_digest,
            decision=review.decision,
            decision_action_id=action_id,
        )
    except RecipeDuplicatePreflightUnavailableError as error:
        raise RecipeForkSourceUnavailableError(
            "The public source recipe is no longer available."
        ) from error
    _finish_publication_write_phase(session, "duplicate_evidence")
    return RevalidatedPublicationEvidence(preflight=preflight, decision=decision)


def _fingerprint_snapshot_phase(
    session: Session,
    *,
    version: RecipeVersion,
    expected: StructuralFingerprint,
) -> None:
    result = fingerprint_and_store_recipe_version(session, version.id)
    stored = result.fingerprint
    if (
        result.state == "incomplete"
        or stored is None
        or stored.algorithm_version != expected.algorithm_version
        or stored.digest != expected.digest
        or stored.canonical_payload != expected.canonical_json
    ):
        raise PublishedRecipeFingerprintMismatchError(
            "The published snapshot differs from its fully validated private draft."
        )
    _finish_publication_write_phase(session, "structural_fingerprint")


def _write_publication_receipt_phase(
    session: Session,
    *,
    version: RecipeVersion,
    draft: RecipeDraft,
    author_user_id: UUID,
    action_id: UUID,
    request_fingerprint: str,
    evidence: RevalidatedPublicationEvidence,
) -> None:
    published_at = datetime.now(UTC)
    session.add(
        RecipeVersionPublication(
            recipe_version_id=version.id,
            state=RECIPE_PUBLICATION_STATE_PUBLISHED,
            state_changed_at=published_at,
            state_changed_by_user_id=author_user_id,
            source_draft_id=draft.id,
            actor_user_id=author_user_id,
            action_id=action_id,
            request_fingerprint=request_fingerprint,
            draft_revision=draft.revision,
            duplicate_preflight_id=evidence.preflight.id,
            duplicate_policy_version=evidence.preflight.policy_version,
            duplicate_result_digest=evidence.preflight.result_digest,
            duplicate_decision_id=(evidence.decision.id if evidence.decision is not None else None),
            community_rules_version=CURRENT_COMMUNITY_RULES_VERSION,
            publication_rights_confirmed_at=published_at,
            published_at=published_at,
        )
    )
    _finish_publication_write_phase(session, "publication_receipt")


def _write_fork_preference_event_phase(
    session: Session,
    *,
    version: RecipeVersion,
    draft: RecipeDraft,
    author_user_id: UUID,
    action_id: UUID,
    request_fingerprint: str,
) -> None:
    source_version_id = draft.source_version_id
    if source_version_id is None:
        return
    record_preference_event(
        session,
        PreferenceEventIntent(
            action_id=action_id,
            user_id=author_user_id,
            recipe_version_id=source_version_id,
            event_type="fork",
            request_fingerprint=request_fingerprint,
        ),
        related_recipe_version_id=version.id,
    )
    _finish_publication_write_phase(session, "fork_preference_event")


def _complete_draft_phase(session: Session, draft: RecipeDraft) -> None:
    draft.status = RECIPE_DRAFT_STATUS_PUBLISHED
    _finish_publication_write_phase(session, "draft_terminal_state")


def publish_recipe_draft(
    session: Session,
    *,
    author_user_id: UUID,
    draft_id: UUID,
    payload: RecipeDraftPublicationRequest,
    action_id: UUID,
) -> RecipeDraftPublicationResult:
    """Validate, recheck evidence, and expose one immutable root or child atomically."""

    draft = get_owned_recipe_draft_for_publication(
        session,
        author_user_id=author_user_id,
        draft_id=draft_id,
    )
    if draft is None:
        raise RecipePublicationNotFoundError(draft_id)
    request_fingerprint = recipe_draft_publication_request_fingerprint(
        draft_id,
        payload,
        source_version_id=draft.source_version_id,
    )

    # A concurrent identical request may have committed while this transaction waited
    # for the draft row lock. Resolve its receipt before interpreting published status.
    reused = _find_reused_publication(
        session,
        author_user_id=author_user_id,
        action_id=action_id,
        draft=draft,
        request_fingerprint=request_fingerprint,
    )
    if reused is not None:
        return reused

    lock_recipe_publication_guard(session)
    reused = _find_reused_publication(
        session,
        author_user_id=author_user_id,
        action_id=action_id,
        draft=draft,
        request_fingerprint=request_fingerprint,
    )
    if reused is not None:
        return reused

    if (
        draft.source_version_id is not None
        and get_preference_event(
            session,
            user_id=author_user_id,
            event_type="fork",
            action_id=action_id,
        )
        is not None
    ):
        raise RecipePublicationIdempotencyConflictError(
            "The publication action is already bound to another fork request."
        )

    if draft.source_version_id is not None:
        source_is_public = session.scalar(
            select(RecipeVersion.id).where(
                RecipeVersion.id == draft.source_version_id,
                publicly_readable_recipe_version_filter(),
            )
        )
        if source_is_public is None:
            raise RecipeForkSourceUnavailableError(
                "The public source recipe is no longer available."
            )

    # Catalog state and the complete canonical subject are authoritative only after
    # entering the same serialization boundary as public candidate recomputation.
    prepared = _prepare_locked_recipe_draft(
        session,
        draft=draft,
        expected_revision=payload.revision,
    )

    evidence = _revalidate_duplicate_evidence_phase(
        session,
        author_user_id=author_user_id,
        action_id=action_id,
        draft=draft,
        prepared=prepared,
        payload=payload,
    )

    version = _copy_draft_snapshot_phases(
        session,
        draft=draft,
        author_user_id=author_user_id,
    )
    _fingerprint_snapshot_phase(
        session,
        version=version,
        expected=prepared.structural_fingerprint,
    )
    _write_publication_receipt_phase(
        session,
        version=version,
        draft=draft,
        author_user_id=author_user_id,
        action_id=action_id,
        request_fingerprint=request_fingerprint,
        evidence=evidence,
    )
    _write_fork_preference_event_phase(
        session,
        version=version,
        draft=draft,
        author_user_id=author_user_id,
        action_id=action_id,
        request_fingerprint=request_fingerprint,
    )
    _complete_draft_phase(session, draft)
    return RecipeDraftPublicationResult(recipe_version_id=version.id, state="created")


publish_original_recipe_draft = publish_recipe_draft


def publication_preflight_response(
    result: RecipeDuplicatePreflightServiceResult,
) -> RecipeDuplicatePreflightResponse:
    """Keep the route adapter explicit while returning the shared evidence schema."""

    return result.response
