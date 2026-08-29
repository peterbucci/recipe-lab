#!/usr/bin/env python3
"""Compile bounded, privacy-safe evidence for a fail-closed release rehearsal."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from collections.abc import Sequence
from pathlib import Path
from typing import cast

TOOL_NAME = "recipe-lab-release-evidence"
TOOL_VERSION = "1.0.0"
EVIDENCE_SCHEMA_VERSION = 1
SOURCE_MANIFEST_SCHEMA_VERSION = 1
IMAGE_REPORT_SCHEMA_VERSION = 1
SCANNER_SUMMARY_SCHEMA_VERSION = 1
PHASE_SUMMARY_SCHEMA_VERSION = 1
PASSED = "passed"

SOURCE_TOOL = {"name": "recipe-lab-safe-source-export", "version": "1.0.0"}
SOURCE_SCANNER = {"name": "recipe-lab-source-secret-scan", "version": "2"}
IMAGE_TOOL = {"name": "recipe-lab-production-image-verifier", "version": "1.1.0"}
PINNED_SCANNER_NAME = "trivy"

COMMIT_SHA = re.compile(r"[0-9a-f]{40}\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
SHA256_IDENTIFIER = re.compile(r"sha256:[0-9a-f]{64}\Z")
SAFE_VERSION = re.compile(r"[0-9]+(?:\.[0-9]+){1,3}(?:[-+][0-9A-Za-z.-]+)?\Z")
ALEMBIC_REVISION = re.compile(r"(?:base|[0-9]{8}_[0-9]{4})\Z")

MAX_SOURCE_MANIFEST_BYTES = 4 * 1024 * 1024
MAX_SMALL_SUMMARY_BYTES = 64 * 1024

type JsonObject = dict[str, object]


class ReleaseEvidenceError(RuntimeError):
    """A privacy-safe release-rehearsal failure."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ReleaseEvidenceError(message)


def _require_exact_keys(
    value: JsonObject, expected: frozenset[str], label: str
) -> None:
    _require(frozenset(value) == expected, f"The {label} keys do not match its schema.")


def _require_object(value: object, label: str) -> JsonObject:
    _require(isinstance(value, dict), f"The {label} must be a JSON object.")
    return cast(JsonObject, value)


def _require_list(value: object, label: str) -> list[object]:
    _require(isinstance(value, list), f"The {label} must be a JSON array.")
    return cast(list[object], value)


def _require_string(value: object, pattern: re.Pattern[str], label: str) -> str:
    _require(isinstance(value, str), f"The {label} must be a string.")
    normalized = cast(str, value)
    _require(pattern.fullmatch(normalized) is not None, f"The {label} is invalid.")
    return normalized


def _reject_duplicate_keys(pairs: list[tuple[str, object]]) -> JsonObject:
    value: JsonObject = {}
    for key, item in pairs:
        if key in value:
            raise ReleaseEvidenceError("A release input contains duplicate JSON keys.")
        value[key] = item
    return value


def load_bounded_json_object(path: Path, *, max_bytes: int) -> JsonObject:
    """Load one strict UTF-8 JSON object without exposing its content in failures."""

    try:
        with path.open("rb") as stream:
            encoded = stream.read(max_bytes + 1)
        _require(0 < len(encoded) <= max_bytes, "A release input has an invalid size.")
        content = encoded.decode("utf-8")
    except (OSError, UnicodeError) as error:
        raise ReleaseEvidenceError("A release input could not be read.") from error
    try:
        value = json.loads(content, object_pairs_hook=_reject_duplicate_keys)
    except (RecursionError, ReleaseEvidenceError, ValueError) as error:
        raise ReleaseEvidenceError(
            "A release input is not valid strict JSON."
        ) from error
    return _require_object(value, "release input")


