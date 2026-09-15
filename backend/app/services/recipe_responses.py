from typing import Literal, cast

from app.core.demo_identity import DEMO_USER_DISPLAY_NAME, DEMO_USER_ID
from app.models import (
    ACCOUNT_KIND_DEMO,
    RECIPE_PUBLICATION_STATE_PUBLISHED,
    USER_STATUS_DELETED,
    RecipeIngredient,
    RecipeInstruction,
    RecipeVersion,
    RecipeVersionCategory,
    User,
)
from app.repositories.recipe_drafts import RecipeDraftBrowseItem
from app.schemas.recipe_categories import RecipeCategorySummary
from app.schemas.recipe_drafts import RecipeDraftKind, RecipeDraftSummaryResponse
from app.schemas.recipes import (
    RecipeIngredientResponse,
    RecipeInstructionResponse,
    RecipeSummary,
    RecipeVersionReference,
)
from app.schemas.users import PublicUserReference
from app.services.actions import serialize_instruction_action
from app.services.measurements import serialize_measure


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


def recipe_category_summary(item: RecipeVersionCategory) -> RecipeCategorySummary:
    return RecipeCategorySummary(
        id=item.recipe_category_id,
        name=item.category_name,
        slug=item.category_slug,
    )


def recipe_summary_response(
    version: RecipeVersion,
    *,
    adaptation_source: RecipeVersion | None = None,
) -> RecipeSummary:
    publication = version.publication
    if publication is None:
        raise RuntimeError(f"Public recipe version {version.id} has no publication record.")
    edition = version.edition
    if edition is None:
        raise RuntimeError(f"Public recipe version {version.id} has no stable recipe edition.")
    stable_recipe = edition.recipe
    current_edition = stable_recipe.current_edition
    if current_edition is None:
        raise RuntimeError(f"Stable recipe {stable_recipe.id} has no current edition.")
    readable_current_version = getattr(current_edition, "recipe_version", None)
    if readable_current_version is not None and (
        readable_current_version.publication is None
        or readable_current_version.publication.state != RECIPE_PUBLICATION_STATE_PUBLISHED
    ):
        readable_current_version = None
    readable_adaptation_source = adaptation_source
    if (
        readable_adaptation_source is None
        and edition.relation_kind == "adaptation"
        and version.parent is not None
    ):
        readable_adaptation_source = version.parent
    if readable_adaptation_source is not None and (
        readable_adaptation_source.publication is None
        or readable_adaptation_source.publication.state != RECIPE_PUBLICATION_STATE_PUBLISHED
    ):
        readable_adaptation_source = None
    return RecipeSummary(
        id=version.id,
        recipe_id=edition.recipe_id,
        lineage_id=version.lineage_id,
        parent_version_id=version.parent_version_id,
        version_number=version.version_number,
        edition_number=edition.edition_number,
        relation_kind=cast(
            Literal["original", "adaptation", "revision"],
            edition.relation_kind,
        ),
        previous_version_id=edition.previous_recipe_version_id,
        declared_change_reason=cast(
            Literal["correction", "update"] | None,
            edition.declared_change_reason,
        ),
        is_current=stable_recipe.current_recipe_version_id == version.id,
        current_version=(
            recipe_version_reference(readable_current_version)
            if readable_current_version is not None
            else None
        ),
        adaptation_source=(
            recipe_version_reference(readable_adaptation_source)
            if readable_adaptation_source is not None
            else None
        ),
        title=version.title,
        description=version.description,
        servings=version.servings,
        created_at=version.created_at,
        published_at=publication.published_at,
        author=public_user_reference(version.author),
        parent=(recipe_version_reference(version.parent) if version.parent is not None else None),
        categories=[recipe_category_summary(item) for item in version.categories],
    )


def recipe_ingredient_response(item: RecipeIngredient) -> RecipeIngredientResponse:
    return RecipeIngredientResponse(
        id=item.id,
        ingredient_id=item.ingredient_id,
        canonical_name=item.ingredient.canonical_name,
        display_name=item.name,
        measure=serialize_measure(
            kind=item.measure_mode,
            quantity_min=item.quantity_min,
            quantity_max=item.quantity_max,
            unit=item.measurement_unit,
            package_size_id=item.package_size_id,
        ),
        preparation_notes=item.preparation_notes,
        display_order=item.display_order,
    )


def recipe_instruction_response(item: RecipeInstruction) -> RecipeInstructionResponse:
    return RecipeInstructionResponse(
        id=item.id,
        title=item.title,
        text=item.instruction,
        display_order=item.display_order,
        actions=[
            serialize_instruction_action(action)
            for action in sorted(
                item.actions,
                key=lambda value: (value.display_order, value.id.int),
            )
        ],
    )


def recipe_draft_summary_response(
    item: RecipeDraftBrowseItem,
) -> RecipeDraftSummaryResponse:
    """Serialize the shared compact representation of an active private draft."""

    return RecipeDraftSummaryResponse(
        id=item.draft.id,
        draft_kind=cast(RecipeDraftKind, item.draft.draft_kind),
        source_version_id=item.draft.source_version_id,
        status="active",
        revision=item.draft.revision,
        title=item.draft.title,
        ingredient_count=item.ingredient_count,
        instruction_count=item.instruction_count,
        created_at=item.draft.created_at,
        updated_at=item.draft.updated_at,
    )
