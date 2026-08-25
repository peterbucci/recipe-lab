from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

DuplicateClassification = Literal[
    "exact_duplicate",
    "probable_duplicate",
    "distinct",
]
DuplicateCandidateClassification = Literal[
    "exact_duplicate",
    "probable_duplicate",
]
DuplicateDecision = Literal["continue", "revise"]

PolicyVersion = Annotated[
    str,
    StringConstraints(
        min_length=1,
        max_length=64,
        pattern=r"^[a-z0-9]+(?:[._-][a-z0-9]+)*$",
    ),
]
Sha256Digest = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
Score = Annotated[str, StringConstraints(pattern=r"^(?:0|1)\.\d{6}$")]
ReasonCode = Annotated[
    str,
    StringConstraints(
        min_length=1,
        max_length=64,
        pattern=r"^[a-z0-9]+(?:_[a-z0-9]+)*$",
    ),
]


class RecipeDuplicateSchema(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class RecipeDuplicateReasonResponse(RecipeDuplicateSchema):
    code: ReasonCode
    message: Annotated[str, StringConstraints(min_length=1, max_length=200)]


class RecipeDuplicateCandidateResponse(RecipeDuplicateSchema):
    public_recipe_version_id: UUID = Field(
        description="Public recipe UUID from which the client constructs a local recipe link."
    )
    title: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    classification: DuplicateCandidateClassification
    score: Score = Field(
        description="Deterministic structural similarity from 0 to 1 with six decimals."
    )
    reasons: list[RecipeDuplicateReasonResponse] = Field(min_length=1, max_length=3)


class RecipeDuplicateWarningResponse(RecipeDuplicateSchema):
    code: Literal["same_lineage_no_change"]
    message: Annotated[str, StringConstraints(min_length=1, max_length=200)]


class RecipeDuplicateAcknowledgementResponse(RecipeDuplicateSchema):
    preflight_id: UUID
    policy_version: PolicyVersion
    result_digest: Sha256Digest
    required: bool
    allowed_decisions: list[DuplicateDecision] = Field(max_length=2)


class RecipeDuplicatePreflightResponse(RecipeDuplicateSchema):
    classification: DuplicateClassification
    same_lineage_no_change: bool
    candidates: list[RecipeDuplicateCandidateResponse] = Field(max_length=5)
    warnings: list[RecipeDuplicateWarningResponse] = Field(max_length=1)
    acknowledgement: RecipeDuplicateAcknowledgementResponse


class RecipeDuplicateDecisionRequest(RecipeDuplicateSchema):
    policy_version: PolicyVersion
    result_digest: Sha256Digest
    decision: DuplicateDecision


class RecipeDuplicateDecisionResponse(RecipeDuplicateSchema):
    preflight_id: UUID
    decision: DuplicateDecision
    recorded_at: datetime
