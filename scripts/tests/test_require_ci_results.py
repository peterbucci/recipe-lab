import pytest

from scripts.require_ci_results import main, validate_results


def test_fast_tier_accepts_only_intentional_full_suite_skips() -> None:
    assert (
        validate_results(
            tier="fast",
            required=(("Backend", "success"),),
            full_only=(("Browser acceptance", "skipped"),),
        )
        == []
    )
    assert validate_results(
        tier="fast",
        required=(("Backend", "success"),),
        full_only=(("Browser acceptance", "failure"),),
    ) == ["Browser acceptance: expected success or skipped, got failure"]


def test_full_tier_requires_every_result_to_succeed() -> None:
    assert validate_results(
        tier="full",
        required=(("Backend", "success"),),
        full_only=(("Browser acceptance", "skipped"),),
    ) == ["Browser acceptance: expected success, got skipped"]


def test_fast_only_results_are_required_only_in_the_fast_tier() -> None:
    assert (
        validate_results(
            tier="fast",
            required=(),
            full_only=(),
            fast_only=(("Browser smoke", "success"),),
        )
        == []
    )
    assert validate_results(
        tier="fast",
        required=(),
        full_only=(),
        fast_only=(("Browser smoke", "skipped"),),
    ) == ["Browser smoke: expected success, got skipped"]
    assert (
        validate_results(
            tier="full",
            required=(),
            full_only=(),
            fast_only=(("Browser smoke", "skipped"),),
        )
        == []
    )


def test_fast_only_failures_never_count_as_intentional_skips() -> None:
    assert validate_results(
        tier="full",
        required=(),
        full_only=(),
        fast_only=(("Browser smoke", "failure"),),
    ) == ["Browser smoke: expected success or skipped, got failure"]


def test_command_enforces_fast_only_results(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["--tier", "fast", "--fast-only", "Browser smoke=skipped"]) == 1
    captured = capsys.readouterr()
    assert "ERROR: Browser smoke: expected success, got skipped" in captured.out


def test_command_reports_failed_required_result(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert main(["--tier", "fast", "--required", "Backend=failure"]) == 1
    captured = capsys.readouterr()
    assert "ERROR: Backend: expected success, got failure" in captured.out
