from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from app.schemas.measurements import ExactMeasureInput, RangeMeasureInput, StructuredMeasureInput


def _reject_boolean_decimal(value: object) -> object:
    if isinstance(value, bool):
        raise ValueError("boolean values are not valid decimal amounts")
    return value


def _validate_recipe_quantity_precision(value: Decimal) -> None:
    if value.copy_abs() >= Decimal("100000000"):
        raise ValueError("recipe quantities may contain at most eight integer digits")
    if value != value.quantize(Decimal("0.0001")):
        raise ValueError("recipe quantities may contain at most four decimal places")


Title = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=200,
        pattern=r"^[^\x00]*$",
    ),
]
Description = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=2_000,
        pattern=r"^[^\x00]*$",
    ),
]
IngredientName = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=200,
        pattern=r"^[^\x00]*$",
    ),
]
PreparationNotes = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=1_000,
        pattern=r"^[^\x00]*$",
    ),
]
InstructionText = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=5_000,
        pattern=r"^[^\x00]*$",
    ),
]
Servings = Annotated[
    Decimal,
    BeforeValidator(_reject_boolean_decimal),
    Field(gt=0, max_digits=8, decimal_places=2),
]


class ForkSchema(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class SetIngredientMeasure(ForkSchema):
    op: Literal["set_measure"]
    recipe_ingredient_id: UUID = Field(
        description="Ingredient-row identifier from the direct source snapshot."
    )
    measure: StructuredMeasureInput = Field(
        description=(
            "Complete replacement measure. Quantity and unit cannot be edited as "
            "independent partial values."
        )
    )


class ReplaceIngredient(ForkSchema):
    op: Literal["replace"]
    recipe_ingredient_id: UUID = Field(
        description="Ingredient-row identifier from the direct source snapshot."
    )
    ingredient_id: UUID = Field(
        description=(
            "Stable curated catalog identity selected as the replacement. The server also "
            "verifies that display_name belongs to this exact identity."
        )
    )
    display_name: IngredientName = Field(
        description="Selected canonical name or reviewed alias to preserve for display."
    )


class AddIngredient(ForkSchema):
    op: Literal["add"]
    ingredient_id: UUID = Field(
        description=(
            "Stable curated catalog identity to append. Pending or rejected requests are "
            "not identities and cannot be submitted here."
        )
    )
    display_name: IngredientName = Field(
        description="Selected canonical name or reviewed alias for this identity."
    )
    measure: StructuredMeasureInput = Field(
        description=(
            "Required structured amount using a curated unit or an explicit qualitative value."
        )
    )
    preparation_notes: PreparationNotes | None = Field(default=None)


class RemoveIngredient(ForkSchema):
    op: Literal["remove"]
    recipe_ingredient_id: UUID = Field(
        description="Ingredient-row identifier from the direct source snapshot."
    )


IngredientEdit = Annotated[
    SetIngredientMeasure | ReplaceIngredient | AddIngredient | RemoveIngredient,
    Field(discriminator="op"),
]


class UpdateInstruction(ForkSchema):
    op: Literal["update"]
    recipe_instruction_id: UUID = Field(
        description="Instruction-row identifier from the direct source snapshot."
    )
    text: InstructionText


class AddInstruction(ForkSchema):
    op: Literal["add"]
    text: InstructionText


class RemoveInstruction(ForkSchema):
    op: Literal["remove"]
    recipe_instruction_id: UUID = Field(
        description="Instruction-row identifier from the direct source snapshot."
    )


InstructionEdit = Annotated[
    UpdateInstruction | AddInstruction | RemoveInstruction,
    Field(discriminator="op"),
]


class RecipeForkRequest(ForkSchema):
    title: Title = Field(description="Title for the new immutable recipe version.")
    description: Description | None = Field(
        description="Description for the new version, or null when none is needed."
    )
    servings: Servings = Field(
        description="Exact serving yield for the new version, serialized as a JSON string."
    )
    ingredient_edits: list[IngredientEdit] = Field(
        default_factory=list,
        max_length=200,
        description="Ordered edits applied to a copy of the source ingredient rows.",
    )
    instruction_edits: list[InstructionEdit] = Field(
        default_factory=list,
        max_length=100,
        description="Ordered edits applied to a copy of the source instructions.",
    )

    @model_validator(mode="after")
    def validate_recipe_measure_capacity(self) -> "RecipeForkRequest":
        for edit in self.ingredient_edits:
            if not isinstance(edit, (SetIngredientMeasure, AddIngredient)):
                continue
            measure = edit.measure
            if isinstance(measure, ExactMeasureInput):
                _validate_recipe_quantity_precision(measure.value)
            elif isinstance(measure, RangeMeasureInput):
                _validate_recipe_quantity_precision(measure.minimum)
                _validate_recipe_quantity_precision(measure.maximum)
        return self
