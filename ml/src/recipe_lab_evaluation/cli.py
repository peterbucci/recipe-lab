from __future__ import annotations

import argparse
import os
import sys
import tempfile
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy.exc import SQLAlchemyError

from .dataset import SnapshotValidationError, load_snapshot, snapshot_to_json
from .models import ContentBasedV1Model
from .readiness import assess_readiness, readiness_report_to_json
from .report import report_to_json
from .runner import DEFAULT_KS, DEFAULT_SEED, EvaluationConfig, EvaluationError, evaluate
from .simulator import (
    CohortSimulationConfig,
    CohortSimulationError,
    simulate_preference_cohort,
)
from .sources import SnapshotExportError, export_postgres_snapshot

STRICT_INSUFFICIENT_DATA_EXIT_CODE = 3
DEFAULT_SIMULATION_SEED = 20260822
DEFAULT_SIMULATION_PROFILES = 64


def _non_blank(value: str) -> str:
    if not value.strip():
        raise argparse.ArgumentTypeError("value must not be blank")
    return value


def _utc_timestamp(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise argparse.ArgumentTypeError(
            "must be an ISO-8601 timestamp with an explicit UTC offset"
        ) from error
    if parsed.tzinfo is None or parsed.utcoffset() != timedelta(0):
        raise argparse.ArgumentTypeError("must include an explicit UTC offset")
    return parsed.astimezone(UTC)


def _non_negative_integer(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("must be a non-negative integer") from error
    if parsed < 0:
        raise argparse.ArgumentTypeError("must be a non-negative integer")
    return parsed


def _positive_integer(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("must be a positive integer") from error
    if parsed < 1:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return parsed


def _k_cutoff(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("must be an integer between 1 and 50") from error
    if not 1 <= parsed <= 50:
        raise argparse.ArgumentTypeError("must be an integer between 1 and 50")
    return parsed


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="recipe-lab-eval",
        description="Build snapshots and run deterministic offline recommendation evaluation.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    snapshot = subparsers.add_parser(
        "snapshot",
        help="export the evaluation dataset from PostgreSQL",
    )
    snapshot.add_argument("--database-url", required=True, type=_non_blank)
    snapshot.add_argument("--dataset-id", required=True, type=_non_blank)
    snapshot.add_argument("--cutoff", required=True, type=_utc_timestamp)
    snapshot.add_argument(
        "--limitation",
        required=True,
        action="append",
        type=_non_blank,
        help="known dataset limitation; repeat for additional limitations",
    )
    snapshot.add_argument("--output", required=True, type=Path)

    simulate = subparsers.add_parser(
        "simulate",
        help="generate a deterministic synthetic preference cohort from a catalog snapshot",
    )
    simulate.add_argument("--catalog", required=True, type=Path)
    simulate.add_argument(
        "--profiles",
        type=_positive_integer,
        default=DEFAULT_SIMULATION_PROFILES,
        help=f"opaque synthetic profile count (default: {DEFAULT_SIMULATION_PROFILES})",
    )
    simulate.add_argument(
        "--seed",
        type=_non_negative_integer,
        default=DEFAULT_SIMULATION_SEED,
        help=f"deterministic cohort seed (default: {DEFAULT_SIMULATION_SEED})",
    )
    simulate.add_argument("--output", required=True, type=Path)

    readiness = subparsers.add_parser(
        "readiness",
        help="assess structural and temporal collaborative-filtering data readiness",
    )
    readiness.add_argument("--snapshot", required=True, type=Path)
    readiness.add_argument("--output", type=Path, help="write the report here instead of stdout")
    readiness.add_argument(
        "--strict",
        action="store_true",
        help="return a nonzero status when the dataset is insufficient",
    )

    run = subparsers.add_parser(
        "run",
        help="compare content-v1 with baseline-v1 against a saved snapshot",
    )
    run.add_argument("--snapshot", required=True, type=Path)
    run.add_argument(
        "--k",
        action="append",
        type=_k_cutoff,
        help="ranking cutoff; repeat as needed (defaults: 5 and 10)",
    )
    run.add_argument("--seed", type=_non_negative_integer, default=DEFAULT_SEED)
    run.add_argument("--output", type=Path, help="write the report here instead of stdout")
    run.add_argument(
        "--strict",
        action="store_true",
        help="return a nonzero status when the dataset is insufficient",
    )
    return parser


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary_path, path)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise


def _same_path(first: Path, second: Path) -> bool:
    return first.resolve(strict=False) == second.resolve(strict=False)


def _snapshot_command(arguments: argparse.Namespace) -> int:
    try:
        snapshot = export_postgres_snapshot(
            database_url=arguments.database_url,
            dataset_id=arguments.dataset_id,
            cutoff=arguments.cutoff,
            limitations=tuple(arguments.limitation),
        )
        _atomic_write(arguments.output, snapshot_to_json(snapshot))
    except SnapshotExportError as error:
        print(f"error: snapshot export failed: {error}", file=sys.stderr)
        return 1
    except (SQLAlchemyError, SnapshotValidationError):
        print(
            "error: snapshot export failed; verify the PostgreSQL connection and schema",
            file=sys.stderr,
        )
        return 1
    except OSError:
        print("error: could not write the snapshot output", file=sys.stderr)
        return 1
    return 0


def _run_command(arguments: argparse.Namespace) -> int:
    try:
        snapshot = load_snapshot(arguments.snapshot)
        requested_ks = DEFAULT_KS if arguments.k is None else tuple(sorted(set(arguments.k)))
        report = evaluate(
            snapshot,
            models=(ContentBasedV1Model(),),
            config=EvaluationConfig(seed=arguments.seed, ks=requested_ks),
        )
        report_json = report_to_json(report)
        if arguments.output is None:
            sys.stdout.write(report_json)
        else:
            _atomic_write(arguments.output, report_json)
    except SnapshotValidationError as error:
        print(f"error: invalid evaluation snapshot: {error}", file=sys.stderr)
        return 2
    except EvaluationError as error:
        print(f"error: evaluation configuration is invalid: {error}", file=sys.stderr)
        return 2
    except ValueError as error:
        print(f"error: evaluation configuration is invalid: {error}", file=sys.stderr)
        return 2
    except OSError:
        print("error: could not read the snapshot or write the report", file=sys.stderr)
        return 1

    if arguments.strict and report.status == "insufficient_data":
        return STRICT_INSUFFICIENT_DATA_EXIT_CODE
    return 0


def _simulate_command(arguments: argparse.Namespace) -> int:
    if _same_path(arguments.catalog, arguments.output):
        print("error: simulated output must not overwrite the catalog snapshot", file=sys.stderr)
        return 2
    try:
        catalog = load_snapshot(arguments.catalog)
        simulated = simulate_preference_cohort(
            catalog,
            CohortSimulationConfig(
                seed=arguments.seed,
                profile_count=arguments.profiles,
            ),
        )
        _atomic_write(arguments.output, snapshot_to_json(simulated))
    except SnapshotValidationError as error:
        print(f"error: invalid catalog snapshot: {error}", file=sys.stderr)
        return 2
    except CohortSimulationError as error:
        print(f"error: cohort simulation is invalid: {error}", file=sys.stderr)
        return 2
    except OSError:
        print("error: could not read the catalog or write the simulated snapshot", file=sys.stderr)
        return 1
    return 0


def _readiness_command(arguments: argparse.Namespace) -> int:
    if arguments.output is not None and _same_path(arguments.snapshot, arguments.output):
        print("error: readiness output must not overwrite the evaluation snapshot", file=sys.stderr)
        return 2
    try:
        snapshot = load_snapshot(arguments.snapshot)
        report = assess_readiness(snapshot)
        report_json = readiness_report_to_json(report)
        if arguments.output is None:
            sys.stdout.write(report_json)
        else:
            _atomic_write(arguments.output, report_json)
    except SnapshotValidationError as error:
        print(f"error: invalid evaluation snapshot: {error}", file=sys.stderr)
        return 2
    except ValueError as error:
        print(f"error: readiness configuration is invalid: {error}", file=sys.stderr)
        return 2
    except OSError:
        print("error: could not read the snapshot or write the readiness report", file=sys.stderr)
        return 1

    if arguments.strict and report.status == "insufficient_data":
        return STRICT_INSUFFICIENT_DATA_EXIT_CODE
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    """Run the command-line interface and return a process exit code."""

    arguments = _parser().parse_args(argv)
    if arguments.command == "snapshot":
        return _snapshot_command(arguments)
    if arguments.command == "simulate":
        return _simulate_command(arguments)
    if arguments.command == "readiness":
        return _readiness_command(arguments)
    if arguments.command == "run":
        return _run_command(arguments)
    raise AssertionError(f"unhandled command: {arguments.command}")
