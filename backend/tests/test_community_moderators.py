import json
from contextlib import nullcontext
from functools import partial
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from app.models import (
    ACCOUNT_KIND_DEMO,
    ACCOUNT_KIND_MEMBER,
    USER_STATUS_ACTIVE,
    USER_STATUS_SUSPENDED,
    CatalogCurator,
    CommunityModerator,
)
from app.moderators import cli as moderator_cli
from app.moderators.cli import build_parser
from app.moderators.service import (
    MAX_OPERATOR_QUERY_LENGTH,
    MAX_OPERATOR_RESULT_LIMIT,
    CommunityModeratorOperatorError,
    find_eligible_community_moderators,
    grant_community_moderator,
    list_current_community_moderators,
    revoke_community_moderator,
)
from tests.builders.actors import persist_member

_member = partial(
    persist_member,
    handle="moderator-operator-test",
    display_name="Moderator operator test member",
)


def test_moderator_grant_and_revoke_are_idempotent_and_independent(
    db_session: Session,
) -> None:
    grantor = _member(db_session, handle="moderator-grantor")
    target = _member(db_session, handle="moderator-target")
    db_session.add(CatalogCurator(user_id=target.id, granted_by_user_id=grantor.id))
    db_session.flush()

    assert grant_community_moderator(
        db_session,
        user_id=target.id,
        granted_by_user_id=grantor.id,
    )
    assert not grant_community_moderator(
        db_session,
        user_id=target.id,
        granted_by_user_id=grantor.id,
    )
    stored = db_session.get(CommunityModerator, target.id)
    assert stored is not None
    assert stored.granted_by_user_id == grantor.id
    assert db_session.get(CatalogCurator, target.id) is not None

    assert revoke_community_moderator(db_session, user_id=target.id)
    assert not revoke_community_moderator(db_session, user_id=target.id)
    assert db_session.get(CommunityModerator, target.id) is None
    assert db_session.get(CatalogCurator, target.id) is not None


@pytest.mark.parametrize(
    ("handle", "account_kind", "status"),
    [
        (None, ACCOUNT_KIND_MEMBER, USER_STATUS_ACTIVE),
        ("moderator-demo", ACCOUNT_KIND_DEMO, USER_STATUS_ACTIVE),
        ("moderator-suspended", ACCOUNT_KIND_MEMBER, USER_STATUS_SUSPENDED),
    ],
)
def test_moderator_grant_requires_an_active_onboarded_member(
    db_session: Session,
    handle: str | None,
    account_kind: str,
    status: str,
) -> None:
    target = _member(
        db_session,
        handle=handle,
        account_kind=account_kind,
        status=status,
    )

    with pytest.raises(CommunityModeratorOperatorError, match="active, onboarded member"):
        grant_community_moderator(db_session, user_id=target.id)
    assert db_session.get(CommunityModerator, target.id) is None


def test_moderator_grant_rejects_missing_self_or_ineligible_attribution(
    db_session: Session,
) -> None:
    target = _member(db_session, handle="moderator-grant-target")
    suspended_grantor = _member(
        db_session,
        handle="suspended-grantor",
        status=USER_STATUS_SUSPENDED,
    )

    with pytest.raises(CommunityModeratorOperatorError, match="does not exist"):
        grant_community_moderator(db_session, user_id=uuid4())
    with pytest.raises(CommunityModeratorOperatorError, match="must differ"):
        grant_community_moderator(
            db_session,
            user_id=target.id,
            granted_by_user_id=target.id,
        )
    with pytest.raises(CommunityModeratorOperatorError, match="active, onboarded member"):
        grant_community_moderator(
            db_session,
            user_id=target.id,
            granted_by_user_id=suspended_grantor.id,
        )
    assert db_session.get(CommunityModerator, target.id) is None


def test_revoke_remains_available_after_holder_becomes_ineligible(db_session: Session) -> None:
    target = _member(db_session, handle="moderator-revoke-target")
    assert grant_community_moderator(db_session, user_id=target.id)
    target.status = USER_STATUS_SUSPENDED
    db_session.flush()

    assert revoke_community_moderator(db_session, user_id=target.id)
    assert db_session.get(CommunityModerator, target.id) is None


def test_eligible_lookup_is_bounded_literal_deterministic_and_never_searches_email(
    db_session: Session,
) -> None:
    alpha = _member(
        db_session,
        handle="alpha-moderator",
        display_name="Kitchen Alpha",
        email="private-alpha@example.test",
    )
    beta = _member(db_session, handle="beta-moderator", display_name="Kitchen Beta")
    current = _member(db_session, handle="current-moderator", display_name="Current Moderator")
    _member(
        db_session,
        handle="suspended-member",
        display_name="Kitchen Suspended",
        status=USER_STATUS_SUSPENDED,
    )
    _member(
        db_session,
        handle="demo-member",
        display_name="Kitchen Demo",
        account_kind=ACCOUNT_KIND_DEMO,
    )
    _member(db_session, handle=None, display_name="Kitchen Incomplete")
    literal = _member(
        db_session,
        handle="literal-member",
        display_name="Literal %_ Cook",
    )
    db_session.add(CatalogCurator(user_id=beta.id))
    assert grant_community_moderator(db_session, user_id=current.id)
    db_session.flush()

    assert [item.user_id for item in find_eligible_community_moderators(db_session, limit=2)] == [
        alpha.id,
        beta.id,
    ]
    by_name = find_eligible_community_moderators(db_session, query="Kitchen", limit=10)
    assert [item.user_id for item in by_name] == [alpha.id, beta.id]
    by_uuid = find_eligible_community_moderators(
        db_session,
        query=str(current.id),
        limit=10,
    )
    assert len(by_uuid) == 1
    assert by_uuid[0].user_id == current.id
    assert by_uuid[0].is_community_moderator
    assert not by_uuid[0].is_catalog_curator
    catalog_candidate = next(
        item
        for item in find_eligible_community_moderators(db_session, query="beta", limit=10)
        if item.user_id == beta.id
    )
    assert catalog_candidate.is_catalog_curator
    assert not catalog_candidate.is_community_moderator
    assert [
        item.user_id
        for item in find_eligible_community_moderators(db_session, query="%_", limit=10)
    ] == [literal.id]
    assert (
        find_eligible_community_moderators(
            db_session,
            query="private-alpha@example.test",
            limit=10,
        )
        == []
    )


