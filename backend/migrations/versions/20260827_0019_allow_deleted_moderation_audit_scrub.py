"""allow bounded privacy scrubs for deleted moderation actors

Revision ID: 20260827_0019
Revises: 20260826_0018
Create Date: 2026-08-27 12:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260827_0019"
down_revision: str | None = "20260826_0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MODERATION_AUDIT_GUARD = "prevent_recipe_moderation_audit_event_mutation"
DELETED_MODERATION_FINGERPRINT = "9a9300f163addc43a5ac7856d58a20073032e15d5cb3f54878c450887b75474d"


def upgrade() -> None:
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION {MODERATION_AUDIT_GUARD}()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            IF TG_OP = 'UPDATE'
               AND EXISTS (
                    SELECT 1
                    FROM users
                    WHERE id = OLD.actor_user_id
                      AND account_kind = 'member'
                      AND status = 'deleted'
                      AND email IS NULL
                      AND handle IS NULL
                      AND display_name = 'Deleted cook'
                      AND deleted_at IS NOT NULL
               )
               AND NEW.id IS NOT DISTINCT FROM OLD.id
               AND NEW.recipe_version_id IS NOT DISTINCT FROM OLD.recipe_version_id
               AND NEW.actor_user_id IS NOT DISTINCT FROM OLD.actor_user_id
               AND NEW.action IS NOT DISTINCT FROM OLD.action
               AND NEW.previous_status IS NOT DISTINCT FROM OLD.previous_status
               AND NEW.status IS NOT DISTINCT FROM OLD.status
               AND NEW.visibility_state IS NOT DISTINCT FROM OLD.visibility_state
               AND NEW.action_id IS NOT DISTINCT FROM OLD.action_id
               AND NEW.occurred_at IS NOT DISTINCT FROM OLD.occurred_at
               AND NEW.private_note IS NULL
               AND NEW.request_fingerprint = '{DELETED_MODERATION_FINGERPRINT}'
            THEN
                RETURN NEW;
            END IF;

            RAISE EXCEPTION USING
                ERRCODE = '23514',
                MESSAGE = 'recipe moderation audit events are append-only',
                CONSTRAINT = 'ck_recipe_moderation_audit_events_append_only';
        END;
        $$
        """
    )
    op.execute(
        f"""
        UPDATE recipe_moderation_audit_events AS event
        SET private_note = NULL,
            request_fingerprint = '{DELETED_MODERATION_FINGERPRINT}'
        FROM users AS actor
        WHERE actor.id = event.actor_user_id
          AND actor.account_kind = 'member'
          AND actor.status = 'deleted'
          AND actor.email IS NULL
          AND actor.handle IS NULL
          AND actor.display_name = 'Deleted cook'
          AND actor.deleted_at IS NOT NULL
          AND (
                event.private_note IS NOT NULL
                OR event.request_fingerprint <> '{DELETED_MODERATION_FINGERPRINT}'
          )
        """
    )


def downgrade() -> None:
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION {MODERATION_AUDIT_GUARD}()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                MESSAGE = 'recipe moderation audit events are append-only',
                CONSTRAINT = 'ck_recipe_moderation_audit_events_append_only';
        END;
        $$
        """
    )
