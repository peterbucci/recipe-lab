from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.common import CreatedAtMixin, UpdatedAtMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.ingredient import Ingredient
    from app.models.user import User


CATALOG_REQUEST_PENDING = "pending"
CATALOG_REQUEST_APPROVED = "approved"
CATALOG_REQUEST_REJECTED = "rejected"
CATALOG_REQUEST_DUPLICATE = "duplicate"
CATALOG_REQUEST_STATUSES = (
    CATALOG_REQUEST_PENDING,
    CATALOG_REQUEST_APPROVED,
    CATALOG_REQUEST_REJECTED,
    CATALOG_REQUEST_DUPLICATE,
)


class CatalogCurator(CreatedAtMixin, Base):
    """A narrowly scoped grant to review ingredient-catalog requests."""

    __tablename__ = "catalog_curators"

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    granted_by_user_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=True,
    )

    user: Mapped["User"] = relationship(foreign_keys=[user_id])
    granted_by_user: Mapped["User | None"] = relationship(foreign_keys=[granted_by_user_id])


class IngredientCatalogRequest(
    UUIDPrimaryKeyMixin,
    CreatedAtMixin,
    UpdatedAtMixin,
    Base,
):
    """Untrusted member input kept separate from selectable catalog identities.

    Terminal review fields form the durable audit record. Approval snapshots the
    reviewed canonical name, aliases, and provenance used in the same transaction
    that creates the catalog rows.
    """

    __tablename__ = "ingredient_catalog_requests"

    requester_user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    proposed_name: Mapped[str] = mapped_column(String(200), nullable=False)
    normalized_name: Mapped[str] = mapped_column(Text, nullable=False)
    normalized_name_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    context: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default=CATALOG_REQUEST_PENDING,
        server_default=text(f"'{CATALOG_REQUEST_PENDING}'"),
    )
    reviewer_user_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_reason: Mapped[str | None] = mapped_column(String(1_000), nullable=True)
    resolved_ingredient_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ingredients.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    duplicate_of_request_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ingredient_catalog_requests.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    approved_canonical_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    approved_aliases: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    approval_provenance: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint("btrim(proposed_name) <> ''", name="proposed_name_not_blank"),
        CheckConstraint("btrim(normalized_name) <> ''", name="normalized_name_not_blank"),
        CheckConstraint(
            "normalized_name_digest ~ '^[0-9a-f]{64}$'",
            name="name_digest_sha256",
        ),
        CheckConstraint(
            "context IS NULL OR btrim(context) <> ''",
            name="context_not_blank",
        ),
        CheckConstraint(
            f"status IN {CATALOG_REQUEST_STATUSES!r}",
            name="status_supported",
        ),
        CheckConstraint(
            "decision_reason IS NULL OR btrim(decision_reason) <> ''",
            name="decision_reason_not_blank",
        ),
        CheckConstraint(
            "approved_canonical_name IS NULL OR btrim(approved_canonical_name) <> ''",
            name="approved_name_not_blank",
        ),
        CheckConstraint(
            "approved_aliases IS NULL OR jsonb_typeof(approved_aliases) = 'array'",
            name="approved_aliases_array",
        ),
        CheckConstraint(
            "approval_provenance IS NULL OR btrim(approval_provenance) <> ''",
            name="approval_provenance_not_blank",
        ),
        CheckConstraint(
            "duplicate_of_request_id IS NULL OR duplicate_of_request_id <> id",
            name="duplicate_not_self",
        ),
        CheckConstraint(
            "(status = 'pending' AND reviewer_user_id IS NULL AND reviewed_at IS NULL "
            "AND decision_reason IS NULL AND resolved_ingredient_id IS NULL "
            "AND duplicate_of_request_id IS NULL AND approved_canonical_name IS NULL "
            "AND approved_aliases IS NULL AND approval_provenance IS NULL) OR "
            "(status = 'approved' AND reviewer_user_id IS NOT NULL AND reviewed_at IS NOT NULL "
            "AND decision_reason IS NOT NULL AND resolved_ingredient_id IS NOT NULL "
            "AND duplicate_of_request_id IS NULL AND approved_canonical_name IS NOT NULL "
            "AND approved_aliases IS NOT NULL AND approval_provenance IS NOT NULL) OR "
            "(status = 'rejected' AND reviewer_user_id IS NOT NULL AND reviewed_at IS NOT NULL "
            "AND decision_reason IS NOT NULL AND resolved_ingredient_id IS NULL "
            "AND duplicate_of_request_id IS NULL AND approved_canonical_name IS NULL "
            "AND approved_aliases IS NULL AND approval_provenance IS NULL) OR "
            "(status = 'duplicate' AND reviewer_user_id IS NOT NULL AND reviewed_at IS NOT NULL "
            "AND decision_reason IS NOT NULL AND resolved_ingredient_id IS NOT NULL "
            "AND approved_canonical_name IS NULL AND approved_aliases IS NULL "
            "AND approval_provenance IS NULL)",
            name="review_state_consistent",
        ),
        Index(
            "uq_ingredient_catalog_requests_pending_name_normalized",
            normalized_name_digest,
            unique=True,
            postgresql_where=text("status = 'pending'"),
        ),
        Index(
            "ix_ingredient_catalog_requests_status_created_at",
            "status",
            "created_at",
        ),
    )

    requester: Mapped["User"] = relationship(foreign_keys=[requester_user_id])
    reviewer: Mapped["User | None"] = relationship(foreign_keys=[reviewer_user_id])
    resolved_ingredient: Mapped["Ingredient | None"] = relationship()
    duplicate_of_request: Mapped["IngredientCatalogRequest | None"] = relationship(
        remote_side="IngredientCatalogRequest.id"
    )


class IngredientCatalogAuditEvent(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """Append-only audit evidence for request submission and curator decisions."""

    __tablename__ = "ingredient_catalog_audit_events"

    request_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ingredient_catalog_requests.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    actor_user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    event_type: Mapped[str] = mapped_column(String(16), nullable=False)
    payload: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "event_type IN ('submitted', 'approved', 'rejected', 'duplicate')",
            name="event_type_supported",
        ),
        CheckConstraint("jsonb_typeof(payload) = 'object'", name="payload_object"),
        Index(
            "ix_ingredient_catalog_audit_events_request_created_at",
            "request_id",
            "created_at",
        ),
    )

    request: Mapped[IngredientCatalogRequest] = relationship()
    actor: Mapped["User"] = relationship()
