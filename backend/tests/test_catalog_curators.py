import json
from contextlib import nullcontext
from uuid import UUID, uuid4

import pytest
from sqlalchemy.orm import Session

from app.catalog_curators import cli as curator_cli
from app.catalog_curators.cli import build_parser
from app.catalog_curators.service import (
    MAX_OPERATOR_QUERY_LENGTH,
    MAX_OPERATOR_RESULT_LIMIT,
    CatalogCuratorOperatorError,
    find_eligible_catalog_curator_members,
    grant_catalog_curator,
    list_current_catalog_curators,
    revoke_catalog_curator,
)
from app.main import create_app
from app.models import (
    ACCOUNT_KIND_DEMO,
    ACCOUNT_KIND_MEMBER,
    USER_STATUS_ACTIVE,
    USER_STATUS_SUSPENDED,
    CatalogCurator,
    User,
)


def _member(
    session: Session,
    *,
    user_id: UUID | None = None,
    handle: str | None = "catalog-operator-test",
    display_name: str = "Catalog operator test member",
    email: str | None = None,
    account_kind: str = ACCOUNT_KIND_MEMBER,
    status: str = USER_STATUS_ACTIVE,
) -> User:
    resolved_id = user_id or uuid4()
    user = User(
        id=resolved_id,
        email=email or f"{resolved_id}@example.test",
        display_name=display_name,
        handle=handle,
        account_kind=account_kind,
        status=status,
    )
    session.add(user)
    session.flush()
    return user


def test_grant_and_revoke_are_idempotent_by_stable_user_id(db_session: Session) -> None:
    grantor = _member(db_session, handle="catalog-grantor")
    target = _member(db_session, handle="catalog-target")

    assert grant_catalog_curator(
        db_session,
        user_id=target.id,
        granted_by_user_id=grantor.id,
    )
    assert not grant_catalog_curator(
        db_session,
        user_id=target.id,
        granted_by_user_id=grantor.id,
    )

    stored = db_session.get(CatalogCurator, target.id)
    assert stored is not None
    assert stored.granted_by_user_id == grantor.id

    assert revoke_catalog_curator(db_session, user_id=target.id)
    assert not revoke_catalog_curator(db_session, user_id=target.id)
    assert db_session.get(CatalogCurator, target.id) is None


