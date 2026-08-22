import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, cast

import pytest
from conftest import SUBSTITUTION_FIXTURE_PATH

from recipe_lab_evaluation.cli import STRICT_INSUFFICIENT_DATA_EXIT_CODE, main


def _ranking_mismatch_benchmark(path: Path) -> None:
    document = cast(
        dict[str, Any],
        json.loads(SUBSTITUTION_FIXTURE_PATH.read_text(encoding="utf-8")),
    )
    cases = cast(list[dict[str, Any]], document["cases"])
    ranking = cast(list[str], cases[0]["expected_ranking"])
    ranking[0], ranking[1] = ranking[1], ranking[0]
    path.write_text(json.dumps(document), encoding="utf-8")


def test_substitution_run_writes_the_same_validated_report_to_file_and_stdout(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    report_path = tmp_path / "nested" / "substitution-report.json"

    assert (
        main(
            [
                "substitution-run",
                "--benchmark",
                str(SUBSTITUTION_FIXTURE_PATH),
                "--output",
                str(report_path),
                "--strict",
            ]
        )
        == 0
    )
    assert (
        main(
            [
                "substitution-run",
                "--benchmark",
                str(SUBSTITUTION_FIXTURE_PATH),
            ]
        )
        == 0
    )

    stdout = capsys.readouterr().out
    assert stdout.encode("utf-8") == report_path.read_bytes()
    report = json.loads(stdout)
    assert report["status"] == "engineering_validated"
    assert report["reason_codes"] == []
    assert report["learned_ranking_attempted"] is False


def test_strict_invalid_evaluation_writes_report_before_returning_three(
    tmp_path: Path,
) -> None:
    benchmark_path = tmp_path / "ranking-mismatch.json"
    default_report = tmp_path / "default-report.json"
    strict_report = tmp_path / "strict-report.json"
    _ranking_mismatch_benchmark(benchmark_path)

    assert (
        main(
            [
                "substitution-run",
                "--benchmark",
                str(benchmark_path),
                "--output",
                str(default_report),
            ]
        )
        == 0
    )
    assert (
        main(
            [
                "substitution-run",
                "--benchmark",
                str(benchmark_path),
                "--output",
                str(strict_report),
                "--strict",
            ]
        )
        == STRICT_INSUFFICIENT_DATA_EXIT_CODE
    )

    assert default_report.read_bytes() == strict_report.read_bytes()
    report = json.loads(strict_report.read_text(encoding="utf-8"))
    assert report["status"] == "invalid"
    assert report["reason_codes"] == ["ranking_mismatch"]


def test_invalid_benchmark_does_not_overwrite_an_existing_report(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    benchmark_path = tmp_path / "invalid.json"
    report_path = tmp_path / "existing.json"
    benchmark_path.write_text("{}", encoding="utf-8")
    report_path.write_text("keep me", encoding="utf-8")

    exit_code = main(
        [
            "substitution-run",
            "--benchmark",
            str(benchmark_path),
            "--output",
            str(report_path),
        ]
    )

    assert exit_code == 2
    assert report_path.read_text(encoding="utf-8") == "keep me"
    error = capsys.readouterr().err
    assert "invalid substitution benchmark" in error
    assert "Traceback" not in error


def test_substitution_run_refuses_to_overwrite_its_benchmark(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    benchmark_path = tmp_path / "benchmark.json"
    original = SUBSTITUTION_FIXTURE_PATH.read_bytes()
    benchmark_path.write_bytes(original)

    exit_code = main(
        [
            "substitution-run",
            "--benchmark",
            str(benchmark_path),
            "--output",
            str(benchmark_path),
        ]
    )

    assert exit_code == 2
    assert benchmark_path.read_bytes() == original
    assert "must not overwrite the benchmark" in capsys.readouterr().err


def test_missing_benchmark_is_an_io_failure_and_preserves_existing_output(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    report_path = tmp_path / "existing.json"
    report_path.write_text("keep me", encoding="utf-8")

    exit_code = main(
        [
            "substitution-run",
            "--benchmark",
            str(tmp_path / "missing.json"),
            "--output",
            str(report_path),
        ]
    )

    assert exit_code == 1
    assert report_path.read_text(encoding="utf-8") == "keep me"
    assert "could not read" in capsys.readouterr().err


def test_cli_stdout_is_hash_seed_reproducible_and_uses_canonical_lf_bytes(
    tmp_path: Path,
) -> None:
    benchmark_path = tmp_path / "benchmark.json"
    benchmark_path.write_bytes(SUBSTITUTION_FIXTURE_PATH.read_bytes())
    ml_root = Path(__file__).parents[1]
    source_paths = [str(ml_root / "src"), str(ml_root.parent / "backend")]

    def run_with_hash_seed(hash_seed: str) -> bytes:
        environment = os.environ.copy()
        if existing := environment.get("PYTHONPATH"):
            source_paths_with_existing = [*source_paths, existing]
        else:
            source_paths_with_existing = source_paths
        environment["PYTHONPATH"] = os.pathsep.join(source_paths_with_existing)
        environment["PYTHONHASHSEED"] = hash_seed
        completed = subprocess.run(
            [
                sys.executable,
                "-m",
                "recipe_lab_evaluation",
                "substitution-run",
                "--benchmark",
                str(benchmark_path),
                "--strict",
            ],
            check=True,
            capture_output=True,
            cwd=ml_root,
            env=environment,
        )
        assert completed.stderr == b""
        return completed.stdout

    first = run_with_hash_seed("1")
    second = run_with_hash_seed("987654")

    assert first == second
    assert first.endswith(b"\n")
    assert not first.endswith(b"\r\n")
    assert json.loads(first)["status"] == "engineering_validated"


def test_substitution_command_is_present_in_help(
    capsys: pytest.CaptureFixture[str],
) -> None:
    with pytest.raises(SystemExit) as raised:
        main(["--help"])

    assert raised.value.code == 0
    assert "substitution-run" in capsys.readouterr().out
