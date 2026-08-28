import hashlib
from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, exists, select, text, update
from sqlalchemy.orm import Session

from app.models import (
    CATALOG_REQUEST_PENDING,
    AbuseRateLimitBucket,
    CatalogCurator,
    CommunityModerator,
    IngredientCatalogAuditEvent,
    IngredientCatalogRequest,
    OIDCIdentity,
    PreferenceEvent,
    RecipeDraft,
    RecipeDraftIngredient,
    RecipeDraftInstruction,
    RecipeDraftInstructionAction,
    RecipeDraftInstructionActionInput,
    RecipeDraftInstructionActionMeasure,
    RecipeDuplicateCandidate,
    RecipeDuplicateDecision,
    RecipeDuplicatePreflight,
    RecipeModerationAuditEvent,
    RecipeRating,
    RecipeReport,
    RecipeSave,
    RecipeVersionPublication,
    User,
    UserSession,
)

DELETED_REPORT_FINGERPRINT = hashlib.sha256(b"deleted-account-report").hexdigest()
DELETED_MODERATION_FINGERPRINT = hashlib.sha256(b"deleted-account-moderation-action").hexdigest()


def get_account_user_for_update(session: Session, user_id: UUID) -> User | None:
    return session.scalar(select(User).where(User.id == user_id).with_for_update())


def lock_account_lifecycle_user(session: Session, user_id: UUID) -> None:
    """Serialize destructive lifecycle work before taking individual row locks."""

    session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:account_key, CAST(0 AS bigint)))"),
        {"account_key": f"account-lifecycle\x1f{user_id}"},
    )


def list_oidc_identity_keys_for_user(
    session: Session,
    user_id: UUID,
) -> list[tuple[str, str]]:
    statement = (
        select(OIDCIdentity.issuer, OIDCIdentity.subject)
        .where(OIDCIdentity.user_id == user_id)
        .order_by(OIDCIdentity.issuer, OIDCIdentity.subject)
    )
    return [(issuer, subject) for issuer, subject in session.execute(statement)]


def list_user_sessions_for_update(session: Session, user_id: UUID) -> list[UserSession]:
    """Lock every member session in stable order before locking the user row."""

    statement = (
        select(UserSession)
        .where(UserSession.user_id == user_id)
        .order_by(UserSession.id)
        .with_for_update()
    )
    return list(session.scalars(statement))


