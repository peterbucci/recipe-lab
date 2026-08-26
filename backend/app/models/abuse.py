from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

RATE_LIMIT_DIMENSION_ACCOUNT = "account"
RATE_LIMIT_DIMENSION_IDENTITY = "identity"
RATE_LIMIT_DIMENSION_NETWORK = "network"
RATE_LIMIT_DIMENSIONS = (
    RATE_LIMIT_DIMENSION_ACCOUNT,
    RATE_LIMIT_DIMENSION_IDENTITY,
    RATE_LIMIT_DIMENSION_NETWORK,
)


class AbuseRateLimitBucket(Base):
    """Durable fixed-window counters shared by every application process."""

    __tablename__ = "abuse_rate_limit_buckets"
    __table_args__ = (
        CheckConstraint("btrim(operation) <> ''", name="operation_not_blank"),
        CheckConstraint(
            f"dimension IN {RATE_LIMIT_DIMENSIONS!r}",
            name="dimension_supported",
        ),
        CheckConstraint(
            "subject_digest ~ '^[0-9a-f]{64}$'",
            name="subject_digest_sha256",
        ),
        CheckConstraint("request_count >= 1", name="request_count_positive"),
        CheckConstraint("expires_at > window_started_at", name="expires_after_window_start"),
        CheckConstraint(
            "(dimension = 'account' AND account_user_id IS NOT NULL) OR "
            "(dimension IN ('identity', 'network') AND account_user_id IS NULL)",
            name="account_binding_consistent",
        ),
        Index("ix_abuse_rate_limit_buckets_expires_at", "expires_at"),
        Index("ix_abuse_rate_limit_buckets_account_user_id", "account_user_id"),
    )

    operation: Mapped[str] = mapped_column(String(32), primary_key=True)
    dimension: Mapped[str] = mapped_column(String(16), primary_key=True)
    subject_digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_user_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
    )
    window_started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        primary_key=True,
    )
    request_count: Mapped[int] = mapped_column(Integer, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
