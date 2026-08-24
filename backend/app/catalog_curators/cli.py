import argparse
import json
import sys
from collections.abc import Sequence
from typing import cast
from uuid import UUID

from sqlalchemy.exc import SQLAlchemyError

from app.catalog_curators.service import (
    DEFAULT_CURATOR_LIST_LIMIT,
    DEFAULT_ELIGIBLE_MEMBER_LIMIT,
    MAX_OPERATOR_QUERY_LENGTH,
    MAX_OPERATOR_RESULT_LIMIT,
    CatalogCuratorOperatorError,
    CurrentCatalogCuratorGrant,
    EligibleCatalogCuratorMember,
    find_eligible_catalog_curator_members,
    grant_catalog_curator,
    list_current_catalog_curators,
    revoke_catalog_curator,
)
from app.db.session import SessionLocal


def _bounded_limit(value: str) -> int:
    try:
        limit = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("limit must be an integer") from error
    if not 1 <= limit <= MAX_OPERATOR_RESULT_LIMIT:
        raise argparse.ArgumentTypeError(f"limit must be between 1 and {MAX_OPERATOR_RESULT_LIMIT}")
    return limit


def _bounded_query(value: str) -> str:
    query = value.strip()
    if not query:
        raise argparse.ArgumentTypeError("query must not be blank")
    if len(query) > MAX_OPERATOR_QUERY_LENGTH:
        raise argparse.ArgumentTypeError(
            f"query must be at most {MAX_OPERATOR_QUERY_LENGTH} characters"
        )
    return query


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Find eligible members and list, grant, or revoke narrow ingredient "
            "catalog-curator access."
        )
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    eligible = subparsers.add_parser(
        "eligible",
        help="Find active, onboarded members eligible for a curator grant.",
    )
    eligible.add_argument(
        "--query",
        type=_bounded_query,
        help=(
            "Optional literal UUID, handle, or display-name search. "
            "Email is never searched or returned."
        ),
    )
    eligible.add_argument(
        "--limit",
        type=_bounded_limit,
        default=DEFAULT_ELIGIBLE_MEMBER_LIMIT,
        help=(
            f"Maximum results (default {DEFAULT_ELIGIBLE_MEMBER_LIMIT}, "
            f"max {MAX_OPERATOR_RESULT_LIMIT})."
        ),
    )

    list_parser = subparsers.add_parser(
        "list",
        help="List current curator grants, including holders who are now ineligible.",
    )
    list_parser.add_argument(
        "--limit",
        type=_bounded_limit,
        default=DEFAULT_CURATOR_LIST_LIMIT,
        help=(
            f"Maximum results (default {DEFAULT_CURATOR_LIST_LIMIT}, "
            f"max {MAX_OPERATOR_RESULT_LIMIT})."
        ),
    )

    grant = subparsers.add_parser("grant", help="Grant catalog-curator access.")
    grant.add_argument("--user-id", type=UUID, required=True, help="Stable member UUID.")
    grant.add_argument(
        "--granted-by-user-id",
        type=UUID,
        help=(
            "Optional stable member UUID recorded as audit attribution. "
            "It does not authorize this command."
        ),
    )

    revoke = subparsers.add_parser("revoke", help="Revoke catalog-curator access.")
    revoke.add_argument("--user-id", type=UUID, required=True, help="Stable member UUID.")
    return parser


def _eligible_record(member: EligibleCatalogCuratorMember) -> dict[str, object]:
    return {
        "catalog_curator": member.is_catalog_curator,
        "display_name": member.display_name,
        "eligible": True,
        "handle": member.handle,
        "user_id": str(member.user_id),
    }


def _curator_record(grant: CurrentCatalogCuratorGrant) -> dict[str, object]:
    return {
        "catalog_curator": True,
        "display_name": grant.display_name,
        "eligible": grant.is_eligible,
        "granted_at": grant.granted_at.isoformat(),
        "granted_by_user_id": (
            str(grant.granted_by_user_id) if grant.granted_by_user_id is not None else None
        ),
        "handle": grant.handle,
        "user_id": str(grant.user_id),
    }


def _print_records(records: list[dict[str, object]]) -> None:
    print(json.dumps(records, ensure_ascii=True, separators=(",", ":"), sort_keys=True))


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    command = cast(str, arguments.command)

    try:
        if command == "eligible":
            with SessionLocal() as session:
                members = find_eligible_catalog_curator_members(
                    session,
                    query=cast(str | None, arguments.query),
                    limit=cast(int, arguments.limit),
                )
            _print_records([_eligible_record(member) for member in members])
            return 0
        if command == "list":
            with SessionLocal() as session:
                grants = list_current_catalog_curators(
                    session,
                    limit=cast(int, arguments.limit),
                )
            _print_records([_curator_record(grant) for grant in grants])
            return 0

        user_id = cast(UUID, arguments.user_id)
        with SessionLocal.begin() as session:
            if command == "grant":
                granted_by_user_id = cast(UUID | None, arguments.granted_by_user_id)
                changed = grant_catalog_curator(
                    session,
                    user_id=user_id,
                    granted_by_user_id=granted_by_user_id,
                )
            else:
                changed = revoke_catalog_curator(session, user_id=user_id)
    except (CatalogCuratorOperatorError, SQLAlchemyError) as error:
        print(f"Catalog-curator {command} failed: {error}", file=sys.stderr)
        return 1

    if changed:
        verb = "Granted" if command == "grant" else "Revoked"
        print(f"{verb} catalog-curator access for user {user_id}.")
    else:
        state = "granted" if command == "grant" else "revoked"
        print(f"Catalog-curator access for user {user_id} is already {state}; no change.")
    return 0
