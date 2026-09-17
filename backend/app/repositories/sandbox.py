from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models import User
from app.models.sandbox import SandboxGeneration


def read_generation(session: Session) -> SandboxGeneration | None:
    return session.get(SandboxGeneration, 1)


def lock_generation_initialization(session: Session) -> None:
    session.execute(text("LOCK TABLE sandbox_generations IN EXCLUSIVE MODE"))


def database_name(session: Session) -> str:
    return str(session.scalar(text("SELECT current_database()")))


def has_existing_accounts(session: Session) -> bool:
    return session.scalar(select(User.id).limit(1)) is not None


def add_generation(session: Session, generation: SandboxGeneration) -> None:
    session.add(generation)
    session.flush()
