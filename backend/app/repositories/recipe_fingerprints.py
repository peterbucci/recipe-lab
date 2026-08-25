from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import RecipeStructuralFingerprint


class StructuralFingerprintStorageConflictError(RuntimeError):
    """Raised when one recipe/version key already stores different canonical data."""


def store_recipe_structural_fingerprint(
    session: Session,
    *,
    recipe_version_id: UUID,
    algorithm_version: str,
    digest: str,
    canonical_payload: str,
) -> RecipeStructuralFingerprint:
    """Persist one immutable algorithm result, making identical retries idempotent."""

    identity = {
        "recipe_version_id": recipe_version_id,
        "algorithm_version": algorithm_version,
    }
    existing = session.get(RecipeStructuralFingerprint, identity)
    if existing is not None:
        if existing.digest != digest or existing.canonical_payload != canonical_payload:
            raise StructuralFingerprintStorageConflictError(
                "A different structural fingerprint is already stored for "
                f"recipe version {recipe_version_id} and algorithm {algorithm_version!r}."
            )
        return existing

    stored = RecipeStructuralFingerprint(
        recipe_version_id=recipe_version_id,
        algorithm_version=algorithm_version,
        digest=digest,
        canonical_payload=canonical_payload,
    )
    session.add(stored)
    session.flush()
    return stored


def get_recipe_structural_fingerprint(
    session: Session,
    *,
    recipe_version_id: UUID,
    algorithm_version: str,
) -> RecipeStructuralFingerprint | None:
    return session.get(
        RecipeStructuralFingerprint,
        {
            "recipe_version_id": recipe_version_id,
            "algorithm_version": algorithm_version,
        },
    )


def find_structurally_equal_recipe_version_ids(
    session: Session,
    *,
    algorithm_version: str,
    digest: str,
    canonical_payload: str,
    exclude_recipe_version_id: UUID | None = None,
) -> list[UUID]:
    """Find exact equals, confirming digest candidates against canonical payload text."""

    statement = (
        select(RecipeStructuralFingerprint)
        .where(
            RecipeStructuralFingerprint.algorithm_version == algorithm_version,
            RecipeStructuralFingerprint.digest == digest,
        )
        .order_by(RecipeStructuralFingerprint.recipe_version_id)
    )
    if exclude_recipe_version_id is not None:
        statement = statement.where(
            RecipeStructuralFingerprint.recipe_version_id != exclude_recipe_version_id
        )

    return [
        candidate.recipe_version_id
        for candidate in session.scalars(statement)
        if candidate.canonical_payload == canonical_payload
    ]
