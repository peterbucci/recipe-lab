from uuid import UUID

from sqlalchemy.orm import Session

from app.api.errors import ApiError
from app.core.demo_identity import DEMO_USER_ID
from app.models import User
from app.repositories.interactions import (
    get_recipe_viewer_state,
    get_user,
    recipe_version_exists,
)
from app.schemas.interactions import DemoUserResponse, RecipeViewerStateResponse


def get_demo_user_or_error(session: Session) -> User:
    user = get_user(session, DEMO_USER_ID)
    if user is None:
        raise ApiError(
            status_code=503,
            code="demo_user_unavailable",
            message="The demo user is unavailable. Load the bundled seed data and try again.",
        )
    return user


def ensure_recipe_exists(session: Session, recipe_version_id: UUID) -> None:
    if not recipe_version_exists(session, recipe_version_id):
        raise ApiError(
            status_code=404,
            code="recipe_not_found",
            message=f"Recipe version {recipe_version_id} was not found.",
        )


def demo_user_response(user: User) -> DemoUserResponse:
    return DemoUserResponse(
        id=user.id,
        display_name=user.display_name,
        identity_mode="shared_demo",
    )


def recipe_viewer_state_response(
    session: Session,
    *,
    user: User,
    recipe_version_id: UUID,
) -> RecipeViewerStateResponse:
    state = get_recipe_viewer_state(
        session,
        user_id=user.id,
        recipe_version_id=recipe_version_id,
    )
    return RecipeViewerStateResponse(
        recipe_version_id=recipe_version_id,
        user=demo_user_response(user),
        saved=state.saved,
        rating=state.rating,
    )