def _validate_source_manifest(
    manifest: JsonObject,
    *,
    commit_sha: str,
    archive_sha256: str,
) -> None:
    _require_exact_keys(
        manifest,
        frozenset(
            {
                "archive",
                "files",
                "policy",
                "scanner",
                "schema_version",
                "source",
                "tool",
            }
        ),
        "safe-source manifest",
    )
    _require(
        manifest["schema_version"] == SOURCE_MANIFEST_SCHEMA_VERSION,
        "The safe-source manifest schema is unsupported.",
    )

    tool = _require_object(manifest["tool"], "safe-source tool")
    _require_exact_keys(tool, frozenset({"name", "version"}), "safe-source tool")
    _require(tool == SOURCE_TOOL, "The safe-source tool is not the reviewed version.")

    source = _require_object(manifest["source"], "safe-source identity")
    _require_exact_keys(
        source, frozenset({"commit_sha", "working_tree"}), "safe-source identity"
    )
    _require(
        source["commit_sha"] == commit_sha, "The safe-source commit does not match."
    )
    _require(source["working_tree"] == "clean", "The safe-source tree was not clean.")

    archive = _require_object(manifest["archive"], "safe-source archive")
    _require_exact_keys(
        archive,
        frozenset(
            {
                "compressed_bytes",
                "entry_count",
                "format",
                "root",
                "sha256",
                "uncompressed_bytes",
            }
        ),
        "safe-source archive",
    )
    _require(
        archive["format"] == "zip", "The safe-source archive format is unsupported."
    )
    _require(
        archive["root"] == f"recipe-lab-{commit_sha[:12]}/",
        "The safe-source archive root does not match its commit.",
    )
    _require(
        archive["sha256"] == archive_sha256,
        "The safe-source archive hash does not match.",
    )
    _require_object(manifest["policy"], "safe-source policy")
    _require_list(manifest["files"], "safe-source files")

    scanner = _require_object(manifest["scanner"], "safe-source scanner")
    _require_exact_keys(
        scanner,
        frozenset(
            {
                "findings",
                "name",
                "passes",
                "result",
                "sha256",
                "text_files_scanned_per_pass",
                "version",
            }
        ),
        "safe-source scanner",
    )
    _require(
        scanner["name"] == SOURCE_SCANNER["name"], "The source scanner name is invalid."
    )
    _require(
        scanner["version"] == SOURCE_SCANNER["version"],
        "The source scanner version is unsupported.",
    )
    _require(scanner["result"] == PASSED, "The safe-source secret scan did not pass.")
    _require(
        scanner["findings"] == 0,
        "The safe-source secret scan found prohibited material.",
    )
    _require(
        scanner["passes"] == ["commit-tree", "completed-archive"],
        "The safe-source scan passes are incomplete.",
    )
    _require_string(scanner["sha256"], SHA256, "safe-source scanner hash")


def _validate_image_report(report: JsonObject) -> tuple[str, str]:
    _require_exact_keys(
        report,
        frozenset({"images", "schema_version", "status", "tool"}),
        "production-image report",
    )
    _require(
        report["schema_version"] == IMAGE_REPORT_SCHEMA_VERSION,
        "The production-image report schema is unsupported.",
    )
    _require(report["status"] == PASSED, "Production-image verification did not pass.")
    tool = _require_object(report["tool"], "production-image tool")
    _require_exact_keys(tool, frozenset({"name", "version"}), "production-image tool")
    _require(
        tool == IMAGE_TOOL, "The production-image tool is not the reviewed version."
    )
    images = _require_object(report["images"], "production images")
    _require_exact_keys(images, frozenset({"backend", "frontend"}), "production images")
    identifiers: list[str] = []
    for role in ("backend", "frontend"):
        identity = _require_object(images[role], f"{role} image identity")
        _require_exact_keys(identity, frozenset({"id"}), f"{role} image identity")
        identifiers.append(
            _require_string(identity["id"], SHA256_IDENTIFIER, f"{role} image ID")
        )
    _require(
        identifiers[0] != identifiers[1],
        "The backend and frontend image IDs must differ.",
    )
    return identifiers[0], identifiers[1]


def _validate_scanner_summary(
    summary: JsonObject,
    *,
    commit_sha: str,
    archive_sha256: str,
    backend_image_id: str,
    frontend_image_id: str,
    rollback_backend_image_id: str,
    rollback_frontend_image_id: str,
) -> tuple[str, str]:
    _require_exact_keys(
        summary,
        frozenset({"checks", "schema_version", "tool"}),
        "scanner summary",
    )
    _require(
        summary["schema_version"] == SCANNER_SUMMARY_SCHEMA_VERSION,
        "The scanner summary schema is unsupported.",
    )
    tool = _require_object(summary["tool"], "scanner tool")
    _require_exact_keys(
        tool, frozenset({"database_revision", "name", "version"}), "scanner tool"
    )
    _require(
        tool["name"] == PINNED_SCANNER_NAME, "The scanner tool is not allowlisted."
    )
    version = _require_string(tool["version"], SAFE_VERSION, "scanner version")
    database_revision = _require_string(
        tool["database_revision"], SHA256_IDENTIFIER, "scanner database revision"
    )

    checks = _require_object(summary["checks"], "scanner checks")
    _require_exact_keys(
        checks,
        frozenset(
            {
                "candidate_backend",
                "candidate_frontend",
                "rollback_backend",
                "rollback_frontend",
                "source",
            }
        ),
        "scanner checks",
    )
    source = _require_object(checks["source"], "source scan result")
    _require_exact_keys(
        source,
        frozenset({"archive_sha256", "commit_sha", "status"}),
        "source scan result",
    )
    _require(source["status"] == PASSED, "The source dependency scan did not pass.")
    _require(
        source["commit_sha"] == commit_sha, "The scanned source commit does not match."
    )
    _require(
        source["archive_sha256"] == archive_sha256,
        "The scanned source archive hash does not match.",
    )
    for role, expected_id in (
        ("candidate_backend", backend_image_id),
        ("candidate_frontend", frontend_image_id),
        ("rollback_backend", rollback_backend_image_id),
        ("rollback_frontend", rollback_frontend_image_id),
    ):
        result = _require_object(checks[role], f"{role} scan result")
        _require_exact_keys(
            result, frozenset({"image_id", "status"}), f"{role} scan result"
        )
        _require(result["status"] == PASSED, f"The {role} image scan did not pass.")
        _require(
            result["image_id"] == expected_id,
            f"The scanned {role} image ID does not match.",
        )
    return version, database_revision


