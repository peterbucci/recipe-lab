from fastapi import APIRouter, Depends
from sqlalchemy import text

from app.api.dependencies import SessionDependency
from app.api.sandbox import require_active_sandbox
from app.schemas.errors import ErrorResponse
from app.schemas.health import HealthResponse, ReadinessResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
def health_check() -> HealthResponse:
    return HealthResponse(status="ok", service="recipe-lab-api")


@router.get(
    "/readiness",
    dependencies=[Depends(require_active_sandbox)],
    response_model=ReadinessResponse,
    responses={
        503: {
            "model": ErrorResponse,
            "description": "A required service dependency is unavailable.",
        }
    },
)
def readiness_check(session: SessionDependency) -> ReadinessResponse:
    session.execute(text("SELECT 1")).scalar_one()
    return ReadinessResponse(status="ready", service="recipe-lab-api")
