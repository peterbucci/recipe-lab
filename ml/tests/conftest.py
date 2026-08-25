from pathlib import Path

import pytest

from recipe_lab_evaluation.dataset import EvaluationSnapshot, load_snapshot
from recipe_lab_evaluation.substitution_dataset import (
    SubstitutionBenchmark,
    load_substitution_benchmark,
)

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "synthetic_snapshot_v2.json"
SUBSTITUTION_FIXTURE_PATH = Path(__file__).parent / "fixtures" / "substitution_benchmark_v1.json"


@pytest.fixture(scope="session")
def synthetic_snapshot() -> EvaluationSnapshot:
    return load_snapshot(FIXTURE_PATH)


@pytest.fixture(scope="session")
def substitution_benchmark() -> SubstitutionBenchmark:
    return load_substitution_benchmark(SUBSTITUTION_FIXTURE_PATH)
