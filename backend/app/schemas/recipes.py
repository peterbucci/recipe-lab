from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.actions import RecipeInstructionActionResponse
from app.schemas.interactions import RecipeViewerStateResponse
from app.schemas.measurements import StructuredMeasureResponse
from app.schemas.users import PublicUserReference


class RecipeSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class RecipeSummary(RecipeSchema):
    id: UUID = Field(description="Stable identifier for this immutable recipe version.")
    lineage_id: UUID = Field(description="Identifier shared by every version in the lineage.")
    parent_version_id: UUID | None = Field(
        description="Direct parent version, or null for the original root."
    )
    version_number: int = Field(ge=1, description="Lineage-wide version number.")
    title: str = Field(min_length=1, max_length=200)
    description: str | None
    servings: Decimal = Field(
        gt=0,
        max_digits=8,
        decimal_places=2,
        description="Exact serving yield, serialized as a JSON string.",
    )
    created_at: datetime = Field(description="Timestamp when this version was created.")
    author: PublicUserReference = Field(
        description="Public author of this exact immutable recipe version."
    )
    parent: "RecipeVersionReference | None" = Field(
        description=(
            "Bounded direct-parent context for a fork. It is null for an original or when "
            "the referenced parent is not publicly readable. "
            "Parent authorship does not imply endorsement or lineage ownership."
        )
    )


class RecipeVersionReference(RecipeSchema):
    id: UUID
    version_number: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=200)
    author: PublicUserReference


class RecipeIngredientResponse(RecipeSchema):
    id: UUID
    ingredient_id: UUID = Field(
        description=(
            "Required curated catalog identity used for comparison, filtering, "
            "substitution, and recommendation signals."
        )
    )
    canonical_name: str = Field(
        min_length=1,
        max_length=200,
        description="Current canonical name for the required catalog identity.",
    )
    display_name: str = Field(
        min_length=1,
        max_length=200,
        description=(
            "Authored canonical-or-alias wording preserved for presentation; this value "
            "does not define ingredient identity."
        ),
    )
    measure: StructuredMeasureResponse = Field(
        description=(
            "Atomic structured amount. Numeric values always reference a curated unit; "
            "qualitative values are represented explicitly without a unit."
        )
    )
    preparation_notes: str | None
    display_order: int = Field(ge=0)


class RecipeInstructionResponse(RecipeSchema):
    id: UUID
    text: str = Field(min_length=1)
    display_order: int = Field(ge=0)
    actions: list[RecipeInstructionActionResponse] = Field(
        description=(
            "Ordered reviewed actions attached to the prose. An empty list identifies an "
            "unmapped historical instruction; newly published versions require at least one."
        )
    )


class RecipeDetailResponse(RecipeSummary):
    average_rating: float | None = Field(
        ge=1,
        le=5,
        description=(
            "Average of ratings currently recorded for this recipe version, rounded to two "
            "decimal places."
        ),
    )
    rating_count: int = Field(
        ge=0,
        description="Number of ratings included in the aggregate.",
    )
    viewer_state: RecipeViewerStateResponse | None = Field(
        description="Private member state, or null when the request is signed out."
    )
    children: list[RecipeVersionReference]
    ingredients: list[RecipeIngredientResponse]
    instructions: list[RecipeInstructionResponse]


class RecipePageResponse(BaseModel):
    items: list[RecipeSummary]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
    total: int = Field(ge=0, description="Total matches across every page.")
    total_pages: int = Field(ge=0, description="Number of pages at the requested page size.")
