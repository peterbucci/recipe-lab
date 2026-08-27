from typing import Annotated, cast
from uuid import UUID

from fastapi import APIRouter, Body, Header, Query, Response, status
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import (
    CsrfProtectedSessionDependency,
    RequiredAuthenticatedSessionDependency,
    SessionDependency,
)
from app.api.errors import ApiError
from app.api.member_context import lock_active_member_actor, lock_recipe_moderator_actor
from app.repositories.moderation import (
    ModerationCaseQueueItem,
    browse_moderation_cases,
    get_moderation_case_summary,
    list_case_audit_history,
    list_case_reason_counts,
    list_case_reports,
)
from app.schemas.errors import ErrorResponse
from app.schemas.moderation import (
    DeidentifiedRecipeReport,
    ModerationAction,
    ModerationCaseStatus,
    RecipeModerationActionRequest,
    RecipeModerationActionResponse,
    RecipeModerationAuditActor,
    RecipeModerationAuditEntry,
    RecipeModerationCaseDetail,
    RecipeModerationCasePage,
    RecipeModerationCaseSummary,
    RecipeReportCreate,
    RecipeReportReason,
    RecipeReportReasonCount,
    RecipeReportReceipt,
    RecipeVisibilityState,
)
from app.schemas.users import PublicUserReference
from app.services.moderation import (
    DuplicateRecipeReportError,
    ModerationActionConflictError,
    ModerationCaseNotFoundError,
    ModerationIdempotencyConflictError,
    RecipeReportNotFoundError,
    moderate_recipe_case,
    submit_recipe_report,
)

router = APIRouter()

ActionIdHeader = Annotated[
    UUID,
    Header(
        alias="Idempotency-Key",
        description="Opaque UUID scoped to the current member and moderation operation.",
    ),
]

MODERATION_ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    401: {"model": ErrorResponse, "description": "A valid active member session is required."},
    403: {
        "model": ErrorResponse,
        "description": "CSRF, onboarding, or the separate moderator grant is missing.",
    },
    404: {"model": ErrorResponse, "description": "The recipe or moderation case is unavailable."},
    409: {
        "model": ErrorResponse,
        "description": "The report, action state, or Idempotency-Key conflicts.",
    },
    413: {"model": ErrorResponse, "description": "The request body is too large."},
    422: {"model": ErrorResponse, "description": "The request parameters are invalid."},
    429: {"model": ErrorResponse, "description": "The abuse-control limit was exceeded."},
}
REPORT_RECIPE_RESPONSES: dict[int | str, dict[str, object]] = {
    **MODERATION_ERROR_RESPONSES,
    status.HTTP_200_OK: {
        "model": RecipeReportReceipt,
        "description": "The receipt from an exact idempotent report replay.",
    },
    status.HTTP_201_CREATED: {
        "description": (
            "The private report was accepted. The receipt is not a separately readable "
            "API resource."
        )
    },
}


def _private_no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Vary"] = "Cookie"


def _case_summary(item: ModerationCaseQueueItem) -> RecipeModerationCaseSummary:
    return RecipeModerationCaseSummary(
        recipe_version_id=item.moderation_case.recipe_version_id,
        title=item.recipe.title,
        author=PublicUserReference.model_validate(item.author),
        status=cast(ModerationCaseStatus, item.moderation_case.status),
        visibility_state=cast(RecipeVisibilityState, item.publication.state),
        reporter_count=item.reporter_count,
        opened_at=item.moderation_case.opened_at,
        last_reported_at=item.last_reported_at,
        resolved_at=item.moderation_case.resolved_at,
    )


@router.post(
    "/recipes/{recipe_version_id}/reports",
    response_model=RecipeReportReceipt,
    status_code=status.HTTP_201_CREATED,
    responses=REPORT_RECIPE_RESPONSES,
    summary="Report a public recipe",
    description=(
        "Stores one bounded, private report per member and recipe. Reporter identity and "
        "optional details never enter public recipe responses."
    ),
)
def report_recipe(
    recipe_version_id: UUID,
    payload: Annotated[RecipeReportCreate, Body()],
    action_id: ActionIdHeader,
    response: Response,
    session: SessionDependency,
    authenticated: CsrfProtectedSessionDependency,
) -> RecipeReportReceipt:
    reporter_id = lock_active_member_actor(session, authenticated)
    try:
        result = submit_recipe_report(
            session,
            reporter_user_id=reporter_id,
            recipe_version_id=recipe_version_id,
            payload=payload,
            action_id=action_id,
        )
        session.commit()
    except RecipeReportNotFoundError as error:
        session.rollback()
        raise ApiError(
            status_code=404,
            code="recipe_not_found",
            message="The recipe was not found or is not publicly available.",
        ) from error
    except DuplicateRecipeReportError as error:
        session.rollback()
        raise ApiError(
            status_code=409,
            code="recipe_already_reported",
            message="You already reported this recipe.",
        ) from error
    except ModerationIdempotencyConflictError as error:
        session.rollback()
        raise ApiError(
            status_code=409,
            code="idempotency_key_conflict",
            message="The Idempotency-Key conflicts with an earlier report.",
        ) from error
    except IntegrityError as error:
        session.rollback()
        raise ApiError(
            status_code=409,
            code="recipe_report_conflict",
            message="A matching report was submitted concurrently.",
        ) from error

    if result.state == "reused":
        response.status_code = status.HTTP_200_OK
    _private_no_store(response)
    return RecipeReportReceipt(
        id=result.report.id,
        recipe_version_id=result.report.recipe_version_id,
        submitted_at=result.report.created_at,
    )


