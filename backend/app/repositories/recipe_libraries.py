from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal, cast
from uuid import UUID

from sqlalchemy import func, literal, select
from sqlalchemy.orm import Session, joinedload, raiseload, selectinload

from app.models import (
    RecipeDraft,
    RecipeDraftIngredient,
    RecipeDraftInstruction,
    RecipeSave,
    RecipeVersion,
    RecipeVersionPublication,
)
from app.repositories.recipe_drafts import RecipeDraftBrowseItem
from app.repositories.recipes import publicly_readable_recipe_version_filter

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
        activity_statement = select(
            literal("draft").label("kind"),
            RecipeDraft.id.label("entity_id"),
            RecipeDraft.updated_at.label("activity_at"),
        ).where(
            RecipeDraft.author_user_id == actor_user_id,
            RecipeDraft.status == "active",
        )
    else:
        publication_states = (
            ("published", "moderation_hidden") if view == "published" else ("author_withdrawn",)
        )
        activity_at = (
            RecipeVersionPublication.published_at
            if view == "published"
            else RecipeVersionPublication.state_changed_at
        )
        activity_statement = (
            select(
                literal("published").label("kind"),
                RecipeVersion.id.label("entity_id"),
                activity_at.label("activity_at"),
            )
            .join(
                RecipeVersionPublication,
                RecipeVersionPublication.recipe_version_id == RecipeVersion.id,
            )
            .where(
                RecipeVersion.created_by_user_id == actor_user_id,
                RecipeVersionPublication.state.in_(publication_states),
            )
        )
    activity = activity_statement.subquery("my_recipe_library_activity")
    total = session.scalar(select(func.count()).select_from(activity)) or 0
    page_rows = list(
        session.execute(
            select(activity.c.kind, activity.c.entity_id)
            .order_by(
                activity.c.activity_at.desc(),
                activity.c.entity_id,
            )
            .offset(offset)
            .limit(limit)
        )
    )

    draft_ids = {entity_id for kind, entity_id in page_rows if kind == "draft"}
    recipe_ids = {entity_id for kind, entity_id in page_rows if kind == "published"}

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

    items: list[MyRecipeLibraryEntry] = []
    for kind, entity_id in page_rows:
        if kind == "draft" and entity_id in drafts:
            items.append(MyRecipeLibraryEntry(kind="draft", draft=drafts[entity_id]))
        elif kind == "published" and entity_id in recipes:
            recipe, visibility_state = recipes[entity_id]
            items.append(
                MyRecipeLibraryEntry(
                    kind="published",
                    recipe=recipe,
                    visibility_state=cast(RecipeVisibilityState, visibility_state),
                )
            )
    return MyRecipeLibraryResult(items=items, total=total)


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
