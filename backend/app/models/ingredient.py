from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    Column,
    ForeignKey,
    Index,
    Numeric,
    String,
    Table,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.common import CreatedAtMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.recipe import RecipeIngredient


ingredient_dietary_flags = Table(
    "ingredient_dietary_flags",
    Base.metadata,
    Column(
        "ingredient_id",
        Uuid(as_uuid=True),
        ForeignKey("ingredients.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "dietary_flag_id",
        Uuid(as_uuid=True),
        ForeignKey("dietary_flags.id", ondelete="RESTRICT"),
        primary_key=True,
    ),
    Index("ix_ingredient_dietary_flags_dietary_flag_id", "dietary_flag_id"),
)


ingredient_allergens = Table(
    "ingredient_allergens",
    Base.metadata,
    Column(
        "ingredient_id",
        Uuid(as_uuid=True),
        ForeignKey("ingredients.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "allergen_id",
        Uuid(as_uuid=True),
        ForeignKey("allergens.id", ondelete="RESTRICT"),
        primary_key=True,
    ),
    Index("ix_ingredient_allergens_allergen_id", "allergen_id"),
)


class IngredientCategory(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "ingredient_categories"

    name: Mapped[str] = mapped_column(String(100), nullable=False)

    __table_args__ = (
        CheckConstraint("btrim(name) <> ''", name="name_not_blank"),
        Index(
            "uq_ingredient_categories_name_normalized",
            func.lower(func.btrim(name)),
            unique=True,
        ),
    )


class DietaryFlag(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "dietary_flags"

    name: Mapped[str] = mapped_column(String(100), nullable=False)

    __table_args__ = (
        CheckConstraint("btrim(name) <> ''", name="name_not_blank"),
        Index(
            "uq_dietary_flags_name_normalized",
            func.lower(func.btrim(name)),
            unique=True,
        ),
    )


class Allergen(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "allergens"

    name: Mapped[str] = mapped_column(String(100), nullable=False)

    __table_args__ = (
        CheckConstraint("btrim(name) <> ''", name="name_not_blank"),
        Index(
            "uq_allergens_name_normalized",
            func.lower(func.btrim(name)),
            unique=True,
        ),
    )


class Ingredient(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "ingredients"

    canonical_name: Mapped[str] = mapped_column(String(200), nullable=False)
    category_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ingredient_categories.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )

    __table_args__ = (
        CheckConstraint("btrim(canonical_name) <> ''", name="canonical_name_not_blank"),
        Index(
            "uq_ingredients_canonical_name_normalized",
            func.lower(func.btrim(canonical_name)),
            unique=True,
        ),
    )

    category: Mapped[IngredientCategory | None] = relationship()
    aliases: Mapped[list["IngredientAlias"]] = relationship(
        back_populates="ingredient",
        order_by="IngredientAlias.alias",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    dietary_flags: Mapped[list[DietaryFlag]] = relationship(
        secondary=ingredient_dietary_flags,
        passive_deletes=True,
    )
    allergens: Mapped[list[Allergen]] = relationship(
        secondary=ingredient_allergens,
        passive_deletes=True,
    )
    recipe_ingredients: Mapped[list["RecipeIngredient"]] = relationship(
        back_populates="ingredient",
        passive_deletes="all",
    )
    outgoing_substitutions: Mapped[list["IngredientSubstitution"]] = relationship(
        back_populates="source_ingredient",
        foreign_keys="IngredientSubstitution.source_ingredient_id",
        passive_deletes="all",
    )
    incoming_substitutions: Mapped[list["IngredientSubstitution"]] = relationship(
        back_populates="replacement_ingredient",
        foreign_keys="IngredientSubstitution.replacement_ingredient_id",
        passive_deletes="all",
    )


class IngredientAlias(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "ingredient_aliases"

    ingredient_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ingredients.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    alias: Mapped[str] = mapped_column(String(200), nullable=False)

    __table_args__ = (
        CheckConstraint("btrim(alias) <> ''", name="alias_not_blank"),
        Index(
            "uq_ingredient_aliases_alias_normalized",
            func.lower(func.btrim(alias)),
            unique=True,
        ),
    )

    ingredient: Mapped[Ingredient] = relationship(back_populates="aliases")


class IngredientSubstitution(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "ingredient_substitutions"

    source_ingredient_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ingredients.id", ondelete="RESTRICT"),
        nullable=False,
    )
    replacement_ingredient_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ingredients.id", ondelete="RESTRICT"),
        nullable=False,
    )
    quantity_ratio: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    guidance: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    provenance: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 4), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "source_ingredient_id <> replacement_ingredient_id",
            name="ingredients_must_differ",
        ),
        CheckConstraint(
            "quantity_ratio IS NULL OR quantity_ratio > 0",
            name="quantity_ratio_positive",
        ),
        CheckConstraint(
            "confidence IS NULL OR confidence BETWEEN 0 AND 1",
            name="confidence_supported_range",
        ),
        CheckConstraint(
            "quantity_ratio IS NOT NULL OR NULLIF(btrim(guidance), '') IS NOT NULL",
            name="ratio_or_guidance_required",
        ),
        CheckConstraint(
            "NULLIF(btrim(provenance), '') IS NOT NULL OR confidence IS NOT NULL",
            name="provenance_or_confidence_required",
        ),
        CheckConstraint(
            "guidance IS NULL OR btrim(guidance) <> ''",
            name="guidance_not_blank",
        ),
        CheckConstraint("notes IS NULL OR btrim(notes) <> ''", name="notes_not_blank"),
        CheckConstraint(
            "provenance IS NULL OR btrim(provenance) <> ''",
            name="provenance_not_blank",
        ),
        UniqueConstraint(
            "source_ingredient_id",
            "replacement_ingredient_id",
            name="uq_ingredient_substitutions_source_replacement",
        ),
        Index(
            "ix_ingredient_substitutions_replacement_ingredient_id",
            "replacement_ingredient_id",
        ),
    )

    source_ingredient: Mapped[Ingredient] = relationship(
        back_populates="outgoing_substitutions",
        foreign_keys=[source_ingredient_id],
    )
    replacement_ingredient: Mapped[Ingredient] = relationship(
        back_populates="incoming_substitutions",
        foreign_keys=[replacement_ingredient_id],
    )
