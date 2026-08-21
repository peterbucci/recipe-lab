from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

PREFERENCE_EVENT_TYPES = ("view", "save", "rating", "fork")


class PreferenceEvent(Base):
    __tablename__ = "preference_events"
    __table_args__ = (
        CheckConstraint(
            "event_type IN ('view', 'save', 'rating', 'fork')",
            name="event_type_supported",
        ),
        CheckConstraint(
            """
            (
                event_type = 'view'
                AND saved_value IS NULL
                AND rating_value IS NULL
                AND related_recipe_version_id IS NULL
                AND request_fingerprint IS NULL
            )
            OR (
                event_type = 'save'
                AND saved_value IS NOT NULL
                AND rating_value IS NULL
                AND related_recipe_version_id IS NULL
                AND request_fingerprint IS NULL
            )
            OR (
                event_type = 'rating'
                AND saved_value IS NULL
                AND rating_value IS NOT NULL
                AND related_recipe_version_id IS NULL
                AND request_fingerprint IS NULL
            )
            OR (
                event_type = 'fork'
                AND saved_value IS NULL
                AND rating_value IS NULL
                AND related_recipe_version_id IS NOT NULL
                AND request_fingerprint IS NOT NULL
            )
            """,
            name="context_matches_event_type",
        ),
        CheckConstraint(
            "rating_value IS NULL OR rating_value BETWEEN 1 AND 5",
            name="rating_value_supported_range",
        ),
        CheckConstraint(
            "related_recipe_version_id IS NULL OR related_recipe_version_id <> recipe_version_id",
            name="related_recipe_version_differs",
        ),
        CheckConstraint(
            "request_fingerprint IS NULL OR request_fingerprint ~ '^[0-9a-f]{64}$'",
            name="request_fingerprint_lowercase_sha256",
        ),
        UniqueConstraint(
            "related_recipe_version_id",
            name="uq_preference_events_related_recipe_version_id",
        ),
        Index(
            "ix_preference_events_user_type_occurred_id",
            "user_id",
            "event_type",
            "occurred_at",
            "id",
        ),
        Index(
            "ix_preference_events_recipe_version_type_occurred_id",
            "recipe_version_id",
            "event_type",
            "occurred_at",
            "id",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    recipe_version_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("recipe_versions.id", ondelete="RESTRICT"),
        nullable=False,
    )
    event_type: Mapped[str] = mapped_column(String(16), nullable=False)
    saved_value: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    rating_value: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    related_recipe_version_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("recipe_versions.id", ondelete="RESTRICT"),
        nullable=True,
    )
    request_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
