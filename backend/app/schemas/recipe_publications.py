from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.recipe_duplicates import PolicyVersion, Sha256Digest


class RecipePublicationSchema(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class RecipeDraftDuplicatePreflightRequest(RecipePublicationSchema):
    revision: int = Field(ge=1)


class RecipePublicationDuplicateReview(RecipePublicationSchema):
    preflight_id: UUID
    policy_version: PolicyVersion
    result_digest: Sha256Digest
    decision: Literal["continue"] | None


class RecipeOriginalPublicationRequest(RecipePublicationSchema):
    revision: int = Field(ge=1)
    duplicate_review: RecipePublicationDuplicateReview
    community_rules_accepted: Literal[True]
    content_rights_confirmed: Literal[True]


class RecipeOriginalPublicationResponse(RecipePublicationSchema):
    recipe_version_id: UUID
    location: str


class RecipeVisibilityUpdateRequest(RecipePublicationSchema):
    state: Literal["published", "author_withdrawn"] = Field(
        description=(
            "Desired author-controlled visibility. Moderation state is intentionally "
            "outside this member endpoint."
        )
    )


class RecipeVisibilityResponse(RecipePublicationSchema):
    recipe_version_id: UUID
    state: Literal["published", "author_withdrawn", "moderation_hidden"]
    updated_at: datetime


# RCP-28 source-backed publication uses the shipped RCP-27 HTTP/OpenAPI contract.
# Generic Python aliases let the implementation describe both draft kinds without
# changing the original component names consumed by existing clients.
RecipeDraftPublicationRequest = RecipeOriginalPublicationRequest
RecipeDraftPublicationResponse = RecipeOriginalPublicationResponse
