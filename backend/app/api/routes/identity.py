from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.demo_context import demo_user_response, get_demo_user_or_error
from app.api.dependencies import get_session
from app.schemas.errors import ErrorResponse
from app.schemas.interactions import DemoUserResponse

router = APIRouter()
SessionDependency = Annotated[Session, Depends(get_session)]

IDENTITY_ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    503: {
        "model": ErrorResponse,
        "description": "The seeded demo identity is unavailable.",
    }
}


@router.get(
    "/me",
    response_model=DemoUserResponse,
    responses=IDENTITY_ERROR_RESPONSES,
    summary="Read the scoped demo identity",
)
def current_user(session: SessionDependency) -> DemoUserResponse:
    return demo_user_response(get_demo_user_or_error(session))
