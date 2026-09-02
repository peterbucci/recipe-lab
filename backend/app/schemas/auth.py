import unicodedata
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

HANDLE_PATTERN = r"^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])$"

Handle = Annotated[
    str,
    StringConstraints(
        min_length=3,
        max_length=30,
        pattern=HANDLE_PATTERN,
    ),
]


class AccountUserResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    handle: str | None = Field(default=None, min_length=3, max_length=30)
    display_name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)


class AnonymousSessionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["anonymous"] = "anonymous"


class AccountCapabilitiesResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    review_ingredient_requests: bool = False
    moderate_recipe_reports: bool = False


class MemberSessionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["onboarding_required", "authenticated"]
    user: AccountUserResponse
    capabilities: AccountCapabilitiesResponse = Field(default_factory=AccountCapabilitiesResponse)


AccountSessionResponse = Annotated[
    AnonymousSessionResponse | MemberSessionResponse,
    Field(discriminator="status"),
]


class AccountProfileUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    handle: Handle
    display_name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)

    @field_validator("handle", mode="before")
    @classmethod
    def normalize_handle(cls, value: object) -> object:
        return value.strip().lower() if isinstance(value, str) else value

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized or any(
            unicodedata.category(character).startswith("C") for character in normalized
        ):
            raise ValueError("Display name must not be blank or contain control characters.")
        return normalized

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.replace("\r\n", "\n").replace("\r", "\n").strip()
        if not normalized:
            return None
        if any(
            unicodedata.category(character).startswith("C") and character != "\n"
            for character in normalized
        ):
            raise ValueError(
                "Description must not contain control characters other than line breaks."
            )
        return normalized


class AccountDeletionRequest(BaseModel):
    """Exact destructive confirmation supplied by the member."""

    model_config = ConfigDict(extra="forbid")

    confirmation: str = Field(min_length=1, max_length=30)
