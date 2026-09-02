from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.recipes import RecipeSummary
from app.schemas.users import PublicUserReference


class MemberFollowSchema(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class CookFollowStateResponse(MemberFollowSchema):
    cook_id: UUID
    following: bool
    follower_count: int = Field(ge=0)


class MyFollowStatsResponse(MemberFollowSchema):
    follower_count: int = Field(ge=0)
    following_count: int = Field(ge=0)


class MyFollowerItem(MemberFollowSchema):
    follower: PublicUserReference
    followed_at: datetime


class MyFollowersResponse(MemberFollowSchema):
    items: list[MyFollowerItem]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=100)
    total: int = Field(ge=0)
    total_pages: int = Field(ge=0)


class MyCommunityActivityResponse(MemberFollowSchema):
    items: list[RecipeSummary]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=100)
    total: int = Field(ge=0)
    total_pages: int = Field(ge=0)
