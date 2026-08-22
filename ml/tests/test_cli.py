import json
import os
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy.exc import SQLAlchemyError

from recipe_lab_evaluation.cli import (
    STRICT_INSUFFICIENT_DATA_EXIT_CODE,
    main,
)
from recipe_lab_evaluation.dataset import (
    EvaluationSnapshot,
    create_snapshot,
    load_snapshot,
    snapshot_to_json,
)
from recipe_lab_evaluation.split import split_snapshot

READINESS_CATALOG = Path(__file__).parent / "fixtures" / "readiness_catalog_v1.json"


def test_run_command_writes_the_same_report_for_reordered_k_values(
    synthetic_snapshot: EvaluationSnapshot,
    tmp_path: Path,
) -> None:
    snapshot_path = tmp_path / "snapshot.json"
    first_report = tmp_path / "first.json"
    second_report = tmp_path / "second.json"
    snapshot_path.write_text(snapshot_to_json(synthetic_snapshot), encoding="utf-8")

    assert (
        main(
            [
                "run",
                "--snapshot",
                str(snapshot_path),
                "--k",
                "5",
                "--k",
                "10",
                "--seed",
                "20260821",
                "--output",
                str(first_report),
            ]
        )
        == 0
    )
    assert (
        main(
            [
                "run",
                "--snapshot",
                str(snapshot_path),
                "--k",
                "10",
                "--k",
                "5",
                "--seed",
                "20260821",
                "--output",
                str(second_report),
            ]
        )
        == 0
    )

    assert first_report.read_bytes() == second_report.read_bytes()
    report = json.loads(first_report.read_text(encoding="utf-8"))
    assert [model["model_id"] for model in report["models"]] == [
        "baseline-v1",
        "content-v1",
    ]
    content = report["models"][1]
    assert [delta["k"] for delta in content["deltas_vs_baseline"]] == [5, 10]
    assert all(delta["precision"] is not None for delta in content["deltas_vs_baseline"])


def test_run_command_is_reproducible_across_python_hash_seeds(
    synthetic_snapshot: EvaluationSnapshot,
    tmp_path: Path,
) -> None:
    snapshot_path = tmp_path / "snapshot.json"
    snapshot_path.write_text(snapshot_to_json(synthetic_snapshot), encoding="utf-8")
    ml_root = Path(__file__).parents[1]
    source_paths = (ml_root / "src", ml_root.parent / "backend")

    def run_with_hash_seed(hash_seed: str) -> str:
        environment = os.environ.copy()
        python_path = [str(path) for path in source_paths]
        if existing := environment.get("PYTHONPATH"):
            python_path.append(existing)
        environment["PYTHONPATH"] = os.pathsep.join(python_path)
        environment["PYTHONHASHSEED"] = hash_seed
        completed = subprocess.run(
            [
                sys.executable,
                "-m",
                "recipe_lab_evaluation",
                "run",
                "--snapshot",
                str(snapshot_path),
                "--k",
                "1",
                "--k",
                "3",
                "--seed",
                "20260822",
            ],
            check=True,
            capture_output=True,
            cwd=ml_root,
            env=environment,
            text=True,
        )
        return completed.stdout

    first = run_with_hash_seed("1")
    second = run_with_hash_seed("987654")

    assert first == second
    report = json.loads(first)
    assert [model["model_id"] for model in report["models"]] == [
        "baseline-v1",
        "content-v1",
    ]


def test_strict_run_writes_an_insufficient_report_then_returns_its_status(
    synthetic_snapshot: EvaluationSnapshot,
    tmp_path: Path,
) -> None:
    split = split_snapshot(synthetic_snapshot)
    insufficient = create_snapshot(
        dataset_id="insufficient-cli-fixture",
        cutoff=synthetic_snapshot.cutoff,
        limitations=synthetic_snapshot.limitations,
        recipes=synthetic_snapshot.recipes,
        events=split.training_events,
    )
    snapshot_path = tmp_path / "insufficient.json"
    report_path = tmp_path / "report.json"
    snapshot_path.write_text(snapshot_to_json(insufficient), encoding="utf-8")

    exit_code = main(
        [
            "run",
            "--snapshot",
            str(snapshot_path),
            "--output",
            str(report_path),
            "--strict",
        ]
    )

    assert exit_code == STRICT_INSUFFICIENT_DATA_EXIT_CODE
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["status"] == "insufficient_data"
    assert report["reason_codes"] == ["no_relevant_holdout_events"]

    default_report_path = tmp_path / "default-report.json"
    assert (
        main(
            [
                "run",
                "--snapshot",
                str(snapshot_path),
                "--output",
                str(default_report_path),
            ]
        )
        == 0
    )
    assert default_report_path.read_bytes() == report_path.read_bytes()


