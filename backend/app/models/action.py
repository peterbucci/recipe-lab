from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    Boolean,
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
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.common import CreatedAtMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.measurement import MeasurementUnit
    from app.models.recipe import RecipeIngredient, RecipeInstruction


ACTION_PARAMETER_DURATION = "duration"
ACTION_PARAMETER_TEMPERATURE = "temperature"
ACTION_PARAMETER_SEMANTICS = (
    ACTION_PARAMETER_DURATION,
    ACTION_PARAMETER_TEMPERATURE,
)


class CookingActionType(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """One curated cooking verb with a stable identity.

    Catalog records are never rewritten to reinterpret historical snapshots.
    Superseded verbs become inactive so existing recipes remain readable while
    new action instances can select only reviewed active records.
    """

    __tablename__ = "cooking_action_types"

    key: Mapped[str] = mapped_column(String(64), nullable=False)
    canonical_verb: Mapped[str] = mapped_column(String(64), nullable=False)
    active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("true"),
    )
    provenance: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'",
            name="key_supported_format",
        ),
        CheckConstraint("btrim(canonical_verb) <> ''", name="canonical_verb_not_blank"),
        CheckConstraint("btrim(provenance) <> ''", name="provenance_not_blank"),
        Index(
            "uq_cooking_action_types_key_normalized",
            func.lower(func.btrim(key)),
            unique=True,
        ),
        Index(
            "uq_cooking_action_types_canonical_verb_normalized",
            func.lower(func.btrim(canonical_verb)),
            unique=True,
        ),
        Index("ix_cooking_action_types_active_verb", "active", "canonical_verb"),
    )


class RecipeInstructionAction(UUIDPrimaryKeyMixin, Base):
    """One ordered action instance attached to immutable instruction prose."""

    __tablename__ = "recipe_instruction_actions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["recipe_version_id", "recipe_instruction_id"],
            [
                "recipe_version_instructions.recipe_version_id",
                "recipe_version_instructions.id",
            ],
            name="fk_recipe_instruction_actions_instruction_same_version",
            ondelete="RESTRICT",
        ),
        CheckConstraint("display_order >= 0", name="display_order_nonnegative"),
        UniqueConstraint(
            "recipe_instruction_id",
            "display_order",
            name="uq_recipe_instruction_actions_instruction_display_order",
        ),
        UniqueConstraint(
            "recipe_version_id",
            "id",
            name="uq_recipe_instruction_actions_version_id",
        ),
        Index("ix_recipe_instruction_actions_recipe_version_id", "recipe_version_id"),
        Index("ix_recipe_instruction_actions_action_type_id", "action_type_id"),
    )

    recipe_version_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    recipe_instruction_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    action_type_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("cooking_action_types.id", ondelete="RESTRICT"),
        nullable=False,
    )
    display_order: Mapped[int] = mapped_column(Integer, nullable=False)

    instruction: Mapped["RecipeInstruction"] = relationship(back_populates="actions")
    action_type: Mapped[CookingActionType] = relationship()
    inputs: Mapped[list["RecipeInstructionActionInput"]] = relationship(
        back_populates="action",
        order_by="RecipeInstructionActionInput.display_order",
        passive_deletes="all",
    )
    measures: Mapped[list["RecipeInstructionActionMeasure"]] = relationship(
        back_populates="action",
        order_by="RecipeInstructionActionMeasure.semantic",
        passive_deletes="all",
    )


class RecipeInstructionActionInput(UUIDPrimaryKeyMixin, Base):
    """An ordered reference to one ingredient occurrence in the same snapshot."""

    __tablename__ = "recipe_instruction_action_inputs"
    __table_args__ = (
        ForeignKeyConstraint(
            ["recipe_version_id", "recipe_instruction_action_id"],
            [
                "recipe_instruction_actions.recipe_version_id",
                "recipe_instruction_actions.id",
            ],
            name="fk_recipe_instruction_action_inputs_action_same_version",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["recipe_version_id", "recipe_ingredient_id"],
            [
                "recipe_version_ingredients.recipe_version_id",
                "recipe_version_ingredients.id",
            ],
            name="fk_recipe_instruction_action_inputs_ingredient_same_version",
            ondelete="RESTRICT",
        ),
        CheckConstraint("display_order >= 0", name="display_order_nonnegative"),
        UniqueConstraint(
            "recipe_instruction_action_id",
            "display_order",
            name="uq_recipe_instruction_action_inputs_action_display_order",
        ),
        UniqueConstraint(
            "recipe_instruction_action_id",
            "recipe_ingredient_id",
            name="uq_recipe_instruction_action_inputs_action_ingredient",
        ),
        Index(
            "ix_recipe_instruction_action_inputs_recipe_version_id",
            "recipe_version_id",
        ),
        Index(
            "ix_recipe_instruction_action_inputs_recipe_ingredient_id",
            "recipe_ingredient_id",
        ),
    )

    recipe_version_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    recipe_instruction_action_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        nullable=False,
    )
    recipe_ingredient_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False)

    action: Mapped[RecipeInstructionAction] = relationship(
        back_populates="inputs",
        foreign_keys=[recipe_version_id, recipe_instruction_action_id],
    )
    ingredient: Mapped["RecipeIngredient"] = relationship(
        foreign_keys=[recipe_version_id, recipe_ingredient_id],
        viewonly=True,
    )


class RecipeInstructionActionMeasure(Base):
    """One structured numeric parameter on an action instance."""

    __tablename__ = "recipe_instruction_action_measures"
    __table_args__ = (
        CheckConstraint(
            "semantic IN ('duration', 'temperature')",
            name="semantic_supported",
        ),
        CheckConstraint(
            "(measure_mode = 'exact' "
            "AND quantity_min IS NOT NULL "
            "AND quantity_max IS NULL) "
            "OR (measure_mode = 'range' "
            "AND quantity_min IS NOT NULL "
            "AND quantity_max IS NOT NULL "
            "AND quantity_max > quantity_min)",
            name="measure_shape_valid",
        ),
        CheckConstraint(
            "semantic <> 'duration' OR quantity_min > 0",
            name="duration_positive",
        ),
        CheckConstraint("btrim(unit_display) <> ''", name="unit_display_not_blank"),
        Index(
            "ix_recipe_instruction_action_measures_measurement_unit_id",
            "measurement_unit_id",
        ),
    )

    recipe_instruction_action_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("recipe_instruction_actions.id", ondelete="RESTRICT"),
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

    action: Mapped[RecipeInstructionAction] = relationship(back_populates="measures")
    measurement_unit: Mapped["MeasurementUnit"] = relationship()
