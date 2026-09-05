import hashlib
import json
import os
import threading
from contextlib import nullcontext
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from uuid import UUID

import pytest
from sqlalchemy import Engine, delete, func, select
from sqlalchemy.orm import Session

import app.recovery.__main__ as recovery_cli
from app.models import (
    ACCOUNT_KIND_SYSTEM,
    USER_STATUS_ACTIVE,
    USER_STATUS_DELETED,
    USER_STATUS_SUSPENDED,
    RecipeDraft,
    RecipeLineage,
    RecipeVersion,
    User,
)
from app.recovery import account_deletions as recovery
from app.recovery.account_deletions import (
    DeletionLedger,
    DeletionLedgerEntry,
    DeletionLedgerError,
    DeletionLedgerExport,
    DeletionReplayResult,
    PreparedDeletionReplay,
    export_deletion_ledger,
    format_utc_timestamp,
    parse_deletion_ledger,
    prepare_deletion_replay,
    render_deletion_ledger,
    replay_deletion_ledger,
)
from app.repositories.account_lifecycle import lock_account_deletion_ledger_writer
from app.services.account_lifecycle import tombstone_member_from_durable_deletion_evidence

COVERED_THROUGH = datetime(2026, 8, 29, 18, 0, 0, 123456, tzinfo=UTC)
DELETED_AT = COVERED_THROUGH - timedelta(days=1, minutes=5)
ACTIVE_USER_ID = UUID("10000000-0000-4000-8000-000000000001")
DELETED_USER_ID = UUID("20000000-0000-4000-8000-000000000002")
ABSENT_USER_ID = UUID("30000000-0000-4000-8000-000000000003")
INVALID_USER_ID = UUID("40000000-0000-4000-8000-000000000004")


def _entry(user_id: UUID, deleted_at: datetime = DELETED_AT) -> DeletionLedgerEntry:
    return DeletionLedgerEntry(user_id=user_id, deleted_at=deleted_at)


def _ledger(*entries: DeletionLedgerEntry) -> DeletionLedger:
    return DeletionLedger(covered_through=COVERED_THROUGH, deletions=tuple(entries))


def _prepared(tmp_path: Path, *entries: DeletionLedgerEntry) -> PreparedDeletionReplay:
    ledger = _ledger(*entries)
    data = render_deletion_ledger(ledger)
    path = tmp_path / f"validated-ledger-{len(tuple(tmp_path.iterdir()))}.json"
    path.write_bytes(data)
    path.chmod(0o600)
    return prepare_deletion_replay(
        path,
        expected_sha256=hashlib.sha256(data).hexdigest(),
        required_covered_through=COVERED_THROUGH,
    )


def _canonical_raw(value: object) -> bytes:
    return (
        json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True) + "\n"
    ).encode("ascii")


def _raw_ledger(*entries: dict[str, object], **overrides: object) -> bytes:
    value: dict[str, object] = {
        "covered_through": format_utc_timestamp(COVERED_THROUGH),
        "deletions": list(entries),
        "version": 1,
    }
    value.update(overrides)
    return _canonical_raw(value)


def _raw_entry(
    user_id: UUID = ACTIVE_USER_ID, deleted_at: datetime = DELETED_AT
) -> dict[str, object]:
    return {
        "deleted_at": format_utc_timestamp(deleted_at),
        "user_id": str(user_id),
    }


def _active_user(user_id: UUID, *, status: str = USER_STATUS_ACTIVE) -> User:
    return User(
        id=user_id,
        email=f"{user_id}@recovery.example.test",
        handle=f"r{user_id.hex[-10:]}",
        display_name="Recovery member",
        status=status,
    )


def _database_name(session: Session) -> str:
    value = session.scalar(select(func.current_database()))
    assert isinstance(value, str)
    return value


def _deleted_user(user_id: UUID, deleted_at: datetime = DELETED_AT) -> User:
    return User(
        id=user_id,
        email=None,
        handle=None,
        display_name="Deleted cook",
        status=USER_STATUS_DELETED,
        deleted_at=deleted_at,
    )


