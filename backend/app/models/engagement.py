from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, SmallInteger, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.recipe import RecipeVersion

MIN_RATING = 1
MAX_RATING = 5


class RecipeSave(Base):
    __tablename__ = "recipe_saves"
    __table_args__ = (Index("ix_recipe_saves_recipe_version_id", "recipe_version_id"),)

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    recipe_version_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("recipe_versions.id", ondelete="RESTRICT"),
        primary_key=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    recipe_version: Mapped["RecipeVersion"] = relationship(back_populates="saves")


_recipe_save_library_index = Index(
    "ix_recipe_saves_user_created_recipe",
    RecipeSave.user_id,
    RecipeSave.created_at.desc(),
    RecipeSave.recipe_version_id,
)


class RecipeRating(Base):
    __tablename__ = "recipe_ratings"
    __table_args__ = (
        CheckConstraint(
            f"rating BETWEEN {MIN_RATING} AND {MAX_RATING}",
            name="rating_supported_range",
        ),
        Index("ix_recipe_ratings_recipe_version_id", "recipe_version_id"),
        Index(
            "ix_recipe_ratings_user_positive_profile",
            "user_id",
            text("rating DESC"),
            text("created_at DESC"),
            "recipe_version_id",
        ),
    )

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    recipe_version_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("recipe_versions.id", ondelete="RESTRICT"),
        primary_key=True,
    )
    rating: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    recipe_version: Mapped["RecipeVersion"] = relationship(back_populates="ratings")
