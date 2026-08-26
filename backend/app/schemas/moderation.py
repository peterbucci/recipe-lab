from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.schemas.users import PublicUserReference

RecipeReportReason = Literal[
    "spam",
    "harassment",
    "dangerous_content",
    "intellectual_property",
    "other",
]
ModerationCaseStatus = Literal["open", "resolved"]
ModerationAction = Literal["hide", "restore", "resolve"]
RecipeVisibilityState = Literal["published", "author_withdrawn", "moderation_hidden"]

PrivateText = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=1_000,
        pattern=r"^[^\x00]*$",
    ),
]


class ModerationSchema(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, from_attributes=True)


class RecipeReportCreate(ModerationSchema):
    reason: RecipeReportReason
    details: PrivateText | None = None

    @field_validator("details", mode="before")
    @classmethod
    def blank_details_are_absent(cls, value: object) -> object:
        return None if isinstance(value, str) and not value.strip() else value


class RecipeReportReceipt(ModerationSchema):
    id: UUID
    recipe_version_id: UUID
    submitted_at: datetime


class RecipeReportReasonCount(ModerationSchema):
    reason: RecipeReportReason
    count: int = Field(ge=1)


class RecipeModerationCaseSummary(ModerationSchema):
    recipe_version_id: UUID
    title: str = Field(min_length=1, max_length=200)
    author: PublicUserReference
    status: ModerationCaseStatus
    visibility_state: RecipeVisibilityState
    reporter_count: int = Field(ge=1)
    opened_at: datetime
    last_reported_at: datetime
    resolved_at: datetime | None


class RecipeModerationCasePage(ModerationSchema):
    items: list[RecipeModerationCaseSummary] = Field(max_length=100)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=100)
    total: int = Field(ge=0)
    total_pages: int = Field(ge=0)


class DeidentifiedRecipeReport(ModerationSchema):
    id: UUID
    reason: RecipeReportReason
    details: PrivateText | None
    submitted_at: datetime


class RecipeModerationAuditActor(ModerationSchema):
    id: UUID
    handle: str | None = Field(default=None, min_length=3, max_length=30)
    display_name: str = Field(min_length=1, max_length=120)


class RecipeModerationAuditEntry(ModerationSchema):
    id: int = Field(ge=1)
    action: ModerationAction
    previous_status: ModerationCaseStatus
    status: ModerationCaseStatus
    visibility_state: RecipeVisibilityState
    private_note: PrivateText | None
    occurred_at: datetime
    actor: RecipeModerationAuditActor


class RecipeModerationCaseDetail(RecipeModerationCaseSummary):
    reason_counts: list[RecipeReportReasonCount] = Field(max_length=5)
    reports: list[DeidentifiedRecipeReport] = Field(max_length=100)
    reports_total: int = Field(ge=0)
    reports_truncated: bool
    history: list[RecipeModerationAuditEntry] = Field(max_length=100)
    history_total: int = Field(ge=0)
    history_truncated: bool


class RecipeModerationActionRequest(ModerationSchema):
    action: ModerationAction
    private_note: PrivateText | None = None

    @field_validator("private_note", mode="before")
    @classmethod
    def blank_note_is_absent(cls, value: object) -> object:
        return None if isinstance(value, str) and not value.strip() else value


class RecipeModerationActionResponse(ModerationSchema):
    recipe_version_id: UUID
    action: ModerationAction
    changed: bool
    case_status: ModerationCaseStatus
    visibility_state: RecipeVisibilityState
    acted_at: datetime