@pytest.mark.parametrize(
    ("handle", "account_kind", "status"),
    [
        (None, ACCOUNT_KIND_MEMBER, USER_STATUS_ACTIVE),
        ("catalog-demo", ACCOUNT_KIND_DEMO, USER_STATUS_ACTIVE),
        ("catalog-suspended", ACCOUNT_KIND_MEMBER, USER_STATUS_SUSPENDED),
    ],
)
def test_grant_requires_an_active_onboarded_member(
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

    with pytest.raises(CatalogCuratorOperatorError, match="active, onboarded member"):
        grant_catalog_curator(db_session, user_id=target.id)

    assert db_session.get(CatalogCurator, target.id) is None


def test_grant_rejects_a_missing_target(db_session: Session) -> None:
    missing_id = uuid4()

    with pytest.raises(CatalogCuratorOperatorError, match="does not exist"):
        grant_catalog_curator(db_session, user_id=missing_id)

    assert db_session.get(CatalogCurator, missing_id) is None


def test_grant_rejects_missing_or_self_identified_granting_users(
    db_session: Session,
) -> None:
    target = _member(db_session, handle="catalog-grant-target")

    with pytest.raises(CatalogCuratorOperatorError, match="does not exist"):
        grant_catalog_curator(
            db_session,
            user_id=target.id,
            granted_by_user_id=uuid4(),
        )
    with pytest.raises(CatalogCuratorOperatorError, match="must differ"):
        grant_catalog_curator(
            db_session,
            user_id=target.id,
            granted_by_user_id=target.id,
        )

    assert db_session.get(CatalogCurator, target.id) is None


def test_revoke_remains_available_after_a_member_is_suspended(db_session: Session) -> None:
    target = _member(db_session, handle="catalog-revoke-target")
    assert grant_catalog_curator(db_session, user_id=target.id)
    target.status = USER_STATUS_SUSPENDED
    db_session.flush()

    assert revoke_catalog_curator(db_session, user_id=target.id)
    assert db_session.get(CatalogCurator, target.id) is None


def test_eligible_lookup_is_bounded_deterministic_and_never_searches_email(
    db_session: Session,
) -> None:
    alpha = _member(
        db_session,
        handle="alpha-eligible",
        display_name="Kitchen Alpha",
        email="private-alpha@example.test",
    )
    beta = _member(
        db_session,
        handle="beta-eligible",
        display_name="Kitchen Beta",
    )
    current = _member(
        db_session,
        handle="current-curator",
        display_name="Current Curator",
    )
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
    assert grant_catalog_curator(db_session, user_id=current.id)

    first_page = find_eligible_catalog_curator_members(db_session, limit=2)
    by_display_name = find_eligible_catalog_curator_members(
        db_session,
        query="Kitchen",
        limit=10,
    )
    by_uuid = find_eligible_catalog_curator_members(
        db_session,
        query=str(current.id),
        limit=10,
    )
    literal_match = find_eligible_catalog_curator_members(
        db_session,
        query="%_",
        limit=10,
    )

    assert [item.user_id for item in first_page] == [alpha.id, beta.id]
    assert [item.user_id for item in by_display_name] == [alpha.id, beta.id]
    assert len(by_uuid) == 1
    assert by_uuid[0].user_id == current.id
    assert by_uuid[0].is_catalog_curator
    assert [item.user_id for item in literal_match] == [literal.id]
    assert (
        find_eligible_catalog_curator_members(
            db_session,
            query="private-alpha@example.test",
            limit=10,
        )
        == []
    )


def test_current_curator_list_keeps_ineligible_grants_visible_for_revocation(
    db_session: Session,
) -> None:
    grantor = _member(db_session, handle="audit-grantor")
    active = _member(
        db_session,
        handle="active-curator",
        display_name="Active Curator",
    )
    suspended = _member(
        db_session,
        handle="suspended-curator",
        display_name="Suspended Curator",
    )
    incomplete = _member(
        db_session,
        handle="incomplete-curator",
        display_name="Incomplete Curator",
    )
    assert grant_catalog_curator(
        db_session,
        user_id=active.id,
        granted_by_user_id=grantor.id,
    )
    assert grant_catalog_curator(db_session, user_id=suspended.id)
    assert grant_catalog_curator(db_session, user_id=incomplete.id)
    suspended.status = USER_STATUS_SUSPENDED
    incomplete.handle = None
    db_session.flush()

    grants = list_current_catalog_curators(db_session, limit=10)

    assert [grant.user_id for grant in grants] == [active.id, suspended.id, incomplete.id]
    assert [grant.is_eligible for grant in grants] == [True, False, False]
    assert grants[0].granted_by_user_id == grantor.id
    assert all(grant.granted_at is not None for grant in grants)
    assert [grant.user_id for grant in list_current_catalog_curators(db_session, limit=1)] == [
        active.id
    ]


def test_operator_queries_defend_their_bounds_in_the_service(db_session: Session) -> None:
    with pytest.raises(CatalogCuratorOperatorError, match="result limit"):
        find_eligible_catalog_curator_members(db_session, limit=0)
    with pytest.raises(CatalogCuratorOperatorError, match="result limit"):
        list_current_catalog_curators(db_session, limit=MAX_OPERATOR_RESULT_LIMIT + 1)
    with pytest.raises(CatalogCuratorOperatorError, match="must not be blank"):
        find_eligible_catalog_curator_members(db_session, query="   ")
    with pytest.raises(CatalogCuratorOperatorError, match="at most"):
        find_eligible_catalog_curator_members(
            db_session,
            query="x" * (MAX_OPERATOR_QUERY_LENGTH + 1),
        )


def test_operator_parser_accepts_safe_reads_and_only_stable_uuid_write_targets() -> None:
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

    assert eligible.command == "eligible"
    assert eligible.query == "member cook"
    assert eligible.limit == 7
    assert listing.command == "list"
    assert listing.limit == 9
    assert grant.command == "grant"
    assert grant.user_id == target_id
    assert grant.granted_by_user_id == grantor_id
    assert revoke.command == "revoke"
    assert revoke.user_id == target_id
    with pytest.raises(SystemExit):
        build_parser().parse_args(["grant", "--user-id", "member@example.test"])
    with pytest.raises(SystemExit):
        build_parser().parse_args(["eligible", "--limit", "101"])
    with pytest.raises(SystemExit):
        build_parser().parse_args(["eligible", "--query", "   "])


def test_operator_read_output_is_deterministic_and_privacy_safe(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    grantor = _member(db_session, handle="output-grantor")
    eligible = _member(
        db_session,
        handle="output-eligible",
        display_name="Output\nEligible",
        email="eligible-secret@example.test",
    )
    curator = _member(
        db_session,
        handle="output-curator",
        display_name="Output Curator",
        email="curator-secret@example.test",
    )
    assert grant_catalog_curator(
        db_session,
        user_id=curator.id,
        granted_by_user_id=grantor.id,
    )
    curator.status = USER_STATUS_SUSPENDED
    db_session.flush()
    monkeypatch.setattr(curator_cli, "SessionLocal", lambda: nullcontext(db_session))

    assert curator_cli.main(["eligible", "--query", str(eligible.id)]) == 0
    eligible_output = capsys.readouterr().out.strip()
    assert len(eligible_output.splitlines()) == 1
    assert json.loads(eligible_output) == [
        {
            "catalog_curator": False,
            "display_name": "Output\nEligible",
            "eligible": True,
            "handle": "output-eligible",
            "user_id": str(eligible.id),
        }
    ]
    assert "eligible-secret@example.test" not in eligible_output

    assert curator_cli.main(["list", "--limit", "10"]) == 0
    list_output = capsys.readouterr().out.strip()
    records = json.loads(list_output)
    listed = next(record for record in records if record["user_id"] == str(curator.id))
    assert set(listed) == {
        "catalog_curator",
        "display_name",
        "eligible",
        "granted_at",
        "granted_by_user_id",
        "handle",
        "user_id",
    }
    assert listed["catalog_curator"] is True
    assert listed["eligible"] is False
    assert listed["granted_by_user_id"] == str(grantor.id)
    assert "curator-secret@example.test" not in list_output


def test_the_application_exposes_no_curator_grant_or_revoke_route() -> None:
    paths = create_app().openapi()["paths"]

    assert not any("catalog-curator" in path for path in paths)
