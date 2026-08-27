from __future__ import annotations

import json
import tempfile
import unittest
from collections.abc import Sequence
from pathlib import Path
from typing import Any
from unittest import mock

from scripts import verify_production_images as image_verifier


def _result(
    *arguments: str,
    returncode: int = 0,
    stdout: str = "",
    stderr: str = "",
) -> image_verifier.CommandResult:
    return image_verifier.CommandResult(
        arguments=("docker", *arguments),
        returncode=returncode,
        stdout=stdout,
        stderr=stderr,
    )


class FakeDockerClient(image_verifier.DockerClient):
    def __init__(
        self, results: list[image_verifier.CommandResult] | None = None
    ) -> None:
        self.results = list(results or [])
        self.calls: list[tuple[tuple[str, ...], bool]] = []

    def run(
        self,
        arguments: Sequence[str],
        *,
        check: bool = True,
    ) -> image_verifier.CommandResult:
        normalized = tuple(arguments)
        self.calls.append((normalized, check))
        if self.results:
            return self.results.pop(0)
        return _result(*normalized)


def _metadata(
    *,
    user: str = "recipe-lab",
    command: list[str] | None = None,
    environment: list[str] | None = None,
    healthcheck: dict[str, object] | None = None,
) -> str:
    return json.dumps(
        [
            {
                "Config": {
                    "User": user,
                    "Entrypoint": None,
                    "Cmd": command or ["uvicorn", "app.main:app"],
                    "Env": environment or ["APP_ENVIRONMENT=production"],
                    "Healthcheck": (
                        {"Test": ["CMD", "python", "-c", "health"]}
                        if healthcheck is None
                        else healthcheck
                    ),
                }
            }
        ]
    )


class ImageMetadataTests(unittest.TestCase):
    def test_accepts_non_root_production_image_without_baked_credentials(self) -> None:
        client = FakeDockerClient([_result(stdout=_metadata())])

        image_verifier.verify_image_metadata(client, "recipe-lab-backend:test")

    def test_rejects_root_development_and_credential_bearing_images(self) -> None:
        cases: tuple[tuple[dict[str, Any], str], ...] = (
            ({"user": "root"}, "non-root"),
            ({"command": ["uvicorn", "app.main:app", "--reload"]}, "development"),
            ({"command": ["npm", "run", "dev"]}, "development"),
            ({"command": ["node", "server.mjs", "--dev"]}, "development"),
            ({"environment": ["DATABASE_URL=postgresql://private"]}, "credential"),
            ({"healthcheck": {}}, "health check"),
        )
        for options, message in cases:
            with self.subTest(message=message):
                client = FakeDockerClient([_result(stdout=_metadata(**options))])
                with self.assertRaisesRegex(image_verifier.VerificationError, message):
                    image_verifier.verify_image_metadata(client, "recipe-lab:test")

    def test_backend_image_must_use_the_guarded_production_launcher(self) -> None:
        approved = FakeDockerClient(
            [
                _result(
                    stdout=_metadata(command=["python", "-m", "app.production_server"])
                )
            ]
        )
        image_verifier.verify_image_metadata(
            approved,
            "recipe-lab-backend:test",
            required_command=("python", "-m", "app.production_server"),
        )

        bypass = FakeDockerClient([_result(stdout=_metadata())])
        with self.assertRaisesRegex(
            image_verifier.VerificationError, "approved server launcher"
        ):
            image_verifier.verify_image_metadata(
                bypass,
                "recipe-lab-backend:test",
                required_command=("python", "-m", "app.production_server"),
            )

    def test_rejects_unreadable_or_unexpected_inspect_output(self) -> None:
        for payload in ("not-json", "[]", '[{"Config": null}]'):
            with self.subTest(payload=payload):
                client = FakeDockerClient([_result(stdout=payload)])
                with self.assertRaises(image_verifier.VerificationError):
                    image_verifier.verify_image_metadata(client, "recipe-lab:test")


