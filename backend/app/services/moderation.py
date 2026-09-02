import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal, cast
from uuid import UUID

from sqlalchemy.orm import Session

from app.models import (
    MODERATION_ACTION_HIDE,
    MODERATION_ACTION_RESOLVE,
    MODERATION_ACTION_RESTORE,
    MODERATION_CASE_OPEN,
    MODERATION_CASE_RESOLVED,
    RECIPE_PUBLICATION_STATE_MODERATION_HIDDEN,
    RecipeModerationAuditEvent,
    RecipeModerationCase,
    RecipeReport,
)
from app.policies.recipe_visibility import (
    RecipeVisibilityState,
    effective_recipe_visibility_state,
)
from app.repositories.moderation import (
    get_moderation_action_by_action,
    get_moderation_case,
    get_moderation_case_publication_for_update,
    get_public_recipe_publication_for_update,
    get_recipe_report_by_action,
    get_recipe_report_by_member_and_version,
)
from app.repositories.recipe_publications import lock_recipe_publication_guard
from app.schemas.moderation import RecipeModerationActionRequest, RecipeReportCreate


class RecipeReportNotFoundError(LookupError):
    pass


class DuplicateRecipeReportError(ValueError):
    pass


class ModerationCaseNotFoundError(LookupError):
    pass


class ModerationActionConflictError(ValueError):
    pass


class ModerationIdempotencyConflictError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class RecipeReportSubmissionResult:
    report: RecipeReport
    state: Literal["created", "reused"]


@dataclass(frozen=True, slots=True)
class ModerationActionResult:
    event: RecipeModerationAuditEvent
    state: Literal["created", "reused"]


def _fingerprint(document: dict[str, object]) -> str:
    canonical = json.dumps(document, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def recipe_report_request_fingerprint(
    recipe_version_id: UUID,
    payload: RecipeReportCreate,
) -> str:
    return _fingerprint(
        {
            "payload": payload.model_dump(mode="json"),
            "recipe_version_id": str(recipe_version_id),
            "schema": "recipe-lab.recipe-report-request",
            "version": 1,
        }
    )


def moderation_action_request_fingerprint(
    recipe_version_id: UUID,
    payload: RecipeModerationActionRequest,
) -> str:
    return _fingerprint(
        {
            "payload": payload.model_dump(mode="json"),
            "recipe_version_id": str(recipe_version_id),
            "schema": "recipe-lab.recipe-moderation-action-request",
            "version": 1,
        }
    )


def submit_recipe_report(
    session: Session,
    *,
    reporter_user_id: UUID,
    recipe_version_id: UUID,
    payload: RecipeReportCreate,
    action_id: UUID,
) -> RecipeReportSubmissionResult:
    """Store one private, idempotent report against a currently public snapshot."""

    request_fingerprint = recipe_report_request_fingerprint(recipe_version_id, payload)
    lock_recipe_publication_guard(session)
    replay = get_recipe_report_by_action(
        session,
        reporter_user_id=reporter_user_id,
        action_id=action_id,
    )
    if replay is not None:
        if replay.request_fingerprint != request_fingerprint:
            raise ModerationIdempotencyConflictError(
                "The report action is already bound to a different request."
            )
        return RecipeReportSubmissionResult(report=replay, state="reused")

    if (
        get_recipe_report_by_member_and_version(
            session,
            reporter_user_id=reporter_user_id,
            recipe_version_id=recipe_version_id,
        )
        is not None
    ):
        raise DuplicateRecipeReportError("You already reported this recipe.")

    publication = get_public_recipe_publication_for_update(session, recipe_version_id)
    if publication is None:
        raise RecipeReportNotFoundError("The recipe is not publicly available.")

    now = datetime.now(UTC)
    moderation_case = get_moderation_case(session, recipe_version_id, for_update=True)
    if moderation_case is None:
        moderation_case = RecipeModerationCase(
            recipe_version_id=recipe_version_id,
            status=MODERATION_CASE_OPEN,
            opened_at=now,
            updated_at=now,
            resolved_at=None,
            reporter_count=1,
            last_reported_at=now,
        )
        session.add(moderation_case)
        session.flush()
    else:
        moderation_case.status = MODERATION_CASE_OPEN
        moderation_case.resolved_at = None
        moderation_case.updated_at = now
        moderation_case.reporter_count += 1
        moderation_case.last_reported_at = now

    report = RecipeReport(
        recipe_version_id=recipe_version_id,
        reporter_user_id=reporter_user_id,
        reason=payload.reason,
        details=payload.details,
        action_id=action_id,
        request_fingerprint=request_fingerprint,
    )
    session.add(report)
    session.flush()
    return RecipeReportSubmissionResult(report=report, state="created")


def _next_change_time(state_changed_at: datetime) -> datetime:
    return max(datetime.now(UTC), state_changed_at + timedelta(microseconds=1))


def moderate_recipe_case(
    session: Session,
    *,
    moderator_user_id: UUID,
    recipe_version_id: UUID,
    payload: RecipeModerationActionRequest,
    action_id: UUID,
) -> ModerationActionResult:
    """Apply one auditable action while preserving the independent author axis."""

    request_fingerprint = moderation_action_request_fingerprint(recipe_version_id, payload)
    lock_recipe_publication_guard(session)
    replay = get_moderation_action_by_action(
        session,
        actor_user_id=moderator_user_id,
        action_id=action_id,
    )
    if replay is not None:
        if replay.request_fingerprint != request_fingerprint:
            raise ModerationIdempotencyConflictError(
                "The moderation action is already bound to a different request."
            )
        return ModerationActionResult(event=replay, state="reused")

    locked = get_moderation_case_publication_for_update(session, recipe_version_id)
    if locked is None:
        raise ModerationCaseNotFoundError("The moderation case was not found.")
    moderation_case, publication = locked
    previous_status = moderation_case.status
    acted_at = _next_change_time(publication.state_changed_at)

    if payload.action == MODERATION_ACTION_HIDE:
        if publication.moderation_hidden_at is not None:
            raise ModerationActionConflictError("The recipe is already hidden by moderation.")
        publication.moderation_hidden_at = acted_at
        publication.state = RECIPE_PUBLICATION_STATE_MODERATION_HIDDEN
        publication.state_changed_at = acted_at
        publication.state_changed_by_user_id = moderator_user_id
    elif payload.action == MODERATION_ACTION_RESTORE:
        if publication.moderation_hidden_at is None:
            raise ModerationActionConflictError("The recipe is not hidden by moderation.")
        publication.moderation_hidden_at = None
        publication.state = effective_recipe_visibility_state(publication)
        publication.state_changed_at = acted_at
        publication.state_changed_by_user_id = moderator_user_id
    elif payload.action == MODERATION_ACTION_RESOLVE:
        if moderation_case.status == MODERATION_CASE_RESOLVED:
            raise ModerationActionConflictError("The moderation case is already resolved.")
        moderation_case.status = MODERATION_CASE_RESOLVED
        moderation_case.resolved_at = acted_at
    else:
        raise ValueError("Unsupported moderation action.")

    moderation_case.updated_at = acted_at
    visibility_state = cast(RecipeVisibilityState, publication.state)
    event = RecipeModerationAuditEvent(
        recipe_version_id=recipe_version_id,
        actor_user_id=moderator_user_id,
        action=payload.action,
        previous_status=previous_status,
        status=moderation_case.status,
        visibility_state=visibility_state,
        private_note=payload.private_note,
        action_id=action_id,
        request_fingerprint=request_fingerprint,
        occurred_at=acted_at,
    )
    session.add(event)
    session.flush()
    return ModerationActionResult(event=event, state="created")
