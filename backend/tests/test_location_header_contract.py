from typing import Any, cast

from app.main import create_app

HTTP_METHODS = frozenset({"delete", "get", "patch", "post", "put"})
EXPECTED_LOCATION_HEADERS = {
    ("/api/ingredient-requests", "post", "201"): (
        "api-resource",
        "/api/ingredient-requests/{request_id}",
    ),
    ("/api/recipe-drafts", "post", "201"): (
        "api-resource",
        "/api/recipe-drafts/{draft_id}",
    ),
    ("/api/recipe-drafts/{draft_id}/publish", "post", "201"): (
        "product-route",
        "/recipes/{recipe_version_id}",
    ),
}


def _object(value: object) -> dict[str, Any]:
    assert isinstance(value, dict)
    return cast(dict[str, Any], value)


def test_openapi_advertises_only_readable_or_approved_location_targets() -> None:
    paths = _object(create_app().openapi()["paths"])
    advertised: dict[tuple[str, str, str], tuple[str, str]] = {}

    for path, raw_path_item in paths.items():
        path_item = _object(raw_path_item)
        for method, raw_operation in path_item.items():
            if method not in HTTP_METHODS:
                continue
            operation = _object(raw_operation)
            responses = _object(operation["responses"])
            for status_code, raw_response in responses.items():
                response = _object(raw_response)
                raw_headers = response.get("headers", {})
                headers = _object(raw_headers)
                for header_name, raw_header in headers.items():
                    if header_name.casefold() != "location":
                        continue
                    header = _object(raw_header)
                    route_kind = header.get("x-recipe-lab-route-kind")
                    target = header.get("x-recipe-lab-readable-target")
                    assert isinstance(route_kind, str)
                    assert isinstance(target, str)
                    advertised[(path, method, str(status_code))] = (
                        route_kind,
                        target,
                    )

    assert advertised == EXPECTED_LOCATION_HEADERS

    for route_kind, target in advertised.values():
        if route_kind == "api-resource":
            assert target in paths
            assert "get" in _object(paths[target])
        else:
            assert (route_kind, target) == (
                "product-route",
                "/recipes/{recipe_version_id}",
            )

    duplicate_preflight = _object(
        _object(paths["/api/recipe-drafts/{draft_id}/duplicate-preflights"])["post"]
    )
    report_recipe = _object(_object(paths["/api/recipes/{recipe_version_id}/reports"])["post"])
    assert "201" in _object(duplicate_preflight["responses"])
    assert {"200", "201"} <= set(_object(report_recipe["responses"]))
