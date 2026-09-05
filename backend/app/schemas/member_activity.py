from datetime import datetime
from typing import Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.recipe_drafts import RecipeDraftSummaryResponse
from app.services.member_activity import (
    MemberActivityFilter,
    MemberActivityKind,
    MemberActivityState,
)


class MemberActivitySchema(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class MemberActivityItem(MemberActivitySchema):
    id: UUID
    kind: MemberActivityKind
    title: str = Field(max_length=200)
    occurred_at: datetime
    state: MemberActivityState | None = None

    @model_validator(mode="after")
    def state_matches_kind(self) -> Self:
        if self.kind == "published":
            if self.state not in {"published", "moderation_hidden"}:
                raise ValueError("Published activity requires a visible publication state.")
        elif self.kind == "withdrawn":
            if self.state != "author_withdrawn":
                raise ValueError("Withdrawn activity requires an author-withdrawn state.")
        elif self.kind == "ingredient-request":
            if self.state not in {"approved", "rejected", "duplicate"}:
                raise ValueError("Ingredient-request activity requires a reviewed state.")
        elif self.state is not None:
            raise ValueError("Draft and saved activity cannot carry a state.")
        return self


class MemberActivityCounts(MemberActivitySchema):
    all: int = Field(ge=0)
    recipes: int = Field(ge=0)
    saved: int = Field(ge=0)
    requests: int = Field(ge=0)


class MyMemberActivityResponse(MemberActivitySchema):
    items: list[MemberActivityItem]
    counts: MemberActivityCounts
    selected_filter: MemberActivityFilter
    next_cursor: str | None = Field(max_length=512)


class MemberDashboardStats(MemberActivitySchema):
    versions_published: int = Field(ge=0)
    active_drafts: int = Field(ge=0)
    saved_recipes: int = Field(ge=0)
    followers: int = Field(ge=0)


class MyMemberDashboardResponse(MemberActivitySchema):
    latest_draft: RecipeDraftSummaryResponse | None
    recent_activity: list[MemberActivityItem] = Field(max_length=3)
    stats: MemberDashboardStats