def _validate_phase_summary(
    summary: JsonObject,
    *,
    phase: str,
) -> tuple[str | None, str | None]:
    expected_keys = {"phase", "schema_version", "status"}
    if phase == "migration":
        expected_keys.update({"end_revision", "start_revision"})
    _require_exact_keys(summary, frozenset(expected_keys), f"{phase} phase summary")
    _require(
        summary["schema_version"] == PHASE_SUMMARY_SCHEMA_VERSION,
        f"The {phase} phase summary schema is unsupported.",
    )
    _require(summary["phase"] == phase, f"The {phase} phase summary is mislabeled.")
    _require(summary["status"] == PASSED, f"The {phase} phase did not pass.")
    if phase != "migration":
        return None, None
    start = _require_string(
        summary["start_revision"], ALEMBIC_REVISION, "migration start revision"
    )
    end = _require_string(
        summary["end_revision"], ALEMBIC_REVISION, "migration end revision"
    )
    return start, end


def compile_release_evidence(
    *,
    commit_sha: str,
    rollback_commit_sha: str,
    source_archive_sha256: str,
    source_manifest: JsonObject,
    image_report: JsonObject,
    rollback_image_report: JsonObject,
    scanner_summary: JsonObject,
    migration_summary: JsonObject,
    smoke_summary: JsonObject,
    recovery_summary: JsonObject,
    rollback_summary: JsonObject,
    community_journey_summary: JsonObject,
) -> JsonObject:
    """Validate all release inputs and return one deterministic safe summary."""

    normalized_commit = _require_string(commit_sha, COMMIT_SHA, "release commit")
    normalized_rollback_commit = _require_string(
        rollback_commit_sha, COMMIT_SHA, "rollback release commit"
    )
    normalized_archive_sha = _require_string(
        source_archive_sha256, SHA256, "source archive hash"
    )
    _validate_source_manifest(
        source_manifest,
        commit_sha=normalized_commit,
        archive_sha256=normalized_archive_sha,
    )
    backend_image_id, frontend_image_id = _validate_image_report(image_report)
    rollback_backend_image_id, rollback_frontend_image_id = _validate_image_report(
        rollback_image_report
    )
    scanner_version, scanner_database_revision = _validate_scanner_summary(
        scanner_summary,
        commit_sha=normalized_commit,
        archive_sha256=normalized_archive_sha,
        backend_image_id=backend_image_id,
        frontend_image_id=frontend_image_id,
        rollback_backend_image_id=rollback_backend_image_id,
        rollback_frontend_image_id=rollback_frontend_image_id,
    )
    start_revision, end_revision = _validate_phase_summary(
        migration_summary, phase="migration"
    )
    _validate_phase_summary(smoke_summary, phase="smoke")
    _validate_phase_summary(recovery_summary, phase="recovery")
    _validate_phase_summary(rollback_summary, phase="rollback")
    _validate_phase_summary(community_journey_summary, phase="community_journey")
    assert start_revision is not None
    assert end_revision is not None

    return {
        "checks": {
            "candidate_backend_image_scan": PASSED,
            "candidate_frontend_image_scan": PASSED,
            "candidate_production_images": PASSED,
            "migration": PASSED,
            "recovery": PASSED,
            "community_journey": PASSED,
            "rollback": PASSED,
            "rollback_backend_image_scan": PASSED,
            "rollback_frontend_image_scan": PASSED,
            "rollback_production_images": PASSED,
            "smoke": PASSED,
            "source_package": PASSED,
            "source_scan": PASSED,
        },
        "commit_sha": normalized_commit,
        "image_ids": {
            "candidate": {
                "backend": backend_image_id,
                "frontend": frontend_image_id,
            },
            "rollback": {
                "backend": rollback_backend_image_id,
                "frontend": rollback_frontend_image_id,
            },
        },
        "migration": {
            "end_revision": end_revision,
            "start_revision": start_revision,
        },
        "rollback_commit_sha": normalized_rollback_commit,
        "scanner": {
            "database_revision": scanner_database_revision,
            "tool": PINNED_SCANNER_NAME,
            "version": scanner_version,
        },
        "schema_version": EVIDENCE_SCHEMA_VERSION,
        "source_archive_sha256": normalized_archive_sha,
    }


