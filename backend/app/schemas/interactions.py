from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

RatingValue = Annotated[int, Field(strict=True, ge=1, le=5)]


class DemoUserResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID = Field(description="Server-selected identity used for demo interactions.")
    display_name: str = Field(min_length=1, max_length=120)
    identity_mode: Literal["shared_demo"] = Field(
        description="Signals that this is a shared demo profile, not an authenticated account."
    )


class RecipeViewerStateResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recipe_version_id: UUID = Field(description="Recipe version this state belongs to.")
    user: DemoUserResponse
    saved: bool = Field(description="Whether the demo user has saved this version.")
    rating: RatingValue | None = Field(
        description="The demo user's current rating, or null when they have not rated it."
    )


class RatingUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rating: RatingValue = Field(description="Rating to set for the shared demo user.")