@router.get(
    "/moderation/recipe-reports",
    response_model=RecipeModerationCasePage,
    responses=MODERATION_ERROR_RESPONSES,
    summary="List aggregate recipe-report cases",
)
def moderation_queue(
    response: Response,
    session: SessionDependency,
    authenticated: RequiredAuthenticatedSessionDependency,
    page: Annotated[int, Query(ge=1, le=1_000_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    case_status: Annotated[ModerationCaseStatus | None, Query(alias="status")] = None,
) -> RecipeModerationCasePage:
    lock_recipe_moderator_actor(session, authenticated)
    result = browse_moderation_cases(
        session,
        status=case_status,
        offset=(page - 1) * page_size,
        limit=page_size,
    )
    page_response = RecipeModerationCasePage(
        items=[_case_summary(item) for item in result.items],
        page=page,
        page_size=page_size,
        total=result.total,
        total_pages=(result.total + page_size - 1) // page_size,
    )
    session.commit()
    _private_no_store(response)
    return page_response


@router.get(
    "/moderation/recipe-reports/{recipe_version_id}",
    response_model=RecipeModerationCaseDetail,
    responses=MODERATION_ERROR_RESPONSES,
    summary="Read a de-identified recipe-report case",
)
def moderation_case_detail(
    recipe_version_id: UUID,
    response: Response,
    session: SessionDependency,
    authenticated: RequiredAuthenticatedSessionDependency,
) -> RecipeModerationCaseDetail:
    lock_recipe_moderator_actor(session, authenticated)
    summary = get_moderation_case_summary(session, recipe_version_id)
    if summary is None:
        session.rollback()
        raise ApiError(
            status_code=404,
            code="moderation_case_not_found",
            message="The moderation case was not found.",
        )
    reports, reports_total = list_case_reports(session, recipe_version_id, limit=100)
    history, history_total = list_case_audit_history(session, recipe_version_id, limit=100)
    detail = RecipeModerationCaseDetail(
        **_case_summary(summary).model_dump(),
        reason_counts=[
            RecipeReportReasonCount(reason=cast(RecipeReportReason, reason), count=count)
            for reason, count in list_case_reason_counts(session, recipe_version_id)
        ],
        reports=[
            DeidentifiedRecipeReport(
                id=report.id,
                reason=cast(RecipeReportReason, report.reason),
                details=report.details,
                submitted_at=report.created_at,
            )
            for report in reports
        ],
        reports_total=reports_total,
        reports_truncated=reports_total > len(reports),
        history=[
            RecipeModerationAuditEntry(
                id=record.event.id,
                action=cast(ModerationAction, record.event.action),
                previous_status=cast(ModerationCaseStatus, record.event.previous_status),
                status=cast(ModerationCaseStatus, record.event.status),
                visibility_state=cast(RecipeVisibilityState, record.event.visibility_state),
                private_note=record.event.private_note,
                occurred_at=record.event.occurred_at,
                actor=RecipeModerationAuditActor(
                    id=record.actor.id,
                    handle=record.actor.handle,
                    display_name=record.actor.display_name,
                ),
            )
            for record in history
        ],
        history_total=history_total,
        history_truncated=history_total > len(history),
    )
    session.commit()
    _private_no_store(response)
    return detail


@router.post(
    "/moderation/recipe-reports/{recipe_version_id}/actions",
    response_model=RecipeModerationActionResponse,
    responses=MODERATION_ERROR_RESPONSES,
    summary="Hide, restore, or resolve a recipe-report case",
)
def moderate_recipe(
    recipe_version_id: UUID,
    payload: Annotated[RecipeModerationActionRequest, Body()],
    action_id: ActionIdHeader,
    response: Response,
    session: SessionDependency,
    authenticated: CsrfProtectedSessionDependency,
) -> RecipeModerationActionResponse:
    moderator_id = lock_recipe_moderator_actor(session, authenticated, lock_grant=True)
    try:
        result = moderate_recipe_case(
            session,
            moderator_user_id=moderator_id,
            recipe_version_id=recipe_version_id,
            payload=payload,
            action_id=action_id,
        )
        session.commit()
    except ModerationCaseNotFoundError as error:
        session.rollback()
        raise ApiError(
            status_code=404,
            code="moderation_case_not_found",
            message="The moderation case was not found.",
        ) from error
    except ModerationActionConflictError as error:
        session.rollback()
        raise ApiError(
            status_code=409,
            code="moderation_action_conflict",
            message=str(error),
        ) from error
    except ModerationIdempotencyConflictError as error:
        session.rollback()
        raise ApiError(
            status_code=409,
            code="idempotency_key_conflict",
            message="The Idempotency-Key conflicts with an earlier moderation action.",
        ) from error
    except IntegrityError as error:
        session.rollback()
        raise ApiError(
            status_code=409,
            code="moderation_action_conflict",
            message="The moderation case changed concurrently. Refresh and try again.",
        ) from error

    _private_no_store(response)
    return RecipeModerationActionResponse(
        recipe_version_id=result.event.recipe_version_id,
        action=cast(ModerationAction, result.event.action),
        changed=result.state == "created",
        case_status=cast(ModerationCaseStatus, result.event.status),
        visibility_state=cast(RecipeVisibilityState, result.event.visibility_state),
        acted_at=result.event.occurred_at,
    )
