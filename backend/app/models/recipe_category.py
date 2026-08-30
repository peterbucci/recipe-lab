from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.common import CreatedAtMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.recipe import RecipeVersion
    from app.models.recipe_draft import RecipeDraft


MAX_RECIPE_CATEGORIES = 3


class RecipeCategory(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """One governed recipe-discovery label from the curated vocabulary."""

    __tablename__ = "recipe_categories"
    __table_args__ = (
        CheckConstraint("btrim(name) <> ''", name="name_not_blank"),
        CheckConstraint(
            "slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'",
            name="slug_supported",
        ),
        CheckConstraint("display_order >= 0", name="display_order_nonnegative"),
        UniqueConstraint("slug", name="uq_recipe_categories_slug"),
        UniqueConstraint("display_order", name="uq_recipe_categories_display_order"),
    )

    name: Mapped[str] = mapped_column(String(80), nullable=False)
    slug: Mapped[str] = mapped_column(String(64), nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False)
    active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=text("true"),
    )


class RecipeDraftCategory(Base):
    """One private draft selection referencing the current curated vocabulary."""

    __tablename__ = "recipe_draft_categories"
    __table_args__ = (
        CheckConstraint(
            f"display_order >= 0 AND display_order < {MAX_RECIPE_CATEGORIES}",
            name="display_order_bounded",
        ),
        UniqueConstraint(
            "recipe_draft_id",
            "display_order",
            name="uq_recipe_draft_categories_draft_display_order",
        ),
    )

    recipe_draft_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("recipe_drafts.id", ondelete="CASCADE"),
        primary_key=True,
    )
    recipe_category_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("recipe_categories.id", ondelete="RESTRICT"),
        primary_key=True,
    )
    display_order: Mapped[int] = mapped_column(Integer, nullable=False)

    draft: Mapped["RecipeDraft"] = relationship(back_populates="categories")
    category: Mapped[RecipeCategory] = relationship()


class RecipeVersionCategory(Base):
    """Immutable category identity and label snapshot for one public version."""

    __tablename__ = "recipe_version_categories"
    __table_args__ = (
        CheckConstraint("btrim(category_name) <> ''", name="category_name_not_blank"),
        CheckConstraint(
            "category_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'",
            name="category_slug_supported",
        ),
        CheckConstraint(
            f"display_order >= 0 AND display_order < {MAX_RECIPE_CATEGORIES}",
            name="display_order_bounded",
        ),
        UniqueConstraint(
            "recipe_version_id",
            "display_order",
            name="uq_recipe_version_categories_version_display_order",
        ),
    )

    recipe_version_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("recipe_versions.id", ondelete="RESTRICT"),
        primary_key=True,
    )
    recipe_category_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("recipe_categories.id", ondelete="RESTRICT"),
        primary_key=True,
    )
    category_name: Mapped[str] = mapped_column(String(80), nullable=False)
    category_slug: Mapped[str] = mapped_column(String(64), nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False)

    recipe_version: Mapped["RecipeVersion"] = relationship(back_populates="categories")
    category: Mapped[RecipeCategory] = relationship()