def test_current_moderator_list_keeps_ineligible_grants_visible_for_revocation(
    db_session: Session,
) -> None:
    grantor = _member(db_session, handle="audit-grantor")
    active = _member(db_session, handle="active-moderator", display_name="Active Moderator")
    suspended = _member(
        db_session,
        handle="suspended-moderator",
        display_name="Suspended Moderator",
    )
    incomplete = _member(
        db_session,
        handle="incomplete-moderator",
        display_name="Incomplete Moderator",
    )
    assert grant_community_moderator(
        db_session,
        user_id=active.id,
        granted_by_user_id=grantor.id,
    )
    assert grant_community_moderator(db_session, user_id=suspended.id)
    assert grant_community_moderator(db_session, user_id=incomplete.id)
    suspended.status = USER_STATUS_SUSPENDED
    incomplete.handle = None
    db_session.flush()

    grants = list_current_community_moderators(db_session, limit=10)

    assert [grant.user_id for grant in grants] == [active.id, suspended.id, incomplete.id]
    assert [grant.is_eligible for grant in grants] == [True, False, False]
    assert grants[0].granted_by_user_id == grantor.id
    assert all(grant.granted_at is not None for grant in grants)
    assert [grant.user_id for grant in list_current_community_moderators(db_session, limit=1)] == [
        active.id
    ]


def test_operator_service_and_parser_enforce_bounds_and_stable_uuid_targets(
    db_session: Session,
) -> None:
    with pytest.raises(CommunityModeratorOperatorError, match="between 1 and"):
        find_eligible_community_moderators(db_session, limit=0)
    with pytest.raises(CommunityModeratorOperatorError, match="between 1 and"):
        list_current_community_moderators(db_session, limit=MAX_OPERATOR_RESULT_LIMIT + 1)
    with pytest.raises(CommunityModeratorOperatorError, match="1 to"):
        find_eligible_community_moderators(db_session, query="   ")
    with pytest.raises(CommunityModeratorOperatorError, match="1 to"):
        find_eligible_community_moderators(
            db_session,
            query="x" * (MAX_OPERATOR_QUERY_LENGTH + 1),
        )

    target_id = uuid4()
    grantor_id = uuid4()
    eligible = build_parser().parse_args(["eligible", "--query", "  member cook  ", "--limit", "7"])
    listing = build_parser().parse_args(["list", "--limit", "9"])
    grant = build_parser().parse_args(
        [
            "grant",
            "--user-id",
            str(target_id),
            "--granted-by-user-id",
            str(grantor_id),
        ]
    )
    revoke = build_parser().parse_args(["revoke", "--user-id", str(target_id)])
    assert eligible.query == "member cook"
    assert eligible.limit == 7
    assert listing.limit == 9
    assert grant.user_id == target_id
    assert grant.granted_by_user_id == grantor_id
    assert revoke.user_id == target_id
    with pytest.raises(SystemExit):
        build_parser().parse_args(["grant", "--user-id", "member@example.test"])
    with pytest.raises(SystemExit):
        build_parser().parse_args(["eligible", "--limit", "101"])
    with pytest.raises(SystemExit):
        build_parser().parse_args(["eligible", "--query", "   "])


def test_operator_read_output_is_deterministic_and_non_pii(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    eligible = _member(
        db_session,
        handle="output-eligible",
        display_name="Output\nEligible",
        email="eligible-secret@example.test",
    )
    moderator = _member(
        db_session,
        handle="output-moderator",
        display_name="Output Moderator",
        email="moderator-secret@example.test",
    )
    assert grant_community_moderator(db_session, user_id=moderator.id)
    moderator.status = USER_STATUS_SUSPENDED
    db_session.flush()
    monkeypatch.setattr(moderator_cli, "SessionLocal", lambda: nullcontext(db_session))

    assert moderator_cli.main(["eligible", "--query", str(eligible.id)]) == 0
    eligible_output = capsys.readouterr().out.strip()
    assert len(eligible_output.splitlines()) == 1
    assert json.loads(eligible_output) == [
        {
            "catalog_curator": False,
            "community_moderator": False,
            "display_name": "Output\nEligible",
            "eligible": True,
            "handle": "output-eligible",
            "user_id": str(eligible.id),
        }
    ]
    assert "eligible-secret@example.test" not in eligible_output

    assert moderator_cli.main(["list", "--limit", "10"]) == 0
    list_output = capsys.readouterr().out.strip()
    records = json.loads(list_output)
    listed = next(record for record in records if record["user_id"] == str(moderator.id))
    assert set(listed) == {
        "catalog_curator",
        "community_moderator",
        "display_name",
        "eligible",
        "granted_at",
        "granted_by_user_id",
        "handle",
        "user_id",
    }
    assert "moderator-secret@example.test" not in list_output
    assert "oidc" not in list_output.casefold()
    assert "session" not in list_output.casefold()
