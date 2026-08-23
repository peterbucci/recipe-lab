"""Provision two member sessions in an explicitly disposable acceptance database.

This module is a command-line test harness, not an HTTP route. It deliberately
keeps raw bearer and CSRF tokens out of PostgreSQL and stdout; the caller-owned
fixture file is the only place where those short-lived values are written.
"""

import argparse
import json
import os
import stat
import tempfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TypedDict
from uuid import NAMESPACE_URL, UUID, uuid5

from sqlalchemy import create_engine, delete, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.security import generate_opaque_token, token_digest
from app.models import (
    ACCOUNT_KIND_MEMBER,
    USER_STATUS_ACTIVE,
    User,
    UserSession,
)

ACCEPTANCE_FIXTURE_VERSION = 1
ACCEPTANCE_DATABASE_NAMES = frozenset(
    {
        "recipe_lab_acceptance",
        "recipe_lab_acceptance_local",
    }
)
ACCEPTANCE_SESSION_TTL = timedelta(hours=2)
_MEMBER_NAMESPACE = uuid5(
    NAMESPACE_URL,
    "https://github.com/peterbucci/recipe-lab/acceptance-members",
)


class AcceptanceMemberFixture(TypedDict):
    user_id: str
    session_token: str
    csrf_token: str


class AcceptanceFixture(TypedDict):
    version: int
    members: dict[str, AcceptanceMemberFixture]


@dataclass(frozen=True, slots=True)
class AcceptanceMemberDefinition:
    key: str
    user_id: UUID
    email: str
    handle: str
    display_name: str


ACCEPTANCE_MEMBERS = (
    AcceptanceMemberDefinition(
        key="alice",
        user_id=uuid5(_MEMBER_NAMESPACE, "alice"),
        email="alice@acceptance.recipe-lab.invalid",
        handle="acceptance_alice",
        display_name="Alice Cook",
    ),
    AcceptanceMemberDefinition(
        key="bob",
        user_id=uuid5(_MEMBER_NAMESPACE, "bob"),
        email="bob@acceptance.recipe-lab.invalid",
        handle="acceptance_bob",
        display_name="Bob Cook",
    ),
)


class AcceptanceHarnessError(RuntimeError):
    """Raised when the acceptance harness cannot prove that its target is disposable."""


def validate_acceptance_environment(environment: Mapping[str, str]) -> str:
    """Return the guarded database URL or reject an unsafe target."""

    if environment.get("MVP_ACCEPTANCE") != "1":
        raise AcceptanceHarnessError("MVP_ACCEPTANCE=1 is required.")
    if environment.get("ACCEPTANCE_DATABASE_ISOLATED") != "1":
        raise AcceptanceHarnessError("ACCEPTANCE_DATABASE_ISOLATED=1 is required.")

    database_url = environment.get("DATABASE_URL", "").strip()
    if not database_url:
        raise AcceptanceHarnessError("DATABASE_URL is required.")

    try:
        parsed = make_url(database_url)
    except Exception as error:
        raise AcceptanceHarnessError("DATABASE_URL is invalid.") from error

    if parsed.get_backend_name() != "postgresql":
        raise AcceptanceHarnessError("The acceptance database must use PostgreSQL.")
    if parsed.database not in ACCEPTANCE_DATABASE_NAMES:
        allowed = ", ".join(sorted(ACCEPTANCE_DATABASE_NAMES))
        raise AcceptanceHarnessError(
            f"Refusing non-acceptance database {parsed.database!r}; expected one of: {allowed}."
        )
    return database_url


def _load_or_create_member(
    session: Session,
    definition: AcceptanceMemberDefinition,
    *,
    now: datetime,
) -> User:
    handle_owner = session.scalar(
        select(User).where(User.handle == definition.handle, User.id != definition.user_id)
    )
    if handle_owner is not None:
        raise AcceptanceHarnessError(
            f"Acceptance handle {definition.handle!r} belongs to an unexpected user."
        )

    user = session.get(User, definition.user_id)
    if user is None:
        user = User(
            id=definition.user_id,
            email=definition.email,
            handle=definition.handle,
            display_name=definition.display_name,
            account_kind=ACCOUNT_KIND_MEMBER,
            status=USER_STATUS_ACTIVE,
            created_at=now,
            updated_at=now,
        )
        session.add(user)
        session.flush()
        return user

    if user.account_kind != ACCOUNT_KIND_MEMBER:
        raise AcceptanceHarnessError(
            f"Acceptance user {definition.key!r} has an unexpected account kind."
        )
    user.email = definition.email
    user.handle = definition.handle
    user.display_name = definition.display_name
    user.status = USER_STATUS_ACTIVE
    session.flush()
    return user


