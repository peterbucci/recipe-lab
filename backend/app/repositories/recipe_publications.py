from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models import RecipeVersion, RecipeVersionPublication

RECIPE_PUBLICATION_ADVISORY_LOCK_ID = 0x52435027


def lock_recipe_publication_guard(session: Session) -> None:
    """Serialize candidate revalidation and public visibility changes."""

    session.execute(
        text("SELECT pg_advisory_xact_lock(:lock_id)"),
        {"lock_id": RECIPE_PUBLICATION_ADVISORY_LOCK_ID},
    )


def get_recipe_publication_by_action(
    session: Session,
    *,
    actor_user_id: UUID,
    action_id: UUID,
) -> RecipeVersionPublication | None:
    return session.scalar(
        select(RecipeVersionPublication).where(
            RecipeVersionPublication.actor_user_id == actor_user_id,
            RecipeVersionPublication.action_id == action_id,
        )
    )


def get_recipe_publication_by_draft(
    session: Session,
    *,
    actor_user_id: UUID,
    draft_id: UUID,
) -> RecipeVersionPublication | None:
    return session.scalar(
        select(RecipeVersionPublication).where(
            RecipeVersionPublication.actor_user_id == actor_user_id,
            RecipeVersionPublication.source_draft_id == draft_id,
        )
    )


def get_owned_recipe_publication_for_update(
    session: Session,
    *,
    actor_user_id: UUID,
    recipe_version_id: UUID,
) -> RecipeVersionPublication | None:
    """Lock one exact publication only when the session member authored its version."""

    return session.scalar(
        select(RecipeVersionPublication)
        .join(
            RecipeVersion,
            RecipeVersion.id == RecipeVersionPublication.recipe_version_id,
        )
        .where(
            RecipeVersionPublication.recipe_version_id == recipe_version_id,
            RecipeVersion.created_by_user_id == actor_user_id,
        )
        .with_for_update(of=RecipeVersionPublication)
    )
