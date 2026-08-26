from datetime import UTC, datetime, timedelta
from typing import cast

import pytest
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    ACCOUNT_KIND_MEMBER,
    USER_STATUS_ACTIVE,
    OIDCIdentity,
    OIDCLoginTransaction,
    User,
    UserSession,
)
from app.repositories.auth import (
    consume_oidc_login_transaction,
    create_oidc_identity,
    create_oidc_login_transaction,
    create_user_session,
    get_oidc_identity,
    get_user_by_handle,
    get_user_session_by_token_digest,
    lock_oidc_identity_key,
    prune_oidc_login_transactions,
    revoke_user_session,
    set_user_handle,
    touch_oidc_identity,
    touch_user_session,
)


def assert_constraint_name(error: IntegrityError, expected_constraint: str) -> None:
    diagnostic = getattr(error.orig, "diag", None)
    actual_constraint = cast(str | None, getattr(diagnostic, "constraint_name", None))
    assert actual_constraint == expected_constraint


def create_member(
    session: Session,
    *,
    email: str,
    display_name: str,
    handle: str | None = None,
) -> User:
    user = User(email=email, display_name=display_name, handle=handle)
    session.add(user)
    session.flush()
    return user


def test_member_defaults_and_non_unique_private_email(db_session: Session) -> None:
    first = create_member(
        db_session,
        email="shared@example.com",
        display_name="First Member",
        handle="first-member",
    )
    second = create_member(
        db_session,
        email="shared@example.com",
        display_name="Second Member",
        handle="second-member",
    )

    assert first.account_kind == ACCOUNT_KIND_MEMBER
    assert first.status == USER_STATUS_ACTIVE
    assert first.updated_at.tzinfo is not None
    assert second.email == first.email


def test_handle_is_normalized_and_unique(db_session: Session) -> None:
    first = create_member(
        db_session,
        email="first@example.com",
        display_name="First Member",
    )
    set_user_handle(db_session, first, handle="  First-Member  ")

    assert first.handle == "first-member"
    assert get_user_by_handle(db_session, " FIRST-MEMBER ") is first

    duplicate = User(
        email="other@example.com",
        display_name="Other Member",
        handle="first-member",
    )
    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            db_session.add(duplicate)
            db_session.flush()
    assert_constraint_name(error.value, "uq_users_handle")

    invalid = User(
        email="invalid@example.com",
        display_name="Invalid Handle",
        handle="Not Normalized",
    )
    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            db_session.add(invalid)
            db_session.flush()
    assert_constraint_name(error.value, "ck_users_handle_supported_format")

    trailing_separator = User(
        email="trailing@example.com",
        display_name="Trailing Separator",
        handle="trailing_",
    )
    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            db_session.add(trailing_separator)
            db_session.flush()
    assert_constraint_name(error.value, "ck_users_handle_supported_format")


def test_oidc_identity_uses_exact_issuer_subject_key(db_session: Session) -> None:
    now = datetime.now(UTC)
    first = create_member(
        db_session,
        email="same@example.com",
        display_name="First Identity",
    )
    second = create_member(
        db_session,
        email="same@example.com",
        display_name="Second Identity",
    )
    first_identity = create_oidc_identity(
        db_session,
        user=first,
        issuer="https://identity.example.test",
        subject="subject-123",
        email="same@example.com",
        email_verified=True,
        last_seen_at=now,
    )
    second_identity = create_oidc_identity(
        db_session,
        user=second,
        issuer="https://other-identity.example.test",
        subject="subject-123",
        email="same@example.com",
        email_verified=True,
        last_seen_at=now,
    )

    lock_oidc_identity_key(
        db_session,
        issuer=first_identity.issuer,
        subject=first_identity.subject,
    )
    assert (
        get_oidc_identity(
            db_session,
            issuer=first_identity.issuer,
            subject=first_identity.subject,
        )
        is first_identity
    )
    assert second_identity.user_id == second.id

    duplicate = OIDCIdentity(
        user=second,
        issuer=first_identity.issuer,
        subject=first_identity.subject,
        email="same@example.com",
        email_verified=True,
        last_seen_at=now,
    )
    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            db_session.add(duplicate)
            db_session.flush()
    assert_constraint_name(error.value, "uq_oidc_identities_issuer_subject")


def test_unverified_oidc_identity_is_rejected(db_session: Session) -> None:
    member = create_member(
        db_session,
        email="unverified@example.com",
        display_name="Unverified Identity",
    )

    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            create_oidc_identity(
                db_session,
                user=member,
                issuer="https://identity.example.test",
                subject="unverified-subject",
                email="unverified@example.com",
                email_verified=False,
                last_seen_at=datetime.now(UTC),
            )
    assert_constraint_name(error.value, "ck_oidc_identities_email_must_be_verified")


