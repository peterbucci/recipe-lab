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
from app.models.common import CreatedAtMixin, UpdatedAtMixin, UUIDPrimaryKeyMixin
from app.models.recipe import RECIPE_DIFFICULTIES

if TYPE_CHECKING:
    from app.models.action import CookingActionType
    from app.models.catalog import IngredientCatalogRequest
    from app.models.ingredient import Ingredient
    from app.models.measurement import IngredientPackageSize, MeasurementUnit
    from app.models.recipe import RecipeVersion, RecipeVersionPublication
    from app.models.recipe_category import RecipeDraftCategory
    from app.models.user import User


RECIPE_DRAFT_STATUS_ACTIVE = "active"
RECIPE_DRAFT_STATUS_DISCARDED = "discarded"
RECIPE_DRAFT_STATUS_PUBLISHED = "published"
RECIPE_DRAFT_STATUSES = (
    RECIPE_DRAFT_STATUS_ACTIVE,
    RECIPE_DRAFT_STATUS_DISCARDED,
    RECIPE_DRAFT_STATUS_PUBLISHED,
)

RECIPE_DRAFT_SELECTION_CATALOG = "catalog"
RECIPE_DRAFT_SELECTION_REQUEST = "request"
RECIPE_DRAFT_SELECTION_KINDS = (
    RECIPE_DRAFT_SELECTION_CATALOG,
    RECIPE_DRAFT_SELECTION_REQUEST,
)


