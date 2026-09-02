from fastapi import Response

from app.api.cache import apply_private_no_store, private_no_store_headers
from app.db.query import LIKE_ESCAPE, escape_like_literal, literal_contains_pattern


def test_literal_like_helpers_escape_every_wildcard_character() -> None:
    value = r"100%_real\\name"

    assert LIKE_ESCAPE == "\\"
    assert escape_like_literal(value) == r"100\%\_real\\\\name"
    assert literal_contains_pattern(value) == r"%100\%\_real\\\\name%"


def test_private_no_store_policy_is_consistent_and_returns_fresh_mappings() -> None:
    response = Response()

    apply_private_no_store(response)
    first = private_no_store_headers()
    second = private_no_store_headers()

    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["vary"] == "Cookie"
    assert first == {"Cache-Control": "private, no-store", "Vary": "Cookie"}
    assert first is not second

    first["Cache-Control"] = "public"
    assert second["Cache-Control"] == "private, no-store"
