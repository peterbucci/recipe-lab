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


def test_command_reports_failed_required_result(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert main(["--tier", "fast", "--required", "Backend=failure"]) == 1
    captured = capsys.readouterr()
    assert "ERROR: Backend: expected success, got failure" in captured.out
