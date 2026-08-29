import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import cast

from app.db.session import SessionLocal
from app.recovery.account_deletions import (
    LEDGER_VERSION,
    export_deletion_ledger,
    format_utc_timestamp,
    parse_utc_timestamp,
    prepare_deletion_replay,
    replay_deletion_ledger,
)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Export or replay private account-deletion recovery evidence."
    )
    commands = parser.add_subparsers(dest="command", required=True)
    export = commands.add_parser("export", help="Exclusively export current deletion evidence.")
    export.add_argument("--output", required=True, type=Path)
    replay = commands.add_parser("replay", help="Replay validated evidence into an isolated DB.")
    replay.add_argument("--ledger", required=True, type=Path)
    replay.add_argument("--expected-sha256", required=True)
    replay.add_argument("--required-covered-through", required=True)
    replay.add_argument("--expected-database-name", required=True)
    replay.add_argument(
        "--confirm-isolated-restore",
        action="store_true",
        help="Confirm that the named database is an isolated restored copy with no traffic.",
    )
    return parser


def _print_safe(value: dict[str, object]) -> None:
    print(json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True))


def main(argv: Sequence[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    command = cast(str, arguments.command)
    try:
        if command == "export":
            with SessionLocal.begin() as session:
                export_result = export_deletion_ledger(session, cast(Path, arguments.output))
            _print_safe(
                {
                    "covered_through": format_utc_timestamp(export_result.covered_through),
                    "deletion_count": export_result.deletion_count,
                    "ledger_sha256": export_result.sha256,
                    "version": LEDGER_VERSION,
                }
            )
            return 0

        if not cast(bool, arguments.confirm_isolated_restore):
            raise ValueError("Isolated restore confirmation is required.")
        required = parse_utc_timestamp(cast(str, arguments.required_covered_through))
        prepared = prepare_deletion_replay(
            cast(Path, arguments.ledger),
            expected_sha256=cast(str, arguments.expected_sha256),
            required_covered_through=required,
        )
        with SessionLocal.begin() as session:
            replay_result = replay_deletion_ledger(
                session,
                prepared,
                expected_database_name=cast(str, arguments.expected_database_name),
            )
        _print_safe(
            {
                "absent_count": replay_result.absent_count,
                "already_deleted_count": replay_result.already_deleted_count,
                "covered_through": format_utc_timestamp(prepared.ledger.covered_through),
                "ledger_sha256": prepared.sha256,
                "replayed_count": replay_result.replayed_count,
                "version": LEDGER_VERSION,
            }
        )
        return 0
    # This is a private recovery boundary: never print a provider, database, path, or
    # account-specific exception. Operators get one stable failure and diagnose it only in the
    # isolated recovery environment.
    except Exception:  # noqa: BLE001
        print("Account-deletion recovery failed.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