def test_canonical_ledger_has_stable_shape_round_trip_and_digest() -> None:
    ledger = _ledger(_entry(ACTIVE_USER_ID), _entry(DELETED_USER_ID))

    rendered = render_deletion_ledger(ledger)

    assert rendered == (
        b'{"covered_through":"2026-08-29T18:00:00.123456Z","deletions":'
        b'[{"deleted_at":"2026-08-28T17:55:00.123456Z",'
        b'"user_id":"10000000-0000-4000-8000-000000000001"},'
        b'{"deleted_at":"2026-08-28T17:55:00.123456Z",'
        b'"user_id":"20000000-0000-4000-8000-000000000002"}],"version":1}\n'
    )
    assert hashlib.sha256(rendered).hexdigest() == (
        "9b70b52a4a6118793e0cb2b9bfd91a6a721672490e5db119a6930adc359b7255"
    )
    assert parse_deletion_ledger(rendered) == ledger


@pytest.mark.parametrize(
    "payload",
    [
        b"",
        b"not-json\n",
        b"{}\n",
        b'{"covered_through":"2026-08-29T18:00:00.123456Z",'
        b'"covered_through":"2026-08-29T18:00:00.123456Z","deletions":[],"version":1}\n',
        _raw_ledger(extra=True),
        _raw_ledger(version=True),
        _raw_ledger(version=2),
        _raw_ledger(covered_through="2026-08-29T18:00:00Z"),
        _raw_ledger(covered_through="2026-08-29T18:00:00.123456+00:00"),
        _raw_ledger(_raw_entry() | {"extra": True}),
        _raw_ledger(_raw_entry() | {"user_id": "not-a-uuid"}),
        _raw_ledger(_raw_entry() | {"user_id": "a0000000-0000-4000-8000-000000000001".upper()}),
        _raw_ledger(_raw_entry(deleted_at=COVERED_THROUGH + timedelta(microseconds=1))),
        _raw_ledger(_raw_entry(), _raw_entry()),
        _raw_ledger(_raw_entry(DELETED_USER_ID), _raw_entry(ACTIVE_USER_ID)),
        _raw_ledger(_raw_entry())[:-1],
        b' {"covered_through":"2026-08-29T18:00:00.123456Z","deletions":[],"version":1}\n',
        b'{"covered_through":"2026-08-29T18:00:00.123456Z","deletions":[],"version":NaN}\n',
    ],
)
def test_parser_rejects_noncanonical_or_invalid_ledgers(payload: bytes) -> None:
    with pytest.raises(DeletionLedgerError, match="Account-deletion recovery failed"):
        parse_deletion_ledger(payload)


