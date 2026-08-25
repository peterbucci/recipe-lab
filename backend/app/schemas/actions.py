from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.schemas.measurements import (
    ExactMeasureInput,
    ExactMeasureResponse,
    RangeMeasureInput,
    RangeMeasureResponse,
)


class ActionSchema(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


IngredientEditReference = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=100,
        pattern=r"^[^\x00]*$",
    ),
]


class CookingActionTypeSummary(ActionSchema):
    id: UUID
    key: str = Field(min_length=1, max_length=64)
    canonical_verb: str = Field(min_length=1, max_length=64)
    active: bool


class CookingActionTypeCatalogItem(CookingActionTypeSummary):
    provenance: str = Field(min_length=1)


class CookingActionTypeCatalogPage(ActionSchema):
    items: list[CookingActionTypeCatalogItem]


class ExistingIngredientOccurrenceReference(ActionSchema):
    kind: Literal["existing"]
    recipe_ingredient_id: UUID


class AddedIngredientOccurrenceReference(ActionSchema):
    kind: Literal["added"]
    ingredient_edit_ref: IngredientEditReference


IngredientOccurrenceReference = Annotated[
    ExistingIngredientOccurrenceReference | AddedIngredientOccurrenceReference,
    Field(discriminator="kind"),
]

ActionNumericMeasureInput = Annotated[
    ExactMeasureInput | RangeMeasureInput,
    Field(discriminator="kind"),
]
ActionNumericMeasureResponse = Annotated[
    ExactMeasureResponse | RangeMeasureResponse,
    Field(discriminator="kind"),
]


class StructuredActionInput(ActionSchema):
    action_type_id: UUID
    ingredient_refs: list[IngredientOccurrenceReference] = Field(
        default_factory=list,
        max_length=200,
    )
    duration: ActionNumericMeasureInput | None = None
    temperature: ActionNumericMeasureInput | None = None

    @model_validator(mode="after")
    def unique_inputs(self) -> "StructuredActionInput":
        identities = [
            (reference.kind, reference.model_dump(mode="python"))
            for reference in self.ingredient_refs
        ]
        canonical = [
            (kind, tuple(sorted((key, str(value)) for key, value in values.items())))
            for kind, values in identities
        ]
        if len(canonical) != len(set(canonical)):
            raise ValueError("an action cannot reference the same ingredient occurrence twice")
        return self


class RecipeInstructionActionResponse(ActionSchema):
    id: UUID
    action_type: CookingActionTypeSummary
    display_order: int = Field(ge=0)
    ingredient_occurrence_ids: list[UUID] = Field(default_factory=list)
    duration: ActionNumericMeasureResponse | None
    temperature: ActionNumericMeasureResponse | None
