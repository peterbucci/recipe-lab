from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


class JsonCodecError(ValueError):
    """Raised before a domain validator receives an unsafe JSON document."""


@dataclass(frozen=True, slots=True)
class JsonDocumentLimits:
    maximum_utf8_bytes: int
    maximum_depth: int
    maximum_nodes: int

    def __post_init__(self) -> None:
        if self.maximum_utf8_bytes < 1:
            raise ValueError("maximum_utf8_bytes must be positive")
        if self.maximum_depth < 1:
            raise ValueError("maximum_depth must be positive")
        if self.maximum_nodes < 1:
            raise ValueError("maximum_nodes must be positive")


def _reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise JsonCodecError(f"duplicate JSON key: {key!r}")
        result[key] = value
    return result


def _validate_shape(
    document: object,
    *,
    limits: JsonDocumentLimits,
    document_name: str,
) -> None:
    nodes_seen = 0

    def visit(value: object, depth: int) -> None:
        nonlocal nodes_seen
        nodes_seen += 1
        if nodes_seen > limits.maximum_nodes:
            raise JsonCodecError(
                f"{document_name} exceeds the JSON node limit of {limits.maximum_nodes}"
            )
        if depth > limits.maximum_depth:
            raise JsonCodecError(
                f"{document_name} exceeds the JSON nesting limit of {limits.maximum_depth}"
            )
        if isinstance(value, dict):
            for child in value.values():
                visit(child, depth + 1)
        elif isinstance(value, list):
            for child in value:
                visit(child, depth + 1)

    visit(document, 1)


def _decode_json_document(
    text: str,
    *,
    byte_length: int,
    limits: JsonDocumentLimits,
    document_name: str,
) -> object:
    if byte_length > limits.maximum_utf8_bytes:
        raise JsonCodecError(
            f"{document_name} exceeds the JSON size limit of "
            f"{limits.maximum_utf8_bytes} UTF-8 bytes"
        )
    try:
        document = json.loads(text, object_pairs_hook=_reject_duplicate_keys)
    except json.JSONDecodeError as error:
        raise JsonCodecError(f"invalid JSON: {error.msg}") from error
    except RecursionError as error:
        raise JsonCodecError(
            f"{document_name} exceeds the JSON nesting limit of {limits.maximum_depth}"
        ) from error
    _validate_shape(document, limits=limits, document_name=document_name)
    return document


def decode_json_document(
    text: str,
    *,
    limits: JsonDocumentLimits,
    document_name: str,
) -> object:
    try:
        encoded = text.encode("utf-8")
    except UnicodeEncodeError as error:
        raise JsonCodecError(f"{document_name} must be valid UTF-8") from error
    return _decode_json_document(
        text,
        byte_length=len(encoded),
        limits=limits,
        document_name=document_name,
    )


def load_json_document(
    path: str | Path,
    *,
    limits: JsonDocumentLimits,
    document_name: str,
) -> object:
    with Path(path).open("rb") as stream:
        content = stream.read(limits.maximum_utf8_bytes + 1)
    if len(content) > limits.maximum_utf8_bytes:
        raise JsonCodecError(
            f"{document_name} exceeds the JSON size limit of "
            f"{limits.maximum_utf8_bytes} UTF-8 bytes"
        )
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError as error:
        raise JsonCodecError(f"{document_name} must be valid UTF-8") from error
    return _decode_json_document(
        text,
        byte_length=len(content),
        limits=limits,
        document_name=document_name,
    )


__all__ = [
    "JsonCodecError",
    "JsonDocumentLimits",
    "decode_json_document",
    "load_json_document",
]
