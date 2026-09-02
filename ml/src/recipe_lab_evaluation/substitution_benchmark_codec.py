from __future__ import annotations

from pathlib import Path

from .dataset import canonical_json
from .json_codec import (
    JsonCodecError,
    JsonDocumentLimits,
    decode_json_document,
    load_json_document,
)
from .substitution_dataset import (
    SubstitutionBenchmark,
    SubstitutionBenchmarkError,
    _normalized_document,
    _parse_substitution_benchmark_document,
)

_SUBSTITUTION_JSON_LIMITS = JsonDocumentLimits(
    maximum_utf8_bytes=32 * 1024 * 1024,
    maximum_depth=32,
    maximum_nodes=1_000_000,
)


def _codec_error(error: JsonCodecError) -> SubstitutionBenchmarkError:
    if str(error).startswith("duplicate JSON key:"):
        return SubstitutionBenchmarkError("substitution benchmark contains a duplicate JSON key")
    return SubstitutionBenchmarkError(str(error))


def parse_substitution_benchmark_json(text: str) -> SubstitutionBenchmark:
    try:
        raw = decode_json_document(
            text,
            limits=_SUBSTITUTION_JSON_LIMITS,
            document_name="substitution benchmark",
        )
    except JsonCodecError as error:
        raise _codec_error(error) from error
    return _parse_substitution_benchmark_document(raw)


def load_substitution_benchmark(path: str | Path) -> SubstitutionBenchmark:
    try:
        raw = load_json_document(
            path,
            limits=_SUBSTITUTION_JSON_LIMITS,
            document_name="substitution benchmark",
        )
    except JsonCodecError as error:
        raise _codec_error(error) from error
    return _parse_substitution_benchmark_document(raw)


def substitution_benchmark_to_json(benchmark: SubstitutionBenchmark) -> str:
    document = _normalized_document(
        schema_version=benchmark.schema_version,
        benchmark_id=benchmark.benchmark_id,
        limitations=benchmark.limitations,
        catalog=benchmark.catalog,
        cases=benchmark.cases,
    )
    return canonical_json(document) + "\n"


__all__ = [
    "load_substitution_benchmark",
    "parse_substitution_benchmark_json",
    "substitution_benchmark_to_json",
]
