from __future__ import annotations

from pathlib import Path

import pytest

from recipe_lab_evaluation.json_codec import (
    JsonCodecError,
    JsonDocumentLimits,
    decode_json_document,
    load_json_document,
)


def _limits(*, bytes: int = 100, depth: int = 4, nodes: int = 10) -> JsonDocumentLimits:
    return JsonDocumentLimits(
        maximum_utf8_bytes=bytes,
        maximum_depth=depth,
        maximum_nodes=nodes,
    )


def test_decoder_rejects_duplicate_keys_and_invalid_json() -> None:
    with pytest.raises(JsonCodecError, match="duplicate JSON key: 'value'"):
        decode_json_document(
            '{"value":1,"value":2}',
            limits=_limits(),
            document_name="fixture",
        )
    with pytest.raises(JsonCodecError, match="^invalid JSON:"):
        decode_json_document("{", limits=_limits(), document_name="fixture")


def test_decoder_enforces_byte_depth_and_node_limits() -> None:
    with pytest.raises(JsonCodecError, match="JSON size limit of 4 UTF-8 bytes"):
        decode_json_document('"éé"', limits=_limits(bytes=4), document_name="fixture")
    with pytest.raises(JsonCodecError, match="JSON nesting limit of 2"):
        decode_json_document("[[0]]", limits=_limits(depth=2), document_name="fixture")
    with pytest.raises(JsonCodecError, match="JSON node limit of 3"):
        decode_json_document("[0,1,2]", limits=_limits(nodes=3), document_name="fixture")


def test_loader_reads_only_through_the_configured_byte_boundary(tmp_path: Path) -> None:
    path = tmp_path / "oversized.json"
    path.write_bytes(b" " * 6)

    with pytest.raises(JsonCodecError, match="JSON size limit of 5 UTF-8 bytes"):
        load_json_document(path, limits=_limits(bytes=5), document_name="fixture")


def test_loader_rejects_invalid_utf8_without_exposing_the_path(tmp_path: Path) -> None:
    path = tmp_path / "private-name.json"
    path.write_bytes(b"\xff")

    with pytest.raises(JsonCodecError) as raised:
        load_json_document(path, limits=_limits(), document_name="fixture")

    assert str(raised.value) == "fixture must be valid UTF-8"
    assert str(path) not in str(raised.value)
