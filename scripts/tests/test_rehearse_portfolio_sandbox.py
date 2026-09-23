import io
import json
import ssl
import unittest
from contextlib import ExitStack, contextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from scripts import rehearse_portfolio_sandbox as rehearsal
from scripts import run_portfolio_sandbox as sandbox


class RehearsalTests(unittest.TestCase):
    def setUp(self) -> None:
        now = datetime.now(UTC)
        self.generation = sandbox.Generation(uuid4(), now, now + timedelta(minutes=3))
        self.arguments = [
            "--backend-image",
            "sha256:" + "a" * 64,
            "--frontend-image",
            "sha256:" + "b" * 64,
        ]

    def test_http_failure_does_not_expose_path_body_or_cookie(self) -> None:
        response = MagicMock()
        response.__enter__.return_value = response
        response.status = 403
        opener = MagicMock()
        opener.open.return_value = response
        with patch.object(rehearsal, "build_opener", return_value=opener):
            visitor = rehearsal.Visitor(ssl.create_default_context())
        with self.assertRaises(sandbox.SandboxOperationError) as error:
            visitor.request("/api/private-secret-id", method="POST", body={"private": "secret"})
        self.assertNotIn("secret", str(error.exception))
        self.assertIn("expected 200, got 403", str(error.exception))

    def test_old_cookie_is_explicitly_replayed_even_after_cookie_jar_expiry(self) -> None:
        response = MagicMock()
        response.__enter__.return_value = response
        response.status = 200
        response.read.return_value = b'{"status":"anonymous"}'
        opener = MagicMock()
        opener.open.return_value = response
        with patch.object(rehearsal, "build_opener", return_value=opener):
            visitor = rehearsal.Visitor(ssl.create_default_context())
        visitor.request("/api/auth/session", cookie_header="recipe_lab_session=old-test-cookie")
        request = opener.open.call_args.args[0]
        self.assertEqual(request.headers["Cookie"], "recipe_lab_session=old-test-cookie")
        self.assertEqual(request.full_url, rehearsal.ORIGIN + "/api/auth/session")

    def test_frontend_lifecycle_probe_checks_exact_status_and_body(self) -> None:
        response = MagicMock()
        response.__enter__.return_value = response
        response.status = 503
        response.read.return_value = b"unavailable\n"
        opener = MagicMock()
        opener.open.return_value = response
        with patch.object(rehearsal, "build_opener", return_value=opener):
            visitor = rehearsal.Visitor(ssl.create_default_context())
        visitor.verify_frontend_lifecycle_probe("/readyz")
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, rehearsal.ORIGIN + "/readyz")

    def test_frontend_lifecycle_probe_rejects_other_paths(self) -> None:
        opener = MagicMock()
        with patch.object(rehearsal, "build_opener", return_value=opener):
            visitor = rehearsal.Visitor(ssl.create_default_context())
        with self.assertRaises(sandbox.SandboxOperationError):
            visitor.verify_frontend_lifecycle_probe("/api/health")
        opener.open.assert_not_called()

    def test_frontend_lifecycle_probe_requires_exact_status_and_body(self) -> None:
        for status, body in ((200, b"unavailable\n"), (503, b"ready\n")):
            with self.subTest(status=status, body=body):
                response = MagicMock()
                response.__enter__.return_value = response
                response.status = status
                response.read.return_value = body
                opener = MagicMock()
                opener.open.return_value = response
                with patch.object(rehearsal, "build_opener", return_value=opener):
                    visitor = rehearsal.Visitor(ssl.create_default_context())
                with self.assertRaises(sandbox.SandboxOperationError):
                    visitor.verify_frontend_lifecycle_probe("/readyz")

    def test_database_attestation_is_read_only_and_checks_exact_owner_first(self) -> None:
        with (
            patch.object(sandbox, "_owned_container", return_value=True) as owned,
            patch.object(sandbox, "docker", return_value='BEGIN\n{"users":2}\nROLLBACK') as docker,
        ):
            result = rehearsal._database_counts(self.generation)
        owned.assert_called_once_with(f"{self.generation.prefix}-db", self.generation)
        self.assertEqual(result, {"users": 2})
        command = docker.call_args.args[0]
        self.assertIn(self.generation.database_name, command)
        self.assertTrue(command[-1].startswith("BEGIN READ ONLY;"))
        self.assertTrue(command[-1].endswith("ROLLBACK;"))

    def test_database_attestation_refuses_unowned_container(self) -> None:
        with (
            patch.object(sandbox, "_owned_container", return_value=False),
            patch.object(sandbox, "docker") as docker,
        ):
            with self.assertRaises(sandbox.SandboxOperationError):
                rehearsal._database_counts(self.generation)
        docker.assert_not_called()

    def test_private_backend_probe_uses_only_owned_internal_health_routes(self) -> None:
        with (
            patch.object(sandbox, "_owned_container", return_value=True) as owned,
            patch.object(sandbox, "docker") as docker,
        ):
            rehearsal._verify_private_backend_status(self.generation, "/api/readiness", 503)
        name = f"{self.generation.prefix}-backend"
        owned.assert_called_once_with(name, self.generation)
        command = docker.call_args.args[0]
        self.assertEqual(command[:3], ["exec", name, "python"])
        self.assertEqual(command[-2:], ["/api/readiness", "503"])
        self.assertIn("ProxyHandler({})", command[-3])

    def test_private_backend_probe_refuses_unowned_or_public_paths(self) -> None:
        with (
            patch.object(sandbox, "_owned_container", return_value=False),
            patch.object(sandbox, "docker") as docker,
        ):
            with self.assertRaises(sandbox.SandboxOperationError):
                rehearsal._verify_private_backend_status(self.generation, "/api/readiness", 503)
        docker.assert_not_called()
        with (
            patch.object(sandbox, "_owned_container", return_value=True),
            patch.object(sandbox, "docker") as docker,
        ):
            with self.assertRaises(sandbox.SandboxOperationError):
                rehearsal._verify_private_backend_status(self.generation, "/api/recipes", 503)
        docker.assert_not_called()

    def test_deadline_keeps_health_routes_private(self) -> None:
        expired = sandbox.Generation(
            self.generation.identifier,
            self.generation.started_at,
            datetime.now(UTC) - timedelta(seconds=4),
        )
        visitor = MagicMock()
        with (
            patch.object(sandbox, "_owned_container", return_value=False),
            patch.object(rehearsal, "_verify_private_backend_status") as private_probe,
        ):
            rehearsal._deadline(expired, visitor)
        self.assertEqual(
            [item.args for item in visitor.request.call_args_list],
            [
                ("/api/recipes",),
                ("/api/readiness",),
                ("/api/health",),
            ],
        )
        self.assertEqual(
            [item.kwargs for item in visitor.request.call_args_list],
            [{"expected": 503}, {"expected": 404}, {"expected": 404}],
        )
        self.assertEqual(
            [item.args for item in visitor.verify_frontend_lifecycle_probe.call_args_list],
            [("/readyz",), ("/healthz",)],
        )
        self.assertEqual(
            [item.args for item in private_probe.call_args_list],
            [
                (expired, "/api/readiness", 503),
                (expired, "/api/health", 200),
            ],
        )

    def test_binding_checks_changed_id_and_deadline_then_original(self) -> None:
        with (
            patch.object(sandbox, "_owned_container", return_value=True),
            patch.object(
                rehearsal.subprocess,
                "run",
                return_value=SimpleNamespace(
                    returncode=1, stderr=b"Sandbox generation operation failed.\n", stdout=b""
                ),
            ) as run,
            patch.object(sandbox, "docker") as docker,
        ):
            rehearsal._verify_binding(self.generation)
        self.assertEqual(run.call_count, 2)
        overrides = [call.args[0][3] for call in run.call_args_list]
        self.assertTrue(overrides[0].startswith("SANDBOX_GENERATION_ID="))
        self.assertTrue(overrides[1].startswith("SANDBOX_EXPIRES_AT="))
        docker.assert_called_once()
        self.assertNotIn("--env", docker.call_args.args[0])

    def test_docker_failure_does_not_count_as_binding_policy_refusal(self) -> None:
        with (
            patch.object(sandbox, "_owned_container", return_value=True),
            patch.object(
                rehearsal.subprocess,
                "run",
                return_value=SimpleNamespace(
                    returncode=1, stderr=b"daemon unavailable", stdout=b""
                ),
            ),
            patch.object(sandbox, "docker") as docker,
        ):
            with self.assertRaises(sandbox.SandboxOperationError):
                rehearsal._verify_binding(self.generation)
        docker.assert_not_called()

    def test_storage_rejects_a_persistent_mount(self) -> None:
        metadata = [
            {
                "HostConfig": {
                    "LogConfig": {"Type": "none"},
                    "RestartPolicy": {"Name": "no"},
                    "Memory": 100,
                    "MemorySwap": 100,
                },
                "Mounts": [{"Type": "volume"}],
            }
        ]
        with (
            patch.object(sandbox, "_owned_container", return_value=True),
            patch.object(sandbox, "docker", return_value=json.dumps(metadata)),
        ):
            with self.assertRaises(sandbox.SandboxOperationError) as error:
                rehearsal._verify_storage(self.generation)
        self.assertIn("persistent storage", str(error.exception))

    def test_database_may_not_join_public_ingress(self) -> None:
        metadata = [
            {
                "HostConfig": {
                    "LogConfig": {"Type": "none"},
                    "RestartPolicy": {"Name": "no"},
                    "Memory": 100,
                    "MemorySwap": 100,
                    "AutoRemove": True,
                    "PortBindings": {},
                },
                "Mounts": [{"Type": "tmpfs"}],
                "NetworkSettings": {
                    "Ports": {},
                    "Networks": {
                        self.generation.prefix: {},
                        f"{self.generation.prefix}-ingress": {},
                    },
                },
            }
        ]
        with (
            patch.object(sandbox, "_owned_container", return_value=True),
            patch.object(sandbox, "docker", return_value=json.dumps(metadata)),
        ):
            with self.assertRaises(sandbox.SandboxOperationError) as error:
                rehearsal._verify_storage(self.generation)
        self.assertIn("outside its intended networks", str(error.exception))

    @contextmanager
    def _main_patches(self):
        baseline = dict.fromkeys(rehearsal.TABLES, 0)
        baseline.update({"recipe_versions": 34, "users": 2, "seed_fingerprint": "synthetic"})
        populated = dict(baseline)
        for table in (
            "recipe_saves",
            "recipe_ratings",
            "user_follows",
            "recipe_reports",
            "ingredient_catalog_requests",
        ):
            populated[table] += 1
        visitor = MagicMock()
        visitor.cookies = [SimpleNamespace(name="recipe_lab_session", value="synthetic-credential")]
        visitor.request.return_value = {"status": "anonymous"}
        identifiers = {name: "synthetic" for name in ("draft", "recipe", "handle", "request")}
        with ExitStack() as stack:
            stack.enter_context(patch.object(rehearsal, "_https_proxy", return_value=MagicMock()))
            stack.enter_context(patch.object(rehearsal, "_verify_storage"))
            stack.enter_context(patch.object(rehearsal, "_verify_binding"))
            stack.enter_context(patch.object(rehearsal, "_removed"))
            stack.enter_context(patch.object(rehearsal, "Visitor"))
            stack.enter_context(
                patch.object(
                    rehearsal, "_database_counts", side_effect=[baseline, populated, baseline]
                )
            )
            stack.enter_context(
                patch.object(rehearsal, "_populate", return_value=(visitor, identifiers))
            )
            stack.enter_context(
                patch.object(
                    rehearsal, "_deadline", side_effect=lambda *_args: visitor.cookies.clear()
                )
            )
            start = stack.enter_context(patch.object(sandbox, "start_generation"))
            destroy = stack.enter_context(patch.object(sandbox, "destroy_generation"))
            stdout = stack.enter_context(patch("sys.stdout", new_callable=io.StringIO))
            stderr = stack.enter_context(patch("sys.stderr", new_callable=io.StringIO))
            yield start, destroy, visitor, stdout, stderr

    def test_main_runs_two_generations_replays_stale_cookie_and_cleans_both(self) -> None:
        with self._main_patches() as (start, destroy, visitor, stdout, stderr):
            result = rehearsal.main(self.arguments)
        self.assertEqual(result, 0)
        self.assertEqual(start.call_count, 2)
        first, second = [call.args[0] for call in start.call_args_list]
        self.assertNotEqual(first.identifier, second.identifier)
        self.assertEqual([call.args[0] for call in destroy.call_args_list], [first, second, first])
        visitor.request.assert_any_call(
            "/api/auth/session", cookie_header="recipe_lab_session=synthetic-credential"
        )
        self.assertNotIn("synthetic-credential", stdout.getvalue() + stderr.getvalue())
        self.assertIn("PASS", stdout.getvalue())

    def test_failed_start_is_cleaned_without_starting_replacement(self) -> None:
        with self._main_patches() as (start, destroy, _visitor, _stdout, stderr):
            start.side_effect = KeyboardInterrupt()
            result = rehearsal.main(self.arguments)
        self.assertEqual(result, 1)
        start.assert_called_once()
        destroy.assert_called_once_with(start.call_args.args[0])
        self.assertIn("FAIL", stderr.getvalue())

    def test_failed_cleanup_does_not_open_replacement(self) -> None:
        with self._main_patches() as (start, destroy, _visitor, _stdout, stderr):
            destroy.side_effect = sandbox.SandboxOperationError("Ownership verification failed.")
            result = rehearsal.main(self.arguments)
        self.assertEqual(result, 1)
        start.assert_called_once()
        self.assertIn("cleanup needs inspection", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