def write_release_evidence(path: Path, evidence: JsonObject) -> None:
    """Write canonical JSON atomically and never replace an existing artifact."""

    destination = path.resolve()
    try:
        parent = destination.parent.resolve(strict=True)
    except OSError as error:
        raise ReleaseEvidenceError(
            "The evidence directory could not be resolved."
        ) from error
    _require(parent.is_dir(), "The evidence directory is not a directory.")
    _require(
        not destination.exists(),
        "Release evidence already exists; refusing to overwrite it.",
    )

    temporary: Path | None = None
    published = False
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            prefix=f".{destination.name}.",
            suffix=".tmp",
            dir=parent,
            delete=False,
        ) as handle:
            temporary = Path(handle.name)
            os.chmod(temporary, 0o600)
            handle.write(json.dumps(evidence, sort_keys=True, separators=(",", ":")))
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary, destination)
        except FileExistsError as error:
            raise ReleaseEvidenceError(
                "Release evidence appeared during publication; refusing to overwrite it."
            ) from error
        published = True
    except ReleaseEvidenceError:
        raise
    except OSError as error:
        raise ReleaseEvidenceError(
            "Release evidence could not be published."
        ) from error
    finally:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError as error:
                if published:
                    try:
                        destination.unlink(missing_ok=True)
                    except OSError:
                        pass
                raise ReleaseEvidenceError(
                    "Temporary release evidence could not be removed."
                ) from error


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Compile privacy-safe release rehearsal evidence."
    )
    parser.add_argument("--commit-sha", required=True)
    parser.add_argument("--rollback-commit-sha", required=True)
    parser.add_argument("--source-archive-sha256", required=True)
    parser.add_argument("--source-manifest", required=True, type=Path)
    parser.add_argument("--image-report", required=True, type=Path)
    parser.add_argument("--rollback-image-report", required=True, type=Path)
    parser.add_argument("--scanner-summary", required=True, type=Path)
    parser.add_argument("--migration-summary", required=True, type=Path)
    parser.add_argument("--smoke-summary", required=True, type=Path)
    parser.add_argument("--recovery-summary", required=True, type=Path)
    parser.add_argument("--rollback-summary", required=True, type=Path)
    parser.add_argument("--community-journey-summary", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--version", action="version", version=f"{TOOL_NAME} {TOOL_VERSION}"
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    try:
        evidence = compile_release_evidence(
            commit_sha=arguments.commit_sha,
            rollback_commit_sha=arguments.rollback_commit_sha,
            source_archive_sha256=arguments.source_archive_sha256,
            source_manifest=load_bounded_json_object(
                arguments.source_manifest, max_bytes=MAX_SOURCE_MANIFEST_BYTES
            ),
            image_report=load_bounded_json_object(
                arguments.image_report, max_bytes=MAX_SMALL_SUMMARY_BYTES
            ),
            rollback_image_report=load_bounded_json_object(
                arguments.rollback_image_report, max_bytes=MAX_SMALL_SUMMARY_BYTES
            ),
            scanner_summary=load_bounded_json_object(
                arguments.scanner_summary, max_bytes=MAX_SMALL_SUMMARY_BYTES
            ),
            migration_summary=load_bounded_json_object(
                arguments.migration_summary, max_bytes=MAX_SMALL_SUMMARY_BYTES
            ),
            smoke_summary=load_bounded_json_object(
                arguments.smoke_summary, max_bytes=MAX_SMALL_SUMMARY_BYTES
            ),
            recovery_summary=load_bounded_json_object(
                arguments.recovery_summary, max_bytes=MAX_SMALL_SUMMARY_BYTES
            ),
            rollback_summary=load_bounded_json_object(
                arguments.rollback_summary, max_bytes=MAX_SMALL_SUMMARY_BYTES
            ),
            community_journey_summary=load_bounded_json_object(
                arguments.community_journey_summary, max_bytes=MAX_SMALL_SUMMARY_BYTES
            ),
        )
        write_release_evidence(arguments.output, evidence)
    except ReleaseEvidenceError:
        print("Release evidence could not be produced.", file=sys.stderr)
        return 1
    print("Release evidence compiled successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
