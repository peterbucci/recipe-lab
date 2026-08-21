from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.recipes import RecipeSummary


class RecommendationWeightsResponse(BaseModel):
    quality: Decimal = Field(
        ge=0,
        le=1,
        description="Weight of Bayesian rating quality within the global score.",
    )
    saves: Decimal = Field(
        ge=0,
        le=1,
        description="Weight of normalized active-save support within the global score.",
    )
    forks: Decimal = Field(
        ge=0,
        le=1,
        description="Weight of normalized distinct-fork support within the global score.",
    )
    views: Decimal = Field(
        ge=0,
        le=1,
        description="Weight of normalized distinct-view support within the global score.",
    )
    personalized_global: Decimal = Field(
        ge=0,
        le=1,
        description="Global-score weight when positive demo-profile history exists.",
    )
    personalized_similarity: Decimal = Field(
        ge=0,
        le=1,
        description="Ingredient-similarity weight when positive demo-profile history exists.",
    )
    quality_prior_mean: Decimal = Field(
        ge=1,
        le=5,
        description="Bayesian prior rating used for recipes with limited rating support.",
    )
    quality_prior_strength: int = Field(
        ge=1,
        description="Equivalent rating count assigned to the quality prior.",
    )


class RecommendationScoreBreakdown(BaseModel):
    quality: Decimal = Field(
        ge=0,
        le=1,
        decimal_places=6,
        description="Normalized Bayesian rating-quality signal.",
    )
    save_popularity: Decimal = Field(
        ge=0,
        le=1,
        decimal_places=6,
        description="Distinct active-save support normalized against the eligible maximum.",
    )
    fork_popularity: Decimal = Field(
        ge=0,
        le=1,
        decimal_places=6,
        description="Distinct-user fork support normalized against the eligible maximum.",
    )
    view_popularity: Decimal = Field(
        ge=0,
        le=1,
        decimal_places=6,
        description="Distinct-user view support normalized against the eligible maximum.",
    )
    global_score: Decimal = Field(
        ge=0,
        le=1,
        decimal_places=6,
        description="Weighted quality and popularity score before personalization.",
    )
    ingredient_similarity: Decimal = Field(
        ge=0,
        le=1,
        decimal_places=6,
        description="Strongest positive-history-weighted canonical-ingredient Jaccard score.",
    )


class RecipeRecommendationResponse(BaseModel):
    recipe: RecipeSummary
    score: Decimal = Field(
        ge=0,
        le=1,
        decimal_places=6,
        description="Final deterministic baseline score, serialized as a JSON string.",
    )
    components: RecommendationScoreBreakdown
    reason: str = Field(
        min_length=1,
        max_length=200,
        description="Short deterministic explanation for this recommendation.",
    )


class RecipeRecommendationsResponse(BaseModel):
    strategy: Literal["baseline-v1"] = Field(
        description="Versioned recommendation strategy used for every returned item."
    )
    personalized: bool = Field(
        description="Whether positive shared-demo history contributed to this ranking."
    )
    weights: RecommendationWeightsResponse
    items: list[RecipeRecommendationResponse]
