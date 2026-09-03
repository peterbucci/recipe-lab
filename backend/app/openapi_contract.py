"""Deterministic, reviewed OpenAPI contract metadata and snapshot tooling."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, TypedDict, cast

from fastapi import FastAPI

Classification = Literal[
    "active_consumer",
    "staff_internal",
    "research_experimental",
    "retired",
]
Reachability = Literal["active", "internal", "compatibility-only", "retired"]

HTTP_METHODS = frozenset({"delete", "get", "head", "options", "patch", "post", "put", "trace"})
EXTERNAL_CONSUMER_STATUS = "unknown_pending"
SNAPSHOT_PATH = Path(__file__).resolve().parents[1] / "openapi.json"


@dataclass(frozen=True, slots=True)
class OperationContract:
    operation_id: str
    classification: Classification
    consumer_evidence: tuple[str, ...]
    successor_operation_ids: tuple[str, ...] = ()

    @property
    def reachability(self) -> Reachability:
        """Map the detailed consumer class onto the repository-wide lifecycle class."""

        if self.classification == "active_consumer":
            return "active"
        if self.classification in {"staff_internal", "research_experimental"}:
            return "internal"
        return "retired"


class FrameworkRouteContract(TypedDict):
    path: str
    methods: list[str]


def _operation(
    operation_id: str,
    classification: Classification,
    *consumer_evidence: str,
    successors: tuple[str, ...] = (),
) -> OperationContract:
    return OperationContract(
        operation_id=operation_id,
        classification=classification,
        consumer_evidence=consumer_evidence,
        successor_operation_ids=successors,
    )


# This registry is intentionally explicit. Function names and router layout may change without
# silently renaming a public operation or erasing the reviewed consumer classification.
OPERATION_CONTRACTS: dict[tuple[str, str], OperationContract] = {
    ("DELETE", "/api/auth/account"): _operation(
        "delete_account_api_auth_account_delete",
        "active_consumer",
        "frontend/lib/auth-api.ts",
    ),
    ("GET", "/api/auth/callback"): _operation(
        "complete_login_api_auth_callback_get",
        "active_consumer",
        "frontend/lib/auth-api.ts",
        "frontend/app/api/[...path]/route.ts",
    ),
    ("GET", "/api/auth/login"): _operation(
        "start_login_api_auth_login_get",
        "active_consumer",
        "frontend/lib/auth-api.ts",
    ),
    ("POST", "/api/auth/logout"): _operation(
        "logout_api_auth_logout_post",
        "active_consumer",
        "frontend/lib/auth-api.ts",
    ),
    ("GET", "/api/auth/reauthenticate"): _operation(
        "start_reauthentication_api_auth_reauthenticate_get",
        "active_consumer",
        "frontend/lib/auth-api.ts",
    ),
    ("GET", "/api/auth/session"): _operation(
        "account_session_api_auth_session_get",
        "active_consumer",
        "frontend/lib/auth-api.ts",
    ),
    ("PATCH", "/api/auth/session/profile"): _operation(
        "update_account_profile_api_auth_session_profile_patch",
        "active_consumer",
        "frontend/lib/auth-api.ts",
    ),
    ("GET", "/api/cooking-action-types"): _operation(
        "cooking_action_type_catalog_api_cooking_action_types_get",
        "active_consumer",
        "frontend/lib/cooking-action-api.ts",
    ),
    ("GET", "/api/cooks/{handle}"): _operation(
        "public_cook_profile_api_cooks__handle__get",
        "active_consumer",
        "frontend/lib/recipe-library-api.ts",
    ),
    ("DELETE", "/api/cooks/{handle}/follow"): _operation(
        "unfollow_cook_api_cooks__handle__follow_delete",
        "active_consumer",
        "frontend/lib/member-follow-api.ts",
    ),
    ("GET", "/api/cooks/{handle}/follow"): _operation(
        "cook_follow_state_api_cooks__handle__follow_get",
        "active_consumer",
        "frontend/lib/member-follow-api.ts",
    ),
    ("PUT", "/api/cooks/{handle}/follow"): _operation(
        "follow_cook_api_cooks__handle__follow_put",
        "active_consumer",
        "frontend/lib/member-follow-api.ts",
    ),
    ("GET", "/api/health"): _operation(
        "health_check_api_health_get",
        "staff_internal",
        "docs/operations-observability.md",
    ),
    ("GET", "/api/ingredient-requests"): _operation(
        "review_queue_api_ingredient_requests_get",
        "staff_internal",
        "frontend/lib/ingredient-catalog-api.ts",
        "frontend/app/components/ingredient-request-review-workspace.tsx",
    ),
    ("POST", "/api/ingredient-requests"): _operation(
        "create_ingredient_request_api_ingredient_requests_post",
        "active_consumer",
        "frontend/lib/ingredient-catalog-api.ts",
    ),
    ("GET", "/api/ingredient-requests/mine"): _operation(
        "my_ingredient_requests_api_ingredient_requests_mine_get",
        "active_consumer",
        "frontend/lib/ingredient-catalog-api.ts",
    ),
    ("GET", "/api/ingredient-requests/{request_id}"): _operation(
        "ingredient_request_detail_api_ingredient_requests__request_id__get",
        "active_consumer",
        "frontend/lib/ingredient-catalog-api.ts",
    ),
    ("GET", "/api/ingredient-requests/{request_id}/review"): _operation(
        "review_request_detail_api_ingredient_requests__request_id__review_get",
        "staff_internal",
        "frontend/lib/ingredient-catalog-api.ts",
        "frontend/app/components/ingredient-request-review-workspace.tsx",
    ),
    ("POST", "/api/ingredient-requests/{request_id}/review"): _operation(
        "review_ingredient_request_api_ingredient_requests__request_id__review_post",
        "staff_internal",
        "frontend/lib/ingredient-catalog-api.ts",
        "frontend/app/components/ingredient-request-review-workspace.tsx",
    ),
    ("GET", "/api/ingredients"): _operation(
        "ingredient_catalog_api_ingredients_get",
        "active_consumer",
        "frontend/lib/ingredient-catalog-api.ts",
    ),
    ("GET", "/api/measurement-units"): _operation(
        "measurement_unit_catalog_api_measurement_units_get",
        "active_consumer",
        "frontend/lib/measurement-unit-api.ts",
    ),
    ("POST", "/api/measurements/convert"): _operation(
        "measurement_conversion_api_measurements_convert_post",
        "research_experimental",
        "docs/measurements.md",
    ),
    ("GET", "/api/moderation/recipe-reports"): _operation(
        "moderation_queue_api_moderation_recipe_reports_get",
        "staff_internal",
        "frontend/lib/recipe-moderation-api.ts",
        "frontend/app/components/recipe-moderation-workspace.tsx",
    ),
    ("GET", "/api/moderation/recipe-reports/{recipe_version_id}"): _operation(
        "moderation_case_detail_api_moderation_recipe_reports__recipe_version_id__get",
        "staff_internal",
        "frontend/lib/recipe-moderation-api.ts",
        "frontend/app/components/recipe-moderation-workspace.tsx",
    ),
    ("POST", "/api/moderation/recipe-reports/{recipe_version_id}/actions"): _operation(
        "moderate_recipe_api_moderation_recipe_reports__recipe_version_id__actions_post",
        "staff_internal",
        "frontend/lib/recipe-moderation-api.ts",
        "frontend/app/components/recipe-moderation-workspace.tsx",
    ),
    ("GET", "/api/my/recipes"): _operation(
        "my_recipe_library_api_my_recipes_get",
        "active_consumer",
        "frontend/lib/recipe-library-api.ts",
    ),
    ("GET", "/api/my/activity"): _operation(
        "my_member_activity_api_my_activity_get",
        "active_consumer",
        "frontend/lib/member-activity-api.ts",
    ),
    ("GET", "/api/my/dashboard"): _operation(
        "my_member_dashboard_api_my_dashboard_get",
        "active_consumer",
        "frontend/lib/member-activity-api.ts",
    ),
    ("GET", "/api/my/follow-stats"): _operation(
        "my_follow_stats_api_my_follow_stats_get",
        "active_consumer",
        "frontend/lib/member-follow-api.ts",
    ),
    ("GET", "/api/my/followers"): _operation(
        "my_followers_api_my_followers_get",
        "active_consumer",
        "frontend/lib/member-follow-api.ts",
    ),
    ("GET", "/api/my/community-activity"): _operation(
        "my_community_activity_api_my_community_activity_get",
        "active_consumer",
        "frontend/lib/member-follow-api.ts",
    ),
    ("GET", "/api/my/saved-recipes"): _operation(
        "my_saved_recipe_library_api_my_saved_recipes_get",
        "active_consumer",
        "frontend/lib/recipe-library-api.ts",
    ),
    ("GET", "/api/readiness"): _operation(
        "readiness_check_api_readiness_get",
        "staff_internal",
        "docs/operations-observability.md",
    ),
    ("GET", "/api/recipe-drafts"): _operation(
        "my_private_recipe_drafts_api_recipe_drafts_get",
        "active_consumer",
        "frontend/lib/recipe-draft-api.ts",
    ),
    ("POST", "/api/recipe-drafts"): _operation(
        "create_private_recipe_draft_api_recipe_drafts_post",
        "active_consumer",
        "frontend/lib/recipe-draft-api.ts",
    ),
    ("DELETE", "/api/recipe-drafts/{draft_id}"): _operation(
        "delete_private_recipe_draft_api_recipe_drafts__draft_id__delete",
        "active_consumer",
        "frontend/lib/recipe-draft-api.ts",
    ),
    ("GET", "/api/recipe-drafts/{draft_id}"): _operation(
        "private_recipe_draft_detail_api_recipe_drafts__draft_id__get",
        "active_consumer",
        "frontend/lib/recipe-draft-api.ts",
    ),
    ("PUT", "/api/recipe-drafts/{draft_id}"): _operation(
        "save_private_recipe_draft_api_recipe_drafts__draft_id__put",
        "active_consumer",
        "frontend/lib/recipe-draft-api.ts",
    ),
    ("POST", "/api/recipe-drafts/{draft_id}/duplicate-preflights"): _operation(
        "create_original_draft_duplicate_preflight_api_recipe_drafts__draft_id__duplicate_preflights_post",
        "active_consumer",
        "frontend/lib/recipe-duplicate-api.ts",
    ),
    ("POST", "/api/recipe-drafts/{draft_id}/publish"): _operation(
        "publish_original_draft_api_recipe_drafts__draft_id__publish_post",
        "active_consumer",
        "frontend/lib/recipe-publication-api.ts",
    ),
    ("GET", "/api/recipes"): _operation(
        "browse_recipes_api_recipes_get",
        "active_consumer",
        "frontend/lib/recipe-api.ts",
    ),
    ("GET", "/api/recipe-categories"): _operation(
        "recipe_categories_api_recipe_categories_get",
        "active_consumer",
        "frontend/lib/recipe-api.ts",
    ),
    ("GET", "/api/recipes/featured"): _operation(
        "featured_recipes_api_recipes_featured_get",
        "active_consumer",
        "frontend/lib/recipe-api.ts",
    ),
    ("GET", "/api/recipes/viewer-states"): _operation(
        "recipe_viewer_states_for_current_user_api_recipes_viewer_states_get",
        "active_consumer",
        "frontend/lib/interaction-api.ts",
    ),
    ("GET", "/api/recipes/{recipe_version_id}"): _operation(
        "recipe_detail_api_recipes__recipe_version_id__get",
        "active_consumer",
        "frontend/lib/recipe-api.ts",
    ),
    ("GET", "/api/recipes/{recipe_version_id}/diff"): _operation(
        "recipe_diff_api_recipes__recipe_version_id__diff_get",
        "active_consumer",
        "frontend/lib/recipe-api.ts",
    ),
    ("PUT", "/api/recipes/{recipe_version_id}/rating"): _operation(
        "rate_recipe_for_current_user_api_recipes__recipe_version_id__rating_put",
        "active_consumer",
        "frontend/lib/interaction-api.ts",
    ),
    ("DELETE", "/api/recipes/{recipe_version_id}/rating"): _operation(
        "unrate_recipe_for_current_user_api_recipes__recipe_version_id__rating_delete",
        "active_consumer",
        "frontend/lib/interaction-api.ts",
    ),
    ("POST", "/api/recipes/{recipe_version_id}/reports"): _operation(
        "report_recipe_api_recipes__recipe_version_id__reports_post",
        "active_consumer",
        "frontend/lib/recipe-report-api.ts",
    ),
    ("DELETE", "/api/recipes/{recipe_version_id}/save"): _operation(
        "unsave_recipe_for_current_user_api_recipes__recipe_version_id__save_delete",
        "active_consumer",
        "frontend/lib/interaction-api.ts",
    ),
    ("PUT", "/api/recipes/{recipe_version_id}/save"): _operation(
        "save_recipe_for_current_user_api_recipes__recipe_version_id__save_put",
        "active_consumer",
        "frontend/lib/interaction-api.ts",
    ),
    ("POST", "/api/recipes/{recipe_version_id}/view"): _operation(
        "record_recipe_view_for_current_user_api_recipes__recipe_version_id__view_post",
        "active_consumer",
        "frontend/lib/interaction-api.ts",
    ),
    ("PUT", "/api/recipes/{recipe_version_id}/visibility"): _operation(
        "update_authored_recipe_visibility_api_recipes__recipe_version_id__visibility_put",
        "active_consumer",
        "frontend/lib/recipe-visibility-api.ts",
    ),
    ("GET", "/api/recommendations"): _operation(
        "get_recommendations_api_recommendations_get",
        "research_experimental",
        "docs/recommendations.md",
    ),
}

FRAMEWORK_ROUTE_CONTRACTS: tuple[FrameworkRouteContract, ...] = (
    {"path": "/docs", "methods": ["GET", "HEAD"]},
    {"path": "/docs/oauth2-redirect", "methods": ["GET", "HEAD"]},
    {"path": "/openapi.json", "methods": ["GET", "HEAD"]},
    {"path": "/redoc", "methods": ["GET", "HEAD"]},
)


class OpenAPIContractError(RuntimeError):
    """Raised when the executable API and reviewed registry do not match."""


def _walk_executable_routes(
    routes: Iterable[Any],
    *,
    prefix: str = "",
) -> list[tuple[str, str]]:
    keys: list[tuple[str, str]] = []
    for route in routes:
        original_router = getattr(route, "original_router", None)
        include_context = getattr(route, "include_context", None)
        if original_router is not None and include_context is not None:
            nested_prefix = f"{prefix}{getattr(include_context, 'prefix', '')}"
            keys.extend(_walk_executable_routes(original_router.routes, prefix=nested_prefix))
            continue

        path = getattr(route, "path", None)
        methods = getattr(route, "methods", None)
        if isinstance(path, str) and methods:
            keys.extend((str(method).upper(), f"{prefix}{path}") for method in methods)
            continue

        raise OpenAPIContractError(
            "An executable route type is not represented by the reviewed HTTP inventory: "
            f"{type(route).__name__}."
        )
    return keys


def executable_route_keys(application: FastAPI) -> set[tuple[str, str]]:
    """Return every reachable HTTP method/path, including schema-excluded routes."""

    keys = _walk_executable_routes(application.routes)
    unique_keys = set(keys)
    if len(keys) != len(unique_keys):
        raise OpenAPIContractError("Duplicate executable method/path routes require review.")
    return unique_keys


def reviewed_executable_route_keys() -> set[tuple[str, str]]:
    framework_keys = {
        (method, route["path"])
        for route in FRAMEWORK_ROUTE_CONTRACTS
        for method in route["methods"]
    }
    return set(OPERATION_CONTRACTS) | framework_keys


def validate_executable_routes(application: FastAPI) -> None:
    """Fail closed when any live route is absent from the reviewed inventory."""

    executable = executable_route_keys(application)
    reviewed = reviewed_executable_route_keys()
    if executable != reviewed:
        unclassified = sorted(executable - reviewed)
        absent = sorted(reviewed - executable)
        raise OpenAPIContractError(
            f"Executable route inventory drifted; unclassified={unclassified!r}, absent={absent!r}."
        )


def _document_operation_keys(document: dict[str, Any]) -> set[tuple[str, str]]:
    paths = cast(dict[str, Any], document.get("paths", {}))
    return {
        (method.upper(), path)
        for path, path_item in paths.items()
        if isinstance(path_item, dict)
        for method in path_item
        if method.lower() in HTTP_METHODS
    }


def apply_contract_metadata(document: dict[str, Any]) -> dict[str, Any]:
    """Validate coverage and attach the reviewed metadata to an OpenAPI document."""

    generated = _document_operation_keys(document)
    reviewed = set(OPERATION_CONTRACTS)
    if generated != reviewed:
        unclassified = sorted(generated - reviewed)
        absent = sorted(reviewed - generated)
        raise OpenAPIContractError(
            "OpenAPI operation inventory drifted; "
            f"unclassified={unclassified!r}, absent={absent!r}."
        )

    operation_ids = [contract.operation_id for contract in OPERATION_CONTRACTS.values()]
    if len(operation_ids) != len(set(operation_ids)):
        raise OpenAPIContractError("Reviewed OpenAPI operation IDs must be unique.")

    known_operation_ids = set(operation_ids)
    for key, contract in OPERATION_CONTRACTS.items():
        unknown_successors = set(contract.successor_operation_ids) - known_operation_ids
        if unknown_successors:
            raise OpenAPIContractError(
                f"Reviewed successor operation IDs are unknown: {sorted(unknown_successors)!r}."
            )
        method, path = key
        operation = cast(dict[str, Any], document["paths"][path][method.lower()])
        operation["operationId"] = contract.operation_id
        operation["x-recipe-lab-classification"] = contract.classification
        operation["x-recipe-lab-reachability"] = contract.reachability
        operation["x-recipe-lab-consumer-evidence"] = list(contract.consumer_evidence)
        operation["x-recipe-lab-external-consumer-status"] = EXTERNAL_CONSUMER_STATUS
        if contract.successor_operation_ids:
            operation["x-recipe-lab-successor-operation-ids"] = list(
                contract.successor_operation_ids
            )

    document["x-recipe-lab-external-consumer-status"] = EXTERNAL_CONSUMER_STATUS
    document["x-recipe-lab-framework-routes"] = [
        {
            **route,
            "classification": "staff_internal",
            "reachability": "internal",
            "consumer_evidence": ["docs/api-contracts.md"],
            "external_consumer_status": EXTERNAL_CONSUMER_STATUS,
        }
        for route in FRAMEWORK_ROUTE_CONTRACTS
    ]
    return document


def install_openapi_contract(application: FastAPI) -> None:
    """Make the application's OpenAPI rendering use the reviewed registry."""

    default_openapi = application.openapi

    def contract_openapi() -> dict[str, Any]:
        validate_executable_routes(application)
        if application.openapi_schema is None:
            application.openapi_schema = apply_contract_metadata(default_openapi())
        return application.openapi_schema

    application.openapi = contract_openapi  # type: ignore[method-assign]


