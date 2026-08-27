from collections.abc import Mapping
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.observability import (
    CORRELATION_ID_HEADER,
    correlation_id_from_scope,
    emit_operational_failure,
    request_failure_event,
)
from app.schemas.errors import ErrorDetail, ErrorResponse, ValidationIssue


class ApiError(Exception):
    def __init__(
        self,
        *,
        status_code: int,
        code: str,
        message: str,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.headers = dict(headers or {})


def _json_error(
    *,
    status_code: int,
    code: str,
    message: str,
    issues: list[ValidationIssue] | None = None,
    headers: Mapping[str, str] | None = None,
    correlation_id: str,
) -> JSONResponse:
    response = ErrorResponse(
        error=ErrorDetail(
            code=code,
            message=message,
            issues=issues or [],
            correlation_id=correlation_id,
        )
    )
    response_headers = dict(headers or {})
    response_headers[CORRELATION_ID_HEADER] = correlation_id
    return JSONResponse(
        status_code=status_code,
        content=response.model_dump(mode="json"),
        headers=response_headers,
    )


async def api_error_handler(request: Request, exception: Exception) -> JSONResponse:
    if not isinstance(exception, ApiError):
        raise exception
    correlation_id = correlation_id_from_scope(request.scope)
    if exception.status_code >= 500:
        emit_operational_failure(
            request_failure_event(request.scope),
            correlation_id=correlation_id,
        )
    return _json_error(
        status_code=exception.status_code,
        code=exception.code,
        message=exception.message,
        headers=exception.headers,
        correlation_id=correlation_id,
    )


def _validation_issue(error: dict[str, Any]) -> ValidationIssue:
    raw_location = error.get("loc", ())
    location = [item if isinstance(item, (str, int)) else str(item) for item in raw_location]
    return ValidationIssue(
        location=location,
        message=str(error.get("msg", "Invalid value.")),
        type=str(error.get("type", "value_error")),
    )


async def request_validation_error_handler(
    request: Request,
    exception: Exception,
) -> JSONResponse:
    if not isinstance(exception, RequestValidationError):
        raise exception
    issues = [_validation_issue(error) for error in exception.errors()]
    identifier_error = any(
        issue.type.startswith("uuid_")
        and any(
            part
            in {
                "recipe_version_id",
                "lineage_id",
                "base_version_id",
                "source_version_id",
                "draft_id",
                "ingredient_request_id",
            }
            for part in issue.location
        )
        for issue in issues
    )
    return _json_error(
        status_code=422,
        code="invalid_identifier" if identifier_error else "validation_error",
        message=(
            "One or more identifiers are invalid."
            if identifier_error
            else "The request parameters are invalid."
        ),
        issues=issues,
        correlation_id=correlation_id_from_scope(request.scope),
    )


def register_error_handlers(application: FastAPI) -> None:
    application.add_exception_handler(ApiError, api_error_handler)
    application.add_exception_handler(RequestValidationError, request_validation_error_handler)
