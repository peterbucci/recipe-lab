from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import token_digest
from app.models import (
    ACCOUNT_KIND_DEMO,
    ACCOUNT_KIND_SYSTEM,
    OIDCIdentity,
    User,
    UserSession,
)
from app.repositories.auth import create_oidc_identity
from app.services.auth import (
    AccountCannotAuthenticateError,
    issue_member_session,
    resolve_authenticated_session,
    revoke_authenticated_session,
    update_member_profile,
)
from app.services.oidc import VerifiedOIDCIdentity


def auth_settings() -> Settings:
    return Settings.model_validate({"app_environment": "test", "auth_session_ttl_seconds": 3600})


def verified_identity(
    *,
    subject: str = "provider-member-123",
    email: str = "member@example.test",
) -> VerifiedOIDCIdentity:
    return VerifiedOIDCIdentity(
        issuer="https://identity.example.test",
        subject=subject,
        email=email,
        email_verified=True,
        suggested_display_name="Member Cook",
    )


def test_first_login_is_keyed_only_by_exact_issuer_subject_and_stores_digests(
    db_session: Session,
) -> None:
    now = datetime.now(UTC)
    first = issue_member_session(
        db_session,
        settings=auth_settings(),
        identity=verified_identity(),
        return_path="/recipes",
        now=now,
    )
    second = issue_member_session(
        db_session,
        settings=auth_settings(),
        identity=verified_identity(email="updated@example.test"),
        return_path="/account",
        now=now + timedelta(minutes=1),
    )

    assert first.user.id == second.user.id
    assert db_session.scalar(select(func.count()).select_from(User)) == 1
    assert db_session.scalar(select(func.count()).select_from(OIDCIdentity)) == 1
    assert db_session.scalar(select(func.count()).select_from(UserSession)) == 2

    stored_session = db_session.scalar(
        select(UserSession).where(UserSession.token_digest == token_digest(first.session_token))
    )
    assert stored_session is not None
    assert stored_session.token_digest != first.session_token
    assert stored_session.csrf_token_digest == token_digest(first.csrf_token)
    assert first.session_token not in repr(stored_session)
    assert first.csrf_token not in repr(stored_session)


def test_matching_verified_email_does_not_link_different_subjects(db_session: Session) -> None:
    now = datetime.now(UTC)
    first = issue_member_session(
        db_session,
        settings=auth_settings(),
        identity=verified_identity(subject="subject-one", email="same@example.test"),
        return_path="/",
        now=now,
    )
    second = issue_member_session(
        db_session,
        settings=auth_settings(),
        identity=verified_identity(subject="subject-two", email="same@example.test"),
        return_path="/",
        now=now,
    )

    assert first.user.id != second.user.id
    assert db_session.scalar(select(func.count()).select_from(User)) == 2


@pytest.mark.parametrize("account_kind", [ACCOUNT_KIND_SYSTEM, ACCOUNT_KIND_DEMO])
def test_oidc_identity_attached_to_non_member_can_never_log_in(
    db_session: Session,
    account_kind: str,
) -> None:
    now = datetime.now(UTC)
    system_user = User(
        email=f"{account_kind}@example.test",
        display_name=f"{account_kind.title()} identity",
        account_kind=account_kind,
    )
    db_session.add(system_user)
    db_session.flush()
    identity = verified_identity(
        subject=f"{account_kind}-subject",
        email=f"{account_kind}@example.test",
    )
    create_oidc_identity(
        db_session,
        user=system_user,
        issuer=identity.issuer,
        subject=identity.subject,
        email=identity.email,
        email_verified=True,
        last_seen_at=now,
    )

    with pytest.raises(AccountCannotAuthenticateError):
        issue_member_session(
            db_session,
            settings=auth_settings(),
            identity=identity,
            return_path="/",
            now=now,
        )
    assert db_session.scalar(select(func.count()).select_from(UserSession)) == 0


@pytest.mark.parametrize("blocked_status", ["suspended", "deleted"])
def test_revoked_expired_and_inactive_sessions_do_not_authenticate(
    db_session: Session,
    blocked_status: str,
) -> None:
    now = datetime.now(UTC)
    issued = issue_member_session(
        db_session,
        settings=auth_settings(),
        identity=verified_identity(),
        return_path="/",
        now=now,
    )
    authenticated = resolve_authenticated_session(
        db_session,
        raw_session_token=issued.session_token,
        now=now,
    )
    assert authenticated is not None

    revoke_authenticated_session(db_session, authenticated=authenticated, now=now)
    assert (
        resolve_authenticated_session(
            db_session,
            raw_session_token=issued.session_token,
            now=now,
        )
        is None
    )

    other = issue_member_session(
        db_session,
        settings=auth_settings(),
        identity=verified_identity(subject="other-subject"),
        return_path="/",
        now=now,
    )
    assert (
        resolve_authenticated_session(
            db_session,
            raw_session_token=other.session_token,
            now=other.expires_at,
        )
        is None
    )
    other.user.status = blocked_status
    if blocked_status == "deleted":
        other.user.email = None
        other.user.handle = None
        other.user.display_name = "Deleted cook"
        other.user.deleted_at = now
    assert (
        resolve_authenticated_session(
            db_session,
            raw_session_token=other.session_token,
            now=now,
        )
        is None
    )


def test_session_last_seen_is_written_only_after_the_touch_interval(
    db_session: Session,
) -> None:
    issued_at = datetime.now(UTC)
    issued = issue_member_session(
        db_session,
        settings=auth_settings(),
        identity=verified_identity(),
        return_path="/",
        now=issued_at,
    )

    within_interval = issued_at + timedelta(minutes=4)
    authenticated = resolve_authenticated_session(
        db_session,
        raw_session_token=issued.session_token,
        now=within_interval,
        touch_interval_seconds=5 * 60,
    )

    assert authenticated is not None
    stored_session = db_session.get(UserSession, authenticated.session_id)
    assert stored_session is not None
    assert stored_session.last_seen_at == issued_at

    after_interval = issued_at + timedelta(minutes=5)
    authenticated = resolve_authenticated_session(
        db_session,
        raw_session_token=issued.session_token,
        now=after_interval,
        touch_interval_seconds=5 * 60,
    )

    assert authenticated is not None
    assert stored_session.last_seen_at == after_interval


def test_onboarding_sets_normalized_profile_without_changing_session(db_session: Session) -> None:
    now = datetime.now(UTC)
    issued = issue_member_session(
        db_session,
        settings=auth_settings(),
        identity=verified_identity(),
        return_path="/",
        now=now,
    )
    authenticated = resolve_authenticated_session(
        db_session,
        raw_session_token=issued.session_token,
        now=now,
    )
    assert authenticated is not None

    updated = update_member_profile(
        db_session,
        authenticated=authenticated,
        handle="test-cook",
        display_name="Test Cook",
        profile_description="Weeknight recipes for busy cooks.",
        update_profile_description=True,
    )

    assert updated.session_id == authenticated.session_id
    assert updated.handle == "test-cook"
    assert updated.display_name == "Test Cook"
    assert updated.profile_description == "Weeknight recipes for busy cooks."
    assert issued.user.profile_description == "Weeknight recipes for busy cooks."