def render_snapshot(document: dict[str, Any]) -> str:
    """Render a canonical UTF-8 JSON snapshot with dictionary keys sorted recursively."""

    return json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def generate_snapshot() -> str:
    """Generate the current contract without starting a server or connecting to PostgreSQL."""

    from app.main import create_app

    return render_snapshot(create_app().openapi())


def check_snapshot(path: Path = SNAPSHOT_PATH) -> bool:
    """Return whether *path* is readable and exactly matches the current contract."""

    try:
        committed = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return False
    return committed == generate_snapshot()


def write_snapshot(path: Path = SNAPSHOT_PATH) -> None:
    """Write the canonical contract snapshot."""

    path.write_text(generate_snapshot(), encoding="utf-8", newline="\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check or write the backend OpenAPI baseline.")
    parser.add_argument("command", nargs="?", choices=("check", "write"), default="check")
    args = parser.parse_args(argv)

    try:
        if args.command == "write":
            write_snapshot()
            print("Wrote the reviewed OpenAPI contract snapshot.")
            return 0
        if check_snapshot():
            print("The reviewed OpenAPI contract snapshot is current.")
            return 0
    except OpenAPIContractError as error:
        print(str(error), file=sys.stderr)
        return 1

    print(
        "The committed OpenAPI contract is missing, unreadable, or stale. "
        "Review the contract change, then run `python -m app.openapi_contract write`.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
