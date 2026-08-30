from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import stat
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Final, Literal
from uuid import UUID

from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.models import (
    ACCOUNT_KIND_MEMBER,
    USER_STATUS_ACTIVE,
    USER_STATUS_DELETED,
    USER_STATUS_SUSPENDED,
    AbuseRateLimitBucket,
    CatalogCurator,
    CommunityModerator,
    IngredientCatalogAuditEvent,
    IngredientCatalogRequest,
    OIDCIdentity,
    PreferenceEvent,
    RecipeDraft,
    RecipeDraftCategory,
    RecipeDraftIngredient,
    RecipeDraftInstruction,
    RecipeDuplicatePreflight,
    RecipeModerationAuditEvent,
    RecipeRating,
    RecipeReport,
    RecipeSave,
    RecipeVersionPublication,
    User,
    UserSession,
)
from app.repositories.account_lifecycle import (
    DELETED_MODERATION_FINGERPRINT,
    DELETED_REPORT_FINGERPRINT,
    get_account_user_for_update,
    list_oidc_identity_keys_for_user,
    list_user_sessions_for_update,
    lock_account_deletion_ledger_exclusive,
    lock_account_lifecycle_user,
)
from app.repositories.auth import get_oidc_identity, lock_oidc_identity_key
from app.services.account_lifecycle import (
    DELETED_COOK_DISPLAY_NAME,
    tombstone_member_from_durable_deletion_evidence,
)

LEDGER_VERSION: Final = 1
MAX_LEDGER_BYTES: Final = 1_048_576
MAX_LEDGER_ENTRIES: Final = 10_000
_SHA256_HEX_LENGTH: Final = 64
_LEDGER_KEYS: Final = frozenset({"covered_through", "deletions", "version"})
_ENTRY_KEYS: Final = frozenset({"deleted_at", "user_id"})
_PREPARED_REPLAY_TOKEN: Final = object()


class DeletionLedgerError(RuntimeError):
    """A deliberately generic fail-closed recovery error."""


@dataclass(frozen=True)
class DeletionLedgerEntry:
    user_id: UUID
    deleted_at: datetime


@dataclass(frozen=True)
class DeletionLedger:
    covered_through: datetime
    deletions: tuple[DeletionLedgerEntry, ...]
    version: int = LEDGER_VERSION


@dataclass(frozen=True)
class DeletionLedgerExport:
    covered_through: datetime
    deletion_count: int
    sha256: str


@dataclass(frozen=True)
class PreparedDeletionReplay:
    ledger: DeletionLedger = field(repr=False)
    sha256: str
    _validation_token: object = field(repr=False, compare=False)


@dataclass(frozen=True)
class DeletionReplayResult:
    absent_count: int
    already_deleted_count: int
    replayed_count: int


ReplayState = Literal["absent", "deletable", "deleted"]


def _fail() -> DeletionLedgerError:
    return DeletionLedgerError("Account-deletion recovery failed.")


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise _fail()
    return value.astimezone(UTC)


def format_utc_timestamp(value: datetime) -> str:
    return _utc(value).isoformat(timespec="microseconds").replace("+00:00", "Z")


def parse_utc_timestamp(value: object) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise _fail()
    try:
        parsed = datetime.fromisoformat(f"{value[:-1]}+00:00")
    except ValueError as error:
        raise _fail() from error
    parsed = _utc(parsed)
    if format_utc_timestamp(parsed) != value:
        raise _fail()
    return parsed


def _canonical_uuid(value: object) -> UUID:
    if not isinstance(value, str):
        raise _fail()
    try:
        parsed = UUID(value)
    except (ValueError, AttributeError) as error:
        raise _fail() from error
    if str(parsed) != value:
        raise _fail()
    return parsed


def _object_without_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise _fail()
        result[key] = value
    return result


def _ledger_value(ledger: DeletionLedger) -> dict[str, object]:
    return {
        "covered_through": format_utc_timestamp(ledger.covered_through),
        "deletions": [
            {
                "deleted_at": format_utc_timestamp(entry.deleted_at),
                "user_id": str(entry.user_id),
            }
            for entry in ledger.deletions
        ],
        "version": ledger.version,
    }


def render_deletion_ledger(ledger: DeletionLedger) -> bytes:
    rendered = json.dumps(
        _ledger_value(ledger),
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )
    return f"{rendered}\n".encode("ascii")


