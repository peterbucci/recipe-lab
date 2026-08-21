from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.recipes import (
    RecipeIngredientResponse,
    RecipeInstructionResponse,
    RecipeVersionReference,
)

type RecipeFieldName = Literal["title", "description", "servings"]
type RecipeFieldValue = str | Decimal | None
type RecipeIngredientChangedField = Literal[
    "ingredient",
    "display_name",
    "quantity",
    "unit",
    "preparation_notes",
]
type RecipeInstructionChangedField = Literal["text"]


class RecipeFieldChange(BaseModel):
    field: RecipeFieldName
    before: RecipeFieldValue
    after: RecipeFieldValue


class RecipeIngredientPairChange(BaseModel):
    before: RecipeIngredientResponse
    after: RecipeIngredientResponse
    changed_fields: list[RecipeIngredientChangedField] = Field(min_length=1)


class RecipeIngredientDiff(BaseModel):
    added: list[RecipeIngredientResponse] = Field(default_factory=list)
    removed: list[RecipeIngredientResponse] = Field(default_factory=list)
    replaced: list[RecipeIngredientPairChange] = Field(default_factory=list)
    modified: list[RecipeIngredientPairChange] = Field(default_factory=list)


class RecipeInstructionPairChange(BaseModel):
    before: RecipeInstructionResponse
    after: RecipeInstructionResponse
    changed_fields: list[RecipeInstructionChangedField] = Field(min_length=1)


class RecipeInstructionDiff(BaseModel):
    added: list[RecipeInstructionResponse] = Field(default_factory=list)
    removed: list[RecipeInstructionResponse] = Field(default_factory=list)
    modified: list[RecipeInstructionPairChange] = Field(default_factory=list)


class RecipeDiffResponse(BaseModel):
    lineage_id: UUID
    base_version: RecipeVersionReference
    target_version: RecipeVersionReference
    metadata_changes: list[RecipeFieldChange] = Field(default_factory=list)
    ingredients: RecipeIngredientDiff
    instructions: RecipeInstructionDiff
    has_changes: bool
