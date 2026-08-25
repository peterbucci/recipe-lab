from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.recipe import RecipeVersion


class RecipeStructuralFingerprint(Base):
    """One reproducible structural identity for one recipe and algorithm version."""

    __tablename__ = "recipe_structural_fingerprints"
    __table_args__ = (
        CheckConstraint(
            "algorithm_version ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'",
            name="algorithm_version_format",
        ),
        CheckConstraint(
            "digest ~ '^[0-9a-f]{64}$'",
            name="digest_lowercase_sha256",
        ),
        CheckConstraint(
            "btrim(canonical_payload) <> ''",
            name="canonical_payload_not_blank",
        ),
        Index(
            "ix_recipe_structural_fingerprints_algorithm_digest",
            "algorithm_version",
            "digest",
        ),
    )

    recipe_version_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("recipe_versions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    algorithm_version: Mapped[str] = mapped_column(String(64), primary_key=True)
    digest: Mapped[str] = mapped_column(String(64), nullable=False)
    canonical_payload: Mapped[str] = mapped_column(Text, nullable=False)

    recipe_version: Mapped["RecipeVersion"] = relationship(back_populates="structural_fingerprints")
