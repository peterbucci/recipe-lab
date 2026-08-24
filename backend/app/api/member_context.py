from uuid import UUID

from sqlalchemy.orm import Session

from app.api.errors import ApiError
from app.models import ACCOUNT_KIND_MEMBER, USER_STATUS_ACTIVE
from app.repositories.catalog_requests import is_catalog_curator
from app.repositories.interactions import (
    get_recipe_viewer_state,
    get_user,
    recipe_version_exists,
)
from app.schemas.interactions import RecipeViewerStateResponse
from app.services.auth import AuthenticatedSession


def lock_active_member_actor(
    session: Session,
    authenticated: AuthenticatedSession,
) -> UUID:
    """Lock and revalidate the member selected exclusively by the session cookie."""

    user = get_user(session, authenticated.user_id, for_update=True)
    if (
        user is None
        or user.account_kind != ACCOUNT_KIND_MEMBER
        or user.status != USER_STATUS_ACTIVE
    ):
        raise ApiError(
            status_code=401,
            code="authentication_required",
            message="Sign in to continue.",
        )
    if user.handle is None:
        raise ApiError(
            status_code=403,
            code="account_setup_required",
            message="Finish account setup to continue.",
        )
    return user.id


def lock_catalog_curator_actor(
    session: Session,
    authenticated: AuthenticatedSession,
) -> UUID:
    """Require an active, onboarded member with the narrow catalog-curator grant."""

    actor_id = lock_active_member_actor(session, authenticated)
    if not is_catalog_curator(session, actor_id):
        raise ApiError(
            status_code=403,
            code="catalog_curator_required",
            message="Catalog curator access is required.",
        )
    return actor_id


def ensure_recipe_exists(session: Session, recipe_version_id: UUID) -> None:
    if not recipe_version_exists(session, recipe_version_id):
        raise ApiError(
            status_code=404,
            code="recipe_not_found",
            message=f"Recipe version {recipe_version_id} was not found.",
        )


def recipe_viewer_state_response(
    session: Session,
    *,
    user_id: UUID,
    recipe_version_id: UUID,
) -> RecipeViewerStateResponse:
    state = get_recipe_viewer_state(
        session,
        user_id=user_id,
        recipe_version_id=recipe_version_id,
    )
    return RecipeViewerStateResponse(
        recipe_version_id=recipe_version_id,
        saved=state.saved,
        rating=state.rating,
    )