def test_identity_and_session_lifecycle_helpers(db_session: Session) -> None:
    now = datetime.now(UTC)
    member = create_member(
        db_session,
        email="session@example.com",
        display_name="Session Member",
    )
    identity = create_oidc_identity(
        db_session,
        user=member,
        issuer="https://identity.example.test",
        subject="session-subject",
        email="session@example.com",
        email_verified=True,
        last_seen_at=now,
    )
    user_session = create_user_session(
        db_session,
        user=member,
        token_digest="a" * 64,
        csrf_token_digest="b" * 64,
        expires_at=now + timedelta(days=7),
        last_seen_at=now,
    )

    loaded = get_user_session_by_token_digest(db_session, "a" * 64)
    assert loaded is user_session
    assert loaded.user is member
    assert set(UserSession.__table__.columns.keys()) == {
        "id",
        "user_id",
        "token_digest",
        "csrf_token_digest",
        "expires_at",
        "last_seen_at",
        "authenticated_at",
        "revoked_at",
        "created_at",
    }

    later = now + timedelta(minutes=5)
    touch_oidc_identity(
        db_session,
        identity,
        email="updated@example.com",
        email_verified=True,
        last_seen_at=later,
    )
    touch_user_session(db_session, user_session, last_seen_at=later)
    revoke_user_session(db_session, user_session, revoked_at=later)
    assert identity.email == "updated@example.com"
    assert identity.last_seen_at == later
    assert user_session.last_seen_at == later
    assert user_session.authenticated_at is None
    assert user_session.revoked_at == later


def test_session_digest_constraints_and_user_delete_cascade(db_session: Session) -> None:
    now = datetime.now(UTC)
    member = create_member(
        db_session,
        email="digest@example.com",
        display_name="Digest Member",
    )

    invalid_session = UserSession(
        user=member,
        token_digest="raw-session-token",
        csrf_token_digest="c" * 64,
        expires_at=now + timedelta(days=1),
        last_seen_at=now,
    )
    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            db_session.add(invalid_session)
            db_session.flush()
    assert_constraint_name(error.value, "ck_user_sessions_token_digest_lowercase_sha256")

    create_user_session(
        db_session,
        user=member,
        token_digest="d" * 64,
        csrf_token_digest="e" * 64,
        expires_at=now + timedelta(days=1),
        last_seen_at=now,
    )
    db_session.execute(delete(User).where(User.id == member.id))
    assert db_session.scalar(select(UserSession)) is None


def test_oidc_login_transaction_is_consumed_once_under_lock(db_session: Session) -> None:
    now = datetime.now(UTC)
    transaction = create_oidc_login_transaction(
        db_session,
        state_digest="f" * 64,
        nonce="n" * 32,
        pkce_verifier="v" * 64,
        return_path="/recipes?type=originals",
        expires_at=now + timedelta(minutes=5),
    )

    consumed_at = datetime.now(UTC)
    assert (
        consume_oidc_login_transaction(
            db_session,
            state_digest=transaction.state_digest,
            now=consumed_at,
        )
        is transaction
    )
    assert transaction.consumed_at == consumed_at
    assert (
        consume_oidc_login_transaction(
            db_session,
            state_digest=transaction.state_digest,
            now=consumed_at,
        )
        is None
    )
    prune_oidc_login_transactions(db_session, now=consumed_at)
    assert db_session.get(OIDCLoginTransaction, transaction.id) is None


def test_expired_or_invalid_login_transaction_cannot_be_used(db_session: Session) -> None:
    now = datetime.now(UTC)
    expires_at = now + timedelta(seconds=1)
    expired = create_oidc_login_transaction(
        db_session,
        state_digest="1" * 64,
        nonce="n" * 32,
        pkce_verifier="p" * 64,
        return_path="/",
        expires_at=expires_at,
    )

    assert (
        consume_oidc_login_transaction(
            db_session,
            state_digest=expired.state_digest,
            now=expires_at + timedelta(seconds=1),
        )
        is None
    )
    assert expired.consumed_at is None
    prune_oidc_login_transactions(
        db_session,
        now=expires_at + timedelta(seconds=1),
    )
    assert db_session.get(OIDCLoginTransaction, expired.id) is None

    invalid_return_path = OIDCLoginTransaction(
        state_digest="2" * 64,
        nonce="n" * 32,
        pkce_verifier="p" * 64,
        return_path="https://evil.example.test",
        expires_at=now + timedelta(minutes=5),
    )
    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            db_session.add(invalid_return_path)
            db_session.flush()
    assert_constraint_name(error.value, "ck_oidc_login_transactions_return_path_is_local")