def purge_member_private_data(
    session: Session,
    *,
    user_id: UUID,
    deleted_at: datetime,
) -> None:
    """Erase private account state while retaining publication and catalog audit topology."""

    draft_ids = select(RecipeDraft.id).where(RecipeDraft.author_user_id == user_id)
    action_ids = select(RecipeDraftInstructionAction.id).where(
        RecipeDraftInstructionAction.recipe_draft_id.in_(draft_ids)
    )
    execution_options = {"synchronize_session": False}
    session.execute(
        delete(RecipeDraftInstructionActionMeasure)
        .where(
            RecipeDraftInstructionActionMeasure.recipe_draft_instruction_action_id.in_(action_ids)
        )
        .execution_options(**execution_options)
    )
    session.execute(
        delete(RecipeDraftInstructionActionInput)
        .where(RecipeDraftInstructionActionInput.recipe_draft_id.in_(draft_ids))
        .execution_options(**execution_options)
    )
    session.execute(
        delete(RecipeDraftInstructionAction)
        .where(RecipeDraftInstructionAction.recipe_draft_id.in_(draft_ids))
        .execution_options(**execution_options)
    )
    session.execute(
        delete(RecipeDraftInstruction)
        .where(RecipeDraftInstruction.recipe_draft_id.in_(draft_ids))
        .execution_options(**execution_options)
    )
    session.execute(
        delete(RecipeDraftIngredient)
        .where(RecipeDraftIngredient.recipe_draft_id.in_(draft_ids))
        .execution_options(**execution_options)
    )
    session.execute(
        delete(RecipeDraft)
        .where(
            RecipeDraft.author_user_id == user_id,
            RecipeDraft.status.in_(("active", "discarded")),
        )
        .execution_options(**execution_options)
    )
    session.execute(
        update(RecipeDraft)
        .where(
            RecipeDraft.author_user_id == user_id,
            RecipeDraft.status == "published",
        )
        .values(
            title="",
            description=None,
            servings=None,
            updated_at=deleted_at,
        )
        .execution_options(**execution_options)
    )

    private_preflight_ids = select(RecipeDuplicatePreflight.id).where(
        RecipeDuplicatePreflight.actor_user_id == user_id,
        ~exists().where(
            RecipeVersionPublication.duplicate_preflight_id == RecipeDuplicatePreflight.id
        ),
    )
    session.execute(
        delete(RecipeDuplicateDecision)
        .where(RecipeDuplicateDecision.preflight_id.in_(private_preflight_ids))
        .execution_options(**execution_options)
    )
    session.execute(
        delete(RecipeDuplicateCandidate)
        .where(RecipeDuplicateCandidate.preflight_id.in_(private_preflight_ids))
        .execution_options(**execution_options)
    )
    session.execute(
        delete(RecipeDuplicatePreflight)
        .where(RecipeDuplicatePreflight.id.in_(private_preflight_ids))
        .execution_options(**execution_options)
    )

    pending_request_ids = select(IngredientCatalogRequest.id).where(
        IngredientCatalogRequest.requester_user_id == user_id,
        IngredientCatalogRequest.status == CATALOG_REQUEST_PENDING,
    )
    session.execute(
        delete(IngredientCatalogAuditEvent)
        .where(IngredientCatalogAuditEvent.request_id.in_(pending_request_ids))
        .execution_options(**execution_options)
    )
    session.execute(
        delete(IngredientCatalogRequest)
        .where(IngredientCatalogRequest.id.in_(pending_request_ids))
        .execution_options(**execution_options)
    )
    terminal_request_ids = select(IngredientCatalogRequest.id).where(
        IngredientCatalogRequest.requester_user_id == user_id,
        IngredientCatalogRequest.status != CATALOG_REQUEST_PENDING,
    )
    session.execute(
        update(IngredientCatalogAuditEvent)
        .where(
            IngredientCatalogAuditEvent.request_id.in_(terminal_request_ids),
            IngredientCatalogAuditEvent.event_type == "submitted",
        )
        .values(payload=IngredientCatalogAuditEvent.payload.op("-")("context"))
        .execution_options(**execution_options)
    )
    session.execute(
        update(IngredientCatalogRequest)
        .where(IngredientCatalogRequest.id.in_(terminal_request_ids))
        .values(context=None)
        .execution_options(**execution_options)
    )

    for model in (RecipeSave, RecipeRating, PreferenceEvent):
        session.execute(
            delete(model).where(model.user_id == user_id).execution_options(**execution_options)
        )
    session.execute(
        update(RecipeReport)
        .where(RecipeReport.reporter_user_id == user_id)
        .values(details=None, request_fingerprint=DELETED_REPORT_FINGERPRINT)
        .execution_options(**execution_options)
    )
    session.execute(
        update(RecipeModerationAuditEvent)
        .where(RecipeModerationAuditEvent.actor_user_id == user_id)
        .values(
            private_note=None,
            request_fingerprint=DELETED_MODERATION_FINGERPRINT,
        )
        .execution_options(**execution_options)
    )
    session.execute(
        delete(AbuseRateLimitBucket)
        .where(AbuseRateLimitBucket.account_user_id == user_id)
        .execution_options(**execution_options)
    )
    session.execute(
        delete(CommunityModerator)
        .where(CommunityModerator.user_id == user_id)
        .execution_options(**execution_options)
    )
    session.execute(
        delete(CatalogCurator)
        .where(CatalogCurator.user_id == user_id)
        .execution_options(**execution_options)
    )
    session.execute(
        delete(OIDCIdentity)
        .where(OIDCIdentity.user_id == user_id)
        .execution_options(**execution_options)
    )
    session.execute(
        delete(UserSession)
        .where(UserSession.user_id == user_id)
        .execution_options(**execution_options)
    )
