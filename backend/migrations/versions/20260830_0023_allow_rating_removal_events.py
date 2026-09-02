"""allow rating removal events

Revision ID: 20260830_0023
Revises: 20260830_0022
Create Date: 2026-08-30 20:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260830_0023"
down_revision: str | None = "20260830_0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CONSTRAINT_NAME = "ck_preference_events_context_matches_event_type"

_CONTEXT_WITH_RATING_REMOVALS = """
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
"""

_LEGACY_CONTEXT = _CONTEXT_WITH_RATING_REMOVALS.replace(
    "event_type = 'rating'\n    AND saved_value IS NULL",
    "event_type = 'rating'\n    AND saved_value IS NULL\n    AND rating_value IS NOT NULL",
)


def upgrade() -> None:
    op.drop_constraint(op.f(_CONSTRAINT_NAME), "preference_events", type_="check")
    op.create_check_constraint(
        op.f(_CONSTRAINT_NAME),
        "preference_events",
        sa.text(_CONTEXT_WITH_RATING_REMOVALS),
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "DELETE FROM preference_events WHERE event_type = 'rating' AND rating_value IS NULL"
        )
    )
    op.drop_constraint(op.f(_CONSTRAINT_NAME), "preference_events", type_="check")
    op.create_check_constraint(
        op.f(_CONSTRAINT_NAME),
        "preference_events",
        sa.text(_LEGACY_CONTEXT),
    )