class BuildAndContentTests(unittest.TestCase):
    def test_clean_build_targets_production_without_a_push_or_output(self) -> None:
        client = FakeDockerClient()
        context = Path.cwd().resolve()
        dockerfile = (context / "backend" / "Dockerfile").resolve()

        image_verifier.build_image(
            client,
            "recipe-lab-backend:test",
            context,
            dockerfile,
        )

        arguments, check = client.calls[0]
        self.assertTrue(check)
        self.assertEqual(
            arguments,
            (
                "build",
                "--no-cache",
                "--pull",
                "--target",
                "production",
                "--file",
                str(dockerfile),
                "--tag",
                "recipe-lab-backend:test",
                str(context),
            ),
        )
        self.assertNotIn("--push", arguments)
        self.assertNotIn("--output", arguments)

    def test_runtime_checks_cover_testing_packages_and_frontend_artifacts(self) -> None:
        client = FakeDockerClient()

        image_verifier.verify_runtime_contents(
            client,
            "recipe-lab-backend:test",
            "recipe-lab-frontend:test",
        )

        backend_command = " ".join(client.calls[0][0])
        frontend_command = " ".join(client.calls[1][0])
        self.assertIn('root / "app" / "testing"', backend_command)
        self.assertIn('find_spec("app.testing")', backend_command)
        self.assertIn('"ensurepip"', backend_command)
        self.assertIn('"pytest"', backend_command)
        self.assertIn('which("uv")', backend_command)
        self.assertIn("${root}/e2e", frontend_command)
        self.assertIn("node_modules/@playwright", frontend_command)
        self.assertIn("node_modules/playwright-core", frontend_command)
        self.assertIn("node_modules/vitest", frontend_command)
        self.assertIn('"/opt/yarn-v1.22.22"', frontend_command)
        self.assertIn('["npm", "npx", "yarn", "yarnpkg"]', frontend_command)

    def test_context_resolution_stays_inside_the_repository(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            repository = Path(temporary) / "repository"
            repository.mkdir()
            (repository / "backend").mkdir()
            outside = Path(temporary) / "outside"
            outside.mkdir()
            self.assertEqual(
                image_verifier._resolve_context(repository, Path("backend")),
                (repository / "backend").resolve(),
            )
            with self.assertRaisesRegex(image_verifier.VerificationError, "inside"):
                image_verifier._resolve_context(repository, outside)

            dockerfile = repository / "backend" / "Dockerfile"
            dockerfile.write_text("FROM scratch\n", encoding="utf-8")
            outside_dockerfile = outside / "Dockerfile"
            outside_dockerfile.write_text("FROM scratch\n", encoding="utf-8")
            self.assertEqual(
                image_verifier._resolve_dockerfile(
                    repository,
                    repository.resolve(),
                    Path("backend/Dockerfile"),
                ),
                dockerfile.resolve(),
            )
            with self.assertRaisesRegex(image_verifier.VerificationError, "inside"):
                image_verifier._resolve_dockerfile(
                    repository,
                    (repository / "backend").resolve(),
                    outside_dockerfile,
                )

    def test_image_tags_are_bounded_local_cli_values(self) -> None:
        self.assertEqual(
            image_verifier._validate_image_tag("recipe-lab/backend:rcp33d"),
            "recipe-lab/backend:rcp33d",
        )
        for tag in ("", "--help", "tag with spaces", "tag\nvalue"):
            with (
                self.subTest(tag=tag),
                self.assertRaises(image_verifier.VerificationError),
            ):
                image_verifier._validate_image_tag(tag)


class ConfigurationAndHealthTests(unittest.TestCase):
    correlation_id = "123e4567-e89b-42d3-a456-426614174000"

    def test_invalid_configuration_must_fail_without_exposing_the_canary(self) -> None:
        failed = _result(returncode=1, stderr="Configuration is invalid.")
        image_verifier._require_redacted_failure(failed, "private-canary", "backend")

        with self.assertRaisesRegex(image_verifier.VerificationError, "accepted"):
            image_verifier._require_redacted_failure(
                _result(returncode=0),
                "private-canary",
                "backend",
            )
        with self.assertRaisesRegex(image_verifier.VerificationError, "exposed"):
            image_verifier._require_redacted_failure(
                _result(returncode=1, stderr="private-canary"),
                "private-canary",
                "backend",
            )

    def test_frontend_health_contract_is_plain_text_private_and_uncached(self) -> None:
        image_verifier._assert_frontend_health(
            {
                "cache-control": "no-store",
                "content-type": "text/plain; charset=utf-8",
            },
            b"ok\n",
        )
        with self.assertRaises(image_verifier.VerificationError):
            image_verifier._assert_frontend_health(
                {"content-type": "text/plain; charset=utf-8"},
                b"ok\n",
            )

    def test_backend_health_contract_is_the_existing_api_payload(self) -> None:
        image_verifier._assert_backend_health(
            b'{"status":"ok","service":"recipe-lab-api"}',
            "recipe-lab-api",
        )
        with self.assertRaises(image_verifier.VerificationError):
            image_verifier._assert_backend_health(
                b'{"status":"degraded"}', "recipe-lab-api"
            )

    def test_backend_readiness_contract_fails_closed_without_database(self) -> None:
        image_verifier._assert_backend_readiness(
            200,
            b'{"status":"ready","service":"recipe-lab-api"}',
            "recipe-lab-api",
        )
        image_verifier._assert_backend_dependency_failure(
            503,
            json.dumps(
                {
                    "error": {
                        "code": "dependency_unavailable",
                        "correlation_id": self.correlation_id,
                        "issues": [],
                        "message": (
                            "A required service dependency is temporarily unavailable."
                        ),
                    }
                }
            ).encode(),
            self.correlation_id,
        )

        with self.assertRaisesRegex(
            image_verifier.VerificationError, "unavailable dependency"
        ):
            image_verifier._assert_backend_readiness(
                503,
                b"{}",
                "recipe-lab-api",
            )
        with self.assertRaisesRegex(
            image_verifier.VerificationError, "did not fail closed"
        ):
            image_verifier._assert_backend_dependency_failure(
                200,
                b"{}",
                self.correlation_id,
            )

    def test_backend_correlation_id_is_a_canonical_uuid4(self) -> None:
        self.assertEqual(
            image_verifier._assert_correlation_id(
                {"x-correlation-id": self.correlation_id}
            ),
            self.correlation_id,
        )
        for headers in (
            {},
            {"x-correlation-id": "123e4567-e89b-12d3-a456-426614174000"},
            {"x-correlation-id": "private-user-controlled-text"},
        ):
            with (
                self.subTest(headers=headers),
                self.assertRaises(image_verifier.VerificationError),
            ):
                image_verifier._assert_correlation_id(headers)

    def test_backend_correlation_id_must_be_fresh_for_each_smoke_request(self) -> None:
        seen: set[str] = set()
        headers = {"x-correlation-id": self.correlation_id}

        self.assertEqual(
            image_verifier._assert_correlation_id(headers, seen=seen),
            self.correlation_id,
        )
        with self.assertRaisesRegex(image_verifier.VerificationError, "reused"):
            image_verifier._assert_correlation_id(headers, seen=seen)

    def test_startup_proves_live_ready_and_database_unavailable_states(self) -> None:
        client = FakeDockerClient()
        backend_correlation_ids = (
            "123e4567-e89b-42d3-a456-426614174000",
            "223e4567-e89b-42d3-a456-426614174000",
            "323e4567-e89b-42d3-a456-426614174000",
            "423e4567-e89b-42d3-a456-426614174000",
        )
        backend_headers = tuple(
            {"x-correlation-id": value} for value in backend_correlation_ids
        )
        frontend_headers = {
            "cache-control": "no-store",
            "content-type": "text/plain; charset=utf-8",
        }
        unavailable_body = json.dumps(
            {
                "error": {
                    "code": "dependency_unavailable",
                    "correlation_id": backend_correlation_ids[3],
                    "issues": [],
                    "message": "A required service dependency is temporarily unavailable.",
                }
            }
        ).encode()
        endpoint_results = (
            (200, backend_headers[0], b'{"status":"ok","service":"recipe-lab-api"}'),
            (200, backend_headers[1], b'{"status":"ready","service":"recipe-lab-api"}'),
            (200, frontend_headers, b"ok\n"),
            (200, backend_headers[2], b'{"status":"ok","service":"recipe-lab-api"}'),
            (503, backend_headers[3], unavailable_body),
        )

        with (
            mock.patch.object(image_verifier, "_wait_for_container_health"),
            mock.patch.object(
                image_verifier,
                "_published_port",
                side_effect=(49101, 49102),
            ),
            mock.patch.object(
                image_verifier,
                "_read_endpoint",
                side_effect=endpoint_results,
            ) as read_endpoint,
        ):
            image_verifier.verify_startup_and_health(
                client,
                "recipe-lab-backend:test",
                "recipe-lab-frontend:test",
            )

        commands = [call[0] for call in client.calls]
        self.assertTrue(
            any(
                command[:2] == ("run", "--detach")
                and image_verifier.DATABASE_IMAGE in command
                for command in commands
            )
        )
        self.assertTrue(
            any(
                command[:2] == ("run", "--rm")
                and command[-3:] == ("alembic", "upgrade", "head")
                for command in commands
            )
        )
        self.assertTrue(
            any(command[:3] == ("stop", "--time", "0") for command in commands)
        )
        self.assertEqual(
            [call.args[1] for call in read_endpoint.call_args_list],
            [
                "/api/health",
                "/api/readiness",
                "/healthz",
                "/api/health",
                "/api/readiness",
            ],
        )

    def test_startup_cleanup_runs_when_a_health_check_fails(self) -> None:
        client = FakeDockerClient()
        with (
            mock.patch.object(
                image_verifier,
                "_wait_for_container_health",
                side_effect=image_verifier.VerificationError("health failed"),
            ),
            self.assertRaisesRegex(image_verifier.VerificationError, "health failed"),
        ):
            image_verifier.verify_startup_and_health(
                client,
                "recipe-lab-backend:test",
                "recipe-lab-frontend:test",
            )

        commands = [call[0][:2] for call in client.calls]
        self.assertIn(("rm", "--force"), commands)
        self.assertIn(("network", "rm"), commands)


if __name__ == "__main__":
    unittest.main()
