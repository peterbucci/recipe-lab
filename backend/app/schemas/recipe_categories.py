from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class RecipeCategorySchema(BaseModel):
    model_config = ConfigDict(from_attributes=True, frozen=True)


class RecipeCategorySummary(RecipeCategorySchema):
    id: UUID = Field(description="Stable identity from the curated category vocabulary.")
    name: str = Field(min_length=1, max_length=80)
    slug: str = Field(
        min_length=1,
        max_length=64,
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
        description="Exact stable value accepted by the public recipe category filter.",
    )


class RecipeCategoryListResponse(RecipeCategorySchema):
    items: list[RecipeCategorySummary] = Field(
        description="Active curated categories in stable product display order."
    )
