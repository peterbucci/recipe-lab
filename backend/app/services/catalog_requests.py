from uuid import UUID

from sqlalchemy.orm import Session

from app.catalog_names import catalog_name_digest, lock_catalog_names, normalize_catalog_name
from app.models import (
    CATALOG_REQUEST_APPROVED,
    CATALOG_REQUEST_DUPLICATE,
    CATALOG_REQUEST_PENDING,
    CATALOG_REQUEST_REJECTED,
    Ingredient,
    IngredientAlias,
    IngredientCatalogRequest,
)
from app.repositories.catalog_requests import (
    append_catalog_audit_event,
    find_pending_request_by_normalized_name,
    get_catalog_request,
)
from app.repositories.ingredients import get_ingredient, list_catalog_labels
from app.schemas.ingredient_catalog import (
    ApproveIngredientCatalogRequest,
    DuplicateIngredientCatalogRequest,
    IngredientCatalogRequestCreate,
    IngredientCatalogReviewRequest,
    RejectIngredientCatalogRequest,
)
from app.services.auth import utc_now


class CatalogRequestConflictError(ValueError):
    pass


class CatalogRequestAlreadyReviewedError(ValueError):
    pass


def _normalized_catalog_candidates(session: Session) -> dict[str, str]:
    """Index likely duplicate labels without asserting semantic identity."""

    candidates: dict[str, str] = {}
    for label in sorted(list_catalog_labels(session), key=lambda value: (value.casefold(), value)):
        candidates.setdefault(normalize_catalog_name(label), label)
    return candidates


def submit_catalog_request(
    session: Session,
    *,
    requester_user_id: UUID,
    payload: IngredientCatalogRequestCreate,
) -> IngredientCatalogRequest:
    proposed_name = payload.proposed_name.strip()
    normalized_name = normalize_catalog_name(proposed_name)
    normalized_name_digest = catalog_name_digest(normalized_name)
    context = payload.context.strip() if payload.context is not None else None

    lock_catalog_names(session, {normalized_name})
    catalog_candidate = _normalized_catalog_candidates(session).get(normalized_name)
    if catalog_candidate is not None:
        raise CatalogRequestConflictError(
            f'"{proposed_name}" matches the normalized catalog candidate '
            f'"{catalog_candidate}"; no ingredient identity was inferred.'
        )
    if (
        find_pending_request_by_normalized_name(
            session,
            normalized_name,
            normalized_name_digest,
        )
        is not None
    ):
        raise CatalogRequestConflictError(
            "A request for that normalized ingredient name is already pending review."
        )

    request = IngredientCatalogRequest(
        requester_user_id=requester_user_id,
        proposed_name=proposed_name,
        normalized_name=normalized_name,
        normalized_name_digest=normalized_name_digest,
        context=context,
        status=CATALOG_REQUEST_PENDING,
    )
    session.add(request)
    session.flush()
    append_catalog_audit_event(
        session,
        request_id=request.id,
        actor_user_id=requester_user_id,
        event_type="submitted",
        payload={"proposed_name": proposed_name, "context": context},
    )
    return request


def _pending_request_for_review(
    session: Session,
    request_id: UUID,
) -> IngredientCatalogRequest | None:
    request = get_catalog_request(session, request_id, for_update=True)
    if request is not None and request.status != CATALOG_REQUEST_PENDING:
        raise CatalogRequestAlreadyReviewedError(
            f"Ingredient request {request_id} has already received a decision."
        )
    return request


def _set_terminal_review(
    request: IngredientCatalogRequest,
    *,
    status: str,
    reviewer_user_id: UUID,
    reason: str,
) -> None:
    request.status = status
    request.reviewer_user_id = reviewer_user_id
    request.reviewed_at = utc_now()
    request.decision_reason = reason


