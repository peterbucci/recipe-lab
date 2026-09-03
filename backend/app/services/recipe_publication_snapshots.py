"""Publication topology allocation around the shared recipe document boundary."""

from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.domain_errors import DomainConflictError
from app.models import RecipeLineage, RecipeVersion
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
    document: RecipeDocument,
    author_user_id: UUID,
) -> RecipeVersion:
    """Stage lineage position and immutable header without owning the flush."""

    parent_version_id: UUID | None = None
    new_lineage: RecipeLineage | None = None
    if source_version_id is None:
        new_lineage = RecipeLineage(id=uuid4(), created_by_user_id=author_user_id)
        lineage_id = new_lineage.id
        version_number = 1
    else:
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
        parent_version_id = source_version_id
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
    return version