def provision_acceptance_sessions(
    session: Session,
    *,
    now: datetime | None = None,
) -> AcceptanceFixture:
    """Stage two active, onboarded members and fresh digest-only sessions."""

    issued_at = now or datetime.now(UTC)
    member_ids = [definition.user_id for definition in ACCEPTANCE_MEMBERS]
    session.execute(delete(UserSession).where(UserSession.user_id.in_(member_ids)))

    members: dict[str, AcceptanceMemberFixture] = {}
    for definition in ACCEPTANCE_MEMBERS:
        user = _load_or_create_member(session, definition, now=issued_at)
        raw_session_token = generate_opaque_token()
        raw_csrf_token = generate_opaque_token()
        session.add(
            UserSession(
                user=user,
                token_digest=token_digest(raw_session_token),
                csrf_token_digest=token_digest(raw_csrf_token),
                created_at=issued_at,
                last_seen_at=issued_at,
                expires_at=issued_at + ACCEPTANCE_SESSION_TTL,
            )
        )
        members[definition.key] = {
            "user_id": str(user.id),
            "session_token": raw_session_token,
            "csrf_token": raw_csrf_token,
        }

    session.flush()
    return {
        "version": ACCEPTANCE_FIXTURE_VERSION,
        "members": members,
    }


def write_acceptance_fixture(path: Path, fixture: AcceptanceFixture) -> None:
    """Create one private fixture file without replacing an existing secret file."""

    resolved = path.expanduser().resolve()
    if resolved.suffix.casefold() != ".json":
        raise AcceptanceHarnessError("The acceptance session fixture must be a .json file.")
    if not resolved.parent.is_dir():
        raise AcceptanceHarnessError("The acceptance session fixture directory does not exist.")

    payload = (json.dumps(fixture, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    try:
        descriptor = os.open(resolved, flags, stat.S_IRUSR | stat.S_IWUSR)
    except FileExistsError as error:
        raise AcceptanceHarnessError(
            "The acceptance session fixture already exists; remove the disposable file first."
        ) from error

    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(payload)
        try:
            resolved.chmod(stat.S_IRUSR | stat.S_IWUSR)
        except OSError:
            # Some Windows filesystems do not implement POSIX permission bits.
            pass
    except Exception:
        try:
            resolved.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def _output_path(arguments: argparse.Namespace, environment: Mapping[str, str]) -> Path:
    configured = arguments.output or environment.get("ACCEPTANCE_SESSION_FIXTURE", "")
    if not configured:
        raise AcceptanceHarnessError(
            "Pass --output or set ACCEPTANCE_SESSION_FIXTURE to a caller-owned temp path."
        )
    return Path(str(configured))


def validate_output_path(path: Path, environment: Mapping[str, str]) -> Path:
    """Keep the raw-token fixture inside a caller-owned temporary directory."""

    resolved = path.expanduser().resolve()
    if resolved.suffix.casefold() != ".json":
        raise AcceptanceHarnessError("The acceptance session fixture must be a .json file.")
    if not resolved.parent.is_dir():
        raise AcceptanceHarnessError("The acceptance session fixture directory does not exist.")
    if resolved.exists():
        raise AcceptanceHarnessError(
            "The acceptance session fixture already exists; remove the disposable file first."
        )
    configured_roots = {
        environment.get(variable, "").strip()
        for variable in ("RUNNER_TEMP", "TEMP", "TMP", "TMPDIR")
    }
    configured_roots.add(tempfile.gettempdir())
    temp_roots = {Path(value).expanduser().resolve() for value in configured_roots if value}
    if not any(resolved.is_relative_to(root) for root in temp_roots):
        raise AcceptanceHarnessError(
            "ACCEPTANCE_SESSION_FIXTURE must be inside a configured temporary directory."
        )
    return resolved


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Provision two opaque member sessions for an isolated acceptance run."
    )
    parser.add_argument(
        "--output",
        help="New JSON fixture path. Defaults to ACCEPTANCE_SESSION_FIXTURE.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    try:
        database_url = validate_acceptance_environment(os.environ)
        output_path = validate_output_path(_output_path(arguments, os.environ), os.environ)
        acceptance_engine = create_engine(database_url, pool_pre_ping=True)
        try:
            with Session(bind=acceptance_engine) as session, session.begin():
                fixture = provision_acceptance_sessions(session)
        finally:
            acceptance_engine.dispose()
        write_acceptance_fixture(output_path, fixture)
    except AcceptanceHarnessError as error:
        raise SystemExit(f"Acceptance session provisioning refused: {error}") from error

    print("Provisioned two isolated acceptance member sessions.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
