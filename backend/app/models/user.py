from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import CreatedAtMixin, UpdatedAtMixin, UUIDPrimaryKeyMixin

ACCOUNT_KIND_MEMBER = "member"
ACCOUNT_KIND_SYSTEM = "system"
ACCOUNT_KIND_DEMO = "demo"
USER_ACCOUNT_KINDS = (
    ACCOUNT_KIND_MEMBER,
    ACCOUNT_KIND_SYSTEM,
    ACCOUNT_KIND_DEMO,
)

USER_STATUS_ACTIVE = "active"
USER_STATUS_SUSPENDED = "suspended"
USER_STATUS_DELETED = "deleted"
USER_STATUSES = (
    USER_STATUS_ACTIVE,
    USER_STATUS_SUSPENDED,
    USER_STATUS_DELETED,
)


class User(UUIDPrimaryKeyMixin, CreatedAtMixin, UpdatedAtMixin, Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("btrim(email) <> ''", name="email_not_blank"),
        CheckConstraint("btrim(display_name) <> ''", name="display_name_not_blank"),
        CheckConstraint(
            "handle IS NULL OR ("
            "handle = lower(btrim(handle)) "
            "AND handle ~ '^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$'"
            ")",
            name="handle_supported_format",
        ),
        CheckConstraint(
            "profile_description IS NULL OR ("
            "char_length(profile_description) <= 500 "
            "AND profile_description ~ '[^[:space:]]'"
            ")",
            name="profile_description_valid",
        ),
        CheckConstraint(
            f"account_kind IN {USER_ACCOUNT_KINDS!r}",
            name="account_kind_supported",
        ),
        CheckConstraint(
            f"status IN {USER_STATUSES!r}",
            name="status_supported",
        ),
        CheckConstraint(
            "(status = 'deleted' AND account_kind = 'member' "
            "AND email IS NULL AND handle IS NULL "
            "AND display_name = 'Deleted cook' AND profile_description IS NULL "
            "AND deleted_at IS NOT NULL) OR "
            "((status <> 'deleted' OR account_kind <> 'member') "
            "AND email IS NOT NULL AND deleted_at IS NULL)",
            name="lifecycle_shape_valid",
        ),
    )

    email: Mapped[str | None] = mapped_column(String(320), nullable=True, index=True)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    handle: Mapped[str | None] = mapped_column(String(30), nullable=True, unique=True)
    profile_description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    account_kind: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default=ACCOUNT_KIND_MEMBER,
        server_default=text(f"'{ACCOUNT_KIND_MEMBER}'"),
    )
    status: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default=USER_STATUS_ACTIVE,
        server_default=text(f"'{USER_STATUS_ACTIVE}'"),
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
