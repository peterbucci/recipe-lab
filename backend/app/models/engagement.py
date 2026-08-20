from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, SmallInteger, Uuid, func
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
        ForeignKey("recipe_versions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    recipe_version: Mapped["RecipeVersion"] = relationship(back_populates="saves")


class RecipeRating(Base):
    __tablename__ = "recipe_ratings"
    __table_args__ = (
        CheckConstraint(
            f"rating BETWEEN {MIN_RATING} AND {MAX_RATING}",
            name="rating_supported_range",
        ),
        Index("ix_recipe_ratings_recipe_version_id", "recipe_version_id"),
    )

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    recipe_version_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("recipe_versions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    rating: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    recipe_version: Mapped["RecipeVersion"] = relationship(back_populates="ratings")
