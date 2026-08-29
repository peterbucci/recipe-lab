from __future__ import annotations

import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts import rehearse_release

COMMIT_SHA = "a" * 40
ROLLBACK_COMMIT_SHA = "9" * 40
ARCHIVE_SHA256 = "b" * 64
BACKEND_IMAGE_ID = f"sha256:{'c' * 64}"
FRONTEND_IMAGE_ID = f"sha256:{'d' * 64}"
SCANNER_DATABASE_REVISION = f"sha256:{'e' * 64}"
ROLLBACK_BACKEND_IMAGE_ID = f"sha256:{'4' * 64}"
ROLLBACK_FRONTEND_IMAGE_ID = f"sha256:{'5' * 64}"


def _source_manifest() -> dict[str, object]:
    return {
        "archive": {
            "compressed_bytes": 12,
            "entry_count": 1,
            "format": "zip",
            "root": f"recipe-lab-{COMMIT_SHA[:12]}/",
            "sha256": ARCHIVE_SHA256,
            "uncompressed_bytes": 4,
        },
        "files": [
            {
                "compressed_bytes": 6,
                "git_object_id": "f" * 40,
                "mode": "100644",
                "path": "README.md",
                "sha256": "1" * 64,
                "size_bytes": 4,
            }
        ],
        "policy": {
            "limits": {
                "max_compressed_bytes": 25 * 1024 * 1024,
                "max_entries": 2_000,
                "max_file_bytes": 10 * 1024 * 1024,
                "max_path_bytes": 512,
                "max_uncompressed_bytes": 25 * 1024 * 1024,
            },
            "reviewed_opaque_entries": 0,
            "sha256": "2" * 64,
            "version": 2,
        },
        "scanner": {
            "findings": 0,
            "name": "recipe-lab-source-secret-scan",
            "passes": ["commit-tree", "completed-archive"],
            "result": "passed",
            "sha256": "3" * 64,
            "text_files_scanned_per_pass": 1,
            "version": "2",
        },
        "schema_version": 1,
        "source": {"commit_sha": COMMIT_SHA, "working_tree": "clean"},
        "tool": {"name": "recipe-lab-safe-source-export", "version": "1.0.0"},
    }


def _image_report() -> dict[str, object]:
    return {
        "images": {
            "backend": {"id": BACKEND_IMAGE_ID},
            "frontend": {"id": FRONTEND_IMAGE_ID},
        },
        "schema_version": 1,
        "status": "passed",
        "tool": {
            "name": "recipe-lab-production-image-verifier",
            "version": "1.1.0",
        },
    }


def _rollback_image_report() -> dict[str, object]:
    report = _image_report()
    report["images"] = {
        "backend": {"id": ROLLBACK_BACKEND_IMAGE_ID},
        "frontend": {"id": ROLLBACK_FRONTEND_IMAGE_ID},
    }
    return report


def _scanner_summary() -> dict[str, object]:
    return {
        "checks": {
            "candidate_backend": {
                "image_id": BACKEND_IMAGE_ID,
                "status": "passed",
            },
            "candidate_frontend": {
                "image_id": FRONTEND_IMAGE_ID,
                "status": "passed",
            },
            "rollback_backend": {
                "image_id": ROLLBACK_BACKEND_IMAGE_ID,
                "status": "passed",
            },
            "rollback_frontend": {
                "image_id": ROLLBACK_FRONTEND_IMAGE_ID,
                "status": "passed",
            },
            "source": {
                "archive_sha256": ARCHIVE_SHA256,
                "commit_sha": COMMIT_SHA,
                "status": "passed",
            },
        },
        "schema_version": 1,
        "tool": {
            "database_revision": SCANNER_DATABASE_REVISION,
            "name": "trivy",
            "version": "1.2.3",
        },
    }


def _migration_summary() -> dict[str, object]:
    return {
        "end_revision": "20260828_0020",
        "phase": "migration",
        "schema_version": 1,
        "start_revision": "20260827_0019",
        "status": "passed",
    }


def _simple_phase(phase: str) -> dict[str, object]:
    return {"phase": phase, "schema_version": 1, "status": "passed"}


def _compile(**overrides: object) -> dict[str, object]:
    arguments: dict[str, object] = {
        "commit_sha": COMMIT_SHA,
        "rollback_commit_sha": ROLLBACK_COMMIT_SHA,
        "source_archive_sha256": ARCHIVE_SHA256,
        "source_manifest": _source_manifest(),
        "image_report": _image_report(),
        "rollback_image_report": _rollback_image_report(),
        "scanner_summary": _scanner_summary(),
        "migration_summary": _migration_summary(),
        "smoke_summary": _simple_phase("smoke"),
        "recovery_summary": _simple_phase("recovery"),
        "rollback_summary": _simple_phase("rollback"),
        "community_journey_summary": _simple_phase("community_journey"),
    }
    arguments.update(overrides)
    return rehearse_release.compile_release_evidence(**arguments)  # type: ignore[arg-type]


