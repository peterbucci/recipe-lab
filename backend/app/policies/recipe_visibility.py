"""Canonical recipe-visibility state and public-read predicates."""

from typing import Literal, cast

from sqlalchemy import ColumnElement, exists

from app.models.recipe import (
    RECIPE_PUBLICATION_STATE_AUTHOR_WITHDRAWN,
    RECIPE_PUBLICATION_STATE_MODERATION_HIDDEN,
    RECIPE_PUBLICATION_STATE_PUBLISHED,
    RecipeVersion,
    RecipeVersionPublication,
)

type AuthorRecipeVisibilityState = Literal["published", "author_withdrawn"]
type RecipeVisibilityState = Literal[
    "published",
    "author_withdrawn",
    "moderation_hidden",
]


def publicly_readable_recipe_publication_filter() -> ColumnElement[bool]:
    """Match the sole publication state exposed by anonymous/public adapters."""

    return RecipeVersionPublication.state == RECIPE_PUBLICATION_STATE_PUBLISHED


def publicly_readable_recipe_version_filter() -> ColumnElement[bool]:
    """Require an exact version to have one publicly readable publication row."""

    return exists().where(
        RecipeVersionPublication.recipe_version_id == RecipeVersion.id,
        publicly_readable_recipe_publication_filter(),
    )


def effective_recipe_visibility_state(
    publication: RecipeVersionPublication,
) -> RecipeVisibilityState:
    """Resolve independent moderation and author axes using policy precedence."""

    if publication.moderation_hidden_at is not None:
        return cast(RecipeVisibilityState, RECIPE_PUBLICATION_STATE_MODERATION_HIDDEN)
    if publication.author_withdrawn_at is not None:
        return cast(RecipeVisibilityState, RECIPE_PUBLICATION_STATE_AUTHOR_WITHDRAWN)
    return cast(RecipeVisibilityState, RECIPE_PUBLICATION_STATE_PUBLISHED)
