from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
)


def _reject_boolean_decimal(value: object) -> object:
    if isinstance(value, bool):
        raise ValueError("boolean values are not valid decimal amounts")
    return value


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
Unit = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=64,
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
Quantity = Annotated[
    Decimal,
    BeforeValidator(_reject_boolean_decimal),
    Field(gt=0, max_digits=12, decimal_places=4),
]


class ForkSchema(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class SetIngredientQuantity(ForkSchema):
    op: Literal["set_quantity"]
    recipe_ingredient_id: UUID = Field(
        description="Ingredient-row identifier from the direct source snapshot."
    )
    quantity: Quantity | None = Field(
        description="Exact new quantity, or null to mark the amount unspecified."
    )


class SetIngredientUnit(ForkSchema):
    op: Literal["set_unit"]
    recipe_ingredient_id: UUID = Field(
        description="Ingredient-row identifier from the direct source snapshot."
    )
    unit: Unit | None = Field(description="New unit, or null to clear the unit.")


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
    quantity: Quantity | None = Field(
        default=None,
        description="Exact quantity, or null when the amount is unspecified.",
    )
    unit: Unit | None = Field(default=None)
    preparation_notes: PreparationNotes | None = Field(default=None)


class RemoveIngredient(ForkSchema):
    op: Literal["remove"]
    recipe_ingredient_id: UUID = Field(
        description="Ingredient-row identifier from the direct source snapshot."
    )


IngredientEdit = Annotated[
    SetIngredientQuantity
    | SetIngredientUnit
    | ReplaceIngredient
    | AddIngredient
    | RemoveIngredient,
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
