from uuid import UUID, uuid4

import pytest
from sqlalchemy.orm import Session

from app.catalog_curators.cli import build_parser
from app.catalog_curators.service import (
    CatalogCuratorOperatorError,
    grant_catalog_curator,
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
    account_kind: str = ACCOUNT_KIND_MEMBER,
    status: str = USER_STATUS_ACTIVE,
) -> User:
    resolved_id = user_id or uuid4()
    user = User(
        id=resolved_id,
        email=f"{resolved_id}@example.test",
        display_name="Catalog operator test member",
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


def test_operator_parser_accepts_only_stable_uuid_targets() -> None:
    target_id = uuid4()
    grantor_id = uuid4()

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

    assert grant.command == "grant"
    assert grant.user_id == target_id
    assert grant.granted_by_user_id == grantor_id
    assert revoke.command == "revoke"
    assert revoke.user_id == target_id
    with pytest.raises(SystemExit):
        build_parser().parse_args(["grant", "--user-id", "member@example.test"])


def test_the_application_exposes_no_curator_grant_or_revoke_route() -> None:
    paths = create_app().openapi()["paths"]

    assert not any("catalog-curator" in path for path in paths)
