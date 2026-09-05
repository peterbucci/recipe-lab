from __future__ import annotations

import re
from pathlib import Path

WORKFLOW = Path(__file__).parents[2] / ".github" / "workflows" / "ci.yml"


def _job(workflow: str, job_id: str) -> str:
    marker = f"  {job_id}:\n"
    start = workflow.index(marker)
    next_job = re.search(r"^  [a-z0-9-]+:\s*$", workflow[start + len(marker) :], re.MULTILINE)
    if next_job is None:
        return workflow[start:]
    return workflow[start : start + len(marker) + next_job.start()]


def test_ci_keeps_stable_required_check_names_and_checked_in_evaluator() -> None:
    workflow = WORKFLOW.read_text(encoding="utf-8")

    for job_id, name in (
        ("unit", "Unit"),
        ("integration", "Integration"),
        ("build", "Build"),
        ("e2e", "E2E"),
        ("rcp32-release-gate", "RCP-32 community release gate"),
        ("repository-quality", "Repository quality"),
    ):
        block = _job(workflow, job_id)
        assert f"name: {name}" in block
        assert "python scripts/require_ci_results.py" in block


def test_pull_requests_skip_only_declared_full_tier_jobs() -> None:
    workflow = WORKFLOW.read_text(encoding="utf-8")
    assert "github.event_name == 'pull_request' && 'fast' || 'full'" in workflow
    assert "schedule:" in workflow
    assert "workflow_dispatch:" in workflow

    for job_id in (
        "offline-evaluation",
        "production-images",
        "source-package",
        "mvp-acceptance",
        "rcp32-acceptance",
        "rcp34b-baselines",
    ):
        assert "github.event_name != 'pull_request'" in _job(workflow, job_id)
