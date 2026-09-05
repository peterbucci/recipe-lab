from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal, cast
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload, raiseload, selectinload

from app.models import (
    RecipeDraft,
    RecipeDraftIngredient,
    RecipeDraftInstruction,
    RecipeSave,
    RecipeVersion,
    RecipeVersionPublication,
)
from app.policies.recipe_visibility import publicly_readable_recipe_version_filter
from app.repositories.recipe_drafts import RecipeDraftBrowseItem

type RecipeVisibilityState = Literal[
    "published",
    "author_withdrawn",
    "moderation_hidden",
]
type MyRecipeLibraryView = Literal["drafts", "published", "withdrawn"]


@dataclass(frozen=True, slots=True)
class MyRecipeLibraryEntry:
    kind: Literal["draft", "published"]
    draft: RecipeDraftBrowseItem | None = None
    recipe: RecipeVersion | None = None
    visibility_state: RecipeVisibilityState | None = None


@dataclass(frozen=True, slots=True)
class MyRecipeLibraryResult:
    items: list[MyRecipeLibraryEntry]
    total: int


@dataclass(frozen=True, slots=True)
class SavedRecipeLibraryEntry:
    recipe: RecipeVersion
    saved_at: datetime


@dataclass(frozen=True, slots=True)
class SavedRecipeLibraryResult:
    items: list[SavedRecipeLibraryEntry]
    total: int


def _recipe_card_options() -> tuple[Any, ...]:
    return (
        joinedload(RecipeVersion.author),
        joinedload(RecipeVersion.publication),
        selectinload(
            RecipeVersion.parent.and_(publicly_readable_recipe_version_filter())
        ).joinedload(RecipeVersion.author),
        selectinload(RecipeVersion.categories),
        raiseload("*"),
    )


def browse_my_recipes(
    session: Session,
    *,
    actor_user_id: UUID,
    view: MyRecipeLibraryView,
    offset: int,
    limit: int,
) -> MyRecipeLibraryResult:
    """Database-page one explicit view of a member's authored recipe work."""

    if view == "drafts":
        return _browse_my_drafts(
            session,
            actor_user_id=actor_user_id,
            offset=offset,
            limit=limit,
        )
    return _browse_my_publications(
        session,
        actor_user_id=actor_user_id,
        view=view,
        offset=offset,
        limit=limit,
    )


def _browse_my_drafts(
    session: Session,
    *,
    actor_user_id: UUID,
    offset: int,
    limit: int,
) -> MyRecipeLibraryResult:
    filters = (
        RecipeDraft.author_user_id == actor_user_id,
        RecipeDraft.status == "active",
    )
    total = session.scalar(select(func.count()).select_from(RecipeDraft).where(*filters)) or 0
    draft_ids = list(
        session.scalars(
            select(RecipeDraft.id)
            .where(*filters)
            .order_by(RecipeDraft.updated_at.desc(), RecipeDraft.id)
            .offset(offset)
            .limit(limit)
        )
    )
    if not draft_ids:
        return MyRecipeLibraryResult(items=[], total=total)

    ingredient_count = (
        select(func.count())
        .select_from(RecipeDraftIngredient)
        .where(RecipeDraftIngredient.recipe_draft_id == RecipeDraft.id)
        .correlate(RecipeDraft)
        .scalar_subquery()
    )
    instruction_count = (
        select(func.count())
        .select_from(RecipeDraftInstruction)
        .where(RecipeDraftInstruction.recipe_draft_id == RecipeDraft.id)
        .correlate(RecipeDraft)
        .scalar_subquery()
    )
    source_recipe_title = (
        select(RecipeVersion.title)
        .where(
            RecipeVersion.id == RecipeDraft.source_version_id,
            publicly_readable_recipe_version_filter(),
        )
        .correlate(RecipeDraft)
        .scalar_subquery()
    )
    rows = session.execute(
        select(
            RecipeDraft,
            ingredient_count,
            instruction_count,
            source_recipe_title,
        ).where(
            RecipeDraft.id.in_(draft_ids),
            RecipeDraft.author_user_id == actor_user_id,
            RecipeDraft.status == "active",
        )
    )
    drafts = {
        draft.id: RecipeDraftBrowseItem(
            draft=draft,
            ingredient_count=stored_ingredient_count,
            instruction_count=stored_instruction_count,
            source_recipe_title=stored_source_recipe_title,
        )
        for (
            draft,
            stored_ingredient_count,
            stored_instruction_count,
            stored_source_recipe_title,
        ) in rows
    }
    return MyRecipeLibraryResult(
        items=[
            MyRecipeLibraryEntry(kind="draft", draft=drafts[draft_id])
            for draft_id in draft_ids
            if draft_id in drafts
        ],
        total=total,
    )


