import argparse
import sys
from collections.abc import Sequence
from typing import cast
from uuid import UUID

from sqlalchemy.exc import SQLAlchemyError

from app.catalog_curators.service import (
    CatalogCuratorOperatorError,
    grant_catalog_curator,
    revoke_catalog_curator,
)
from app.db.session import SessionLocal


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Grant or revoke narrow ingredient catalog-curator access."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    grant = subparsers.add_parser("grant", help="Grant catalog-curator access.")
    grant.add_argument("--user-id", type=UUID, required=True, help="Stable member UUID.")
    grant.add_argument(
        "--granted-by-user-id",
        type=UUID,
        help="Optional stable UUID of the member who authorized the grant.",
    )

    revoke = subparsers.add_parser("revoke", help="Revoke catalog-curator access.")
    revoke.add_argument("--user-id", type=UUID, required=True, help="Stable member UUID.")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    command = cast(str, arguments.command)
    user_id = cast(UUID, arguments.user_id)

    try:
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
