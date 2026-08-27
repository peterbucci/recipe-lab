from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import Engine, delete, func, select
from sqlalchemy.orm import Session

from app.api.errors import ApiError, register_error_handlers
from app.core.config import Settings
from app.main import create_app
from app.middleware.request_body_limit import RequestBodyLimitMiddleware
from app.models import AbuseRateLimitBucket, User
from app.repositories.abuse_limits import (
    EXPIRED_BUCKET_PRUNE_BATCH_SIZE,
    record_rate_limit_attempt,
)
from app.services.abuse_limits import (
    RateLimitPolicy,
    canonical_network_subject,
    classify_rate_limited_request,
    client_network_subject,
    enforce_oidc_identity_rate_limit,
    enforce_request_rate_limit,
    pseudonymous_subject_digest,
    trusted_network_signal_signature,
)


def _settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "app_environment": "test",
        "abuse_rate_limit_secret": "a-private-test-rate-limit-secret",
        "abuse_rate_limit_window_seconds": 60,
    }
    values.update(overrides)
    return Settings.model_validate(values)


def test_networks_are_canonicalized_and_subjects_are_pseudonymous() -> None:
    assert canonical_network_subject("192.0.2.129") == "192.0.2.0/24"
    assert canonical_network_subject("2001:db8:abcd:12ff::1") == "2001:db8:abcd:1200::/56"
    assert canonical_network_subject("not-an-address") == "unavailable"

    digest = pseudonymous_subject_digest(
        secret="test-secret",
        dimension="network",
        subject="192.0.2.0/24",
    )
    assert len(digest) == 64
    assert "192.0.2" not in digest
    assert digest == pseudonymous_subject_digest(
        secret="test-secret",
        dimension="network",
        subject="192.0.2.0/24",
    )
    assert digest != pseudonymous_subject_digest(
        secret="different-secret",
        dimension="network",
        subject="192.0.2.0/24",
    )


@pytest.mark.parametrize(
    ("method", "path", "operation"),
    [
        ("GET", "/api/auth/login", "account_auth"),
        ("GET", "/api/auth/callback", "account_auth"),
        ("POST", "/api/recipe-drafts", "fork_creation"),
        ("PUT", f"/api/recipe-drafts/{uuid4()}", "draft_mutation"),
        (
            "POST",
            f"/api/recipe-drafts/{uuid4()}/duplicate-preflights",
            "draft_mutation",
        ),
        ("POST", f"/api/recipe-drafts/{uuid4()}/publish", "publication"),
        ("POST", f"/api/recipes/{uuid4()}/reports", "recipe_report"),
        (
            "POST",
            f"/api/moderation/recipe-reports/{uuid4()}/actions",
            "recipe_report",
        ),
        ("PUT", f"/api/recipes/{uuid4()}/save", "interaction"),
        ("DELETE", f"/api/recipes/{uuid4()}/save", "interaction"),
        ("PUT", f"/api/recipes/{uuid4()}/rating", "interaction"),
        ("POST", f"/api/recipes/{uuid4()}/view", "interaction"),
    ],
)
def test_protected_actions_have_explicit_policies(
    method: str,
    path: str,
    operation: str,
) -> None:
    policy = classify_rate_limited_request(method=method, path=path, settings=_settings())
    assert policy is not None
    assert policy.operation == operation


def test_unrelated_reads_are_not_counted() -> None:
    assert (
        classify_rate_limited_request(
            method="GET",
            path="/api/recipes",
            settings=_settings(),
        )
        is None
    )


def test_production_rejects_the_documented_local_secret() -> None:
    with pytest.raises(ValidationError, match="ABUSE_RATE_LIMIT_SECRET"):
        Settings.model_validate({"app_environment": "production"})


def test_rate_limit_secret_must_be_long_enough_to_resist_guessing() -> None:
    with pytest.raises(ValidationError, match="at least 32 characters"):
        _settings(abuse_rate_limit_secret="too-short")


def test_internal_network_secret_is_private_and_bounded_in_production() -> None:
    with pytest.raises(ValidationError, match="INTERNAL_NETWORK_SIGNAL_SECRET"):
        _settings(internal_network_signal_secret="too-short")
    with pytest.raises(ValidationError, match="INTERNAL_NETWORK_SIGNAL_SECRET"):
        Settings.model_validate(
            {
                "app_environment": "production",
                "abuse_rate_limit_secret": "production-abuse-rate-limit-secret-123",
            }
        )


