from app.core.demo_identity import DEMO_USER_DISPLAY_NAME, DEMO_USER_ID
from app.models import ACCOUNT_KIND_DEMO, USER_STATUS_DELETED, RecipeVersion, User
from app.schemas.recipes import RecipeSummary, RecipeVersionReference
from app.schemas.users import PublicUserReference


def public_user_reference(user: User) -> PublicUserReference:
    """Serialize exactly the three fields allowed in a public user reference."""

    if user.status == USER_STATUS_DELETED:
        return PublicUserReference(
            id=user.id,
            handle=None,
            display_name="Deleted cook",
        )
    if user.id == DEMO_USER_ID and user.account_kind == ACCOUNT_KIND_DEMO and user.handle is None:
        return PublicUserReference(
            id=user.id,
            handle=None,
            display_name=DEMO_USER_DISPLAY_NAME,
        )
    if user.handle is None:
        raise RuntimeError(f"Public recipe author {user.id} does not have a public handle.")
    return PublicUserReference(
        id=user.id,
        handle=user.handle,
        display_name=user.display_name,
    )


def recipe_version_reference(version: RecipeVersion) -> RecipeVersionReference:
    return RecipeVersionReference(
        id=version.id,
        version_number=version.version_number,
        title=version.title,
        author=public_user_reference(version.author),
    )


def recipe_summary_response(version: RecipeVersion) -> RecipeSummary:
    return RecipeSummary(
        id=version.id,
        lineage_id=version.lineage_id,
        parent_version_id=version.parent_version_id,
        version_number=version.version_number,
        title=version.title,
        description=version.description,
        servings=version.servings,
        created_at=version.created_at,
        author=public_user_reference(version.author),
        parent=(recipe_version_reference(version.parent) if version.parent is not None else None),
    )
