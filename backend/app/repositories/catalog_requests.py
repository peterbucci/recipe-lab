from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import CatalogCurator, IngredientCatalogAuditEvent, IngredientCatalogRequest


@dataclass(frozen=True, slots=True)
class IngredientRequestBrowseResult:
    items: list[IngredientCatalogRequest]
    total: int


def is_catalog_curator(session: Session, user_id: UUID) -> bool:
    return session.get(CatalogCurator, user_id) is not None


def find_pending_request_by_normalized_name(
    session: Session,
    normalized_name: str,
    normalized_name_digest: str,
) -> IngredientCatalogRequest | None:
    return session.scalar(
        select(IngredientCatalogRequest).where(
            IngredientCatalogRequest.status == "pending",
            IngredientCatalogRequest.normalized_name_digest == normalized_name_digest,
            IngredientCatalogRequest.normalized_name == normalized_name,
        )
    )


def get_catalog_request(
    session: Session,
    request_id: UUID,
    *,
    for_update: bool = False,
) -> IngredientCatalogRequest | None:
    statement = select(IngredientCatalogRequest).where(IngredientCatalogRequest.id == request_id)
    if for_update:
        statement = statement.with_for_update()
    return session.scalar(statement)


def browse_catalog_requests(
    session: Session,
    *,
    requester_user_id: UUID | None,
    status: str | None,
    offset: int,
    limit: int,
) -> IngredientRequestBrowseResult:
    filters = []
    if requester_user_id is not None:
        filters.append(IngredientCatalogRequest.requester_user_id == requester_user_id)
    if status is not None:
        filters.append(IngredientCatalogRequest.status == status)

    total = (
        session.scalar(select(func.count()).select_from(IngredientCatalogRequest).where(*filters))
        or 0
    )
    statement = (
        select(IngredientCatalogRequest)
        .where(*filters)
        .order_by(IngredientCatalogRequest.created_at.desc(), IngredientCatalogRequest.id)
        .offset(offset)
        .limit(limit)
    )
    return IngredientRequestBrowseResult(items=list(session.scalars(statement)), total=total)


def append_catalog_audit_event(
    session: Session,
    *,
    request_id: UUID,
    actor_user_id: UUID,
    event_type: str,
    payload: dict[str, object],
) -> IngredientCatalogAuditEvent:
    event = IngredientCatalogAuditEvent(
        request_id=request_id,
        actor_user_id=actor_user_id,
        event_type=event_type,
        payload=payload,
    )
    session.add(event)
    session.flush()
    return event
