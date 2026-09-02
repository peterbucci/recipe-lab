import pytest
from fastapi import Response

from app.api.cache import apply_private_no_store, private_no_store_headers
from app.db.query import LIKE_ESCAPE, escape_like_literal, literal_contains_pattern
from app.pagination import PageParams, PageSlice


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


def test_page_params_cover_empty_exact_partial_and_boundary_pages() -> None:
    first = PageParams(page=1, page_size=20)
    boundary = PageParams(page=1_000_000, page_size=100)

    assert first.offset == 0
    assert first.total_pages(0) == 0
    assert first.total_pages(20) == 1
    assert first.total_pages(21) == 2
    assert boundary.offset == 99_999_900


def test_internal_page_types_reject_impossible_values() -> None:
    for page, page_size in ((0, 20), (1, 0)):
        with pytest.raises(ValueError):
            PageParams(page=page, page_size=page_size)

    with pytest.raises(ValueError):
        PageSlice[object](items=[], total=-1)