def test_request_size_middleware_rejects_declared_and_streamed_bodies() -> None:
    application = FastAPI()
    application.add_middleware(RequestBodyLimitMiddleware, max_body_bytes=8)

    @application.post("/size")
    async def body_size(request: Request) -> dict[str, int]:
        return {"size": len(await request.body())}

    with TestClient(application) as client:
        accepted = client.post("/size", content=b"12345678")
        declared = client.post("/size", content=b"123456789")
        streamed = client.post("/size", content=(chunk for chunk in (b"1234", b"56789")))

    assert accepted.status_code == 200
    assert accepted.json() == {"size": 8}
    for response in (declared, streamed):
        assert response.status_code == 413
        correlation_id = response.headers["X-Correlation-ID"]
        assert response.json() == {
            "error": {
                "code": "request_body_too_large",
                "message": "The request body is too large.",
                "issues": [],
                "correlation_id": correlation_id,
            }
        }


def test_api_error_preserves_retry_after_header() -> None:
    application = FastAPI()
    register_error_handlers(application)

    @application.get("/limited")
    def limited() -> None:
        raise ApiError(
            status_code=429,
            code="rate_limit_exceeded",
            message="Too many requests. Please try again later.",
            headers={"Retry-After": "17"},
        )

    with TestClient(application) as client:
        response = client.get("/limited")

    assert response.status_code == 429
    assert response.headers["retry-after"] == "17"
    correlation_id = response.headers["X-Correlation-ID"]
    assert response.json() == {
        "error": {
            "code": "rate_limit_exceeded",
            "message": "Too many requests. Please try again later.",
            "issues": [],
            "correlation_id": correlation_id,
        }
    }


def test_openapi_documents_global_size_and_rate_limit_errors() -> None:
    operation = create_app().openapi()["paths"]["/api/recipes/{recipe_version_id}/save"]["put"]
    assert operation["responses"]["413"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ErrorResponse"
    }
    assert operation["responses"]["429"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ErrorResponse"
    }


def test_account_and_network_limits_are_durable_before_endpoint_rollback(
    migrated_engine: Engine,
) -> None:
    user_id = uuid4()
    with Session(bind=migrated_engine) as setup, setup.begin():
        setup.add(
            User(
                id=user_id,
                email=f"{user_id}@test.invalid",
                display_name="Abuse Test Cook",
                handle=f"abuse_{user_id.hex[:8]}",
            )
        )

    settings = _settings(
        abuse_rate_limit_publication_account=1,
        abuse_rate_limit_publication_network=10,
    )
    policy = RateLimitPolicy(operation="publication", account_limit=1, network_limit=10)
    now = datetime.now(UTC)
    with Session(bind=migrated_engine) as first:
        enforce_request_rate_limit(
            first,
            settings=settings,
            policy=policy,
            client_host="203.0.113.45",
            account_user_id=user_id,
            now=now,
        )
        # This simulates later endpoint work failing. The limiter's earlier
        # commit must not be part of this rollback.
        first.rollback()

    with Session(bind=migrated_engine) as second:
        with pytest.raises(ApiError) as caught:
            enforce_request_rate_limit(
                second,
                settings=settings,
                policy=policy,
                client_host="203.0.113.45",
                account_user_id=user_id,
                now=now + timedelta(seconds=1),
            )

    assert caught.value.status_code == 429
    assert caught.value.code == "rate_limit_exceeded"
    assert 1 <= int(caught.value.headers["Retry-After"]) <= 60

    with Session(bind=migrated_engine) as lookup:
        rows = list(
            lookup.scalars(
                select(AbuseRateLimitBucket).where(AbuseRateLimitBucket.operation == "publication")
            )
        )
    assert {row.dimension for row in rows} == {"account", "network"}
    assert all(str(user_id) not in row.subject_digest for row in rows)
    assert all("203.0.113" not in row.subject_digest for row in rows)
    with Session(bind=migrated_engine) as cleanup, cleanup.begin():
        cleanup.execute(delete(AbuseRateLimitBucket))
        stored_user = cleanup.get(User, user_id)
        if stored_user is not None:
            cleanup.delete(stored_user)


