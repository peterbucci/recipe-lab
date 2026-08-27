from fastapi import APIRouter
from sqlalchemy import text

from app.api.dependencies import SessionDependency
from app.schemas.errors import ErrorResponse
from app.schemas.health import HealthResponse, ReadinessResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
def health_check() -> HealthResponse:
    return HealthResponse(status="ok", service="recipe-lab-api")


@router.get(
    "/readiness",
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