def test_simulate_and_readiness_commands_are_reproducible_and_ready(
    tmp_path: Path,
) -> None:
    first_snapshot = tmp_path / "simulated-a.json"
    second_snapshot = tmp_path / "simulated-b.json"
    different_snapshot = tmp_path / "simulated-c.json"

    for output, seed in (
        (first_snapshot, "20260822"),
        (second_snapshot, "20260822"),
        (different_snapshot, "20260823"),
    ):
        assert (
            main(
                [
                    "simulate",
                    "--catalog",
                    str(READINESS_CATALOG),
                    "--profiles",
                    "64",
                    "--seed",
                    seed,
                    "--output",
                    str(output),
                ]
            )
            == 0
        )

    assert first_snapshot.read_bytes() == second_snapshot.read_bytes()
    assert first_snapshot.read_bytes() != different_snapshot.read_bytes()
    generated = load_snapshot(first_snapshot)
    assert len({event.user_id for event in generated.events}) == 64
    assert len(generated.events) == 896

    first_report = tmp_path / "readiness-a.json"
    second_report = tmp_path / "readiness-b.json"
    for output in (first_report, second_report):
        assert (
            main(
                [
                    "readiness",
                    "--snapshot",
                    str(first_snapshot),
                    "--output",
                    str(output),
                    "--strict",
                ]
            )
            == 0
        )

    assert first_report.read_bytes() == second_report.read_bytes()
    report = json.loads(first_report.read_text(encoding="utf-8"))
    assert report["status"] == "ready"
    assert report["reason_codes"] == []
    assert report["counts"]["profiles"]["training"] == 64
    assert report["counts"]["interactions"]["training"] == 640
    assert report["counts"]["temporal_evaluation"]["profiles_with_supported_history"] == 64


def test_simulate_rejects_recorded_activity_without_overwriting_output(
    synthetic_snapshot: EvaluationSnapshot,
    tmp_path: Path,
    capsys: Any,
) -> None:
    catalog_path = tmp_path / "recorded.json"
    output_path = tmp_path / "existing.json"
    catalog_path.write_text(snapshot_to_json(synthetic_snapshot), encoding="utf-8")
    output_path.write_text("keep me", encoding="utf-8")

    exit_code = main(
        [
            "simulate",
            "--catalog",
            str(catalog_path),
            "--output",
            str(output_path),
        ]
    )

    assert exit_code == 2
    assert output_path.read_text(encoding="utf-8") == "keep me"
    assert "simulated and recorded activity cannot be mixed" in capsys.readouterr().err


def test_readiness_default_is_nonblocking_but_strict_is_actionable(
    tmp_path: Path,
) -> None:
    default_report = tmp_path / "readiness-default.json"
    strict_report = tmp_path / "readiness-strict.json"

    assert (
        main(
            [
                "readiness",
                "--snapshot",
                str(READINESS_CATALOG),
                "--output",
                str(default_report),
            ]
        )
        == 0
    )
    assert (
        main(
            [
                "readiness",
                "--snapshot",
                str(READINESS_CATALOG),
                "--output",
                str(strict_report),
                "--strict",
            ]
        )
        == STRICT_INSUFFICIENT_DATA_EXIT_CODE
    )
    assert default_report.read_bytes() == strict_report.read_bytes()
    report = json.loads(default_report.read_text(encoding="utf-8"))
    assert report["status"] == "insufficient_data"
    assert "training_profiles_below_minimum" in report["reason_codes"]


@pytest.mark.parametrize(
    "command,input_option", [("simulate", "--catalog"), ("readiness", "--snapshot")]
)
def test_generated_commands_refuse_to_overwrite_their_input(
    command: str,
    input_option: str,
    tmp_path: Path,
) -> None:
    input_path = tmp_path / "input.json"
    input_path.write_bytes(READINESS_CATALOG.read_bytes())
    arguments = [command, input_option, str(input_path), "--output", str(input_path)]

    assert main(arguments) == 2
    assert input_path.read_bytes() == READINESS_CATALOG.read_bytes()


