import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from recipe_lab_evaluation.cli import STRICT_INSUFFICIENT_DATA_EXIT_CODE, main
from recipe_lab_evaluation.dataset import (
    EvaluationSnapshot,
    load_snapshot,
    snapshot_to_json,
)
from recipe_lab_evaluation.models import (
    CollaborativeV1Model,
    ContentBasedV1Model,
    HybridV1Model,
)
from recipe_lab_evaluation.models.hybrid_v1 import (
    CONTENT_FALLBACK_REASON,
    FALLBACK_REASON,
    HYBRID_REASON,
)
from recipe_lab_evaluation.protocol import ModelMetadata
from recipe_lab_evaluation.report import report_to_json
from recipe_lab_evaluation.runner import EvaluationConfig, EvaluationError, evaluate
from recipe_lab_evaluation.simulator import CohortSimulationConfig, simulate_preference_cohort

_READINESS_CATALOG = Path(__file__).parent / "fixtures" / "readiness_catalog_v2.json"


@pytest.fixture(scope="module")
def ready_hybrid_snapshot() -> EvaluationSnapshot:
    return simulate_preference_cohort(
        load_snapshot(_READINESS_CATALOG),
        CohortSimulationConfig(seed=20260822, profile_count=64),
    )


def test_runner_requires_all_simpler_comparators_for_hybrid(
    ready_hybrid_snapshot: EvaluationSnapshot,
) -> None:
    with pytest.raises(EvaluationError, match="requires content-v1 and collaborative-v1"):
        evaluate(
            ready_hybrid_snapshot,
            models=(HybridV1Model(),),
            config=EvaluationConfig(seed=20260822, ks=(1,)),
        )


@pytest.mark.parametrize(
    "metadata",
    [
        ContentBasedV1Model.metadata,
        CollaborativeV1Model.metadata,
        HybridV1Model.metadata,
    ],
    ids=["content", "collaborative", "hybrid"],
)
def test_runner_rejects_custom_adapters_spoofing_a_built_in_id(
    ready_hybrid_snapshot: EvaluationSnapshot,
    metadata: ModelMetadata,
) -> None:
    class _SpoofedModel:
        def __init__(self, spoofed_metadata: ModelMetadata) -> None:
            self.metadata = spoofed_metadata

        def fit(self, training: object, *, seed: int) -> object:
            del training, seed
            raise AssertionError("a spoofed built-in must never be fitted")

    with pytest.raises(EvaluationError, match="reserved for its built-in adapter"):
        evaluate(
            ready_hybrid_snapshot,
            models=(_SpoofedModel(metadata),),  # type: ignore[arg-type]
            config=EvaluationConfig(seed=20260822, ks=(1,)),
        )


def test_hybrid_model_id_cannot_bypass_collaborative_readiness() -> None:
    insufficient = load_snapshot(_READINESS_CATALOG)

    with pytest.raises(EvaluationError, match="collaborative readiness failed"):
        evaluate(
            insufficient,
            models=(ContentBasedV1Model(), CollaborativeV1Model(), HybridV1Model()),
            config=EvaluationConfig(seed=20260822, ks=(1,)),
        )


def test_runner_gives_every_candidate_model_the_exact_same_split_and_candidates(
    ready_hybrid_snapshot: EvaluationSnapshot,
) -> None:
    report = evaluate(
        ready_hybrid_snapshot,
        models=(HybridV1Model(), CollaborativeV1Model(), ContentBasedV1Model()),
        config=EvaluationConfig(seed=20260822, ks=(1, 3)),
    )

    support_by_model = {
        model.model_id: tuple(
            (metric.k, metric.evaluated_users, metric.relevant_items) for metric in model.metrics
        )
        for model in report.models
    }
    assert len(set(support_by_model.values())) == 1


