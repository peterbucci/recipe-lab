from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.common import CreatedAtMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.user import User

LOWERCASE_SHA256_PATTERN = "^[0-9a-f]{64}$"
OIDC_LOGIN_PURPOSE_LOGIN = "login"
OIDC_LOGIN_PURPOSE_REAUTHENTICATE = "reauthenticate"
OIDC_LOGIN_PURPOSES = (
    OIDC_LOGIN_PURPOSE_LOGIN,
    OIDC_LOGIN_PURPOSE_REAUTHENTICATE,
)


class OIDCIdentity(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "oidc_identities"
    __table_args__ = (
        CheckConstraint("btrim(issuer) <> ''", name="issuer_not_blank"),
        CheckConstraint("btrim(subject) <> ''", name="subject_not_blank"),
        CheckConstraint("btrim(email) <> ''", name="email_not_blank"),
        CheckConstraint("email_verified", name="email_must_be_verified"),
        UniqueConstraint("issuer", "subject", name="uq_oidc_identities_issuer_subject"),
    )

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    issuer: Mapped[str] = mapped_column(String(512), nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    user: Mapped["User"] = relationship()


class UserSession(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "user_sessions"
    __table_args__ = (
        CheckConstraint(
            f"token_digest ~ '{LOWERCASE_SHA256_PATTERN}'",
            name="token_digest_lowercase_sha256",
        ),
        CheckConstraint(
            f"csrf_token_digest ~ '{LOWERCASE_SHA256_PATTERN}'",
            name="csrf_token_digest_lowercase_sha256",
        ),
        CheckConstraint("expires_at > created_at", name="expires_after_creation"),
        CheckConstraint(
            "revoked_at IS NULL OR revoked_at >= created_at",
            name="revoked_not_before_creation",
        ),
        Index("ix_user_sessions_expires_at", "expires_at"),
    )

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token_digest: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    csrf_token_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    authenticated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship()


class OIDCLoginTransaction(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "oidc_login_transactions"
    __table_args__ = (
        CheckConstraint(
            f"state_digest ~ '{LOWERCASE_SHA256_PATTERN}'",
            name="state_digest_lowercase_sha256",
        ),
        CheckConstraint("char_length(nonce) BETWEEN 16 AND 255", name="nonce_supported_length"),
        CheckConstraint(
            "char_length(pkce_verifier) BETWEEN 43 AND 128",
            name="pkce_verifier_supported_length",
        ),
        CheckConstraint(
            "pkce_verifier ~ '^[A-Za-z0-9._~-]+$'",
            name="pkce_verifier_supported_characters",
        ),
        CheckConstraint(
            "left(return_path, 1) = '/' AND left(return_path, 2) <> '//'",
            name="return_path_is_local",
        ),
        CheckConstraint("expires_at > created_at", name="expires_after_creation"),
        CheckConstraint(
            "consumed_at IS NULL OR consumed_at >= created_at",
            name="consumed_not_before_creation",
        ),
        CheckConstraint(
            "(purpose = 'login' AND bound_session_id IS NULL) OR "
            "(purpose = 'reauthenticate' AND bound_session_id IS NOT NULL)",
            name="purpose_binding_valid",
        ),
        Index("ix_oidc_login_transactions_expires_at", "expires_at"),
        Index("ix_oidc_login_transactions_bound_session_id", "bound_session_id"),
    )

    state_digest: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    nonce: Mapped[str] = mapped_column(String(255), nullable=False)
    pkce_verifier: Mapped[str] = mapped_column(String(128), nullable=False)
    return_path: Mapped[str] = mapped_column(String(2048), nullable=False)
    purpose: Mapped[str] = mapped_column(
        String(24),
        nullable=False,
        default=OIDC_LOGIN_PURPOSE_LOGIN,
        server_default=OIDC_LOGIN_PURPOSE_LOGIN,
    )
    bound_session_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("user_sessions.id", ondelete="CASCADE"),
        nullable=True,
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
