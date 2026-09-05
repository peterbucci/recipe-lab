"""Byte-stable JSON documents used for durable request and evidence digests."""

import hashlib
import json


def canonical_document_json(document: object) -> str:
    """Serialize one JSON-compatible document with the repository's stable byte contract."""

    return json.dumps(
        document,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def canonical_document_sha256(document: object) -> str:
    """Hash the UTF-8 bytes of :func:`canonical_document_json`."""

    return hashlib.sha256(canonical_document_json(document).encode("utf-8")).hexdigest()
