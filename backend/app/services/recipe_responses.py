from app.core.demo_identity import DEMO_USER_DISPLAY_NAME, DEMO_USER_ID
from app.models import ACCOUNT_KIND_DEMO, USER_STATUS_DELETED, RecipeVersion, User
from app.schemas.recipe_categories import RecipeCategorySummary
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
    publication = version.publication
    if publication is None:
        raise RuntimeError(f"Public recipe version {version.id} has no publication record.")
    return RecipeSummary(
        id=version.id,
        lineage_id=version.lineage_id,
        parent_version_id=version.parent_version_id,
        version_number=version.version_number,
        title=version.title,
        description=version.description,
        servings=version.servings,
        created_at=version.created_at,
        published_at=publication.published_at,
        author=public_user_reference(version.author),
        parent=(recipe_version_reference(version.parent) if version.parent is not None else None),
        categories=[
            RecipeCategorySummary(
                id=item.recipe_category_id,
                name=item.category_name,
                slug=item.category_slug,
            )
            for item in version.categories
        ],
    )
