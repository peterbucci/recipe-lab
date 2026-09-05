from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

RatingValue = Annotated[int, Field(strict=True, ge=1, le=5)]


class EmptyInteractionRequest(BaseModel):
    """Reject client-supplied actor or action data on otherwise bodyless mutations."""

    model_config = ConfigDict(extra="forbid")


class RecipeViewerStateResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recipe_version_id: UUID = Field(description="Recipe version this state belongs to.")
    saved: bool = Field(description="Whether the signed-in member saved this version.")
    rating: RatingValue | None = Field(
        description="The signed-in member's current rating, or null when they have not rated it."
    )


class RecipeViewerStateListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[RecipeViewerStateResponse] = Field(
        description="Private member state for each requested recipe version, in request order."
    )


class RatingUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rating: RatingValue = Field(description="Rating to set for the signed-in member.")