def _browse_my_publications(
    session: Session,
    *,
    actor_user_id: UUID,
    view: Literal["published", "withdrawn"],
    offset: int,
    limit: int,
) -> MyRecipeLibraryResult:
    publication_states = (
        ("published", "moderation_hidden") if view == "published" else ("author_withdrawn",)
    )
    activity_at = (
        RecipeVersionPublication.published_at
        if view == "published"
        else RecipeVersionPublication.state_changed_at
    )
    filters = (
        RecipeVersion.created_by_user_id == actor_user_id,
        RecipeVersionPublication.state.in_(publication_states),
    )
    total = (
        session.scalar(
            select(func.count())
            .select_from(RecipeVersion)
            .join(
                RecipeVersionPublication,
                RecipeVersionPublication.recipe_version_id == RecipeVersion.id,
            )
            .where(*filters)
        )
        or 0
    )
    recipe_ids = list(
        session.scalars(
            select(RecipeVersion.id)
            .join(
                RecipeVersionPublication,
                RecipeVersionPublication.recipe_version_id == RecipeVersion.id,
            )
            .where(*filters)
            .order_by(activity_at.desc(), RecipeVersion.id)
            .offset(offset)
            .limit(limit)
        )
    )
    if not recipe_ids:
        return MyRecipeLibraryResult(items=[], total=total)
    statement = (
        select(
            RecipeVersion,
            RecipeVersionPublication.state,
        )
        .join(
            RecipeVersionPublication,
            RecipeVersionPublication.recipe_version_id == RecipeVersion.id,
        )
        .options(*_recipe_card_options())
        .where(
            RecipeVersion.id.in_(recipe_ids),
            RecipeVersion.created_by_user_id == actor_user_id,
        )
    )
    recipes = {
        recipe.id: (recipe, visibility_state)
        for recipe, visibility_state in session.execute(statement)
    }
    return MyRecipeLibraryResult(
        items=[
            MyRecipeLibraryEntry(
                kind="published",
                recipe=recipes[recipe_id][0],
                visibility_state=cast(RecipeVisibilityState, recipes[recipe_id][1]),
            )
            for recipe_id in recipe_ids
            if recipe_id in recipes
        ],
        total=total,
    )


def browse_my_saved_recipes(
    session: Session,
    *,
    actor_user_id: UUID,
    offset: int,
    limit: int,
) -> SavedRecipeLibraryResult:
    """List only one member's saves that still resolve to public snapshots."""

    filters = (
        RecipeSave.user_id == actor_user_id,
        publicly_readable_recipe_version_filter(),
    )
    total = (
        session.scalar(
            select(func.count())
            .select_from(RecipeSave)
            .join(RecipeVersion, RecipeVersion.id == RecipeSave.recipe_version_id)
            .where(*filters)
        )
        or 0
    )
    statement = (
        select(RecipeVersion, RecipeSave.created_at)
        .join(RecipeVersion, RecipeVersion.id == RecipeSave.recipe_version_id)
        .options(*_recipe_card_options())
        .where(*filters)
        .order_by(RecipeSave.created_at.desc(), RecipeSave.recipe_version_id)
        .offset(offset)
        .limit(limit)
    )
    return SavedRecipeLibraryResult(
        items=[
            SavedRecipeLibraryEntry(recipe=recipe, saved_at=saved_at)
            for recipe, saved_at in session.execute(statement)
        ],
        total=total,
    )
