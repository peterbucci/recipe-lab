from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.catalog_names import normalize_catalog_name
from app.db.query import LIKE_ESCAPE, literal_contains_pattern
from app.models import (
    CatalogCurator,
    Ingredient,
    IngredientAlias,
    IngredientCatalogAuditEvent,
    IngredientCatalogRequest,
)


@dataclass(frozen=True, slots=True)
class IngredientRequestBrowseResult:
    items: list[IngredientCatalogRequest]
    total: int


def is_catalog_curator(
    session: Session,
    user_id: UUID,
    *,
    for_update: bool = False,
) -> bool:
    statement = select(CatalogCurator.user_id).where(CatalogCurator.user_id == user_id)
    if for_update:
        statement = statement.with_for_update()
    return session.scalar(statement) is not None


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
    include_resolved_ingredient: bool = False,
) -> IngredientCatalogRequest | None:
    statement = select(IngredientCatalogRequest).where(IngredientCatalogRequest.id == request_id)
    if include_resolved_ingredient:
        statement = statement.options(
            selectinload(IngredientCatalogRequest.resolved_ingredient).selectinload(
                Ingredient.aliases
            )
        )
    if for_update:
        statement = statement.with_for_update()
    return session.scalar(statement)


def browse_catalog_requests(
    session: Session,
    *,
    requester_user_id: UUID | None,
    status: str | None,
    search: str | None,
    offset: int,
    limit: int,
    include_resolved_ingredient: bool = False,
    include_approval_snapshot_matches: bool = False,
    reviewed_only: bool = False,
) -> IngredientRequestBrowseResult:
    filters = []
    if requester_user_id is not None:
        filters.append(IngredientCatalogRequest.requester_user_id == requester_user_id)
    if status is not None:
        filters.append(IngredientCatalogRequest.status == status)
    if reviewed_only:
        filters.append(IngredientCatalogRequest.reviewed_at.is_not(None))
    if search is not None:
        literal_pattern = literal_contains_pattern(search)
        normalized_pattern = literal_contains_pattern(normalize_catalog_name(search))
        resolved_alias_match = (
            select(IngredientAlias.id)
            .where(
                IngredientAlias.ingredient_id == Ingredient.id,
                IngredientAlias.alias.ilike(literal_pattern, escape=LIKE_ESCAPE),
            )
            .exists()
        )
        resolved_ingredient_match = (
            select(Ingredient.id)
            .where(
                Ingredient.id == IngredientCatalogRequest.resolved_ingredient_id,
                or_(
                    Ingredient.canonical_name.ilike(literal_pattern, escape=LIKE_ESCAPE),
                    resolved_alias_match,
                ),
            )
            .exists()
        )
        search_matches = [
            IngredientCatalogRequest.proposed_name.ilike(
                literal_pattern,
                escape=LIKE_ESCAPE,
            ),
            IngredientCatalogRequest.normalized_name.ilike(
                normalized_pattern,
                escape=LIKE_ESCAPE,
            ),
            resolved_ingredient_match,
        ]
        if include_approval_snapshot_matches:
            approved_alias = func.jsonb_array_elements_text(
                IngredientCatalogRequest.approved_aliases
            ).table_valued("value")
            approved_alias_match = (
                select(approved_alias.c.value)
                .where(approved_alias.c.value.ilike(literal_pattern, escape=LIKE_ESCAPE))
                .exists()
            )
            search_matches.extend(
                (
                    IngredientCatalogRequest.approved_canonical_name.ilike(
                        literal_pattern,
                        escape=LIKE_ESCAPE,
                    ),
                    approved_alias_match,
                )
            )
        filters.append(or_(*search_matches))

    total = (
        session.scalar(select(func.count()).select_from(IngredientCatalogRequest).where(*filters))
        or 0
    )
    ordering: list[Any] = []
    if reviewed_only:
        ordering.append(IngredientCatalogRequest.reviewed_at.desc())
    elif status is None:
        ordering.append(case((IngredientCatalogRequest.status == "pending", 0), else_=1))
    statement = (
        select(IngredientCatalogRequest)
        .where(*filters)
        .order_by(
            *ordering,
            IngredientCatalogRequest.created_at.desc(),
            IngredientCatalogRequest.id,
        )
        .offset(offset)
        .limit(limit)
    )
    if include_resolved_ingredient:
        statement = statement.options(
            selectinload(IngredientCatalogRequest.resolved_ingredient).selectinload(
                Ingredient.aliases
            )
        )
    return IngredientRequestBrowseResult(items=list(session.scalars(statement)), total=total)


def find_catalog_request_candidates(
    session: Session,
    *,
    request_id: UUID,
    search_terms: list[str],
    limit: int,
) -> list[IngredientCatalogRequest]:
    """Return bounded advisory pending/approved request candidates."""

    patterns = [literal_contains_pattern(term) for term in search_terms if term]
    if not patterns:
        return []
    matches = [
        or_(
            IngredientCatalogRequest.proposed_name.ilike(pattern, escape=LIKE_ESCAPE),
            IngredientCatalogRequest.normalized_name.ilike(pattern, escape=LIKE_ESCAPE),
        )
        for pattern in patterns
    ]
    statement = (
        select(IngredientCatalogRequest)
        .where(
            IngredientCatalogRequest.id != request_id,
            IngredientCatalogRequest.status.in_(("pending", "approved")),
            or_(*matches),
        )
        .order_by(
            case((IngredientCatalogRequest.status == "approved", 0), else_=1),
            IngredientCatalogRequest.created_at.desc(),
            IngredientCatalogRequest.id,
        )
        .limit(limit)
    )
    return list(session.scalars(statement))


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