def test_parser_enforces_byte_and_entry_bounds(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(DeletionLedgerError):
        parse_deletion_ledger(b"x" * (recovery.MAX_LEDGER_BYTES + 1))

    monkeypatch.setattr(recovery, "MAX_LEDGER_ENTRIES", 1)
    assert parse_deletion_ledger(_raw_ledger(_raw_entry())).deletions
    with pytest.raises(DeletionLedgerError):
        parse_deletion_ledger(_raw_ledger(_raw_entry(), _raw_entry(DELETED_USER_ID)))


def test_parser_normalizes_a_json_nesting_bomb_to_the_generic_error() -> None:
    payload = (b"[" * 5_000) + (b"]" * 5_000)

    with pytest.raises(DeletionLedgerError, match="Account-deletion recovery failed"):
        parse_deletion_ledger(payload)


def test_prepare_replay_requires_independent_hash_cutoff_and_readable_file(tmp_path: Path) -> None:
    private_marker = "private-member-ledger-marker"
    path = tmp_path / private_marker
    data = render_deletion_ledger(_ledger(_entry(ACTIVE_USER_ID)))
    path.write_bytes(data)
    path.chmod(0o600)
    digest = hashlib.sha256(data).hexdigest()

    prepared = prepare_deletion_replay(
        path,
        expected_sha256=digest,
        required_covered_through=COVERED_THROUGH,
    )
    assert prepared.sha256 == digest
    assert str(ACTIVE_USER_ID) not in repr(prepared)

    invalid_requests = (
        (tmp_path / "missing-private-ledger", digest, COVERED_THROUGH),
        (path, "f" * 64, COVERED_THROUGH),
        (path, digest.upper(), COVERED_THROUGH),
        (path, digest, COVERED_THROUGH + timedelta(microseconds=1)),
    )
    for invalid_path, invalid_digest, invalid_cutoff in invalid_requests:
        with pytest.raises(DeletionLedgerError) as error:
            prepare_deletion_replay(
                invalid_path,
                expected_sha256=invalid_digest,
                required_covered_through=invalid_cutoff,
            )
        assert private_marker not in str(error.value)

    oversized = tmp_path / "oversized"
    oversized.write_bytes(b"x" * (recovery.MAX_LEDGER_BYTES + 1))
    with pytest.raises(DeletionLedgerError):
        prepare_deletion_replay(
            oversized,
            expected_sha256="0" * 64,
            required_covered_through=COVERED_THROUGH,
        )


def test_prepare_replay_normalizes_an_unreadable_file(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = tmp_path / "private-ledger"
    path.write_bytes(render_deletion_ledger(_ledger()))

    def deny_ledger(_target: Path, _flags: int, _mode: int = 0o777) -> int:
        raise PermissionError("private operating-system detail")

    monkeypatch.setattr(os, "open", deny_ledger)

    with pytest.raises(DeletionLedgerError) as error:
        prepare_deletion_replay(
            path,
            expected_sha256="0" * 64,
            required_covered_through=COVERED_THROUGH,
        )
    assert "private operating-system detail" not in str(error.value)


@pytest.mark.skipif(os.name != "posix", reason="POSIX file modes are required")
def test_prepare_replay_rejects_group_or_world_readable_evidence(tmp_path: Path) -> None:
    path = tmp_path / "private-ledger"
    data = render_deletion_ledger(_ledger())
    path.write_bytes(data)
    path.chmod(0o640)

    with pytest.raises(DeletionLedgerError):
        prepare_deletion_replay(
            path,
            expected_sha256=hashlib.sha256(data).hexdigest(),
            required_covered_through=COVERED_THROUGH,
        )

    path.chmod(0o600)
    assert (
        prepare_deletion_replay(
            path,
            expected_sha256=hashlib.sha256(data).hexdigest(),
            required_covered_through=COVERED_THROUGH,
        ).ledger
        == _ledger()
    )


def test_export_is_exclusive_private_canonical_and_count_only(
    db_session: Session,
    tmp_path: Path,
) -> None:
    db_session.add(_deleted_user(DELETED_USER_ID))
    db_session.flush()
    path = tmp_path / "deletions.json"

    exported = export_deletion_ledger(db_session, path)

    assert exported.deletion_count == 1
    data = path.read_bytes()
    assert exported.sha256 == hashlib.sha256(data).hexdigest()
    parsed = parse_deletion_ledger(data)
    assert parsed.deletions == (_entry(DELETED_USER_ID),)
    assert parsed.covered_through == exported.covered_through
    if os.name != "nt":
        assert path.stat().st_mode & 0o777 == 0o600

    with pytest.raises(DeletionLedgerError):
        export_deletion_ledger(db_session, path)
    assert path.read_bytes() == data


def test_export_waits_for_an_inflight_deletion_and_includes_it(
    migrated_engine: Engine,
    tmp_path: Path,
) -> None:
    user_id = UUID("50000000-0000-4000-8000-000000000005")
    with Session(migrated_engine) as setup, setup.begin():
        setup.execute(delete(User).where(User.id == user_id))
        setup.add(_active_user(user_id))

    writer_locked = threading.Event()
    allow_writer_commit = threading.Event()
    exporter_started = threading.Event()
    exporter_finished = threading.Event()
    failures: list[BaseException] = []
    destination = tmp_path / "concurrent-deletions.json"

    def delete_member() -> None:
        try:
            with Session(migrated_engine) as session, session.begin():
                lock_account_deletion_ledger_writer(session)
                tombstone_member_from_durable_deletion_evidence(
                    session,
                    user_id=user_id,
                    deleted_at=DELETED_AT,
                )
                writer_locked.set()
                if not allow_writer_commit.wait(timeout=10):
                    raise AssertionError("The deletion test writer was not released.")
        except BaseException as error:  # pragma: no cover - relayed to the test thread
            failures.append(error)
            writer_locked.set()

    def export_ledger() -> None:
        try:
            with Session(migrated_engine) as session, session.begin():
                exporter_started.set()
                export_deletion_ledger(session, destination)
        except BaseException as error:  # pragma: no cover - relayed to the test thread
            failures.append(error)
        finally:
            exporter_finished.set()

    writer = threading.Thread(target=delete_member, daemon=True)
    exporter = threading.Thread(target=export_ledger, daemon=True)
    writer.start()
    blocked_while_deletion_was_open = False
    try:
        assert writer_locked.wait(timeout=10)
        exporter.start()
        assert exporter_started.wait(timeout=10)
        blocked_while_deletion_was_open = not exporter_finished.wait(timeout=0.5)
    finally:
        allow_writer_commit.set()
    writer.join(timeout=10)
    exporter.join(timeout=10)

    try:
        assert not writer.is_alive()
        assert not exporter.is_alive()
        assert failures == []
        assert blocked_while_deletion_was_open
        ledger = parse_deletion_ledger(destination.read_bytes())
        assert _entry(user_id) in ledger.deletions
    finally:
        with Session(migrated_engine) as cleanup, cleanup.begin():
            cleanup.execute(delete(User).where(User.id == user_id))


def test_export_fails_closed_at_the_entry_cap_without_creating_a_ledger(
    db_session: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db_session.add(_deleted_user(DELETED_USER_ID))
    db_session.flush()
    path = tmp_path / "must-not-exist.json"
    monkeypatch.setattr(recovery, "MAX_LEDGER_ENTRIES", 0)

    with pytest.raises(DeletionLedgerError):
        export_deletion_ledger(db_session, path)
    assert not path.exists()


def test_export_rejects_a_tombstone_beyond_its_database_coverage_time(
    db_session: Session,
    tmp_path: Path,
) -> None:
    db_session.add(
        _deleted_user(
            DELETED_USER_ID,
            deleted_at=datetime(2099, 1, 1, tzinfo=UTC),
        )
    )
    db_session.flush()
    path = tmp_path / "must-not-exist.json"

    with pytest.raises(DeletionLedgerError):
        export_deletion_ledger(db_session, path)

    assert not path.exists()


def test_tombstone_privacy_verification_scans_tables_once_for_the_whole_batch(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scans = 0

    def no_private_rows(_session: Session, _criterion: object) -> bool:
        nonlocal scans
        scans += 1
        return False

    monkeypatch.setattr(recovery, "_has_rows", no_private_rows)
    first = _deleted_user(ACTIVE_USER_ID)
    second = _deleted_user(DELETED_USER_ID)
    db_session.add_all([first, second])
    db_session.flush()

    recovery._verify_deleted_members(db_session, [(first, DELETED_AT)])
    one_member_scans = scans
    scans = 0
    recovery._verify_deleted_members(
        db_session,
        [(first, DELETED_AT), (second, DELETED_AT)],
    )

    assert scans == one_member_scans
    assert scans > 0


def test_tombstone_privacy_verification_rejects_a_retained_profile_description() -> None:
    tombstone = _deleted_user(DELETED_USER_ID)
    tombstone.profile_description = "Private profile prose must not survive deletion."

    with Session() as session, pytest.raises(DeletionLedgerError):
        recovery._verify_deleted_members(session, [(tombstone, DELETED_AT)])


def test_exclusive_writer_removes_temporary_file_when_publication_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = tmp_path / "deletions.json"

    def fail_publication(_source: object, _destination: object) -> None:
        raise OSError("simulated publication failure")

    monkeypatch.setattr(os, "link", fail_publication)

    with pytest.raises(DeletionLedgerError):
        recovery._write_private_ledger_exclusive(path, render_deletion_ledger(_ledger()))
    assert not path.exists()
    assert list(tmp_path.iterdir()) == []


def test_replay_handles_deletable_deleted_and_absent_members_without_losing_public_topology(
    db_session: Session,
    tmp_path: Path,
) -> None:
    active = _active_user(ACTIVE_USER_ID)
    suspended = _active_user(INVALID_USER_ID, status=USER_STATUS_SUSPENDED)
    active.profile_description = "Private profile prose that replay must erase."
    suspended.profile_description = "Suspended profile prose that replay must erase."
    deleted = _deleted_user(DELETED_USER_ID)
    db_session.add_all([active, suspended, deleted])
    db_session.flush()
    lineage = RecipeLineage(created_by_user_id=ACTIVE_USER_ID)
    active_draft = RecipeDraft(
        author_user_id=ACTIVE_USER_ID,
        title="Private restored draft",
        description="Must disappear during replay.",
    )
    db_session.add_all([lineage, active_draft])
    db_session.flush()
    version = RecipeVersion(
        lineage_id=lineage.id,
        parent_version_id=None,
        created_by_user_id=ACTIVE_USER_ID,
        version_number=1,
        title="Public recovery recipe",
        description="Public topology remains.",
        servings=Decimal("2.00"),
    )
    db_session.add(version)
    db_session.flush()
    draft_id = active_draft.id
    version_id = version.id

    result = replay_deletion_ledger(
        db_session,
        _prepared(
            tmp_path,
            _entry(ACTIVE_USER_ID),
            _entry(DELETED_USER_ID),
            _entry(ABSENT_USER_ID),
            _entry(INVALID_USER_ID),
        ),
        expected_database_name=_database_name(db_session),
    )
    db_session.expire_all()

    assert result.absent_count == 1
    assert result.already_deleted_count == 1
    assert result.replayed_count == 2
    tombstone = db_session.get(User, ACTIVE_USER_ID)
    assert tombstone is not None
    assert tombstone.status == USER_STATUS_DELETED
    assert tombstone.deleted_at == DELETED_AT
    assert tombstone.email is None
    assert tombstone.handle is None
    assert tombstone.display_name == "Deleted cook"
    assert tombstone.profile_description is None
    suspended_tombstone = db_session.get(User, INVALID_USER_ID)
    assert suspended_tombstone is not None
    assert suspended_tombstone.status == USER_STATUS_DELETED
    assert suspended_tombstone.deleted_at == DELETED_AT
    assert suspended_tombstone.profile_description is None
    assert db_session.get(RecipeDraft, draft_id) is None
    retained = db_session.get(RecipeVersion, version_id)
    assert retained is not None
    assert retained.created_by_user_id == ACTIVE_USER_ID
    assert retained.title == "Public recovery recipe"


def test_replay_preflights_every_entry_before_mutation_and_fails_all(
    db_session: Session,
    tmp_path: Path,
) -> None:
    first = _active_user(ACTIVE_USER_ID)
    invalid = _active_user(INVALID_USER_ID)
    invalid.account_kind = ACCOUNT_KIND_SYSTEM
    first_draft = RecipeDraft(author_user_id=ACTIVE_USER_ID, title="Must survive failed replay")
    db_session.add_all([first, invalid, first_draft])
    db_session.flush()
    draft_id = first_draft.id

    with pytest.raises(DeletionLedgerError):
        replay_deletion_ledger(
            db_session,
            _prepared(tmp_path, _entry(ACTIVE_USER_ID), _entry(INVALID_USER_ID)),
            expected_database_name=_database_name(db_session),
        )

    db_session.expire_all()
    unchanged = db_session.get(User, ACTIVE_USER_ID)
    assert unchanged is not None
    assert unchanged.status == USER_STATUS_ACTIVE
    assert unchanged.email is not None
    assert db_session.get(RecipeDraft, draft_id) is not None


def test_already_deleted_member_with_wrong_timestamp_or_private_residue_fails_without_rewrite(
    db_session: Session,
    tmp_path: Path,
) -> None:
    first = _active_user(ACTIVE_USER_ID)
    deleted = _deleted_user(DELETED_USER_ID)
    residual = RecipeDraft(author_user_id=DELETED_USER_ID, title="Resurrected private residue")
    db_session.add_all([first, deleted, residual])
    db_session.flush()

    with pytest.raises(DeletionLedgerError):
        replay_deletion_ledger(
            db_session,
            _prepared(tmp_path, _entry(ACTIVE_USER_ID), _entry(DELETED_USER_ID)),
            expected_database_name=_database_name(db_session),
        )
    assert db_session.get(User, ACTIVE_USER_ID).status == USER_STATUS_ACTIVE  # type: ignore[union-attr]
    assert db_session.get(RecipeDraft, residual.id) is not None

    db_session.delete(residual)
    db_session.flush()
    with pytest.raises(DeletionLedgerError):
        replay_deletion_ledger(
            db_session,
            _prepared(
                tmp_path,
                _entry(ACTIVE_USER_ID),
                _entry(DELETED_USER_ID, DELETED_AT - timedelta(seconds=1)),
            ),
            expected_database_name=_database_name(db_session),
        )
    assert db_session.get(User, ACTIVE_USER_ID).status == USER_STATUS_ACTIVE  # type: ignore[union-attr]


def test_cli_failure_is_generic_and_does_not_echo_private_path(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    private_marker = "private-user-ledger-name"

    result = recovery_cli.main(
        [
            "replay",
            "--ledger",
            str(tmp_path / private_marker),
            "--expected-sha256",
            "0" * 64,
            "--required-covered-through",
            format_utc_timestamp(COVERED_THROUGH),
            "--expected-database-name",
            "recipe_lab_restore",
            "--confirm-isolated-restore",
        ]
    )

    captured = capsys.readouterr()
    assert result == 1
    assert captured.out == ""
    assert captured.err == "Account-deletion recovery failed.\n"
    assert private_marker not in captured.err


def test_cli_requires_explicit_isolated_restore_confirmation(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    path = tmp_path / "private-ledger"
    data = render_deletion_ledger(_ledger())
    path.write_bytes(data)
    path.chmod(0o600)

    result = recovery_cli.main(
        [
            "replay",
            "--ledger",
            str(path),
            "--expected-sha256",
            hashlib.sha256(data).hexdigest(),
            "--required-covered-through",
            format_utc_timestamp(COVERED_THROUGH),
            "--expected-database-name",
            "recipe_lab_restore",
        ]
    )

    captured = capsys.readouterr()
    assert result == 1
    assert captured.out == ""
    assert captured.err == "Account-deletion recovery failed.\n"


def test_cli_success_output_is_exact_safe_json_for_export_and_replay(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeSessionLocal:
        @staticmethod
        def begin() -> nullcontext[object]:
            return nullcontext(object())

    private_marker = "private-ledger-path-marker"
    email_marker = "private@example.test"
    export_digest = "a" * 64

    def safe_export(_session: object, _path: Path) -> DeletionLedgerExport:
        return DeletionLedgerExport(
            covered_through=COVERED_THROUGH,
            deletion_count=2,
            sha256=export_digest,
        )

    monkeypatch.setattr(recovery_cli, "SessionLocal", FakeSessionLocal)
    monkeypatch.setattr(recovery_cli, "export_deletion_ledger", safe_export)
    export_result = recovery_cli.main(["export", "--output", str(tmp_path / private_marker)])
    export_output = capsys.readouterr()

    assert export_result == 0
    assert export_output.err == ""
    assert export_output.out == (
        '{"covered_through":"2026-08-29T18:00:00.123456Z","deletion_count":2,'
        f'"ledger_sha256":"{export_digest}","version":1}}\n'
    )

    ledger_path = tmp_path / private_marker
    ledger_data = render_deletion_ledger(_ledger(_entry(ACTIVE_USER_ID)))
    ledger_path.write_bytes(ledger_data)
    ledger_path.chmod(0o600)
    replay_digest = hashlib.sha256(ledger_data).hexdigest()

    def safe_replay(
        _session: object,
        _prepared: PreparedDeletionReplay,
        *,
        expected_database_name: str,
    ) -> DeletionReplayResult:
        assert expected_database_name == "recipe_lab_restore"
        return DeletionReplayResult(
            absent_count=1,
            already_deleted_count=2,
            replayed_count=3,
        )

    monkeypatch.setattr(recovery_cli, "replay_deletion_ledger", safe_replay)
    replay_result = recovery_cli.main(
        [
            "replay",
            "--ledger",
            str(ledger_path),
            "--expected-sha256",
            replay_digest,
            "--required-covered-through",
            format_utc_timestamp(COVERED_THROUGH),
            "--expected-database-name",
            "recipe_lab_restore",
            "--confirm-isolated-restore",
        ]
    )
    replay_output = capsys.readouterr()

    assert replay_result == 0
    assert replay_output.err == ""
    assert replay_output.out == (
        '{"absent_count":1,"already_deleted_count":2,'
        '"covered_through":"2026-08-29T18:00:00.123456Z",'
        f'"ledger_sha256":"{replay_digest}","replayed_count":3,"version":1}}\n'
    )
    for safe_output in (export_output.out, replay_output.out):
        assert private_marker not in safe_output
        assert email_marker not in safe_output
        assert str(ACTIVE_USER_ID) not in safe_output


def test_replay_result_contains_counts_only(db_session: Session, tmp_path: Path) -> None:
    db_session.add(_active_user(ACTIVE_USER_ID))
    db_session.flush()

    result = replay_deletion_ledger(
        db_session,
        _prepared(tmp_path, _entry(ACTIVE_USER_ID)),
        expected_database_name=_database_name(db_session),
    )

    assert result.replayed_count == 1
    serialized = json.dumps(result.__dict__, sort_keys=True)
    assert str(ACTIVE_USER_ID) not in serialized
    assert "@" not in serialized
    assert db_session.scalar(select(User.status).where(User.id == ACTIVE_USER_ID)) == "deleted"


def test_replay_refuses_an_unexpected_database_before_mutation(
    db_session: Session,
    tmp_path: Path,
) -> None:
    db_session.add(_active_user(ACTIVE_USER_ID))
    db_session.flush()

    with pytest.raises(DeletionLedgerError):
        replay_deletion_ledger(
            db_session,
            _prepared(tmp_path, _entry(ACTIVE_USER_ID)),
            expected_database_name="definitely_not_the_current_database",
        )

    db_session.expire_all()
    user = db_session.get(User, ACTIVE_USER_ID)
    assert user is not None
    assert user.status == USER_STATUS_ACTIVE
    assert user.email is not None


def test_replay_rejects_a_constructed_unvalidated_payload_before_database_work(
    db_session: Session,
) -> None:
    ledger = _ledger(_entry(ACTIVE_USER_ID))
    unvalidated = PreparedDeletionReplay(
        ledger=ledger,
        sha256=hashlib.sha256(render_deletion_ledger(ledger)).hexdigest(),
        _validation_token=object(),
    )

    with pytest.raises(DeletionLedgerError):
        replay_deletion_ledger(
            db_session,
            unvalidated,
            expected_database_name=_database_name(db_session),
        )
