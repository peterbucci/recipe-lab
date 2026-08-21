from collections.abc import Iterator

from sqlalchemy.orm import Session

from app.db.session import SessionLocal


def get_session() -> Iterator[Session]:
    """Provide one request-scoped database session."""

    with SessionLocal() as session:
        yield session
