import pytest

from app.core.canonical_documents import canonical_document_json, canonical_document_sha256


def test_canonical_document_json_is_sorted_compact_unicode() -> None:
    document = {"z": [2, 1], "message": "crème brûlée", "a": {"d": 4, "c": 3}}

    assert canonical_document_json(document) == (
        '{"a":{"c":3,"d":4},"message":"crème brûlée","z":[2,1]}'
    )
    assert canonical_document_sha256(document) == (
        "e61b010a7e990502d163047e8be8722bee591766a52b820bf6fd8a8662590b06"
    )


def test_canonical_document_json_rejects_non_finite_numbers() -> None:
    with pytest.raises(ValueError, match="Out of range float values"):
        canonical_document_json({"value": float("nan")})
