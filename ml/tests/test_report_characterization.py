from __future__ import annotations

import hashlib
from pathlib import Path

from recipe_lab_evaluation.dataset import load_snapshot
from recipe_lab_evaluation.duplicate_dataset import load_duplicate_benchmark
from recipe_lab_evaluation.duplicate_evaluation import (
    duplicate_evaluation_report_to_json,
    evaluate_duplicate_candidates,
)
from recipe_lab_evaluation.readiness import assess_readiness, readiness_report_to_json
from recipe_lab_evaluation.report import report_to_json
from recipe_lab_evaluation.runner import EvaluationConfig, evaluate
from recipe_lab_evaluation.substitution_dataset import load_substitution_benchmark
from recipe_lab_evaluation.substitution_evaluation import (
    evaluate_substitution_rules,
    substitution_evaluation_report_to_json,
)

FIXTURE_DIRECTORY = Path(__file__).parent / "fixtures"


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def test_public_report_serializers_preserve_the_reviewed_golden_bytes() -> None:
    evaluation_snapshot = load_snapshot(FIXTURE_DIRECTORY / "synthetic_snapshot_v2.json")
    readiness_snapshot = load_snapshot(FIXTURE_DIRECTORY / "readiness_catalog_v2.json")
    substitution_benchmark = load_substitution_benchmark(
        FIXTURE_DIRECTORY / "substitution_benchmark_v1.json"
    )
    duplicate_benchmark = load_duplicate_benchmark(
        FIXTURE_DIRECTORY / "duplicate_candidates_v1.json"
    )

    serialized = {
        "evaluation": report_to_json(
            evaluate(
                evaluation_snapshot,
                config=EvaluationConfig(seed=55, ks=(2,)),
            )
        ),
        "readiness": readiness_report_to_json(assess_readiness(readiness_snapshot)),
        "substitution": substitution_evaluation_report_to_json(
            evaluate_substitution_rules(substitution_benchmark)
        ),
        "duplicate": duplicate_evaluation_report_to_json(
            evaluate_duplicate_candidates(duplicate_benchmark)
        ),
    }

    assert {name: _sha256(report) for name, report in serialized.items()} == {
        "evaluation": "ca1a81280204d498a0135134c8621927c52fc961d4985a43343499e1f516d283",
        "readiness": "1314c7f06f1c18668d00fb36ee4496edf1337b324964a2a64983ce578b681430",
        "substitution": "86d972a5b142c6cd4705293034cba4f0bb0c59f211f13ea4573747d9ec4509e0",
        "duplicate": "9836f6dc4223fef13ba34349377926aa79df72d69fc89f0ea420344cff304be9",
    }
