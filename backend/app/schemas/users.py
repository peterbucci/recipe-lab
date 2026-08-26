from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PublicUserReference(BaseModel):
    """The complete public identity contract for a Recipe Lab cook."""

    model_config = ConfigDict(extra="forbid", frozen=True, from_attributes=True)

    id: UUID = Field(description="Stable public identifier for this cook.")
    handle: str | None = Field(
        default=None,
        min_length=3,
        max_length=30,
        description=(
            "Unique public handle without a leading at-sign, or null for a non-profile identity."
        ),
    )
    display_name: str = Field(min_length=1, max_length=120)