class ReleaseEvidenceTests(unittest.TestCase):
    def test_compiles_only_fixed_privacy_safe_evidence(self) -> None:
        evidence = _compile()

        self.assertEqual(
            evidence,
            {
                "checks": {
                    "candidate_backend_image_scan": "passed",
                    "candidate_frontend_image_scan": "passed",
                    "candidate_production_images": "passed",
                    "migration": "passed",
                    "recovery": "passed",
                    "community_journey": "passed",
                    "rollback": "passed",
                    "rollback_backend_image_scan": "passed",
                    "rollback_frontend_image_scan": "passed",
                    "rollback_production_images": "passed",
                    "smoke": "passed",
                    "source_package": "passed",
                    "source_scan": "passed",
                },
                "commit_sha": COMMIT_SHA,
                "image_ids": {
                    "candidate": {
                        "backend": BACKEND_IMAGE_ID,
                        "frontend": FRONTEND_IMAGE_ID,
                    },
                    "rollback": {
                        "backend": ROLLBACK_BACKEND_IMAGE_ID,
                        "frontend": ROLLBACK_FRONTEND_IMAGE_ID,
                    },
                },
                "migration": {
                    "end_revision": "20260828_0020",
                    "start_revision": "20260827_0019",
                },
                "rollback_commit_sha": ROLLBACK_COMMIT_SHA,
                "scanner": {
                    "database_revision": SCANNER_DATABASE_REVISION,
                    "tool": "trivy",
                    "version": "1.2.3",
                },
                "schema_version": 1,
                "source_archive_sha256": ARCHIVE_SHA256,
            },
        )
        rendered = json.dumps(evidence)
        self.assertNotIn("README", rendered)
        self.assertNotIn("recipe-lab-backend", rendered)

    def test_rejects_extra_or_missing_input_fields(self) -> None:
        source_with_extra = _source_manifest()
        source_with_extra["private_note"] = "must not be accepted"
        image_without_status = _image_report()
        image_without_status.pop("status")
        rollback_image_with_extra = _rollback_image_report()
        rollback_image_with_extra["tag"] = "must not be retained"
        scanner_without_rollback = _scanner_summary()
        scanner_checks = scanner_without_rollback["checks"]
        assert isinstance(scanner_checks, dict)
        scanner_checks.pop("rollback_frontend")
        recovery_with_extra = _simple_phase("recovery")
        recovery_with_extra["detail"] = "must not be retained"
        community_journey_without_status = _simple_phase("community_journey")
        community_journey_without_status.pop("status")

        for key, value in (
            ("source_manifest", source_with_extra),
            ("image_report", image_without_status),
            ("rollback_image_report", rollback_image_with_extra),
            ("scanner_summary", scanner_without_rollback),
            ("recovery_summary", recovery_with_extra),
            ("community_journey_summary", community_journey_without_status),
        ):
            with (
                self.subTest(key=key),
                self.assertRaises(rehearse_release.ReleaseEvidenceError),
            ):
                _compile(**{key: value})

    def test_rejects_mismatched_commit_archive_and_image_bindings(self) -> None:
        wrong_source_commit = _source_manifest()
        source_identity = wrong_source_commit["source"]
        assert isinstance(source_identity, dict)
        source_identity["commit_sha"] = "9" * 40

        wrong_archive_scan = _scanner_summary()
        scan_checks = wrong_archive_scan["checks"]
        assert isinstance(scan_checks, dict)
        source_scan = scan_checks["source"]
        assert isinstance(source_scan, dict)
        source_scan["archive_sha256"] = "8" * 64

        wrong_backend_scan = _scanner_summary()
        bound_checks = wrong_backend_scan["checks"]
        assert isinstance(bound_checks, dict)
        backend_scan = bound_checks["candidate_backend"]
        assert isinstance(backend_scan, dict)
        backend_scan["image_id"] = f"sha256:{'7' * 64}"

        wrong_rollback_scan = _scanner_summary()
        rollback_checks = wrong_rollback_scan["checks"]
        assert isinstance(rollback_checks, dict)
        rollback_frontend_scan = rollback_checks["rollback_frontend"]
        assert isinstance(rollback_frontend_scan, dict)
        rollback_frontend_scan["image_id"] = f"sha256:{'6' * 64}"

        for key, value in (
            ("source_manifest", wrong_source_commit),
            ("scanner_summary", wrong_archive_scan),
            ("scanner_summary", wrong_backend_scan),
            ("scanner_summary", wrong_rollback_scan),
        ):
            with (
                self.subTest(key=key, value=value),
                self.assertRaises(rehearse_release.ReleaseEvidenceError),
            ):
                _compile(**{key: value})

        with self.assertRaises(rehearse_release.ReleaseEvidenceError):
            _compile(source_archive_sha256="6" * 64)
        with self.assertRaises(rehearse_release.ReleaseEvidenceError):
            _compile(rollback_commit_sha="not-a-commit")

    def test_rejects_unsafe_or_nonpassing_summaries(self) -> None:
        unsafe_scanner = _scanner_summary()
        scanner_tool = unsafe_scanner["tool"]
        assert isinstance(scanner_tool, dict)
        scanner_tool["version"] = "1.2.3\nprivate"

        failed_scan = _scanner_summary()
        failed_checks = failed_scan["checks"]
        assert isinstance(failed_checks, dict)
        failed_frontend = failed_checks["candidate_frontend"]
        assert isinstance(failed_frontend, dict)
        failed_frontend["status"] = "failed"

        failed_migration = _migration_summary()
        failed_migration["status"] = "failed"
        failed_smoke = _simple_phase("smoke")
        failed_smoke["status"] = "failed"

        for key, value in (
            ("scanner_summary", unsafe_scanner),
            ("scanner_summary", failed_scan),
            ("migration_summary", failed_migration),
            ("smoke_summary", failed_smoke),
        ):
            with (
                self.subTest(key=key),
                self.assertRaises(rehearse_release.ReleaseEvidenceError),
            ):
                _compile(**{key: value})

    def test_rejects_duplicate_json_keys_and_unbounded_inputs(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            duplicate = Path(temporary) / "duplicate.json"
            duplicate.write_text(
                '{"status":"passed","status":"failed"}', encoding="utf-8"
            )
            with self.assertRaises(rehearse_release.ReleaseEvidenceError):
                rehearse_release.load_bounded_json_object(duplicate, max_bytes=1024)

            oversized = Path(temporary) / "oversized.json"
            oversized.write_text('{"value":"too large"}', encoding="utf-8")
            with self.assertRaises(rehearse_release.ReleaseEvidenceError):
                rehearse_release.load_bounded_json_object(oversized, max_bytes=4)

            nested = Path(temporary) / "nested.json"
            nested.write_text("[" * 5_000 + "]" * 5_000, encoding="utf-8")
            with self.assertRaises(rehearse_release.ReleaseEvidenceError):
                rehearse_release.load_bounded_json_object(nested, max_bytes=64 * 1024)

    def test_writes_canonical_evidence_once(self) -> None:
        evidence = _compile()
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "release-evidence.json"

            rehearse_release.write_release_evidence(destination, evidence)

            expected = (
                json.dumps(evidence, sort_keys=True, separators=(",", ":")) + "\n"
            )
            self.assertEqual(destination.read_text(encoding="utf-8"), expected)
            with self.assertRaisesRegex(
                rehearse_release.ReleaseEvidenceError, "overwrite"
            ):
                rehearse_release.write_release_evidence(destination, evidence)
            self.assertEqual(destination.read_text(encoding="utf-8"), expected)

    def test_cli_failure_does_not_create_evidence_or_emit_success(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            inputs = {
                "source-manifest": _source_manifest(),
                "image-report": _image_report(),
                "rollback-image-report": _rollback_image_report(),
                "scanner-summary": _scanner_summary(),
                "migration-summary": _migration_summary(),
                "smoke-summary": _simple_phase("smoke"),
                "recovery-summary": _simple_phase("recovery"),
                "rollback-summary": _simple_phase("rollback"),
                "community-journey-summary": _simple_phase("community_journey"),
            }
            arguments = [
                "--commit-sha",
                "invalid-commit",
                "--rollback-commit-sha",
                ROLLBACK_COMMIT_SHA,
                "--source-archive-sha256",
                ARCHIVE_SHA256,
            ]
            for option, value in inputs.items():
                path = root / f"{option}.json"
                path.write_text(json.dumps(value), encoding="utf-8")
                arguments.extend((f"--{option}", str(path)))
            output = root / "evidence.json"
            arguments.extend(("--output", str(output)))
            stdout = io.StringIO()
            stderr = io.StringIO()

            with mock.patch("sys.stdout", stdout), mock.patch("sys.stderr", stderr):
                result = rehearse_release.main(arguments)

            self.assertEqual(result, 1)
            self.assertFalse(output.exists())
            self.assertNotIn("success", stdout.getvalue().casefold())
            self.assertNotIn("invalid-commit", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
