from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.common import CreatedAtMixin, UpdatedAtMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.recipe import RecipeVersionPublication
    from app.models.user import User


RECIPE_REPORT_REASON_SPAM = "spam"
RECIPE_REPORT_REASON_HARASSMENT = "harassment"
RECIPE_REPORT_REASON_DANGEROUS = "dangerous_content"
RECIPE_REPORT_REASON_RIGHTS = "intellectual_property"
RECIPE_REPORT_REASON_OTHER = "other"
RECIPE_REPORT_REASONS = (
    RECIPE_REPORT_REASON_SPAM,
    RECIPE_REPORT_REASON_HARASSMENT,
    RECIPE_REPORT_REASON_DANGEROUS,
    RECIPE_REPORT_REASON_RIGHTS,
    RECIPE_REPORT_REASON_OTHER,
)

MODERATION_CASE_OPEN = "open"
MODERATION_CASE_RESOLVED = "resolved"
MODERATION_CASE_STATUSES = (
    MODERATION_CASE_OPEN,
    MODERATION_CASE_RESOLVED,
)

MODERATION_ACTION_HIDE = "hide"
MODERATION_ACTION_RESTORE = "restore"
MODERATION_ACTION_RESOLVE = "resolve"
MODERATION_ACTIONS = (
    MODERATION_ACTION_HIDE,
    MODERATION_ACTION_RESTORE,
    MODERATION_ACTION_RESOLVE,
)


class CommunityModerator(CreatedAtMixin, Base):
    """A grant kept deliberately separate from ingredient-catalog curation."""

    __tablename__ = "community_moderators"

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


class RecipeModerationCase(UpdatedAtMixin, Base):
    """One aggregate moderation queue entry for an immutable recipe version."""

    __tablename__ = "recipe_moderation_cases"
    __table_args__ = (
        CheckConstraint(
            f"status IN {MODERATION_CASE_STATUSES!r}",
            name="status_supported",
        ),
        CheckConstraint(
            "(status = 'open' AND resolved_at IS NULL) OR "
            "(status = 'resolved' AND resolved_at IS NOT NULL)",
            name="resolution_consistent",
        ),
        CheckConstraint("reporter_count >= 1", name="reporter_count_positive"),
        Index("ix_recipe_moderation_cases_status_updated", "status", "updated_at"),
    )

    recipe_version_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("recipe_version_publications.recipe_version_id", ondelete="RESTRICT"),
        primary_key=True,
    )
    status: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default=MODERATION_CASE_OPEN,
        server_default=text(f"'{MODERATION_CASE_OPEN}'"),
    )
    opened_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reporter_count: Mapped[int] = mapped_column(nullable=False)
    last_reported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    publication: Mapped["RecipeVersionPublication"] = relationship(viewonly=True)
    reports: Mapped[list["RecipeReport"]] = relationship(
        back_populates="moderation_case",
        order_by="RecipeReport.created_at",
        passive_deletes="all",
    )
    audit_events: Mapped[list["RecipeModerationAuditEvent"]] = relationship(
        back_populates="moderation_case",
        order_by="RecipeModerationAuditEvent.id",
        passive_deletes="all",
    )


class RecipeReport(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """Private member report; reporter identity never belongs in public serializers."""

    __tablename__ = "recipe_reports"
    __table_args__ = (
        CheckConstraint(
            f"reason IN {RECIPE_REPORT_REASONS!r}",
            name="reason_supported",
        ),
        CheckConstraint(
            "details IS NULL OR (btrim(details) <> '' AND char_length(details) <= 1000)",
            name="details_bounded",
        ),
        UniqueConstraint(
            "recipe_version_id",
            "reporter_user_id",
            name="uq_recipe_reports_version_reporter",
        ),
        UniqueConstraint(
            "reporter_user_id",
            "action_id",
            name="uq_recipe_reports_reporter_action",
        ),
        CheckConstraint(
            "request_fingerprint ~ '^[0-9a-f]{64}$'",
            name="request_fingerprint_sha256",
        ),
        Index("ix_recipe_reports_version_created", "recipe_version_id", "created_at"),
    )

    recipe_version_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("recipe_moderation_cases.recipe_version_id", ondelete="RESTRICT"),
        nullable=False,
    )
    reporter_user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    reason: Mapped[str] = mapped_column(String(32), nullable=False)
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    action_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)

    moderation_case: Mapped[RecipeModerationCase] = relationship(back_populates="reports")
    reporter: Mapped["User"] = relationship()


class RecipeModerationAuditEvent(Base):
    """Append-only moderator action evidence, including private decision notes."""

    __tablename__ = "recipe_moderation_audit_events"
    __table_args__ = (
        CheckConstraint(
            f"action IN {MODERATION_ACTIONS!r}",
            name="action_supported",
        ),
        CheckConstraint(
            f"previous_status IN {MODERATION_CASE_STATUSES!r}",
            name="previous_status_supported",
        ),
        CheckConstraint(
            f"status IN {MODERATION_CASE_STATUSES!r}",
            name="status_supported",
        ),
        CheckConstraint(
            "visibility_state IN ('published', 'author_withdrawn', 'moderation_hidden')",
            name="visibility_state_supported",
        ),
        CheckConstraint(
            "private_note IS NULL OR ("
            "btrim(private_note) <> '' AND char_length(private_note) <= 1000)",
            name="private_note_bounded",
        ),
        CheckConstraint(
            "request_fingerprint ~ '^[0-9a-f]{64}$'",
            name="request_fingerprint_sha256",
        ),
        UniqueConstraint(
            "actor_user_id",
            "action_id",
            name="uq_recipe_moderation_audit_events_actor_action",
        ),
        Index(
            "ix_recipe_moderation_audit_events_case_occurred_id",
            "recipe_version_id",
            "occurred_at",
            "id",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    recipe_version_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("recipe_moderation_cases.recipe_version_id", ondelete="RESTRICT"),
        nullable=False,
    )
    actor_user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    previous_status: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    visibility_state: Mapped[str] = mapped_column(String(24), nullable=False)
    private_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    action_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    moderation_case: Mapped[RecipeModerationCase] = relationship(back_populates="audit_events")
    actor: Mapped["User"] = relationship()
