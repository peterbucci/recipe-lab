"""Lifetime policy and one-time binding for isolated portfolio environments."""

from datetime import datetime

from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.domain_errors import DomainUnavailableError
from app.models.sandbox import SandboxGeneration
from app.repositories.sandbox import (
    add_generation,
    database_name,
    has_existing_accounts,
    lock_generation_initialization,
    read_generation,
)


class SandboxUnavailableError(DomainUnavailableError):
    code = "sandbox_unavailable"
    public_message = "The demo is resetting. Please try again shortly."

    def __init__(self) -> None:
        super().__init__(headers={"Cache-Control": "no-store"})


def require_generation_window(settings: Settings, *, now: datetime) -> None:
    sandbox = settings.sandbox
    if (
        not sandbox.enabled
        or sandbox.started_at is None
        or sandbox.expires_at is None
        or not sandbox.started_at <= now < sandbox.expires_at
    ):
        raise SandboxUnavailableError()


def verify_active_generation(session: Session, *, settings: Settings, now: datetime) -> None:
    require_generation_window(settings, now=now)
    sandbox = settings.sandbox
    generation = read_generation(session)
    if (
        generation is None
        or generation.generation_id != sandbox.generation_id
        or generation.started_at != sandbox.started_at
        or generation.expires_at != sandbox.expires_at
    ):
        raise SandboxUnavailableError()


def initialize_generation_workflow(
    session: Session, *, settings: Settings, expected_database_name: str, now: datetime
) -> None:
    """Bind only a fresh database, before seeding or admitting any visitor."""
    require_generation_window(settings, now=now)
    if (
        not expected_database_name.startswith("recipe_lab_sandbox_")
        or make_url(settings.database_url).database != expected_database_name
    ):
        raise SandboxUnavailableError()
    with session.begin():
        if database_name(session) != expected_database_name:
            raise SandboxUnavailableError()
        lock_generation_initialization(session)
        if read_generation(session) is not None:
            verify_active_generation(session, settings=settings, now=now)
            return
        if has_existing_accounts(session):
            raise SandboxUnavailableError()
        sandbox = settings.sandbox
        add_generation(
            session,
            SandboxGeneration(
                generation_id=sandbox.generation_id,
                started_at=sandbox.started_at,
                expires_at=sandbox.expires_at,
            ),
        )