def test_oidc_identity_limit_covers_first_account_attempts(migrated_engine: Engine) -> None:
    settings = _settings(abuse_rate_limit_auth_identity=1)
    now = datetime.now(UTC)
    with Session(bind=migrated_engine) as first:
        enforce_oidc_identity_rate_limit(
            first,
            settings=settings,
            issuer="https://identity.test",
            subject=f"new-subject-{uuid4()}",
            now=now,
        )
        first.rollback()

    subject = f"repeated-subject-{uuid4()}"
    with Session(bind=migrated_engine) as session:
        enforce_oidc_identity_rate_limit(
            session,
            settings=settings,
            issuer="https://identity.test",
            subject=subject,
            now=now,
        )
        with pytest.raises(ApiError) as caught:
            enforce_oidc_identity_rate_limit(
                session,
                settings=settings,
                issuer="https://identity.test",
                subject=subject,
                now=now + timedelta(seconds=1),
            )
    assert caught.value.status_code == 429
    with Session(bind=migrated_engine) as cleanup, cleanup.begin():
        cleanup.execute(delete(AbuseRateLimitBucket))


def test_unrelated_traffic_prunes_expired_pseudonymous_buckets(
    migrated_engine: Engine,
) -> None:
    now = datetime.now(UTC)
    expired_digests = {f"{index:064x}" for index in range(EXPIRED_BUCKET_PRUNE_BATCH_SIZE + 2)}
    active_digest = "a" * 64
    with Session(bind=migrated_engine) as setup, setup.begin():
        setup.add_all(
            [
                AbuseRateLimitBucket(
                    operation="account_auth",
                    dimension="identity",
                    subject_digest=expired_digest,
                    account_user_id=None,
                    window_started_at=now - timedelta(minutes=2),
                    request_count=1,
                    expires_at=now - timedelta(minutes=1),
                )
                for expired_digest in expired_digests
            ]
            + [
                AbuseRateLimitBucket(
                    operation="interaction",
                    dimension="network",
                    subject_digest=active_digest,
                    account_user_id=None,
                    window_started_at=now,
                    request_count=1,
                    expires_at=now + timedelta(minutes=1),
                ),
            ]
        )

    with Session(bind=migrated_engine) as session, session.begin():
        record_rate_limit_attempt(
            session,
            operation="publication",
            dimension="network",
            subject_digest="b" * 64,
            account_user_id=None,
            window_started_at=now,
            expires_at=now + timedelta(minutes=1),
            now=now,
        )

    with Session(bind=migrated_engine) as lookup:
        remaining_expired = set(
            lookup.scalars(
                select(AbuseRateLimitBucket.subject_digest).where(
                    AbuseRateLimitBucket.expires_at <= now
                )
            )
        )
        remaining = set(lookup.scalars(select(AbuseRateLimitBucket.subject_digest)))
    assert len(remaining_expired) == 2
    assert active_digest in remaining

    with Session(bind=migrated_engine) as session, session.begin():
        record_rate_limit_attempt(
            session,
            operation="fork_creation",
            dimension="network",
            subject_digest="c" * 64,
            account_user_id=None,
            window_started_at=now,
            expires_at=now + timedelta(minutes=1),
            now=now,
        )

    with Session(bind=migrated_engine) as lookup:
        assert (
            lookup.scalar(
                select(func.count())
                .select_from(AbuseRateLimitBucket)
                .where(AbuseRateLimitBucket.expires_at <= now)
            )
            == 0
        )

    with Session(bind=migrated_engine) as cleanup, cleanup.begin():
        cleanup.execute(delete(AbuseRateLimitBucket))


