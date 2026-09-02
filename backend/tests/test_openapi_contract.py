from __future__ import annotations

import json
import os
import subprocess
import sys
from collections import Counter
from copy import deepcopy
from pathlib import Path

import pytest
from fastapi import APIRouter

from app.main import create_app
from app.openapi_contract import (
    EXTERNAL_CONSUMER_STATUS,
    FRAMEWORK_ROUTE_CONTRACTS,
    OPERATION_CONTRACTS,
    OpenAPIContractError,
    apply_contract_metadata,
    check_snapshot,
    executable_route_keys,
    generate_snapshot,
    render_snapshot,
    reviewed_executable_route_keys,
    write_snapshot,
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPOSITORY_ROOT / "backend"
EXPECTED_CLASSIFICATION_COUNTS = {
    "active_consumer": 44,
    "research_experimental": 2,
    "staff_internal": 8,
}


def _operations(document: dict[str, object]) -> list[dict[str, object]]:
    paths = document["paths"]
    assert isinstance(paths, dict)
    operations: list[dict[str, object]] = []
    for path_item in paths.values():
        assert isinstance(path_item, dict)
        for method, value in path_item.items():
            if method in {"delete", "get", "head", "options", "patch", "post", "put", "trace"}:
                assert isinstance(value, dict)
                operations.append(value)
    return operations


def _subprocess_snapshot(*, cwd: Path, canary: str) -> str:
    environment = os.environ.copy()
    environment.update(
        {
            "PYTHONPATH": str(BACKEND_ROOT),
            "DATABASE_URL": (f"postgresql+psycopg://{canary}:{canary}@127.0.0.1:5432/{canary}"),
            "CORS_ORIGINS": f"https://{canary}.invalid",
            "OIDC_CLIENT_SECRET": f"{canary}-oidc-secret-value",
        }
    )
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "from app.openapi_contract import generate_snapshot; "
            "print(generate_snapshot(), end='')",
        ],
        cwd=cwd,
        env=environment,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout


def test_registry_freezes_every_operation_with_stable_unique_metadata() -> None:
    document = create_app().openapi()
    operations = _operations(document)

    assert len(OPERATION_CONTRACTS) == 54
    assert len(operations) == 54
    assert len({operation["operationId"] for operation in operations}) == 54
    assert (
        Counter(operation["x-recipe-lab-classification"] for operation in operations)
        == EXPECTED_CLASSIFICATION_COUNTS
    )
    assert document["x-recipe-lab-external-consumer-status"] == EXTERNAL_CONSUMER_STATUS

    for operation in operations:
        assert operation["x-recipe-lab-external-consumer-status"] == EXTERNAL_CONSUMER_STATUS
        evidence = operation["x-recipe-lab-consumer-evidence"]
        assert isinstance(evidence, list)
        assert evidence
        for relative_path in evidence:
            assert isinstance(relative_path, str)
            assert not Path(relative_path).is_absolute()
            assert (REPOSITORY_ROOT / relative_path).is_file()


def test_retired_operations_and_legacy_only_schemas_are_absent() -> None:
    document = create_app().openapi()
    operations = _operations(document)
    paths = document["paths"]
    components = document["components"]
    assert isinstance(paths, dict)
    assert isinstance(components, dict)
    schemas = components["schemas"]
    assert isinstance(schemas, dict)

    assert not any(
        operation["x-recipe-lab-classification"] == "retired" for operation in operations
    )
    assert {
        "/api/recipes/{recipe_version_id}/variants",
        "/api/recipes/{recipe_version_id}/duplicate-preflights",
        "/api/recipe-duplicate-preflights/{preflight_id}/decision",
    }.isdisjoint(paths)
    assert {
        "RecipeForkRequest",
        "RecipeDuplicateDecisionRequest",
        "RecipeDuplicateDecisionResponse",
    }.isdisjoint(schemas)


def test_framework_routes_are_separately_inventoried_and_reachable() -> None:
    application = create_app()

    assert executable_route_keys(application) == reviewed_executable_route_keys()
    assert application.openapi()["x-recipe-lab-framework-routes"] == [
        {
            **item,
            "classification": "staff_internal",
            "consumer_evidence": ["docs/api-contracts.md"],
            "external_consumer_status": EXTERNAL_CONSUMER_STATUS,
        }
        for item in FRAMEWORK_ROUTE_CONTRACTS
    ]


def test_schema_excluded_direct_or_nested_routes_fail_closed() -> None:
    direct_application = create_app()

    @direct_application.get("/unreviewed-hidden", include_in_schema=False)
    def direct_hidden_route() -> dict[str, bool]:
        return {"hidden": True}

    with pytest.raises(OpenAPIContractError, match="unclassified"):
        direct_application.openapi()

    nested_application = create_app()
    hidden_router = APIRouter()

    @hidden_router.get("/hidden", include_in_schema=False)
    def nested_hidden_route() -> dict[str, bool]:
        return {"hidden": True}

    nested_application.include_router(hidden_router, prefix="/unreviewed-nested")
    with pytest.raises(OpenAPIContractError, match="unclassified"):
        nested_application.openapi()


def test_unclassified_or_absent_operations_fail_closed() -> None:
    document = create_app().openapi()
    unclassified = deepcopy(document)
    paths = unclassified["paths"]
    assert isinstance(paths, dict)
    paths["/api/unreviewed"] = {"get": {"responses": {"200": {"description": "test"}}}}
    with pytest.raises(OpenAPIContractError, match="unclassified"):
        apply_contract_metadata(unclassified)

    absent = deepcopy(document)
    absent_paths = absent["paths"]
    assert isinstance(absent_paths, dict)
    del absent_paths["/api/health"]
    with pytest.raises(OpenAPIContractError, match="absent"):
        apply_contract_metadata(absent)


def test_snapshot_is_sorted_deterministic_and_environment_independent(tmp_path: Path) -> None:
    first_canary = "contract-canary-one"
    second_canary = "contract-canary-two"
    first = _subprocess_snapshot(cwd=BACKEND_ROOT, canary=first_canary)
    second = _subprocess_snapshot(cwd=tmp_path, canary=second_canary)

    assert first == second == generate_snapshot()
    assert first == render_snapshot(json.loads(first))
    assert first_canary not in first
    assert second_canary not in first
    assert str(REPOSITORY_ROOT) not in first
    assert str(Path.home()) not in first


def test_snapshot_check_fails_for_missing_unreadable_or_stale_files(tmp_path: Path) -> None:
    missing = tmp_path / "missing.json"
    unreadable = tmp_path / "unreadable.json"
    stale = tmp_path / "stale.json"
    unreadable.write_bytes(b"\xff\xfe\xfd")
    stale.write_text("{}\n", encoding="utf-8")

    assert check_snapshot(missing) is False
    assert check_snapshot(unreadable) is False
    assert check_snapshot(stale) is False


def test_write_and_check_snapshot_round_trip(tmp_path: Path) -> None:
    snapshot = tmp_path / "openapi.json"

    write_snapshot(snapshot)

    assert snapshot.read_bytes().endswith(b"\n")
    assert check_snapshot(snapshot) is True


def test_committed_snapshot_matches_the_locked_runtime_contract() -> None:
    assert check_snapshot() is True
