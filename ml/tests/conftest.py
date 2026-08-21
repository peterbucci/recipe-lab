from pathlib import Path

import pytest

from recipe_lab_evaluation.dataset import EvaluationSnapshot, load_snapshot

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "synthetic_snapshot_v1.json"


@pytest.fixture(scope="session")
def synthetic_snapshot() -> EvaluationSnapshot:
    return load_snapshot(FIXTURE_PATH)
