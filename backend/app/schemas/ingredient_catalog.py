from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

CatalogName = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=200,
        pattern=r"^[^\x00]*$",
    ),
]
ShortContext = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=500,
        pattern=r"^[^\x00]*$",
    ),
]
DecisionText = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=1_000,
        pattern=r"^[^\x00]*$",
    ),
]
CatalogRequestStatus = Literal["pending", "approved", "rejected", "duplicate"]


class CatalogSchema(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)


class IngredientCatalogItem(CatalogSchema):
    id: UUID = Field(description="Stable curated ingredient identity.")
    canonical_name: CatalogName
    aliases: list[CatalogName] = Field(
        description="Curated display labels that resolve to the same ingredient identity."
    )


class IngredientCatalogPage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[IngredientCatalogItem]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
    total: int = Field(ge=0)
    total_pages: int = Field(ge=0)


class IngredientCatalogRequestCreate(CatalogSchema):
    proposed_name: CatalogName
    context: ShortContext | None = None

    @field_validator("context", mode="before")
    @classmethod
    def blank_context_is_absent(cls, value: object) -> object:
        return None if isinstance(value, str) and not value.strip() else value


class IngredientCatalogRequestResponse(CatalogSchema):
    id: UUID
    proposed_name: CatalogName
    context: ShortContext | None
    status: CatalogRequestStatus
    created_at: datetime
    reviewed_at: datetime | None
    decision_reason: DecisionText | None
    resolved_ingredient_id: UUID | None


class IngredientCatalogRequestReviewResponse(IngredientCatalogRequestResponse):
    requester_user_id: UUID
    reviewer_user_id: UUID | None
    duplicate_of_request_id: UUID | None
    approved_canonical_name: CatalogName | None
    approved_aliases: list[CatalogName] | None
    approval_provenance: DecisionText | None


class IngredientCatalogRequestPage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[IngredientCatalogRequestResponse]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
    total: int = Field(ge=0)
    total_pages: int = Field(ge=0)


class IngredientCatalogReviewPage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[IngredientCatalogRequestReviewResponse]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
    total: int = Field(ge=0)
    total_pages: int = Field(ge=0)


class ApproveIngredientCatalogRequest(CatalogSchema):
    decision: Literal["approve"]
    canonical_name: CatalogName
    aliases: list[CatalogName] = Field(default_factory=list, max_length=20)
    reason: DecisionText
    provenance: DecisionText

    @model_validator(mode="after")
    def names_are_distinct(self) -> Self:
        normalized_canonical = self.canonical_name.casefold()
        normalized_aliases = [alias.casefold() for alias in self.aliases]
        if len(normalized_aliases) != len(set(normalized_aliases)):
            raise ValueError("Approved aliases must be unique after normalization.")
        if normalized_canonical in normalized_aliases:
            raise ValueError("The canonical name cannot also be an approved alias.")
        return self


class RejectIngredientCatalogRequest(CatalogSchema):
    decision: Literal["reject"]
    reason: DecisionText


class DuplicateIngredientCatalogRequest(CatalogSchema):
    decision: Literal["duplicate"]
    reason: DecisionText
    ingredient_id: UUID | None = None
    request_id: UUID | None = None

    @model_validator(mode="after")
    def exactly_one_duplicate_target(self) -> Self:
        if (self.ingredient_id is None) == (self.request_id is None):
            raise ValueError("A duplicate decision requires exactly one target.")
        return self


IngredientCatalogReviewRequest = Annotated[
    ApproveIngredientCatalogRequest
    | RejectIngredientCatalogRequest
    | DuplicateIngredientCatalogRequest,
    Field(discriminator="decision"),
]