class RecipeDraft(UUIDPrimaryKeyMixin, CreatedAtMixin, UpdatedAtMixin, Base):
    """One private, mutable recipe document owned by exactly one member."""

    __tablename__ = "recipe_drafts"
    __table_args__ = (
        CheckConstraint(
            f"status IN {RECIPE_DRAFT_STATUSES!r}",
            name="status_supported",
        ),
        CheckConstraint("revision >= 1", name="revision_positive"),
        CheckConstraint("char_length(title) <= 200", name="title_bounded"),
        CheckConstraint(
            "description IS NULL OR "
            "(NULLIF(btrim(description), '') IS NOT NULL "
            "AND char_length(description) <= 2000)",
            name="description_valid",
        ),
        CheckConstraint("servings IS NULL OR servings > 0", name="servings_positive"),
        CheckConstraint(
            "total_time_minutes IS NULL OR total_time_minutes > 0",
            name="total_time_minutes_positive",
        ),
        CheckConstraint(
            "active_time_minutes IS NULL OR active_time_minutes > 0",
            name="active_time_minutes_positive",
        ),
        CheckConstraint(
            "total_time_minutes IS NULL OR active_time_minutes IS NULL "
            "OR active_time_minutes <= total_time_minutes",
            name="active_time_not_greater_than_total",
        ),
        CheckConstraint(
            f"difficulty IS NULL OR difficulty IN {RECIPE_DIFFICULTIES!r}",
            name="difficulty_supported",
        ),
        CheckConstraint(
            "notes IS NULL OR (NULLIF(btrim(notes), '') IS NOT NULL "
            "AND char_length(notes) <= 5000)",
            name="notes_valid",
        ),
        CheckConstraint(
            "(creation_action_id IS NULL AND creation_request_fingerprint IS NULL) OR "
            "(creation_action_id IS NOT NULL AND creation_request_fingerprint IS NOT NULL)",
            name="creation_evidence_shape_valid",
        ),
        CheckConstraint(
            "creation_request_fingerprint IS NULL OR "
            "creation_request_fingerprint ~ '^[0-9a-f]{64}$'",
            name="creation_request_fingerprint_sha256",
        ),
        UniqueConstraint("id", "author_user_id", name="uq_recipe_drafts_id_author"),
        UniqueConstraint(
            "author_user_id",
            "creation_action_id",
            name="uq_recipe_drafts_author_creation_action",
        ),
        UniqueConstraint(
            "id",
            "author_user_id",
            "revision",
            name="uq_recipe_drafts_id_author_revision",
        ),
        Index(
            "ix_recipe_drafts_author_status_updated_id",
            "author_user_id",
            "status",
            "updated_at",
            "id",
        ),
        Index("ix_recipe_drafts_source_version_id", "source_version_id"),
    )

    author_user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    source_version_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("recipe_versions.id", ondelete="RESTRICT"),
        nullable=True,
    )
    creation_action_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        nullable=True,
    )
    creation_request_fingerprint: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default=RECIPE_DRAFT_STATUS_ACTIVE,
        server_default=text(f"'{RECIPE_DRAFT_STATUS_ACTIVE}'"),
    )
    revision: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        server_default=text("1"),
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    servings: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)
    total_time_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    active_time_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    difficulty: Mapped[str | None] = mapped_column(String(16), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    author: Mapped["User"] = relationship()
    source_version: Mapped["RecipeVersion | None"] = relationship()
    publication: Mapped["RecipeVersionPublication | None"] = relationship(
        back_populates="source_draft",
        uselist=False,
        viewonly=True,
    )
    ingredients: Mapped[list["RecipeDraftIngredient"]] = relationship(
        back_populates="draft",
        order_by="RecipeDraftIngredient.display_order",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    instructions: Mapped[list["RecipeDraftInstruction"]] = relationship(
        back_populates="draft",
        order_by="RecipeDraftInstruction.display_order",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    categories: Mapped[list["RecipeDraftCategory"]] = relationship(
        back_populates="draft",
        order_by="RecipeDraftCategory.display_order",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class RecipeDraftIngredient(UUIDPrimaryKeyMixin, Base):
    """One ordered private ingredient slot with a trusted or unresolved selection."""

    __tablename__ = "recipe_draft_ingredients"
    __table_args__ = (
        ForeignKeyConstraint(
            ["package_size_id", "ingredient_id", "measurement_unit_id"],
            [
                "ingredient_package_sizes.id",
                "ingredient_package_sizes.ingredient_id",
                "ingredient_package_sizes.package_unit_id",
            ],
            name="fk_recipe_draft_ingredients_package_size_ingredient_unit",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            f"selection_kind IN {RECIPE_DRAFT_SELECTION_KINDS!r}",
            name="selection_kind_supported",
        ),
        CheckConstraint(
            "(selection_kind = 'catalog' AND ingredient_id IS NOT NULL "
            "AND ingredient_request_id IS NULL "
            "AND NULLIF(btrim(name), '') IS NOT NULL) OR "
            "(selection_kind = 'request' AND ingredient_id IS NULL "
            "AND ingredient_request_id IS NOT NULL AND name IS NULL)",
            name="selection_shape_valid",
        ),
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
        CheckConstraint(
            "package_size_id IS NULL OR ingredient_id IS NOT NULL",
            name="package_requires_catalog_ingredient",
        ),
        CheckConstraint("display_order >= 0", name="display_order_nonnegative"),
        UniqueConstraint(
            "recipe_draft_id",
            "display_order",
            name="uq_recipe_draft_ingredients_draft_display_order",
        ),
        UniqueConstraint(
            "recipe_draft_id",
            "id",
            name="uq_recipe_draft_ingredients_draft_id",
        ),
        Index("ix_recipe_draft_ingredients_ingredient_id", "ingredient_id"),
        Index(
            "ix_recipe_draft_ingredients_ingredient_request_id",
            "ingredient_request_id",
        ),
        Index("ix_recipe_draft_ingredients_measurement_unit_id", "measurement_unit_id"),
    )

    recipe_draft_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("recipe_drafts.id", ondelete="CASCADE"),
        nullable=False,
    )
    selection_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    ingredient_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ingredients.id", ondelete="RESTRICT"),
        nullable=True,
    )
    ingredient_request_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ingredient_catalog_requests.id", ondelete="RESTRICT"),
        nullable=True,
    )
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    measure_mode: Mapped[str] = mapped_column(String(16), nullable=False)
    quantity_min: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    quantity_max: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    measurement_unit_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("measurement_units.id", ondelete="RESTRICT"),
        nullable=True,
    )
    unit_display: Mapped[str | None] = mapped_column(String(64), nullable=True)
    package_size_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    preparation_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False)

    draft: Mapped[RecipeDraft] = relationship(back_populates="ingredients")
    ingredient: Mapped["Ingredient | None"] = relationship()
    ingredient_request: Mapped["IngredientCatalogRequest | None"] = relationship()
    measurement_unit: Mapped["MeasurementUnit | None"] = relationship()
    package_size: Mapped["IngredientPackageSize | None"] = relationship(viewonly=True)


