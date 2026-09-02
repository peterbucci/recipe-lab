from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.recipe_drafts import DraftDescription, RecipeDraftSummaryResponse
from app.schemas.recipes import RecipeCardSummary, RecipeSummary
from app.schemas.users import PublicUserReference


class RecipeLibrarySchema(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class PublicCookProfileResponse(RecipeLibrarySchema):
    cook: PublicUserReference
    follower_count: int = Field(ge=0)
    description: str | None = Field(max_length=500)
    items: list[RecipeCardSummary]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=100)
    total: int = Field(ge=0)
    total_pages: int = Field(ge=0)


class MyRecipeDraftItem(RecipeLibrarySchema):
    kind: Literal["draft"] = "draft"
    draft: RecipeDraftSummaryResponse
    source_recipe_title: str | None = Field(max_length=200)
    description: DraftDescription | None


class MyPublishedRecipeItem(RecipeLibrarySchema):
    kind: Literal["published"] = "published"
    recipe: RecipeSummary
    visibility_state: Literal["published", "author_withdrawn", "moderation_hidden"]


MyRecipeLibraryItem = Annotated[
    MyRecipeDraftItem | MyPublishedRecipeItem,
    Field(discriminator="kind"),
]


class MyRecipeLibraryResponse(RecipeLibrarySchema):
    items: list[MyRecipeLibraryItem]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=100)
    total: int = Field(ge=0)
    total_pages: int = Field(ge=0)


class SavedRecipeLibraryItem(RecipeLibrarySchema):
    recipe: RecipeSummary
    saved_at: datetime


class SavedRecipeLibraryResponse(RecipeLibrarySchema):
    items: list[SavedRecipeLibraryItem]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=100)
    total: int = Field(ge=0)
    total_pages: int = Field(ge=0)