def parse_deletion_ledger(data: bytes) -> DeletionLedger:
    if not data or len(data) > MAX_LEDGER_BYTES:
        raise _fail()
    try:
        raw = json.loads(
            data.decode("utf-8"),
            object_pairs_hook=_object_without_duplicate_keys,
            parse_constant=lambda _value: (_ for _ in ()).throw(_fail()),
        )
    except (DeletionLedgerError, RecursionError, UnicodeDecodeError, ValueError) as error:
        raise _fail() from error
    if not isinstance(raw, dict) or set(raw) != _LEDGER_KEYS:
        raise _fail()
    if type(raw["version"]) is not int or raw["version"] != LEDGER_VERSION:
        raise _fail()
    covered_through = parse_utc_timestamp(raw["covered_through"])
    raw_deletions = raw["deletions"]
    if not isinstance(raw_deletions, list) or len(raw_deletions) > MAX_LEDGER_ENTRIES:
        raise _fail()

    entries: list[DeletionLedgerEntry] = []
    previous_user_id: str | None = None
    for raw_entry in raw_deletions:
        if not isinstance(raw_entry, dict) or set(raw_entry) != _ENTRY_KEYS:
            raise _fail()
        user_id = _canonical_uuid(raw_entry["user_id"])
        canonical_user_id = str(user_id)
        if previous_user_id is not None and canonical_user_id <= previous_user_id:
            raise _fail()
        deleted_at = parse_utc_timestamp(raw_entry["deleted_at"])
        if deleted_at > covered_through:
            raise _fail()
        entries.append(DeletionLedgerEntry(user_id=user_id, deleted_at=deleted_at))
        previous_user_id = canonical_user_id

    ledger = DeletionLedger(
        covered_through=covered_through,
        deletions=tuple(entries),
    )
    if render_deletion_ledger(ledger) != data:
        raise _fail()
    return ledger


def _read_private_ledger(path: Path) -> bytes:
    flags = os.O_RDONLY
    if hasattr(os, "O_BINARY"):
        flags |= os.O_BINARY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor: int | None = None
    try:
        descriptor = os.open(path, flags)
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or not 0 < metadata.st_size <= MAX_LEDGER_BYTES:
            raise _fail()
        if os.name == "posix" and metadata.st_mode & 0o077:
            raise _fail()
        chunks: list[bytes] = []
        bytes_read = 0
        while bytes_read <= MAX_LEDGER_BYTES:
            chunk = os.read(descriptor, min(65_536, MAX_LEDGER_BYTES + 1 - bytes_read))
            if not chunk:
                break
            chunks.append(chunk)
            bytes_read += len(chunk)
        data = b"".join(chunks)
        if len(data) != metadata.st_size or len(data) > MAX_LEDGER_BYTES:
            raise _fail()
        return data
    except (OSError, DeletionLedgerError) as error:
        raise _fail() from error
    finally:
        if descriptor is not None:
            os.close(descriptor)


def _write_private_ledger_exclusive(path: Path, data: bytes) -> None:
    if not data or len(data) > MAX_LEDGER_BYTES:
        raise _fail()
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_BINARY"):
        flags |= os.O_BINARY
    descriptor: int | None = None
    temporary_path = path.with_name(f".{path.name}.{secrets.token_hex(16)}.tmp")
    temporary_created = False
    published = False
    try:
        descriptor = os.open(temporary_path, flags, 0o600)
        temporary_created = True
        view = memoryview(data)
        while view:
            written = os.write(descriptor, view)
            if written <= 0:
                raise _fail()
            view = view[written:]
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = None

        # Hard-link publication is atomic and refuses to replace an existing ledger.
        # The temporary file is in the same directory, so no cross-device move exists.
        os.link(temporary_path, path)
        published = True
        temporary_path.unlink()
        temporary_created = False

        if hasattr(os, "O_DIRECTORY"):
            directory_descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory_descriptor)
            finally:
                os.close(directory_descriptor)
    except (OSError, DeletionLedgerError) as error:
        if published:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
        if temporary_created:
            try:
                temporary_path.unlink(missing_ok=True)
            except OSError:
                pass
        raise _fail() from error
    finally:
        if descriptor is not None:
            os.close(descriptor)


def _has_rows(session: Session, criterion: ColumnElement[bool]) -> bool:
    return bool(session.scalar(select(exists().where(criterion))))


