"""Architecture guard for the declarative abuse-route policy boundary."""

from __future__ import annotations

import ast
from pathlib import Path

from app.policies.abuse import classify_rate_limited_request
from app.services import abuse_limits

_APP_ROOT = Path(__file__).resolve().parents[1] / "app"
_POLICY_PATH = Path("policies/abuse.py")


def _classifier_definitions() -> list[Path]:
    definitions: list[Path] = []
    for path in sorted(_APP_ROOT.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        if any(
            isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name == "classify_rate_limited_request"
            for node in ast.walk(tree)
        ):
            definitions.append(path.relative_to(_APP_ROOT))
    return definitions


def test_abuse_classifier_has_one_authoritative_definition() -> None:
    assert _classifier_definitions() == [_POLICY_PATH]


def test_legacy_service_surface_reexports_the_canonical_classifier() -> None:
    assert abuse_limits.classify_rate_limited_request is classify_rate_limited_request