def test_invalid_snapshot_does_not_overwrite_an_existing_report(
    tmp_path: Path,
) -> None:
    snapshot_path = tmp_path / "invalid.json"
    report_path = tmp_path / "existing.json"
    snapshot_path.write_text("{}", encoding="utf-8")
    report_path.write_text("keep me", encoding="utf-8")

    assert (
        main(
            [
                "run",
                "--snapshot",
                str(snapshot_path),
                "--output",
                str(report_path),
            ]
        )
        == 2
    )
    assert report_path.read_text(encoding="utf-8") == "keep me"


def test_snapshot_command_passes_explicit_metadata_to_the_exporter(
    synthetic_snapshot: EvaluationSnapshot,
    tmp_path: Path,
    monkeypatch: Any,
) -> None:
    captured: dict[str, object] = {}

    def fake_export(**arguments: object) -> EvaluationSnapshot:
        captured.update(arguments)
        return synthetic_snapshot

    monkeypatch.setattr(
        "recipe_lab_evaluation.cli.export_postgres_snapshot",
        fake_export,
    )
    output_path = tmp_path / "nested" / "snapshot.json"

    assert (
        main(
            [
                "snapshot",
                "--database-url",
                "postgresql+psycopg://example.invalid/db",
                "--dataset-id",
                "explicit-dataset",
                "--cutoff",
                "2026-06-01T00:00:00Z",
                "--limitation",
                "Synthetic command fixture.",
                "--output",
                str(output_path),
            ]
        )
        == 0
    )

    assert captured["database_url"] == "postgresql+psycopg://example.invalid/db"
    assert captured["dataset_id"] == "explicit-dataset"
    assert captured["limitations"] == ("Synthetic command fixture.",)
    assert load_snapshot(output_path) == synthetic_snapshot


def test_snapshot_failure_does_not_print_connection_details(
    tmp_path: Path,
    monkeypatch: Any,
    capsys: Any,
) -> None:
    def fail_export(**arguments: object) -> EvaluationSnapshot:
        del arguments
        raise SQLAlchemyError("password=do-not-print")

    exporter: Callable[..., EvaluationSnapshot] = fail_export
    monkeypatch.setattr(
        "recipe_lab_evaluation.cli.export_postgres_snapshot",
        exporter,
    )

    exit_code = main(
        [
            "snapshot",
            "--database-url",
            "postgresql+psycopg://secret.invalid/db",
            "--dataset-id",
            "failure-fixture",
            "--cutoff",
            "2026-06-01T00:00:00Z",
            "--limitation",
            "Synthetic command fixture.",
            "--output",
            str(tmp_path / "missing.json"),
        ]
    )

    captured = capsys.readouterr()
    assert exit_code == 1
    assert "verify the PostgreSQL connection and schema" in captured.err
    assert "password" not in captured.err
    assert "secret.invalid" not in captured.err


@pytest.mark.parametrize(
    "database_url",
    [
        "postgresql://recipe_lab:secret@example.invalid/db",
        "postgresql+psycopg://recipe_lab:secret@example.invalid:notaport/db",
    ],
)
def test_snapshot_rejects_unsafe_or_malformed_database_urls_without_a_traceback(
    database_url: str,
    tmp_path: Path,
    capsys: Any,
) -> None:
    exit_code = main(
        [
            "snapshot",
            "--database-url",
            database_url,
            "--dataset-id",
            "invalid-url-fixture",
            "--cutoff",
            "2026-06-01T00:00:00Z",
            "--limitation",
            "Synthetic command fixture.",
            "--output",
            str(tmp_path / "missing.json"),
        ]
    )

    captured = capsys.readouterr()
    assert exit_code == 1
    assert "snapshot export failed" in captured.err
    assert "Traceback" not in captured.err
    assert "secret" not in captured.err
    assert "example.invalid" not in captured.err


def test_module_entry_point_exposes_help() -> None:
    completed = subprocess.run(
        [sys.executable, "-m", "recipe_lab_evaluation", "--help"],
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed.returncode == 0
    assert "snapshot" in completed.stdout
    assert "simulate" in completed.stdout
    assert "readiness" in completed.stdout
    assert "run" in completed.stdout
