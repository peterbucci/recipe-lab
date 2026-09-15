"""Publication topology allocation around the shared recipe document boundary."""

from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.domain_errors import DomainConflictError
from app.models import (
    RECIPE_RELATION_KIND_ADAPTATION,
    RECIPE_RELATION_KIND_ORIGINAL,
    RECIPE_RELATION_KIND_REVISION,
    Recipe,
    RecipeEdition,
    RecipeLineage,
    RecipeVersion,
)
from app.policies.recipe_visibility import publicly_readable_recipe_version_filter
from app.services.recipe_documents import RecipeDocument, RecipeDocumentMaterializationError


class RecipeForkSourceUnavailableError(DomainConflictError):
    """Raised when a source-backed draft's immutable public parent is unavailable."""

    code = "recipe_fork_source_unavailable"
    public_message = (
        "The public source recipe is no longer available. Your private draft is unchanged."
    )


def create_recipe_version_identity(
    session: Session,
    *,
    source_version_id: UUID | None,
    draft_kind: str,
    document: RecipeDocument,
    author_user_id: UUID,
    revision_recipe: Recipe | None = None,
    revision_source_edition: RecipeEdition | None = None,
    declared_change_reason: str | None = None,
) -> RecipeVersion:
    """Stage lineage position and immutable header without owning the flush."""

    parent_version_id: UUID | None = None
    new_lineage: RecipeLineage | None = None
    if draft_kind == RECIPE_RELATION_KIND_ORIGINAL:
        if source_version_id is not None:
            raise RuntimeError("An original publication cannot have a source version.")
        new_lineage = RecipeLineage(id=uuid4(), created_by_user_id=author_user_id)
        lineage_id = new_lineage.id
        version_number = 1
    else:
        if source_version_id is None:
            raise RuntimeError("A source-backed publication requires an exact source.")
        source_lineage_id = session.scalar(
            select(RecipeVersion.lineage_id).where(
                RecipeVersion.id == source_version_id,
                publicly_readable_recipe_version_filter(),
            )
        )
        if source_lineage_id is None:
            raise RecipeForkSourceUnavailableError(
                "The public source recipe is no longer available."
            )
        locked_lineage_id = session.scalar(
            select(RecipeLineage.id).where(RecipeLineage.id == source_lineage_id).with_for_update()
        )
        if locked_lineage_id is None:
            raise RecipeForkSourceUnavailableError(
                "The public source recipe is no longer available."
            )
        confirmed_lineage_id = session.scalar(
            select(RecipeVersion.lineage_id).where(
                RecipeVersion.id == source_version_id,
                RecipeVersion.lineage_id == locked_lineage_id,
                publicly_readable_recipe_version_filter(),
            )
        )
        if confirmed_lineage_id != locked_lineage_id:
            raise RecipeForkSourceUnavailableError(
                "The public source recipe is no longer available."
            )
        highest_version = session.scalar(
            select(func.max(RecipeVersion.version_number)).where(
                RecipeVersion.lineage_id == locked_lineage_id
            )
        )
        lineage_id = locked_lineage_id
        parent_version_id = (
            source_version_id if draft_kind == RECIPE_RELATION_KIND_ADAPTATION else None
        )
        version_number = (highest_version or 0) + 1

    if document.servings is None:
        raise RecipeDocumentMaterializationError(
            "Immutable recipe documents require a serving quantity."
        )
    version = RecipeVersion(
        id=uuid4(),
        lineage_id=lineage_id,
        parent_version_id=parent_version_id,
        created_by_user_id=author_user_id,
        version_number=version_number,
        title=document.title,
        description=document.description,
        servings=document.servings,
        total_time_minutes=document.total_time_minutes,
        active_time_minutes=document.active_time_minutes,
        difficulty=document.difficulty,
        notes=document.notes,
    )
    if new_lineage is not None:
        version.lineage = new_lineage
    session.add(version)
    if draft_kind == RECIPE_RELATION_KIND_REVISION:
        if (
            revision_recipe is None
            or revision_source_edition is None
            or revision_recipe.current_recipe_version_id != source_version_id
            or revision_source_edition.recipe_id != revision_recipe.id
            or revision_source_edition.recipe_version_id != source_version_id
        ):
            raise RuntimeError("A revision publication is missing its locked current source.")
        revision_recipe.current_recipe_version_id = version.id
        edition = RecipeEdition(
            recipe_version_id=version.id,
            recipe_id=revision_recipe.id,
            lineage_id=lineage_id,
            attributed_author_user_id=author_user_id,
            edition_number=revision_source_edition.edition_number + 1,
            relation_kind=RECIPE_RELATION_KIND_REVISION,
            previous_recipe_version_id=source_version_id,
            declared_change_reason=declared_change_reason,
        )
        session.add(edition)
    else:
        recipe_id = uuid4()
        recipe = Recipe(
            id=recipe_id,
            lineage_id=lineage_id,
            attributed_author_user_id=author_user_id,
            owner_user_id=author_user_id,
            current_recipe_version_id=version.id,
        )
        edition = RecipeEdition(
            recipe_version_id=version.id,
            recipe_id=recipe_id,
            lineage_id=lineage_id,
            attributed_author_user_id=author_user_id,
            edition_number=1,
            relation_kind=draft_kind,
            previous_recipe_version_id=None,
            declared_change_reason=None,
        )
        session.add_all((recipe, edition))
    return version