def _verify_deleted_members(
    session: Session,
    members: Sequence[tuple[User, datetime]],
) -> None:
    """Verify every tombstone with a constant number of privacy-table scans."""

    if not members:
        return
    user_ids = tuple(user.id for user, _deleted_at in members)
    if len(set(user_ids)) != len(user_ids):
        raise _fail()
    for user, deleted_at in members:
        if (
            user.account_kind != ACCOUNT_KIND_MEMBER
            or user.status != USER_STATUS_DELETED
            or user.email is not None
            or user.handle is not None
            or user.display_name != DELETED_COOK_DISPLAY_NAME
            or user.deleted_at is None
            or _utc(user.deleted_at) != _utc(deleted_at)
        ):
            raise _fail()

    direct_private_criteria = (
        OIDCIdentity.user_id.in_(user_ids),
        UserSession.user_id.in_(user_ids),
        RecipeSave.user_id.in_(user_ids),
        RecipeRating.user_id.in_(user_ids),
        PreferenceEvent.user_id.in_(user_ids),
        CatalogCurator.user_id.in_(user_ids),
        CommunityModerator.user_id.in_(user_ids),
        AbuseRateLimitBucket.account_user_id.in_(user_ids),
        (
            RecipeDraft.author_user_id.in_(user_ids)
            & RecipeDraft.status.in_(("active", "discarded"))
        ),
        (
            IngredientCatalogRequest.requester_user_id.in_(user_ids)
            & (IngredientCatalogRequest.status == "pending")
        ),
        (
            IngredientCatalogRequest.requester_user_id.in_(user_ids)
            & (IngredientCatalogRequest.status != "pending")
            & (IngredientCatalogRequest.context.is_not(None))
        ),
        (
            RecipeReport.reporter_user_id.in_(user_ids)
            & (
                (RecipeReport.details.is_not(None))
                | RecipeReport.request_fingerprint.is_distinct_from(DELETED_REPORT_FINGERPRINT)
            )
        ),
        (
            RecipeModerationAuditEvent.actor_user_id.in_(user_ids)
            & (
                (RecipeModerationAuditEvent.private_note.is_not(None))
                | RecipeModerationAuditEvent.request_fingerprint.is_distinct_from(
                    DELETED_MODERATION_FINGERPRINT
                )
            )
        ),
    )
    if any(_has_rows(session, criterion) for criterion in direct_private_criteria):
        raise _fail()

    draft_ids = select(RecipeDraft.id).where(RecipeDraft.author_user_id.in_(user_ids))
    if _has_rows(
        session,
        RecipeDraft.author_user_id.in_(user_ids)
        & (RecipeDraft.status == "published")
        & (
            (RecipeDraft.title != "")
            | RecipeDraft.description.is_not(None)
            | RecipeDraft.servings.is_not(None)
        ),
    ):
        raise _fail()
    if (
        _has_rows(session, RecipeDraftCategory.recipe_draft_id.in_(draft_ids))
        or _has_rows(session, RecipeDraftIngredient.recipe_draft_id.in_(draft_ids))
        or _has_rows(session, RecipeDraftInstruction.recipe_draft_id.in_(draft_ids))
    ):
        raise _fail()

    private_preflight = RecipeDuplicatePreflight.actor_user_id.in_(user_ids) & ~exists().where(
        RecipeVersionPublication.duplicate_preflight_id == RecipeDuplicatePreflight.id
    )
    if _has_rows(session, private_preflight):
        raise _fail()

    owned_terminal_request_ids = select(IngredientCatalogRequest.id).where(
        IngredientCatalogRequest.requester_user_id.in_(user_ids),
        IngredientCatalogRequest.status != "pending",
    )
    if _has_rows(
        session,
        (IngredientCatalogAuditEvent.request_id.in_(owned_terminal_request_ids))
        & (IngredientCatalogAuditEvent.event_type == "submitted")
        & IngredientCatalogAuditEvent.payload.op("?")("context"),
    ):
        raise _fail()


def export_deletion_ledger(session: Session, path: Path) -> DeletionLedgerExport:
    """Write one exclusive, complete tombstone snapshot without exposing its entries."""

    lock_account_deletion_ledger_exclusive(session)
    covered_through = session.scalar(select(func.clock_timestamp()))
    if not isinstance(covered_through, datetime):
        raise _fail()
    covered_through = _utc(covered_through)
    users = list(
        session.scalars(
            select(User)
            .where(
                User.account_kind == ACCOUNT_KIND_MEMBER,
                User.status == USER_STATUS_DELETED,
            )
            .order_by(User.id)
            .limit(MAX_LEDGER_ENTRIES + 1)
        )
    )
    if len(users) > MAX_LEDGER_ENTRIES:
        raise _fail()

    entries: list[DeletionLedgerEntry] = []
    verified_members: list[tuple[User, datetime]] = []
    for user in users:
        if user.deleted_at is None:
            raise _fail()
        deleted_at = _utc(user.deleted_at)
        if deleted_at > covered_through:
            raise _fail()
        verified_members.append((user, deleted_at))
        entries.append(DeletionLedgerEntry(user_id=user.id, deleted_at=deleted_at))
    _verify_deleted_members(session, verified_members)

    ledger = DeletionLedger(
        covered_through=covered_through,
        deletions=tuple(entries),
    )
    data = render_deletion_ledger(ledger)
    _write_private_ledger_exclusive(path, data)
    return DeletionLedgerExport(
        covered_through=covered_through,
        deletion_count=len(entries),
        sha256=hashlib.sha256(data).hexdigest(),
    )


