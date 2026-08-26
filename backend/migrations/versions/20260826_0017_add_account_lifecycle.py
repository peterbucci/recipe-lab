"""add private account lifecycle and recent authentication

Revision ID: 20260826_0017
Revises: 20260826_0016
Create Date: 2026-08-26 12:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260826_0017"
down_revision: str | None = "20260826_0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _install_account_deletion_evidence_guards() -> None:
    op.execute(
        sa.text(
            """
            CREATE OR REPLACE FUNCTION prevent_ingredient_catalog_audit_event_mutation()
            RETURNS trigger AS $$
            DECLARE
                request_owner_id uuid;
                request_status text;
                request_owner_is_deleted boolean := false;
            BEGIN
                IF TG_OP IN ('UPDATE', 'DELETE') THEN
                    SELECT request.requester_user_id,
                           request.status,
                           account.status = 'deleted'
                               AND account.account_kind = 'member'
                               AND account.email IS NULL
                               AND account.handle IS NULL
                               AND account.display_name = 'Deleted cook'
                               AND account.deleted_at IS NOT NULL
                    INTO request_owner_id, request_status, request_owner_is_deleted
                    FROM ingredient_catalog_requests AS request
                    JOIN users AS account ON account.id = request.requester_user_id
                    WHERE request.id = OLD.request_id;

                    IF request_owner_is_deleted
                       AND OLD.actor_user_id = request_owner_id THEN
                        IF TG_OP = 'DELETE'
                           AND request_status = 'pending'
                           AND OLD.event_type = 'submitted' THEN
                            RETURN OLD;
                        END IF;

                        IF TG_OP = 'UPDATE'
                           AND request_status <> 'pending'
                           AND OLD.event_type = 'submitted'
                           AND OLD.payload ? 'context'
                           AND NEW.id = OLD.id
                           AND NEW.request_id = OLD.request_id
                           AND NEW.actor_user_id = OLD.actor_user_id
                           AND NEW.event_type = OLD.event_type
                           AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
                           AND NEW.payload = OLD.payload - 'context' THEN
                            RETURN NEW;
                        END IF;
                    END IF;
                END IF;

                RAISE EXCEPTION 'ingredient catalog audit events are append-only';
            END;
            $$ LANGUAGE plpgsql
            """
        )
    )
    op.execute(
        sa.text(
            """
            CREATE OR REPLACE FUNCTION prevent_recipe_duplicate_evidence_mutation()
            RETURNS trigger AS $$
            DECLARE
                evidence_owner_id uuid;
                evidence_preflight_id uuid;
                evidence_owner_is_deleted boolean := false;
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    CASE TG_TABLE_NAME
                        WHEN 'recipe_duplicate_preflights' THEN
                            evidence_owner_id := OLD.actor_user_id;
                            evidence_preflight_id := OLD.id;
                        WHEN 'recipe_duplicate_candidates' THEN
                            evidence_preflight_id := OLD.preflight_id;
                            SELECT preflight.actor_user_id
                            INTO evidence_owner_id
                            FROM recipe_duplicate_preflights AS preflight
                            WHERE preflight.id = OLD.preflight_id;
                        WHEN 'recipe_duplicate_decisions' THEN
                            evidence_preflight_id := OLD.preflight_id;
                            SELECT preflight.actor_user_id
                            INTO evidence_owner_id
                            FROM recipe_duplicate_preflights AS preflight
                            WHERE preflight.id = OLD.preflight_id
                              AND preflight.actor_user_id = OLD.actor_user_id;
                    END CASE;

                    SELECT EXISTS (
                        SELECT 1
                        FROM users AS account
                        WHERE account.id = evidence_owner_id
                          AND account.status = 'deleted'
                          AND account.account_kind = 'member'
                          AND account.email IS NULL
                          AND account.handle IS NULL
                          AND account.display_name = 'Deleted cook'
                          AND account.deleted_at IS NOT NULL
                    )
                    INTO evidence_owner_is_deleted;

                    IF evidence_owner_is_deleted
                       AND NOT EXISTS (
                           SELECT 1
                           FROM recipe_version_publications AS publication
                           WHERE publication.duplicate_preflight_id = evidence_preflight_id
                       ) THEN
                        RETURN OLD;
                    END IF;
                END IF;

                RAISE EXCEPTION 'recipe duplicate evidence is append-only';
            END;
            $$ LANGUAGE plpgsql
            """
        )
    )


def _restore_unconditional_evidence_guards() -> None:
    op.execute(
        sa.text(
            """
            CREATE OR REPLACE FUNCTION prevent_ingredient_catalog_audit_event_mutation()
            RETURNS trigger AS $$
            BEGIN
                RAISE EXCEPTION 'ingredient catalog audit events are append-only';
            END;
            $$ LANGUAGE plpgsql
            """
        )
    )
    op.execute(
        sa.text(
            """
            CREATE OR REPLACE FUNCTION prevent_recipe_duplicate_evidence_mutation()
            RETURNS trigger AS $$
            BEGIN
                RAISE EXCEPTION 'recipe duplicate evidence is append-only';
            END;
            $$ LANGUAGE plpgsql
            """
        )
    )


def upgrade() -> None:
    op.alter_column("users", "email", existing_type=sa.String(length=320), nullable=True)
    op.add_column("users", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.execute(
        sa.text(
            "UPDATE users SET email = NULL, handle = NULL, "
            "display_name = 'Deleted cook', "
            "deleted_at = COALESCE(updated_at, created_at, now()) "
            "WHERE status = 'deleted' AND account_kind = 'member'"
        )
    )
    op.create_check_constraint(
        op.f("ck_users_lifecycle_shape_valid"),
        "users",
        "(status = 'deleted' AND account_kind = 'member' "
        "AND email IS NULL AND handle IS NULL "
        "AND display_name = 'Deleted cook' AND deleted_at IS NOT NULL) OR "
        "((status <> 'deleted' OR account_kind <> 'member') "
        "AND email IS NOT NULL AND deleted_at IS NULL)",
    )

    op.add_column(
        "user_sessions",
        sa.Column(
            "authenticated_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )

    op.add_column(
        "oidc_login_transactions",
        sa.Column(
            "purpose",
            sa.String(length=24),
            server_default="login",
            nullable=False,
        ),
    )
    op.add_column(
        "oidc_login_transactions",
        sa.Column("bound_session_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        op.f("fk_oidc_login_transactions_bound_session_id_user_sessions"),
        "oidc_login_transactions",
        "user_sessions",
        ["bound_session_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_check_constraint(
        op.f("ck_oidc_login_transactions_purpose_binding_valid"),
        "oidc_login_transactions",
        "(purpose = 'login' AND bound_session_id IS NULL) OR "
        "(purpose = 'reauthenticate' AND bound_session_id IS NOT NULL)",
    )
    op.create_index(
        "ix_oidc_login_transactions_bound_session_id",
        "oidc_login_transactions",
        ["bound_session_id"],
        unique=False,
    )
    _install_account_deletion_evidence_guards()


def downgrade() -> None:
    _restore_unconditional_evidence_guards()
    op.drop_index(
        "ix_oidc_login_transactions_bound_session_id",
        table_name="oidc_login_transactions",
    )
    op.drop_constraint(
        op.f("ck_oidc_login_transactions_purpose_binding_valid"),
        "oidc_login_transactions",
        type_="check",
    )
    op.drop_constraint(
        op.f("fk_oidc_login_transactions_bound_session_id_user_sessions"),
        "oidc_login_transactions",
        type_="foreignkey",
    )
    op.drop_column("oidc_login_transactions", "bound_session_id")
    op.drop_column("oidc_login_transactions", "purpose")

    op.drop_column("user_sessions", "authenticated_at")

    op.drop_constraint(
        op.f("ck_users_lifecycle_shape_valid"),
        "users",
        type_="check",
    )
    op.execute(
        sa.text(
            "UPDATE users SET email = "
            "'deleted+' || replace(id::text, '-', '') || '@deleted.invalid' "
            "WHERE email IS NULL"
        )
    )
    op.drop_column("users", "deleted_at")
    op.alter_column("users", "email", existing_type=sa.String(length=320), nullable=False)
