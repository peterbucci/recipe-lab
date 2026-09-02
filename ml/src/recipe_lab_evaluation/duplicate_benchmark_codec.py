from __future__ import annotations

from pathlib import Path

from .dataset import canonical_json
from .duplicate_dataset import (
    DuplicateBenchmark,
    DuplicateBenchmarkError,
    _normalized_document,
    _parse_duplicate_benchmark_document,
)
from .json_codec import (
    JsonCodecError,
    JsonDocumentLimits,
    decode_json_document,
    load_json_document,
)

_DUPLICATE_JSON_LIMITS = JsonDocumentLimits(
    maximum_utf8_bytes=32 * 1024 * 1024,
    maximum_depth=32,
    maximum_nodes=1_000_000,
)


def _codec_error(error: JsonCodecError) -> DuplicateBenchmarkError:
    if str(error).startswith("duplicate JSON key:"):
        return DuplicateBenchmarkError("duplicate benchmark contains a duplicate JSON key")
    return DuplicateBenchmarkError(str(error))


def parse_duplicate_benchmark_json(text: str) -> DuplicateBenchmark:
    try:
        raw = decode_json_document(
            text,
            limits=_DUPLICATE_JSON_LIMITS,
            document_name="duplicate benchmark",
        )
    except JsonCodecError as error:
        raise _codec_error(error) from error
    return _parse_duplicate_benchmark_document(raw)


def load_duplicate_benchmark(path: str | Path) -> DuplicateBenchmark:
    try:
        raw = load_json_document(
            path,
            limits=_DUPLICATE_JSON_LIMITS,
            document_name="duplicate benchmark",
        )
    except JsonCodecError as error:
        raise _codec_error(error) from error
    return _parse_duplicate_benchmark_document(raw)


def duplicate_benchmark_to_json(benchmark: DuplicateBenchmark) -> str:
    return canonical_json(_normalized_document(benchmark)) + "\n"


__all__ = [
    "duplicate_benchmark_to_json",
    "load_duplicate_benchmark",
    "parse_duplicate_benchmark_json",
]