def test_postgresql_counter_increment_is_atomic(migrated_engine: Engine) -> None:
    now = datetime.now(UTC)
    window_started_at = now.replace(second=0, microsecond=0)
    expires_at = window_started_at + timedelta(minutes=1)
    subject_digest = pseudonymous_subject_digest(
        secret="atomic-test-secret",
        dimension="network",
        subject=str(uuid4()),
    )

    def increment() -> int:
        with Session(bind=migrated_engine) as session, session.begin():
            return record_rate_limit_attempt(
                session,
                operation="interaction",
                dimension="network",
                subject_digest=subject_digest,
                account_user_id=None,
                window_started_at=window_started_at,
                expires_at=expires_at,
                now=now,
            ).request_count

    with ThreadPoolExecutor(max_workers=6) as executor:
        observed = sorted(executor.map(lambda _index: increment(), range(12)))

    assert observed == list(range(1, 13))
    with Session(bind=migrated_engine) as lookup:
        stored_count = lookup.scalar(
            select(func.max(AbuseRateLimitBucket.request_count)).where(
                AbuseRateLimitBucket.subject_digest == subject_digest
            )
        )
    assert stored_count == 12
    with Session(bind=migrated_engine) as cleanup, cleanup.begin():
        cleanup.execute(delete(AbuseRateLimitBucket))


def _trusted_network_headers(
    settings: Settings,
    *,
    network: str,
    timestamp: int,
    method: str = "POST",
    path: str = "/api/recipes/example/view",
) -> dict[str, str]:
    return {
        "x-recipe-lab-client-network": network,
        "x-recipe-lab-network-timestamp": str(timestamp),
        "x-recipe-lab-network-signature": trusted_network_signal_signature(
            secret=settings.internal_network_signal_secret.get_secret_value(),
            network=network,
            timestamp=timestamp,
            method=method,
            path=path,
        ),
    }


def test_trusted_network_signal_is_spoof_resistant_and_falls_back_safely() -> None:
    settings = _settings()
    now = datetime.now(UTC)
    timestamp = int(now.timestamp())
    headers = _trusted_network_headers(
        settings,
        network="198.51.100.0/24",
        timestamp=timestamp,
    )
    assert (
        client_network_subject(
            headers,
            settings=settings,
            method="POST",
            path="/api/recipes/example/view",
            direct_client_host="203.0.113.45",
            now=now,
        )
        == "198.51.100.0/24"
    )

    forged = {
        **headers,
        "forwarded": "for=192.0.2.1",
        "x-forwarded-for": "192.0.2.1",
        "x-recipe-lab-client-network": "192.0.2.0/24",
    }
    assert (
        client_network_subject(
            forged,
            settings=settings,
            method="POST",
            path="/api/recipes/example/view",
            direct_client_host="203.0.113.45",
            now=now,
        )
        == "203.0.113.0/24"
    )


def test_internal_network_signature_matches_the_frontend_contract() -> None:
    assert (
        trusted_network_signal_signature(
            secret="frontend-network-signal-test-secret-123456",
            network="203.0.113.0/24",
            timestamp=1_800_000_000,
            method="POST",
            path="/api/recipes/example/view",
        )
        == "cb8228793c37f809562c2266cd5cd8baae9170ab7a38219761bc7c5d57f86edd"
    )


def test_separate_signed_networks_receive_separate_durable_limits(
    migrated_engine: Engine,
) -> None:
    settings = _settings(abuse_rate_limit_interaction_network=1)
    policy = RateLimitPolicy(operation="interaction", account_limit=None, network_limit=1)
    now = datetime.now(UTC)
    timestamp = int(now.timestamp())
    subjects = [
        client_network_subject(
            _trusted_network_headers(settings, network=network, timestamp=timestamp),
            settings=settings,
            method="POST",
            path="/api/recipes/example/view",
            direct_client_host="172.18.0.2",
            now=now,
        )
        for network in ("198.51.100.0/24", "203.0.113.0/24")
    ]
    assert subjects == ["198.51.100.0/24", "203.0.113.0/24"]

    for subject in subjects:
        with Session(bind=migrated_engine) as session:
            enforce_request_rate_limit(
                session,
                settings=settings,
                policy=policy,
                client_host=subject,
                account_user_id=None,
                now=now,
            )

    with Session(bind=migrated_engine) as limited_session:
        with pytest.raises(ApiError) as caught:
            enforce_request_rate_limit(
                limited_session,
                settings=settings,
                policy=policy,
                client_host=subjects[0],
                account_user_id=None,
                now=now + timedelta(seconds=1),
            )
    assert caught.value.status_code == 429
    with Session(bind=migrated_engine) as cleanup, cleanup.begin():
        cleanup.execute(delete(AbuseRateLimitBucket))