def _approve_request(
    session: Session,
    *,
    request: IngredientCatalogRequest,
    reviewer_user_id: UUID,
    payload: ApproveIngredientCatalogRequest,
) -> None:
    canonical_name = payload.canonical_name.strip()
    aliases = [alias.strip() for alias in payload.aliases]
    normalized_names = {
        normalize_catalog_name(canonical_name),
        *(normalize_catalog_name(alias) for alias in aliases),
    }
    if len(normalized_names) != len(aliases) + 1:
        raise CatalogRequestConflictError(
            "The approved canonical name and aliases must be distinct after normalization."
        )

    lock_catalog_names(session, normalized_names)
    catalog_candidates = _normalized_catalog_candidates(session)
    for name in [canonical_name, *aliases]:
        normalized_name = normalize_catalog_name(name)
        catalog_candidate = catalog_candidates.get(normalized_name)
        if catalog_candidate is not None:
            raise CatalogRequestConflictError(
                f'Catalog name or alias "{name}" matches existing candidate "{catalog_candidate}".'
            )
        pending_candidate = find_pending_request_by_normalized_name(
            session,
            normalized_name,
            catalog_name_digest(normalized_name),
        )
        if pending_candidate is not None and pending_candidate.id != request.id:
            raise CatalogRequestConflictError(
                f'Catalog name or alias "{name}" matches another pending request.'
            )

    ingredient = Ingredient(
        canonical_name=canonical_name,
        aliases=[IngredientAlias(alias=alias) for alias in aliases],
    )
    session.add(ingredient)
    session.flush()

    reason = payload.reason.strip()
    provenance = payload.provenance.strip()
    _set_terminal_review(
        request,
        status=CATALOG_REQUEST_APPROVED,
        reviewer_user_id=reviewer_user_id,
        reason=reason,
    )
    request.resolved_ingredient_id = ingredient.id
    request.approved_canonical_name = canonical_name
    request.approved_aliases = aliases
    request.approval_provenance = provenance
    append_catalog_audit_event(
        session,
        request_id=request.id,
        actor_user_id=reviewer_user_id,
        event_type="approved",
        payload={
            "reason": reason,
            "provenance": provenance,
            "canonical_name": canonical_name,
            "aliases": aliases,
            "ingredient_id": str(ingredient.id),
        },
    )


def _reject_request(
    session: Session,
    *,
    request: IngredientCatalogRequest,
    reviewer_user_id: UUID,
    payload: RejectIngredientCatalogRequest,
) -> None:
    reason = payload.reason.strip()
    _set_terminal_review(
        request,
        status=CATALOG_REQUEST_REJECTED,
        reviewer_user_id=reviewer_user_id,
        reason=reason,
    )
    append_catalog_audit_event(
        session,
        request_id=request.id,
        actor_user_id=reviewer_user_id,
        event_type="rejected",
        payload={"reason": reason},
    )


def _mark_request_duplicate(
    session: Session,
    *,
    request: IngredientCatalogRequest,
    reviewer_user_id: UUID,
    payload: DuplicateIngredientCatalogRequest,
) -> None:
    if payload.ingredient_id is not None:
        if get_ingredient(session, payload.ingredient_id) is None:
            raise CatalogRequestConflictError(
                f"Duplicate ingredient target {payload.ingredient_id} does not exist."
            )
        request.resolved_ingredient_id = payload.ingredient_id
        audit_target: dict[str, object] = {"ingredient_id": str(payload.ingredient_id)}
    else:
        duplicate_request_id = payload.request_id
        if duplicate_request_id is None:
            raise RuntimeError("Validated duplicate decision has no target.")
        if duplicate_request_id == request.id:
            raise CatalogRequestConflictError("A request cannot duplicate itself.")
        duplicate_request = get_catalog_request(session, duplicate_request_id)
        if (
            duplicate_request is None
            or duplicate_request.status != CATALOG_REQUEST_APPROVED
            or duplicate_request.resolved_ingredient_id is None
        ):
            raise CatalogRequestConflictError(
                f"Duplicate request target {duplicate_request_id} is not an approved request."
            )
        request.duplicate_of_request_id = duplicate_request_id
        request.resolved_ingredient_id = duplicate_request.resolved_ingredient_id
        audit_target = {
            "request_id": str(duplicate_request_id),
            "ingredient_id": str(duplicate_request.resolved_ingredient_id),
        }

    reason = payload.reason.strip()
    _set_terminal_review(
        request,
        status=CATALOG_REQUEST_DUPLICATE,
        reviewer_user_id=reviewer_user_id,
        reason=reason,
    )
    append_catalog_audit_event(
        session,
        request_id=request.id,
        actor_user_id=reviewer_user_id,
        event_type="duplicate",
        payload={"reason": reason, **audit_target},
    )


def review_catalog_request(
    session: Session,
    *,
    request_id: UUID,
    reviewer_user_id: UUID,
    payload: IngredientCatalogReviewRequest,
) -> IngredientCatalogRequest | None:
    """Apply exactly one terminal decision without committing the caller's transaction."""

    request = _pending_request_for_review(session, request_id)
    if request is None:
        return None
    if isinstance(payload, ApproveIngredientCatalogRequest):
        _approve_request(
            session,
            request=request,
            reviewer_user_id=reviewer_user_id,
            payload=payload,
        )
    elif isinstance(payload, RejectIngredientCatalogRequest):
        _reject_request(
            session,
            request=request,
            reviewer_user_id=reviewer_user_id,
            payload=payload,
        )
    elif isinstance(payload, DuplicateIngredientCatalogRequest):
        _mark_request_duplicate(
            session,
            request=request,
            reviewer_user_id=reviewer_user_id,
            payload=payload,
        )
    else:
        raise TypeError(f"Unsupported catalog review payload: {type(payload)!r}")
    session.flush()
    return request
