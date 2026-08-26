from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models.abuse import AbuseRateLimitBucket


@dataclass(frozen=True, slots=True)
class RecordedRateLimitAttempt:
    request_count: int
    expires_at: datetime


def record_rate_limit_attempt(
    session: Session,
    *,
    operation: str,
    dimension: str,
    subject_digest: str,
    account_user_id: UUID | None,
    window_started_at: datetime,
    expires_at: datetime,
    now: datetime,
) -> RecordedRateLimitAttempt:
    """Atomically increment one durable fixed-window bucket.

    The caller owns the transaction boundary. Request dependencies commit this
    increment before endpoint work begins so an endpoint rollback cannot erase
    evidence of an attempted action.
    """

    session.execute(
        delete(AbuseRateLimitBucket).where(
            AbuseRateLimitBucket.operation == operation,
            AbuseRateLimitBucket.dimension == dimension,
            AbuseRateLimitBucket.subject_digest == subject_digest,
            AbuseRateLimitBucket.expires_at <= now,
        )
    )
    statement = (
        insert(AbuseRateLimitBucket)
        .values(
            operation=operation,
            dimension=dimension,
            subject_digest=subject_digest,
            account_user_id=account_user_id,
            window_started_at=window_started_at,
            request_count=1,
            expires_at=expires_at,
        )
        .on_conflict_do_update(
            index_elements=[
                AbuseRateLimitBucket.operation,
                AbuseRateLimitBucket.dimension,
                AbuseRateLimitBucket.subject_digest,
                AbuseRateLimitBucket.window_started_at,
            ],
            set_={
                "request_count": AbuseRateLimitBucket.request_count + 1,
                "expires_at": expires_at,
            },
        )
        .returning(
            AbuseRateLimitBucket.request_count,
            AbuseRateLimitBucket.expires_at,
        )
    )
    row = session.execute(statement).one()
    return RecordedRateLimitAttempt(
        request_count=row.request_count,
        expires_at=row.expires_at,
    )
