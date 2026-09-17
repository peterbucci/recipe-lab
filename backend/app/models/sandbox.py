"""One immutable lifetime marker for an entire disposable environment."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, Integer, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SandboxGeneration(Base):
    __tablename__ = "sandbox_generations"
    __table_args__ = (
        CheckConstraint("singleton = 1", name="single_generation"),
        CheckConstraint(
            "expires_at > started_at AND expires_at <= started_at + interval '24 hours'",
            name="bounded_lifetime",
        ),
    )

    singleton: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    generation_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False, unique=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
