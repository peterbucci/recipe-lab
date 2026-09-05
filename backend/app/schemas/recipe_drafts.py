from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from app.models.recipe_category import MAX_RECIPE_CATEGORIES
from app.schemas.actions import (
    ActionNumericMeasureInput,
    ActionNumericMeasureResponse,
    CookingActionTypeSummary,
)
from app.schemas.ingredient_catalog import CatalogRequestStatus, IngredientCatalogItem
from app.schemas.measurements import (
    ExactMeasureInput,
    RangeMeasureInput,
    StructuredMeasureInput,
    StructuredMeasureResponse,
)
from app.schemas.recipe_categories import RecipeCategorySummary


def _reject_boolean_decimal(value: object) -> object:
    if isinstance(value, bool):
        raise ValueError("boolean values are not valid decimal amounts")
    return value


def _validate_recipe_quantity_precision(value: Decimal) -> None:
    if value.copy_abs() >= Decimal("100000000"):
        raise ValueError("recipe quantities may contain at most eight integer digits")
    if value != value.quantize(Decimal("0.0001")):
        raise ValueError("recipe quantities may contain at most four decimal places")


DraftReference = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=100,
        pattern=r"^[^\x00]*$",
    ),
]
DraftTitle = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=200, pattern=r"^[^\x00]*$"),
]
DraftDescription = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=2_000,
        pattern=r"^[^\x00]*$",
    ),
]
DraftNotes = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=5_000,
        pattern=r"^[^\x00]*$",
    ),
]
DraftDisplayName = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=200,
        pattern=r"^[^\x00]*$",
    ),
]
DraftPreparationNotes = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=1_000,
        pattern=r"^[^\x00]*$",
    ),
]
DraftInstructionText = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=5_000,
        pattern=r"^[^\x00]*$",
    ),
]
DraftInstructionTitle = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=200,
        pattern=r"^[^\x00]*$",
    ),
]
DraftServings = Annotated[
    Decimal,
    BeforeValidator(_reject_boolean_decimal),
    Field(gt=0, max_digits=8, decimal_places=2),
]
DraftTimeMinutes = Annotated[int, Field(gt=0, le=525_600)]
RecipeDifficulty = Literal["easy", "medium", "hard"]


