from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Response
from sqlalchemy.orm import Session

from app.api.dependencies import SettingsDependency
from app.db.session import SessionLocal
from app.services.auth import utc_now
from app.services.sandbox import verify_active_generation


def get_sandbox_admission_session(settings: SettingsDependency) -> Iterator[Session | None]:
    # Admission has its own read transaction; route workflows retain ownership
    # of their request session and may start their own transaction normally.
    if not settings.sandbox.enabled:
        yield None
        return
    with SessionLocal() as session:
        yield session


def require_active_sandbox(
    settings: SettingsDependency,
    response: Response,
    session: Annotated[Session | None, Depends(get_sandbox_admission_session)],
) -> None:
    if session is not None:
        response.headers["Cache-Control"] = "no-store"
        verify_active_generation(session, settings=settings, now=utc_now())
