from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal, cast
from uuid import UUID

from sqlalchemy.orm import Session

from app.models import (
    RECIPE_PUBLICATION_STATE_AUTHOR_WITHDRAWN,
    RECIPE_PUBLICATION_STATE_PUBLISHED,
    RecipeVersionPublication,
)
from app.repositories.recipe_publications import (
    get_owned_recipe_publication_for_update,
    lock_recipe_publication_guard,
)

type AuthorRecipeVisibilityState = Literal["published", "author_withdrawn"]
type RecipeVisibilityState = Literal[
    "published",
    "author_withdrawn",
    "moderation_hidden",
]


class RecipeVisibilityNotFoundError(LookupError):
    """The exact authored publication is absent from the actor's private scope."""


class RecipeVisibilityModerationConflictError(RuntimeError):
    """An author tried to make moderation-hidden content public."""


@dataclass(frozen=True, slots=True)
class RecipeVisibilityResult:
    recipe_version_id: UUID
    state: RecipeVisibilityState
    state_changed_at: datetime
    changed: bool


def _effective_state(publication: RecipeVersionPublication) -> RecipeVisibilityState:
    if publication.moderation_hidden_at is not None:
        return "moderation_hidden"
    if publication.author_withdrawn_at is not None:
        return "author_withdrawn"
    return "published"


def _next_change_time(publication: RecipeVersionPublication) -> datetime:
    now = datetime.now(UTC)
    return max(now, publication.state_changed_at + timedelta(microseconds=1))


def set_authored_recipe_visibility(
    session: Session,
    *,
    actor_user_id: UUID,
    recipe_version_id: UUID,
    desired_state: AuthorRecipeVisibilityState,
) -> RecipeVisibilityResult:
    """Apply one author-controlled visibility axis without changing recipe topology.

    The publication-wide advisory guard linearizes this state transition with the
    final duplicate/source revalidation performed by recipe publication. A moderator
    state has higher precedence and cannot be cleared by an author restore.
    """

    if desired_state not in {
        RECIPE_PUBLICATION_STATE_PUBLISHED,
        RECIPE_PUBLICATION_STATE_AUTHOR_WITHDRAWN,
    }:
        raise ValueError("Unsupported author recipe visibility state.")

    lock_recipe_publication_guard(session)
    publication = get_owned_recipe_publication_for_update(
        session,
        actor_user_id=actor_user_id,
        recipe_version_id=recipe_version_id,
    )
    if publication is None:
        raise RecipeVisibilityNotFoundError("Authored recipe publication not found.")

    if (
        desired_state == RECIPE_PUBLICATION_STATE_PUBLISHED
        and publication.moderation_hidden_at is not None
    ):
        raise RecipeVisibilityModerationConflictError(
            "Moderation-hidden content cannot be restored by its author."
        )

    changed_at = _next_change_time(publication)
    next_author_withdrawn_at = publication.author_withdrawn_at
    if desired_state == RECIPE_PUBLICATION_STATE_AUTHOR_WITHDRAWN:
        if next_author_withdrawn_at is None:
            next_author_withdrawn_at = changed_at
    else:
        next_author_withdrawn_at = None

    if next_author_withdrawn_at == publication.author_withdrawn_at:
        return RecipeVisibilityResult(
            recipe_version_id=publication.recipe_version_id,
            state=cast(RecipeVisibilityState, publication.state),
            state_changed_at=publication.state_changed_at,
            changed=False,
        )

    publication.author_withdrawn_at = next_author_withdrawn_at
    effective_state = _effective_state(publication)
    publication.state = effective_state
    publication.state_changed_at = changed_at
    publication.state_changed_by_user_id = actor_user_id
    session.flush()
    return RecipeVisibilityResult(
        recipe_version_id=publication.recipe_version_id,
        state=effective_state,
        state_changed_at=publication.state_changed_at,
        changed=True,
    )