def test_cli_hybrid_gate_runs_before_fit_and_preserves_existing_output(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    snapshot_path = tmp_path / "insufficient.json"
    output_path = tmp_path / "existing.json"
    snapshot_path.write_bytes(_READINESS_CATALOG.read_bytes())
    output_path.write_text("keep me", encoding="utf-8")

    def forbidden_evaluate(*args: object, **kwargs: object) -> None:
        del args, kwargs
        raise AssertionError("hybrid evaluation must not start when readiness fails")

    monkeypatch.setattr("recipe_lab_evaluation.cli.evaluate", forbidden_evaluate)

    assert (
        main(
            [
                "run",
                "--snapshot",
                str(snapshot_path),
                "--hybrid",
                "--output",
                str(output_path),
            ]
        )
        == STRICT_INSUFFICIENT_DATA_EXIT_CODE
    )
    assert output_path.read_text(encoding="utf-8") == "keep me"
    error = capsys.readouterr().err
    assert "hybrid-v1 was not fitted" in error
    assert "training_profiles_below_minimum" in error


def test_cli_model_suite_flags_are_mutually_exclusive(
    ready_hybrid_snapshot: EvaluationSnapshot,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    snapshot_path = tmp_path / "ready.json"
    snapshot_path.write_text(snapshot_to_json(ready_hybrid_snapshot), encoding="utf-8")

    with pytest.raises(SystemExit) as raised:
        main(
            [
                "run",
                "--snapshot",
                str(snapshot_path),
                "--hybrid",
                "--collaborative",
            ]
        )

    assert raised.value.code == 2
    error = capsys.readouterr().err
    assert "not allowed with argument" in error


def test_ready_hybrid_cli_report_is_complete_private_and_explicitly_not_adopted(
    ready_hybrid_snapshot: EvaluationSnapshot,
    tmp_path: Path,
) -> None:
    snapshot_path = tmp_path / "ready.json"
    report_path = tmp_path / "hybrid-report.json"
    snapshot_path.write_text(snapshot_to_json(ready_hybrid_snapshot), encoding="utf-8")

    assert (
        main(
            [
                "run",
                "--snapshot",
                str(snapshot_path),
                "--hybrid",
                "--k",
                "1",
                "--k",
                "3",
                "--seed",
                "20260822",
                "--strict",
                "--output",
                str(report_path),
            ]
        )
        == 0
    )

    raw_report = report_path.read_text(encoding="utf-8")
    report = json.loads(raw_report)
    assert report["schema_version"] == "recipe-lab-offline-evaluation-report-v3"
    assert report["status"] == "complete"
    assert [model["model_id"] for model in report["models"]] == [
        "baseline-v1",
        "collaborative-v1",
        "content-v1",
        "hybrid-v1",
    ]
    assert report["hybrid_adoption"] == {
        "candidate_model_id": "hybrid-v1",
        "comparisons": [
            {
                "coverage_delta": "0.250000",
                "evaluated_users": 64,
                "k": 1,
                "ndcg_delta": "0.015625",
                "recall_delta": "0.007812",
                "reference_model_id": "baseline-v1",
            },
            {
                "coverage_delta": "0.000000",
                "evaluated_users": 64,
                "k": 3,
                "ndcg_delta": "0.001028",
                "recall_delta": "0.000000",
                "reference_model_id": "content-v1",
            },
        ],
        "evaluated_users": 64,
        "policy": {
            "maximum_coverage_regression": "0.050000",
            "maximum_ndcg_regression": "0.000000",
            "maximum_recall_regression": "0.000000",
            "minimum_evaluated_users": 40,
            "minimum_primary_ndcg_lift": "0.010000",
        },
        "policy_version": "hybrid-adoption-policy-v1",
        "primary_k": 3,
        "primary_ndcg_lift": "0.001028",
        "reason_codes": [
            "synthetic_evidence_only",
            "primary_ndcg_lift_below_minimum",
        ],
        "reference_model_id": "content-v1",
        "status": "retain_simpler",
        "worst_coverage_delta": "0.000000",
        "worst_ndcg_delta": "0.001028",
        "worst_recall_delta": "0.000000",
    }
    hybrid = report["models"][3]
    assert hybrid["artifact"] is None
    assert hybrid["metrics"] == [
        {
            "coverage": "0.875000",
            "k": 1,
            "mean_candidate_popularity": "1.000000",
            "mean_recommended_popularity": "1.000000",
            "ndcg": "0.718750",
            "popularity_bias": "0.000000",
            "precision": "0.718750",
            "recall": "0.359375",
            "support": {"evaluated_users": 64, "relevant_items": 128},
        },
        {
            "coverage": "1.000000",
            "k": 3,
            "mean_candidate_popularity": "1.000000",
            "mean_recommended_popularity": "1.000000",
            "ndcg": "0.887435",
            "popularity_bias": "0.000000",
            "precision": "0.666667",
            "recall": "1.000000",
            "support": {"evaluated_users": 64, "relevant_items": 128},
        },
    ]
    supports = [
        tuple(metric["support"].items())
        for model in report["models"]
        for metric in model["metrics"]
    ]
    assert len(set(supports[0::2])) == 1
    assert len(set(supports[1::2])) == 1

    for reason in (HYBRID_REASON, CONTENT_FALLBACK_REASON, FALLBACK_REASON):
        assert reason not in raw_report
    for recipe in ready_hybrid_snapshot.recipes:
        assert recipe.title not in raw_report
        assert str(recipe.id) not in raw_report
    for event in ready_hybrid_snapshot.events:
        assert str(event.id) not in raw_report
        assert str(event.user_id) not in raw_report


def test_hybrid_cli_report_is_byte_reproducible_across_k_and_hash_order(
    ready_hybrid_snapshot: EvaluationSnapshot,
    tmp_path: Path,
) -> None:
    snapshot_path = tmp_path / "ready.json"
    snapshot_path.write_text(snapshot_to_json(ready_hybrid_snapshot), encoding="utf-8")
    ml_root = Path(__file__).parents[1]
    source_paths = (ml_root / "src", ml_root.parent / "backend")

    def run_with_hash_seed(hash_seed: str, ks: tuple[str, str]) -> str:
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
                "--hybrid",
                "--k",
                ks[0],
                "--k",
                ks[1],
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

    assert run_with_hash_seed("1", ("1", "3")) == run_with_hash_seed("987654", ("3", "1"))


def test_cli_stdout_preserves_canonical_lf_bytes_on_every_platform(
    ready_hybrid_snapshot: EvaluationSnapshot,
    tmp_path: Path,
) -> None:
    snapshot_path = tmp_path / "ready.json"
    stdout_path = tmp_path / "stdout.json"
    snapshot_path.write_text(snapshot_to_json(ready_hybrid_snapshot), encoding="utf-8")
    ml_root = Path(__file__).parents[1]
    environment = os.environ.copy()
    source_paths = [str(ml_root / "src"), str(ml_root.parent / "backend")]
    if existing := environment.get("PYTHONPATH"):
        source_paths.append(existing)
    environment["PYTHONPATH"] = os.pathsep.join(source_paths)

    with stdout_path.open("wb") as output:
        subprocess.run(
            [
                sys.executable,
                "-m",
                "recipe_lab_evaluation",
                "run",
                "--snapshot",
                str(snapshot_path),
                "--hybrid",
                "--k",
                "1",
                "--k",
                "3",
                "--seed",
                "20260822",
            ],
            check=True,
            cwd=ml_root,
            env=environment,
            stdout=output,
            stderr=subprocess.PIPE,
        )

    raw_report = stdout_path.read_bytes()
    assert raw_report.endswith(b"\n")
    assert not raw_report.endswith(b"\r\n")
    assert json.loads(raw_report)["hybrid_adoption"]["status"] == "retain_simpler"


def test_non_hybrid_report_has_no_adoption_decision(
    synthetic_snapshot: EvaluationSnapshot,
) -> None:
    report = json.loads(
        report_to_json(
            evaluate(
                synthetic_snapshot,
                models=(ContentBasedV1Model(),),
                config=EvaluationConfig(seed=20260822, ks=(1,)),
            )
        )
    )

    assert report["schema_version"] == "recipe-lab-offline-evaluation-report-v3"
    assert report["hybrid_adoption"] is None
