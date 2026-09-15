from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.actions import RecipeInstructionActionResponse
from app.schemas.interactions import RecipeViewerStateResponse
from app.schemas.measurements import StructuredMeasureResponse
from app.schemas.recipe_categories import RecipeCategorySummary
from app.schemas.users import PublicUserReference


class RecipeSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class RecipeSummary(RecipeSchema):
    id: UUID = Field(description="Exact identifier for this immutable recipe version.")
    recipe_id: UUID = Field(
        description="Stable recipe identifier shared by every edition of this recipe."
    )
    lineage_id: UUID = Field(description="Identifier shared by every version in the lineage.")
    parent_version_id: UUID | None = Field(
        description=(
            "Exact source version for a cross-recipe adaptation, or null when this recipe "
            "was not adapted from another recipe. Same-recipe revisions use "
            "previous_version_id instead."
        )
    )
    version_number: int = Field(ge=1, description="Lineage-wide version number.")
    edition_number: int = Field(
        ge=1,
        description="Recipe-local edition number, beginning at one.",
    )
    relation_kind: Literal["original", "adaptation", "revision"] = Field(
        description=(
            "Stored publication topology: an original recipe, a cross-recipe adaptation, "
            "or a later edition of the same stable recipe."
        )
    )
    previous_version_id: UUID | None = Field(
        description="Exact preceding edition for a revision, or null for a first edition."
    )
    declared_change_reason: Literal["correction", "update"] | None = Field(
        description=(
            "Author-declared reason for a revision. This label does not determine topology."
        )
    )
    is_current: bool = Field(
        description="Whether this exact version is the stable recipe's current edition."
    )
    current_version: "RecipeVersionReference | None" = Field(
        description=(
            "The stable recipe's current exact version when it is publicly readable, or "
            "null when the current version is hidden."
        )
    )
    adaptation_source: "RecipeVersionReference | None" = Field(
        description=(
            "The exact publicly readable source from which this stable recipe was adapted, "
            "or null for an original recipe or when that source is unavailable. This stays "
            "fixed across later same-recipe revisions."
        )
    )
    title: str = Field(min_length=1, max_length=200)
    description: str | None
    servings: Decimal = Field(
        gt=0,
        max_digits=8,
        decimal_places=2,
        description="Exact serving yield, serialized as a JSON string.",
    )
    created_at: datetime = Field(description="Timestamp when this version was created.")
    published_at: datetime = Field(
        description="Timestamp when this immutable version first became public."
    )
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
    categories: list[RecipeCategorySummary] = Field(
        description=("Immutable curated category snapshots selected for this exact recipe version.")
    )


class RecipeVersionReference(RecipeSchema):
    id: UUID
    version_number: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=200)
    author: PublicUserReference


class RecipeHistoryEntry(RecipeSchema):
    """One readable version in a stable recipe history or adaptation branch."""

    id: UUID = Field(description="Exact immutable recipe-version identifier.")
    recipe_id: UUID = Field(description="Stable recipe identifier for this entry.")
    edition_number: int = Field(ge=1, description="Recipe-local edition number.")
    relation_kind: Literal["original", "adaptation", "revision"] = Field(
        description="Stored topology for this exact edition."
    )
    previous_version_id: UUID | None = Field(
        description=(
            "Exact preceding same-recipe edition for a revision. The identifier remains "
            "available when that predecessor is hidden, without exposing its description."
        )
    )
    adaptation_source_version_id: UUID | None = Field(
        description=(
            "Exact first-edition adaptation source, retained across later revisions. The "
            "identifier remains available when the source is hidden, without exposing its "
            "description."
        )
    )
    declared_change_reason: Literal["correction", "update"] | None = Field(
        description="Optional author-declared revision reason; it does not determine topology."
    )
    is_current: bool = Field(
        description="Whether this exact version is its stable recipe's current edition."
    )
    title: str = Field(min_length=1, max_length=200)
    published_at: datetime = Field(description="Timestamp when this exact version became public.")
    author: PublicUserReference


class RecipeHistoryResponse(BaseModel):
    recipe_id: UUID = Field(description="Stable recipe selected by the exact request version.")
    selected_version_id: UUID = Field(description="Exact readable version selected by the route.")
    current_version_id: UUID | None = Field(
        description=(
            "Exact current version when publicly readable, or null when the stable recipe's "
            "current edition is hidden. No older fallback is selected."
        )
    )
    editions: list[RecipeHistoryEntry] = Field(
        description="Readable same-recipe editions in ascending recipe-local order."
    )
    adaptations: list[RecipeHistoryEntry] = Field(
        description=(
            "Readable current versions of recipes adapted from any exact edition of this "
            "stable recipe. An entry may itself be a later revision; its branch membership "
            "comes from the stable recipe's first edition."
        )
    )
    editions_truncated: bool = Field(
        description="Whether more readable same-recipe editions exist beyond this bounded list."
    )
    adaptations_truncated: bool = Field(
        description="Whether more readable current adaptations exist beyond this bounded list."
    )


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
    title: str | None = Field(
        min_length=1,
        max_length=200,
        description=(
            "Optional authored heading for this step. Historical instructions may omit it."
        ),
    )
    text: str = Field(min_length=1)
    display_order: int = Field(ge=0)
    actions: list[RecipeInstructionActionResponse] = Field(
        description=(
            "Ordered reviewed actions attached to the prose. An empty list identifies an "
            "unmapped historical instruction; newly published versions require at least one."
        )
    )


class RecipeDetailResponse(RecipeSummary):
    total_time_minutes: int | None = Field(
        default=None,
        gt=0,
        description="Total elapsed cooking time in whole minutes, or null when not provided.",
    )
    active_time_minutes: int | None = Field(
        default=None,
        gt=0,
        description="Hands-on cooking time in whole minutes, or null when not provided.",
    )
    difficulty: Literal["easy", "medium", "hard"] | None = Field(
        default=None,
        description="Author-selected difficulty, or null when not provided.",
    )
    notes: str | None = Field(
        default=None,
        max_length=5_000,
        description="Optional public notes authored for this immutable recipe version.",
    )
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
    save_count: int = Field(
        ge=0,
        description="Number of members who saved this recipe version.",
    )
    viewer_state: RecipeViewerStateResponse | None = Field(
        description="Private member state, or null when the request is signed out."
    )
    children: list[RecipeVersionReference]
    ingredients: list[RecipeIngredientResponse]
    instructions: list[RecipeInstructionResponse]


class RecipeCardSummary(RecipeSummary):
    average_rating: float | None = Field(
        ge=1,
        le=5,
        description="Average public rating for this recipe version, or null when unrated.",
    )
    rating_count: int = Field(ge=0, description="Number of ratings in the average.")
    save_count: int = Field(ge=0, description="Number of members who saved this recipe version.")


class RecipePageResponse(BaseModel):
    items: list[RecipeCardSummary]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
    total: int = Field(ge=0, description="Total matches across every page.")
    total_pages: int = Field(ge=0, description="Number of pages at the requested page size.")


class FeaturedRecipeSummary(RecipeCardSummary):
    """Editorially selected recipe card with anonymous engagement totals."""


class FeaturedRecipeListResponse(BaseModel):
    items: list[FeaturedRecipeSummary] = Field(
        description=(
            "Deploy-reviewed public recipe versions in editorial display order. "
            "The list is global, not personalized or popularity-ranked."
        )
    )
