"""Small, persistence-free builders for common recipe test records."""

from decimal import Decimal
from uuid import UUID, uuid4

from app.models import RecipeDraft, RecipeLineage, RecipeVersion


def build_recipe_lineage(
    *,
    created_by_user_id: UUID,
    lineage_id: UUID | None = None,
) -> RecipeLineage:
    """Build a transient lineage; callers retain all persistence control."""
    return RecipeLineage(
        id=lineage_id or uuid4(),
        created_by_user_id=created_by_user_id,
    )


def build_recipe_version(
    *,
    lineage_id: UUID,
    created_by_user_id: UUID,
    recipe_version_id: UUID | None = None,
    parent_version_id: UUID | None = None,
    version_number: int = 1,
    title: str = "Test recipe",
    description: str | None = None,
    servings: Decimal = Decimal("1.00"),
    total_time_minutes: int | None = None,
    active_time_minutes: int | None = None,
    difficulty: str | None = None,
    notes: str | None = None,
) -> RecipeVersion:
    """Build a transient immutable recipe version with conservative defaults."""
    return RecipeVersion(
        id=recipe_version_id or uuid4(),
        lineage_id=lineage_id,
        parent_version_id=parent_version_id,
        created_by_user_id=created_by_user_id,
        version_number=version_number,
        title=title,
        description=description,
        servings=servings,
        total_time_minutes=total_time_minutes,
        active_time_minutes=active_time_minutes,
        difficulty=difficulty,
        notes=notes,
    )


def build_recipe_draft(
    *,
    author_user_id: UUID,
    draft_id: UUID | None = None,
    source_version_id: UUID | None = None,
    creation_action_id: UUID | None = None,
    creation_request_fingerprint: str | None = None,
    status: str = "active",
    revision: int = 1,
    title: str = "",
    description: str | None = None,
    servings: Decimal | None = None,
    total_time_minutes: int | None = None,
    active_time_minutes: int | None = None,
    difficulty: str | None = None,
    notes: str | None = None,
) -> RecipeDraft:
    """Build a transient mutable draft without adding, flushing, or committing it."""
    return RecipeDraft(
        id=draft_id or uuid4(),
        author_user_id=author_user_id,
        source_version_id=source_version_id,
        creation_action_id=creation_action_id,
        creation_request_fingerprint=creation_request_fingerprint,
        status=status,
        revision=revision,
        title=title,
        description=description,
        servings=servings,
        total_time_minutes=total_time_minutes,
        active_time_minutes=active_time_minutes,
        difficulty=difficulty,
        notes=notes,
    )
