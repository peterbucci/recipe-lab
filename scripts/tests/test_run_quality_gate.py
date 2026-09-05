from pathlib import Path
from subprocess import CompletedProcess

import pytest

from scripts.run_quality_gate import REPOSITORY, SUITES, Check, run_checks


def test_every_quality_suite_uses_repository_owned_working_directories() -> None:
    assert set(SUITES) == {"backend", "contracts", "frontend", "lint", "ml", "types"}

    for build_checks in SUITES.values():
        checks = build_checks()
        assert checks
        assert len({check.label for check in checks}) == len(checks)
        for check in checks:
            assert check.arguments
            assert (
                check.working_directory == REPOSITORY
                or REPOSITORY in check.working_directory.parents
            )


def test_runner_executes_checks_in_order_with_fail_closed_subprocesses() -> None:
    calls: list[tuple[tuple[str, ...], Path, bool, bool]] = []

    def recording_runner(
        arguments: tuple[str, ...],
        *,
        cwd: Path,
        check: bool,
        text: bool,
    ) -> CompletedProcess[str]:
        calls.append((arguments, cwd, check, text))
        return CompletedProcess(arguments, 0)

    checks = (
        Check("first", ("tool", "one"), REPOSITORY / "backend"),
        Check("second", ("tool", "two"), REPOSITORY / "frontend"),
    )

    run_checks(checks, runner=recording_runner)

    assert calls == [
        (("tool", "one"), REPOSITORY / "backend", True, True),
        (("tool", "two"), REPOSITORY / "frontend", True, True),
    ]


def test_runner_stops_at_the_first_failed_check() -> None:
    calls: list[str] = []

    def failing_runner(
        arguments: tuple[str, ...],
        *,
        cwd: Path,
        check: bool,
        text: bool,
    ) -> CompletedProcess[str]:
        del cwd, check, text
        calls.append(arguments[1])
        raise FileNotFoundError(arguments[0])

    with pytest.raises(FileNotFoundError):
        run_checks(
            (
                Check("missing", ("tool", "first")),
                Check("not reached", ("tool", "second")),
            ),
            runner=failing_runner,
        )

    assert calls == ["first"]
