from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.recipes import (
    RecipeIngredientResponse,
    RecipeInstructionResponse,
    RecipeVersionReference,
)

type RecipeFieldName = Literal[
    "title",
    "description",
    "servings",
    "total_time_minutes",
    "active_time_minutes",
    "difficulty",
    "notes",
]
type RecipeFieldValue = str | Decimal | int | None
type RecipeIngredientChangedField = Literal[
    "ingredient",
    "display_name",
    "measure",
    "preparation_notes",
]
type RecipeInstructionChangedField = Literal[
    "title",
    "text",
    "actions",
    "inputs",
    "action_order",
    "duration",
    "temperature",
]


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


class RecipeIngredientContext(BaseModel):
    """Complete ingredient snapshots used to resolve structured-action inputs."""

    base: list[RecipeIngredientResponse] = Field(default_factory=list)
    target: list[RecipeIngredientResponse] = Field(default_factory=list)


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
    ingredient_context: RecipeIngredientContext
    instructions: RecipeInstructionDiff
    has_changes: bool
