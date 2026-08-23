"""add secure accounts and server-managed sessions

Revision ID: 20260823_0005
Revises: 20260821_0004
Create Date: 2026-08-23 17:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260823_0005"
down_revision: str | None = "20260821_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CATALOG_AUTHOR_ID = "16746db2-8776-5937-856c-252b72442671"
DEMO_COOK_ID = "1fc5b3b8-cf73-54ce-b5d6-ed3c30df9fd9"
LOWERCASE_SHA256_PATTERN = "^[0-9a-f]{64}$"


def upgrade() -> None:
    op.drop_constraint(op.f("uq_users_email"), "users", type_="unique")
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=False)
    op.add_column("users", sa.Column("handle", sa.String(length=30), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "account_kind",
            sa.String(length=16),
            server_default=sa.text("'member'"),
            nullable=False,
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "status",
            sa.String(length=16),
            server_default=sa.text("'active'"),
            nullable=False,
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.execute(sa.text("UPDATE users SET updated_at = created_at"))
    op.execute(
        sa.text("UPDATE users SET account_kind = 'system' WHERE id = CAST(:id AS uuid)").bindparams(
            id=CATALOG_AUTHOR_ID
        )
    )
    op.execute(
        sa.text("UPDATE users SET account_kind = 'demo' WHERE id = CAST(:id AS uuid)").bindparams(
            id=DEMO_COOK_ID
        )
    )
    op.create_check_constraint(
        op.f("ck_users_handle_supported_format"),
        "users",
        "handle IS NULL OR ("
        "handle = lower(btrim(handle)) "
        "AND handle ~ '^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$'"
        ")",
    )
    op.create_check_constraint(
        op.f("ck_users_account_kind_supported"),
        "users",
        "account_kind IN ('member', 'system', 'demo')",
    )
    op.create_check_constraint(
        op.f("ck_users_status_supported"),
        "users",
        "status IN ('active', 'suspended', 'deleted')",
    )
    op.create_unique_constraint(op.f("uq_users_handle"), "users", ["handle"])

    op.create_table(
        "oidc_identities",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("issuer", sa.String(length=512), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("email_verified", sa.Boolean(), nullable=False),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "email_verified",
            name=op.f("ck_oidc_identities_email_must_be_verified"),
        ),
        sa.CheckConstraint(
            "btrim(email) <> ''",
            name=op.f("ck_oidc_identities_email_not_blank"),
        ),
        sa.CheckConstraint(
            "btrim(issuer) <> ''",
            name=op.f("ck_oidc_identities_issuer_not_blank"),
        ),
        sa.CheckConstraint(
            "btrim(subject) <> ''",
            name=op.f("ck_oidc_identities_subject_not_blank"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_oidc_identities_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_oidc_identities")),
        sa.UniqueConstraint(
            "issuer",
            "subject",
            name="uq_oidc_identities_issuer_subject",
        ),
    )
    op.create_index(
        op.f("ix_oidc_identities_user_id"),
        "oidc_identities",
        ["user_id"],
        unique=False,
    )

    op.create_table(
        "user_sessions",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_digest", sa.String(length=64), nullable=False),
        sa.Column("csrf_token_digest", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            f"csrf_token_digest ~ '{LOWERCASE_SHA256_PATTERN}'",
            name=op.f("ck_user_sessions_csrf_token_digest_lowercase_sha256"),
        ),
        sa.CheckConstraint(
            "expires_at > created_at",
            name=op.f("ck_user_sessions_expires_after_creation"),
        ),
        sa.CheckConstraint(
            "revoked_at IS NULL OR revoked_at >= created_at",
            name=op.f("ck_user_sessions_revoked_not_before_creation"),
        ),
        sa.CheckConstraint(
            f"token_digest ~ '{LOWERCASE_SHA256_PATTERN}'",
            name=op.f("ck_user_sessions_token_digest_lowercase_sha256"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_user_sessions_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_sessions")),
        sa.UniqueConstraint(
            "token_digest",
            name=op.f("uq_user_sessions_token_digest"),
        ),
    )
    op.create_index(
        "ix_user_sessions_expires_at",
        "user_sessions",
        ["expires_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_user_sessions_user_id"),
        "user_sessions",
        ["user_id"],
        unique=False,
    )

    op.create_table(
        "oidc_login_transactions",
        sa.Column("state_digest", sa.String(length=64), nullable=False),
        sa.Column("nonce", sa.String(length=255), nullable=False),
        sa.Column("pkce_verifier", sa.String(length=128), nullable=False),
        sa.Column("return_path", sa.String(length=2048), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "consumed_at IS NULL OR consumed_at >= created_at",
            name=op.f("ck_oidc_login_transactions_consumed_not_before_creation"),
        ),
        sa.CheckConstraint(
            "expires_at > created_at",
            name=op.f("ck_oidc_login_transactions_expires_after_creation"),
        ),
        sa.CheckConstraint(
            "char_length(nonce) BETWEEN 16 AND 255",
            name=op.f("ck_oidc_login_transactions_nonce_supported_length"),
        ),
        sa.CheckConstraint(
            "char_length(pkce_verifier) BETWEEN 43 AND 128",
            name=op.f("ck_oidc_login_transactions_pkce_verifier_supported_length"),
        ),
        sa.CheckConstraint(
            "pkce_verifier ~ '^[A-Za-z0-9._~-]+$'",
            name=op.f("ck_oidc_login_transactions_pkce_verifier_supported_characters"),
        ),
        sa.CheckConstraint(
            "left(return_path, 1) = '/' AND left(return_path, 2) <> '//'",
            name=op.f("ck_oidc_login_transactions_return_path_is_local"),
        ),
        sa.CheckConstraint(
            f"state_digest ~ '{LOWERCASE_SHA256_PATTERN}'",
            name=op.f("ck_oidc_login_transactions_state_digest_lowercase_sha256"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_oidc_login_transactions")),
        sa.UniqueConstraint(
            "state_digest",
            name=op.f("uq_oidc_login_transactions_state_digest"),
        ),
    )
    op.create_index(
        "ix_oidc_login_transactions_expires_at",
        "oidc_login_transactions",
        ["expires_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_oidc_login_transactions_expires_at",
        table_name="oidc_login_transactions",
    )
    op.drop_table("oidc_login_transactions")
    op.drop_index(op.f("ix_user_sessions_user_id"), table_name="user_sessions")
    op.drop_index("ix_user_sessions_expires_at", table_name="user_sessions")
    op.drop_table("user_sessions")
    op.drop_index(op.f("ix_oidc_identities_user_id"), table_name="oidc_identities")
    op.drop_table("oidc_identities")

    op.drop_constraint(op.f("uq_users_handle"), "users", type_="unique")
    op.drop_constraint(op.f("ck_users_status_supported"), "users", type_="check")
    op.drop_constraint(op.f("ck_users_account_kind_supported"), "users", type_="check")
    op.drop_constraint(op.f("ck_users_handle_supported_format"), "users", type_="check")
    op.drop_column("users", "updated_at")
    op.drop_column("users", "status")
    op.drop_column("users", "account_kind")
    op.drop_column("users", "handle")
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.create_unique_constraint(op.f("uq_users_email"), "users", ["email"])
