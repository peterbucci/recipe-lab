from datetime import UTC, datetime, timedelta
from typing import cast
from unittest.mock import MagicMock, Mock
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

import app.services.auth_workflows as workflows
from app.core.config import Settings
from app.services.auth import AuthenticatedSession, HandleUnavailableError, LoginStart
from app.services.oidc import OIDCClient


def _settings() -> Settings:
    return Settings.model_validate(
        {
            "app_environment": "local",
            "oidc_issuer": "https://identity.example.test",
            "oidc_client_id": "recipe-lab-test",
            "oidc_redirect_uri": "http://app.example.test/api/auth/callback",
        }
    )


def _authenticated_session(*, handle: str | None = "cook") -> AuthenticatedSession:
    return AuthenticatedSession(
        session_id=uuid4(),
        user_id=uuid4(),
        csrf_token_digest="a" * 64,
        expires_at=datetime.now(UTC) + timedelta(hours=1),
        handle=handle,
        display_name="Test Cook",
        profile_description=None,
    )


@pytest.mark.parametrize(
    ("cookie", "state", "expected"),
    [
        ("matching-state", "matching-state", True),
        (None, "matching-state", False),
        ("different-state", "matching-state", False),
        ("x" * 513, "x" * 513, False),
    ],
)
def test_login_state_matches_only_one_bounded_browser_secret(
    cookie: str | None,
    state: str,
    expected: bool,
) -> None:
    assert workflows.login_state_matches(cookie, state) is expected


def test_start_login_workflow_owns_transaction_and_forwards_login_policy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    raw_session = Mock(spec=Session)
    raw_session.begin.return_value = MagicMock()
    session = cast(Session, raw_session)
    oidc_client = cast(OIDCClient, Mock(spec=OIDCClient))
    captured: dict[str, object] = {}

    def begin_login(
        session_value: Session,
        *,
        settings: Settings,
        oidc_client: OIDCClient,
        return_path: str,
        now: datetime,
        force_reauthentication: bool = False,
    ) -> LoginStart:
        captured.update(
            {
                "session": session_value,
                "settings": settings,
                "oidc_client": oidc_client,
                "return_path": return_path,
                "now": now,
                "force_reauthentication": force_reauthentication,
            }
        )
        return LoginStart(
            authorization_url="https://identity.example.test/authorize",
            state="opaque-state",
        )

    monkeypatch.setattr(workflows, "begin_oidc_login", begin_login)
    settings = _settings()

    result = workflows.start_login_workflow(
        session,
        settings=settings,
        oidc_client=oidc_client,
        return_path="/account",
        force_reauthentication=True,
    )

    assert result.state == "opaque-state"
    raw_session.begin.assert_called_once_with()
    assert captured["session"] is session
    assert captured["settings"] is settings
    assert captured["oidc_client"] is oidc_client
    assert captured["return_path"] == "/account"
    assert captured["force_reauthentication"] is True
    assert isinstance(captured["now"], datetime)


def test_provider_reauthentication_failure_preserves_the_validated_return_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    started_at = datetime.now(UTC)

    def consumed(_session: Session, *, state_value: str) -> workflows.ConsumedLoginTransaction:
        assert state_value == "matching-state"
        return workflows.ConsumedLoginTransaction(
            nonce="nonce",
            verifier="verifier",
            return_path="/account/settings?panel=delete",
            purpose="reauthenticate",
            bound_session_id=uuid4(),
            reauthentication_started_at=started_at,
        )

    monkeypatch.setattr(workflows, "_consume_login_transaction", consumed)

    with pytest.raises(workflows.ReauthenticationFailedError) as raised:
        workflows.complete_login_workflow(
            cast(Session, Mock(spec=Session)),
            settings=_settings(),
            oidc_client=cast(OIDCClient, Mock(spec=OIDCClient)),
            flow_cookie="matching-state",
            state_value="matching-state",
            code=None,
            provider_error="access_denied",
        )

    assert raised.value.return_path == "/account/settings?panel=delete"


def test_anonymous_session_read_rolls_back_dependency_work() -> None:
    raw_session = Mock(spec=Session)

    result = workflows.read_account_session_workflow(cast(Session, raw_session), None)

    assert result is None
    raw_session.rollback.assert_called_once_with()
    raw_session.commit.assert_not_called()


def test_onboarding_session_does_not_query_staff_capabilities(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def unexpected_capability_lookup(_session: Session, _user_id: object) -> bool:
        raise AssertionError("onboarding sessions must not query staff grants")

    monkeypatch.setattr(workflows, "is_catalog_curator", unexpected_capability_lookup)
    monkeypatch.setattr(workflows, "is_community_moderator", unexpected_capability_lookup)

    snapshot = workflows.member_session_snapshot(
        cast(Session, Mock(spec=Session)),
        _authenticated_session(handle=None),
    )

    assert snapshot.can_review_ingredient_requests is False
    assert snapshot.can_moderate_recipe_reports is False


def test_profile_conflict_is_translated_after_rollback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    raw_session = Mock(spec=Session)

    def unavailable_profile(*_args: object, **_kwargs: object) -> None:
        raise HandleUnavailableError("already assigned")

    monkeypatch.setattr(workflows, "update_member_profile", unavailable_profile)

    with pytest.raises(workflows.HandleUnavailableWorkflowError):
        workflows.update_account_profile_workflow(
            cast(Session, raw_session),
            authenticated=_authenticated_session(),
            handle="cook",
            display_name="Test Cook",
            profile_description=None,
            update_profile_description=False,
        )

    raw_session.rollback.assert_called_once_with()
    raw_session.commit.assert_not_called()