class RecipeDraftInstruction(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "recipe_draft_instructions"
    __table_args__ = (
        CheckConstraint("btrim(instruction) <> ''", name="instruction_not_blank"),
        CheckConstraint(
            "title IS NULL OR (NULLIF(btrim(title), '') IS NOT NULL AND char_length(title) <= 200)",
            name="title_valid",
        ),
        CheckConstraint("display_order >= 0", name="display_order_nonnegative"),
        UniqueConstraint(
            "recipe_draft_id",
            "display_order",
            name="uq_recipe_draft_instructions_draft_display_order",
        ),
        UniqueConstraint(
            "recipe_draft_id",
            "id",
            name="uq_recipe_draft_instructions_draft_id",
        ),
    )

    recipe_draft_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("recipe_drafts.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    instruction: Mapped[str] = mapped_column(Text, nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False)

    draft: Mapped[RecipeDraft] = relationship(back_populates="instructions")
    actions: Mapped[list["RecipeDraftInstructionAction"]] = relationship(
        back_populates="instruction",
        order_by="RecipeDraftInstructionAction.display_order",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class RecipeDraftInstructionAction(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "recipe_draft_instruction_actions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["recipe_draft_id", "recipe_draft_instruction_id"],
            ["recipe_draft_instructions.recipe_draft_id", "recipe_draft_instructions.id"],
            name="fk_recipe_draft_actions_instruction_same_draft",
            ondelete="CASCADE",
        ),
        CheckConstraint("display_order >= 0", name="display_order_nonnegative"),
        UniqueConstraint(
            "recipe_draft_instruction_id",
            "display_order",
            name="uq_recipe_draft_actions_instruction_display_order",
        ),
        UniqueConstraint(
            "recipe_draft_id",
            "id",
            name="uq_recipe_draft_actions_draft_id",
        ),
        Index("ix_recipe_draft_actions_draft_id", "recipe_draft_id"),
        Index("ix_recipe_draft_actions_action_type_id", "action_type_id"),
    )

    recipe_draft_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    recipe_draft_instruction_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        nullable=False,
    )
    action_type_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("cooking_action_types.id", ondelete="RESTRICT"),
        nullable=False,
    )
    display_order: Mapped[int] = mapped_column(Integer, nullable=False)

    instruction: Mapped[RecipeDraftInstruction] = relationship(back_populates="actions")
    action_type: Mapped["CookingActionType"] = relationship()
    inputs: Mapped[list["RecipeDraftInstructionActionInput"]] = relationship(
        back_populates="action",
        order_by="RecipeDraftInstructionActionInput.display_order",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    measures: Mapped[list["RecipeDraftInstructionActionMeasure"]] = relationship(
        back_populates="action",
        order_by="RecipeDraftInstructionActionMeasure.semantic",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class RecipeDraftInstructionActionInput(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "recipe_draft_instruction_action_inputs"
    __table_args__ = (
        ForeignKeyConstraint(
            ["recipe_draft_id", "recipe_draft_instruction_action_id"],
            [
                "recipe_draft_instruction_actions.recipe_draft_id",
                "recipe_draft_instruction_actions.id",
            ],
            name="fk_recipe_draft_action_inputs_action_same_draft",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["recipe_draft_id", "recipe_draft_ingredient_id"],
            ["recipe_draft_ingredients.recipe_draft_id", "recipe_draft_ingredients.id"],
            name="fk_recipe_draft_action_inputs_ingredient_same_draft",
            ondelete="CASCADE",
        ),
        CheckConstraint("display_order >= 0", name="order_valid"),
        UniqueConstraint(
            "recipe_draft_instruction_action_id",
            "display_order",
            name="uq_recipe_draft_action_inputs_action_display_order",
        ),
        UniqueConstraint(
            "recipe_draft_instruction_action_id",
            "recipe_draft_ingredient_id",
            name="uq_recipe_draft_action_inputs_action_ingredient",
        ),
        Index("ix_recipe_draft_action_inputs_draft_id", "recipe_draft_id"),
        Index(
            "ix_recipe_draft_action_inputs_ingredient_id",
            "recipe_draft_ingredient_id",
        ),
    )

    recipe_draft_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    recipe_draft_instruction_action_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        nullable=False,
    )
    recipe_draft_ingredient_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        nullable=False,
    )
    display_order: Mapped[int] = mapped_column(Integer, nullable=False)

    action: Mapped[RecipeDraftInstructionAction] = relationship(
        back_populates="inputs",
        foreign_keys=[recipe_draft_id, recipe_draft_instruction_action_id],
    )
    ingredient: Mapped[RecipeDraftIngredient] = relationship(
        foreign_keys=[recipe_draft_id, recipe_draft_ingredient_id],
        viewonly=True,
    )


class RecipeDraftInstructionActionMeasure(Base):
    __tablename__ = "recipe_draft_instruction_action_measures"
    __table_args__ = (
        CheckConstraint(
            "semantic IN ('duration', 'temperature')",
            name="semantic_supported",
        ),
        CheckConstraint(
            "(measure_mode = 'exact' AND quantity_min IS NOT NULL "
            "AND quantity_max IS NULL) OR "
            "(measure_mode = 'range' AND quantity_min IS NOT NULL "
            "AND quantity_max IS NOT NULL AND quantity_max > quantity_min)",
            name="measure_shape_valid",
        ),
        CheckConstraint(
            "semantic <> 'duration' OR quantity_min > 0",
            name="duration_positive",
        ),
        CheckConstraint("btrim(unit_display) <> ''", name="unit_not_blank"),
        Index(
            "ix_recipe_draft_action_measures_measurement_unit_id",
            "measurement_unit_id",
        ),
    )

    recipe_draft_instruction_action_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("recipe_draft_instruction_actions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    semantic: Mapped[str] = mapped_column(String(16), primary_key=True)
    measure_mode: Mapped[str] = mapped_column(String(16), nullable=False)
    quantity_min: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False)
    quantity_max: Mapped[Decimal | None] = mapped_column(Numeric(18, 6), nullable=True)
    measurement_unit_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("measurement_units.id", ondelete="RESTRICT"),
        nullable=False,
    )
    unit_display: Mapped[str] = mapped_column(String(64), nullable=False)

    action: Mapped[RecipeDraftInstructionAction] = relationship(back_populates="measures")
    measurement_unit: Mapped["MeasurementUnit"] = relationship()
