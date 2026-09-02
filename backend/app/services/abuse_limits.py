import hashlib
import hmac
import ipaddress
import math
import re
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.errors import ApiError
from app.core.config import Settings
from app.models.abuse import (
    RATE_LIMIT_DIMENSION_ACCOUNT,
    RATE_LIMIT_DIMENSION_IDENTITY,
    RATE_LIMIT_DIMENSION_NETWORK,
)
from app.policies.abuse import (
    RateLimitOperation as RateLimitOperation,
)
from app.policies.abuse import (
    RateLimitPolicy as RateLimitPolicy,
)
from app.policies.abuse import (
    classify_rate_limited_request as classify_rate_limited_request,
)
from app.repositories.abuse_limits import record_rate_limit_attempt

NETWORK_HEADER = "x-recipe-lab-client-network"
NETWORK_TIMESTAMP_HEADER = "x-recipe-lab-network-timestamp"
NETWORK_SIGNATURE_HEADER = "x-recipe-lab-network-signature"


class RateLimitUnavailableError(RuntimeError):
    pass


def canonical_network_subject(client_host: str | None) -> str:
    """Collapse client IPs into privacy-preserving abuse-control networks."""

    if client_host is None:
        return "unavailable"
    try:
        address = ipaddress.ip_address(client_host.strip())
    except ValueError:
        try:
            network = ipaddress.ip_network(client_host.strip(), strict=True)
        except ValueError:
            return "unavailable"
        expected_prefix = 24 if network.version == 4 else 56
        return str(network) if network.prefixlen == expected_prefix else "unavailable"
    prefix_length = 24 if address.version == 4 else 56
    return str(ipaddress.ip_network(f"{address}/{prefix_length}", strict=False))


def trusted_network_signal_signature(
    *,
    secret: str,
    network: str,
    timestamp: int,
    method: str,
    path: str,
) -> str:
    payload = "\n".join(
        (
            "recipe-lab-network-v1",
            network,
            str(timestamp),
            method.upper(),
            path,
        )
    )
    return hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def verified_trusted_network_signal(
    headers: Mapping[str, str],
    *,
    settings: Settings,
    method: str,
    path: str,
    now: datetime,
) -> str | None:
    network = headers.get(NETWORK_HEADER)
    raw_timestamp = headers.get(NETWORK_TIMESTAMP_HEADER)
    signature = headers.get(NETWORK_SIGNATURE_HEADER)
    if (
        network is None
        or canonical_network_subject(network) != network
        or raw_timestamp is None
        or re.fullmatch(r"\d{10}", raw_timestamp) is None
        or signature is None
        or re.fullmatch(r"[0-9a-f]{64}", signature) is None
    ):
        return None
    timestamp = int(raw_timestamp)
    now_timestamp = math.floor(now.astimezone(UTC).timestamp())
    if abs(now_timestamp - timestamp) > settings.internal_network_signal_ttl_seconds:
        return None
    expected = trusted_network_signal_signature(
        secret=settings.internal_network_signal_secret.get_secret_value(),
        network=network,
        timestamp=timestamp,
        method=method,
        path=path,
    )
    return network if hmac.compare_digest(signature, expected) else None


def client_network_subject(
    headers: Mapping[str, str],
    *,
    settings: Settings,
    method: str,
    path: str,
    direct_client_host: str | None,
    now: datetime,
) -> str:
    trusted = verified_trusted_network_signal(
        headers,
        settings=settings,
        method=method,
        path=path,
        now=now,
    )
    return trusted if trusted is not None else canonical_network_subject(direct_client_host)


def pseudonymous_subject_digest(
    *,
    secret: str,
    dimension: str,
    subject: str,
) -> str:
    return hmac.new(
        secret.encode("utf-8"),
        f"{dimension}\x00{subject}".encode(),
        hashlib.sha256,
    ).hexdigest()


def _window(now: datetime, window_seconds: int) -> tuple[datetime, datetime]:
    normalized = now.astimezone(UTC)
    epoch_seconds = math.floor(normalized.timestamp())
    start_epoch = epoch_seconds - (epoch_seconds % window_seconds)
    started_at = datetime.fromtimestamp(start_epoch, tz=UTC)
    return started_at, started_at + timedelta(seconds=window_seconds)


def _retry_after_seconds(*, now: datetime, expires_at: datetime) -> int:
    return max(1, math.ceil((expires_at - now).total_seconds()))


def _rate_limit_error(*, retry_after_seconds: int) -> ApiError:
    return ApiError(
        status_code=429,
        code="rate_limit_exceeded",
        message="Too many requests. Please try again later.",
        headers={"Retry-After": str(retry_after_seconds)},
    )


def _record_dimensions(
    session: Session,
    *,
    settings: Settings,
    operation: RateLimitOperation,
    now: datetime,
    dimensions: list[tuple[str, str, UUID | None, int]],
) -> None:
    started_at, expires_at = _window(now, settings.abuse_rate_limit_window_seconds)
    secret = settings.abuse_rate_limit_secret.get_secret_value()
    exceeded_retry_after: int | None = None
    try:
        for dimension, raw_subject, account_user_id, limit in dimensions:
            attempt = record_rate_limit_attempt(
                session,
                operation=operation,
                dimension=dimension,
                subject_digest=pseudonymous_subject_digest(
                    secret=secret,
                    dimension=dimension,
                    subject=raw_subject,
                ),
                account_user_id=account_user_id,
                window_started_at=started_at,
                expires_at=expires_at,
                now=now,
            )
            if attempt.request_count > limit:
                exceeded_retry_after = max(
                    exceeded_retry_after or 0,
                    _retry_after_seconds(now=now, expires_at=attempt.expires_at),
                )
        # This deliberate boundary makes every attempt durable before endpoint
        # work begins, even if that work later rejects or rolls back.
        session.commit()
    except SQLAlchemyError as error:
        session.rollback()
        raise RateLimitUnavailableError("Durable abuse protection is unavailable.") from error
    if exceeded_retry_after is not None:
        raise _rate_limit_error(retry_after_seconds=exceeded_retry_after)


def enforce_request_rate_limit(
    session: Session,
    *,
    settings: Settings,
    policy: RateLimitPolicy,
    client_host: str | None,
    account_user_id: UUID | None,
    now: datetime,
) -> None:
    dimensions: list[tuple[str, str, UUID | None, int]] = [
        (
            RATE_LIMIT_DIMENSION_NETWORK,
            canonical_network_subject(client_host),
            None,
            policy.network_limit,
        )
    ]
    if account_user_id is not None and policy.account_limit is not None:
        dimensions.append(
            (
                RATE_LIMIT_DIMENSION_ACCOUNT,
                str(account_user_id),
                account_user_id,
                policy.account_limit,
            )
        )
    _record_dimensions(
        session,
        settings=settings,
        operation=policy.operation,
        now=now,
        dimensions=dimensions,
    )


def enforce_oidc_identity_rate_limit(
    session: Session,
    *,
    settings: Settings,
    issuer: str,
    subject: str,
    now: datetime,
) -> None:
    _record_dimensions(
        session,
        settings=settings,
        operation="account_auth",
        now=now,
        dimensions=[
            (
                RATE_LIMIT_DIMENSION_IDENTITY,
                f"{issuer}\x00{subject}",
                None,
                settings.abuse_rate_limit_auth_identity,
            )
        ],
    )


def abuse_protection_unavailable_error() -> ApiError:
    return ApiError(
        status_code=503,
        code="abuse_protection_unavailable",
        message="This request cannot be completed safely right now. Please try again.",
    )
