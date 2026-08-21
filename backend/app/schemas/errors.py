from pydantic import BaseModel, Field


class ValidationIssue(BaseModel):
    location: list[str | int] = Field(
        description="Request field location reported from the outermost object inward."
    )
    message: str
    type: str


class ErrorDetail(BaseModel):
    code: str = Field(examples=["recipe_not_found", "invalid_identifier", "validation_error"])
    message: str
    issues: list[ValidationIssue] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    error: ErrorDetail