def _validate_expected_sha256(value: str) -> str:
    if (
        len(value) != _SHA256_HEX_LENGTH
        or value.lower() != value
        or any(character not in "0123456789abcdef" for character in value)
    ):
        raise _fail()
    return value


def prepare_deletion_replay(
    path: Path,
    *,
    expected_sha256: str,
    required_covered_through: datetime,
) -> PreparedDeletionReplay:
    """Validate every external control before opening a database transaction."""

    expected = _validate_expected_sha256(expected_sha256)
    required = _utc(required_covered_through)
    data = _read_private_ledger(path)
    actual = hashlib.sha256(data).hexdigest()
    if not hmac.compare_digest(actual, expected):
        raise _fail()
    ledger = parse_deletion_ledger(data)
    if ledger.covered_through < required:
        raise _fail()
    return PreparedDeletionReplay(
        ledger=ledger,
        sha256=actual,
        _validation_token=_PREPARED_REPLAY_TOKEN,
    )


def _lock_and_classify_replay_user(
    session: Session,
    entry: DeletionLedgerEntry,
) -> tuple[ReplayState, User | None]:
    lock_account_lifecycle_user(session, entry.user_id)
    identity_keys = list_oidc_identity_keys_for_user(session, entry.user_id)
    for issuer, subject in identity_keys:
        lock_oidc_identity_key(session, issuer=issuer, subject=subject)
        get_oidc_identity(session, issuer=issuer, subject=subject, for_update=True)
    list_user_sessions_for_update(session, entry.user_id)
    user = get_account_user_for_update(session, entry.user_id)
    if user is None:
        return "absent", None
    if user.account_kind != ACCOUNT_KIND_MEMBER:
        raise _fail()
    if user.status in {USER_STATUS_ACTIVE, USER_STATUS_SUSPENDED}:
        return "deletable", user
    if user.status == USER_STATUS_DELETED:
        return "deleted", user
    raise _fail()


def replay_deletion_ledger(
    session: Session,
    prepared: PreparedDeletionReplay,
    *,
    expected_database_name: str,
) -> DeletionReplayResult:
    """Replay a prevalidated ledger atomically against an isolated restored database."""

    if prepared._validation_token is not _PREPARED_REPLAY_TOKEN:
        raise _fail()
    if not 1 <= len(expected_database_name) <= 63:
        raise _fail()
    current_database_name = session.scalar(select(func.current_database()))
    if current_database_name != expected_database_name:
        raise _fail()
    lock_account_deletion_ledger_exclusive(session)
    classified = [
        (entry, *_lock_and_classify_replay_user(session, entry))
        for entry in prepared.ledger.deletions
    ]
    _verify_deleted_members(
        session,
        [
            (user, entry.deleted_at)
            for entry, state, user in classified
            if state == "deleted" and user is not None
        ],
    )

    absent_count = 0
    already_deleted_count = 0
    replayed_count = 0
    replayed_entries: list[DeletionLedgerEntry] = []
    for entry, state, user in classified:
        if state == "absent":
            absent_count += 1
            continue
        if state == "deleted":
            already_deleted_count += 1
            continue
        assert user is not None
        tombstone_member_from_durable_deletion_evidence(
            session,
            user_id=user.id,
            deleted_at=entry.deleted_at,
        )
        replayed_entries.append(entry)
        replayed_count += 1

    if replayed_entries:
        replayed_user_ids = tuple(entry.user_id for entry in replayed_entries)
        refreshed_by_id = {
            user.id: user
            for user in session.scalars(select(User).where(User.id.in_(replayed_user_ids)))
        }
        if len(refreshed_by_id) != len(replayed_entries):
            raise _fail()
        _verify_deleted_members(
            session,
            [(refreshed_by_id[entry.user_id], entry.deleted_at) for entry in replayed_entries],
        )

    return DeletionReplayResult(
        absent_count=absent_count,
        already_deleted_count=already_deleted_count,
        replayed_count=replayed_count,
    )