class RecipeDraftSchema(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class RecipeDraftCreateRequest(RecipeDraftSchema):
    source_version_id: UUID | None = None


class RecipeDraftCatalogSelectionInput(RecipeDraftSchema):
    kind: Literal["catalog"]
    ingredient_id: UUID
    display_name: DraftDisplayName


class RecipeDraftRequestSelectionInput(RecipeDraftSchema):
    kind: Literal["request"]
    ingredient_request_id: UUID


RecipeDraftIngredientSelectionInput = Annotated[
    RecipeDraftCatalogSelectionInput | RecipeDraftRequestSelectionInput,
    Field(discriminator="kind"),
]


class RecipeDraftIngredientInput(RecipeDraftSchema):
    ref: DraftReference
    selection: RecipeDraftIngredientSelectionInput
    measure: StructuredMeasureInput
    preparation_notes: DraftPreparationNotes | None = None


class RecipeDraftActionInput(RecipeDraftSchema):
    action_type_id: UUID
    ingredient_refs: list[DraftReference] = Field(default_factory=list, max_length=200)
    duration: ActionNumericMeasureInput | None = None
    temperature: ActionNumericMeasureInput | None = None

    @model_validator(mode="after")
    def unique_ingredient_references(self) -> Self:
        if len(self.ingredient_refs) != len(set(self.ingredient_refs)):
            raise ValueError("an action cannot reference the same ingredient slot twice")
        return self


class RecipeDraftInstructionInput(RecipeDraftSchema):
    ref: DraftReference
    title: DraftInstructionTitle | None = None
    text: DraftInstructionText
    actions: list[RecipeDraftActionInput] = Field(default_factory=list, max_length=50)


class RecipeDraftUpdateRequest(RecipeDraftSchema):
    revision: int = Field(ge=1)
    title: DraftTitle
    description: DraftDescription | None = None
    servings: DraftServings | None = None
    total_time_minutes: DraftTimeMinutes | None = None
    active_time_minutes: DraftTimeMinutes | None = None
    difficulty: RecipeDifficulty | None = None
    notes: DraftNotes | None = None
    category_ids: list[UUID] = Field(
        default_factory=list,
        max_length=MAX_RECIPE_CATEGORIES,
        description="Unique active curated category identities selected for this draft.",
    )
    ingredients: list[RecipeDraftIngredientInput] = Field(default_factory=list, max_length=200)
    instructions: list[RecipeDraftInstructionInput] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def validate_document_references_and_capacity(self) -> Self:
        if (
            self.total_time_minutes is not None
            and self.active_time_minutes is not None
            and self.active_time_minutes > self.total_time_minutes
        ):
            raise ValueError("active_time_minutes cannot be greater than total_time_minutes")
        if len(self.category_ids) != len(set(self.category_ids)):
            raise ValueError("category_ids values must be unique within a draft")
        for ingredient in self.ingredients:
            measure = ingredient.measure
            if isinstance(measure, ExactMeasureInput):
                _validate_recipe_quantity_precision(measure.value)
            elif isinstance(measure, RangeMeasureInput):
                _validate_recipe_quantity_precision(measure.minimum)
                _validate_recipe_quantity_precision(measure.maximum)

        ingredient_refs = [ingredient.ref for ingredient in self.ingredients]
        if len(ingredient_refs) != len(set(ingredient_refs)):
            raise ValueError("ingredient ref values must be unique within a draft")
        instruction_refs = [instruction.ref for instruction in self.instructions]
        if len(instruction_refs) != len(set(instruction_refs)):
            raise ValueError("instruction ref values must be unique within a draft")

        available = set(ingredient_refs)
        total_actions = 0
        total_inputs = 0
        for instruction in self.instructions:
            total_actions += len(instruction.actions)
            for action in instruction.actions:
                total_inputs += len(action.ingredient_refs)
                missing = set(action.ingredient_refs) - available
                if missing:
                    raise ValueError(
                        "a structured action references an ingredient slot that is not "
                        f"present in this draft: {sorted(missing)!r}"
                    )
        if total_actions > 500:
            raise ValueError("a draft may contain at most 500 structured actions")
        if total_inputs > 2_000:
            raise ValueError("a draft may contain at most 2000 structured action inputs")
        return self


class RecipeDraftCatalogSelectionResponse(RecipeDraftSchema):
    kind: Literal["catalog"] = "catalog"
    ingredient: IngredientCatalogItem
    display_name: str = Field(min_length=1, max_length=200)


class RecipeDraftIngredientRequestState(RecipeDraftSchema):
    id: UUID
    proposed_name: str = Field(min_length=1, max_length=200)
    status: CatalogRequestStatus
    resolved_ingredient: IngredientCatalogItem | None


class RecipeDraftRequestSelectionResponse(RecipeDraftSchema):
    kind: Literal["request"] = "request"
    request: RecipeDraftIngredientRequestState


RecipeDraftIngredientSelectionResponse = Annotated[
    RecipeDraftCatalogSelectionResponse | RecipeDraftRequestSelectionResponse,
    Field(discriminator="kind"),
]


class RecipeDraftIngredientResponse(RecipeDraftSchema):
    id: UUID
    selection: RecipeDraftIngredientSelectionResponse
    measure: StructuredMeasureResponse
    preparation_notes: str | None
    display_order: int = Field(ge=0)


class RecipeDraftActionResponse(RecipeDraftSchema):
    id: UUID
    action_type: CookingActionTypeSummary
    ingredient_occurrence_ids: list[UUID] = Field(default_factory=list)
    duration: ActionNumericMeasureResponse | None
    temperature: ActionNumericMeasureResponse | None
    display_order: int = Field(ge=0)


class RecipeDraftInstructionResponse(RecipeDraftSchema):
    id: UUID
    title: str | None = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=5_000)
    actions: list[RecipeDraftActionResponse]
    display_order: int = Field(ge=0)


class RecipeDraftSummaryResponse(RecipeDraftSchema):
    id: UUID
    source_version_id: UUID | None
    status: Literal["active"]
    revision: int = Field(ge=1)
    title: str = Field(max_length=200)
    ingredient_count: int = Field(ge=0)
    instruction_count: int = Field(ge=0)
    created_at: datetime
    updated_at: datetime


class RecipeDraftDetailResponse(RecipeDraftSchema):
    id: UUID
    source_version_id: UUID | None
    status: Literal["active"]
    revision: int = Field(ge=1)
    title: str = Field(max_length=200)
    description: str | None
    servings: DraftServings | None
    total_time_minutes: DraftTimeMinutes | None
    active_time_minutes: DraftTimeMinutes | None
    difficulty: RecipeDifficulty | None
    notes: str | None = Field(max_length=5_000)
    categories: list[RecipeCategorySummary]
    ingredients: list[RecipeDraftIngredientResponse]
    instructions: list[RecipeDraftInstructionResponse]
    created_at: datetime
    updated_at: datetime


class RecipeDraftPageResponse(RecipeDraftSchema):
    items: list[RecipeDraftSummaryResponse]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=100)
    total: int = Field(ge=0)
    total_pages: int = Field(ge=0)
