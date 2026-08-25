from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.common import CreatedAtMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.engagement import RecipeRating, RecipeSave
    from app.models.ingredient import Ingredient
    from app.models.measurement import IngredientPackageSize, MeasurementUnit


class RecipeLineage(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "recipe_lineages"

    created_by_user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    versions: Mapped[list["RecipeVersion"]] = relationship(
        back_populates="lineage",
        order_by="RecipeVersion.version_number",
        passive_deletes="all",
    )


class RecipeVersion(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "recipe_versions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["lineage_id", "parent_version_id"],
            ["recipe_versions.lineage_id", "recipe_versions.id"],
            name="fk_recipe_versions_parent_same_lineage",
            ondelete="RESTRICT",
        ),
        CheckConstraint("version_number >= 1", name="version_number_positive"),
        CheckConstraint("btrim(title) <> ''", name="title_not_blank"),
        CheckConstraint("servings > 0", name="servings_positive"),
        CheckConstraint(
            "parent_version_id IS NULL OR parent_version_id <> id",
            name="parent_not_self",
        ),
        UniqueConstraint("lineage_id", "id", name="uq_recipe_versions_lineage_id_id"),
        UniqueConstraint(
            "lineage_id",
            "version_number",
            name="uq_recipe_versions_lineage_id_version_number",
        ),
        Index(
            "uq_recipe_versions_one_root_per_lineage",
            "lineage_id",
            unique=True,
            postgresql_where=text("parent_version_id IS NULL"),
        ),
        Index("ix_recipe_versions_parent_version_id", "parent_version_id"),
    )

    lineage_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("recipe_lineages.id", ondelete="RESTRICT"),
        nullable=False,
    )
    parent_version_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    created_by_user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    servings: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False)

    lineage: Mapped[RecipeLineage] = relationship(back_populates="versions")
    parent: Mapped["RecipeVersion | None"] = relationship(
        back_populates="descendants",
        primaryjoin="RecipeVersion.parent_version_id == RecipeVersion.id",
        foreign_keys="RecipeVersion.parent_version_id",
        remote_side="RecipeVersion.id",
    )
    descendants: Mapped[list["RecipeVersion"]] = relationship(
        back_populates="parent",
        primaryjoin="RecipeVersion.id == RecipeVersion.parent_version_id",
        foreign_keys="RecipeVersion.parent_version_id",
        order_by="RecipeVersion.version_number",
        passive_deletes="all",
    )
    ingredients: Mapped[list["RecipeIngredient"]] = relationship(
        back_populates="recipe_version",
        order_by="RecipeIngredient.display_order",
        passive_deletes="all",
    )
    instructions: Mapped[list["RecipeInstruction"]] = relationship(
        back_populates="recipe_version",
        order_by="RecipeInstruction.display_order",
        passive_deletes="all",
    )
    saves: Mapped[list["RecipeSave"]] = relationship(
        back_populates="recipe_version",
        passive_deletes="all",
    )
    ratings: Mapped[list["RecipeRating"]] = relationship(
        back_populates="recipe_version",
        passive_deletes="all",
    )


class RecipeIngredient(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "recipe_version_ingredients"
    __table_args__ = (
        ForeignKeyConstraint(
            ["package_size_id", "ingredient_id", "measurement_unit_id"],
            [
                "ingredient_package_sizes.id",
                "ingredient_package_sizes.ingredient_id",
                "ingredient_package_sizes.package_unit_id",
            ],
            name="fk_recipe_version_ingredients_package_size_ingredient_unit",
            ondelete="RESTRICT",
        ),
        CheckConstraint("btrim(name) <> ''", name="name_not_blank"),
        CheckConstraint(
            "(measure_mode = 'exact' "
            "AND quantity_min IS NOT NULL AND quantity_min > 0 "
            "AND quantity_max IS NULL "
            "AND measurement_unit_id IS NOT NULL "
            "AND NULLIF(btrim(unit_display), '') IS NOT NULL) "
            "OR (measure_mode = 'range' "
            "AND quantity_min IS NOT NULL AND quantity_min > 0 "
            "AND quantity_max IS NOT NULL AND quantity_max > quantity_min "
            "AND measurement_unit_id IS NOT NULL "
            "AND NULLIF(btrim(unit_display), '') IS NOT NULL) "
            "OR (measure_mode IN ('to_taste', 'as_needed', 'unspecified') "
            "AND quantity_min IS NULL AND quantity_max IS NULL "
            "AND measurement_unit_id IS NULL AND unit_display IS NULL "
            "AND package_size_id IS NULL)",
            name="measure_shape_valid",
        ),
        CheckConstraint("display_order >= 0", name="display_order_nonnegative"),
        UniqueConstraint(
            "recipe_version_id",
            "display_order",
            name="uq_recipe_version_ingredients_version_display_order",
        ),
    )

    recipe_version_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("recipe_versions.id", ondelete="RESTRICT"),
        nullable=False,
    )
    ingredient_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ingredients.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    measure_mode: Mapped[str] = mapped_column(String(16), nullable=False)
    quantity_min: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    quantity_max: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    measurement_unit_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("measurement_units.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    unit_display: Mapped[str | None] = mapped_column(String(64), nullable=True)
    package_size_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        nullable=True,
        index=True,
    )
    preparation_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False)

    recipe_version: Mapped[RecipeVersion] = relationship(back_populates="ingredients")
    ingredient: Mapped["Ingredient"] = relationship(back_populates="recipe_ingredients")
    measurement_unit: Mapped["MeasurementUnit | None"] = relationship()
    package_size: Mapped["IngredientPackageSize | None"] = relationship(viewonly=True)


class RecipeInstruction(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "recipe_version_instructions"
    __table_args__ = (
        CheckConstraint("btrim(instruction) <> ''", name="instruction_not_blank"),
        CheckConstraint("display_order >= 0", name="display_order_nonnegative"),
        UniqueConstraint(
            "recipe_version_id",
            "display_order",
            name="uq_recipe_version_instructions_version_display_order",
        ),
    )

    recipe_version_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("recipe_versions.id", ondelete="RESTRICT"),
        nullable=False,
    )
    instruction: Mapped[str] = mapped_column(Text, nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False)

    recipe_version: Mapped[RecipeVersion] = relationship(back_populates="instructions")
