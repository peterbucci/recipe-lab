import io
import os
import subprocess
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch
from uuid import uuid4

from scripts import run_sandbox_acceptance as acceptance


class SandboxAcceptanceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.environment = {
            "CI": "true",
            "GITHUB_ACTIONS": "true",
            "DATABASE_URL": "postgresql+psycopg://recipe_lab:recipe_lab@127.0.0.1:5432/recipe_lab_acceptance",
            "OIDC_ISSUER": "https://unused.example.test",
            "OIDC_CLIENT_ID": "unused-provider",
            "ACCEPTANCE_SESSION_FIXTURE": "/private/existing-fixture",
        }

    def test_environment_is_bounded_separate_and_provider_free(self) -> None:
        now, identifier = datetime.now(UTC), uuid4()
        environment = acceptance.sandbox_environment(
            self.environment, started_at=now, generation_id=identifier
        )
        self.assertTrue(environment["DATABASE_URL"].endswith("/recipe_lab_sandbox_acceptance"))
        self.assertEqual(environment["APP_ENVIRONMENT"], "local")
        self.assertEqual(environment["SANDBOX_STARTED_AT"], now.isoformat())
        self.assertEqual(environment["SANDBOX_EXPIRES_AT"], (now + timedelta(hours=1)).isoformat())
        self.assertEqual(environment["SANDBOX_GENERATION_ID"], str(identifier))
        self.assertEqual(environment["RECIPE_API_URL"], "http://127.0.0.1:8100")
        self.assertEqual(environment["PLAYWRIGHT_BASE_URL"], "http://127.0.0.1:3100")
        self.assertEqual(environment["OIDC_ISSUER"], "")
        self.assertEqual(environment["OIDC_CLIENT_ID"], "")
        self.assertNotIn("ACCEPTANCE_SESSION_FIXTURE", environment)

    def test_environment_refuses_development_or_non_ci_database(self) -> None:
        for overrides in (
            {"CI": "false"},
            {"GITHUB_ACTIONS": "false"},
            {
                "DATABASE_URL": self.environment["DATABASE_URL"].replace(
                    "recipe_lab_acceptance", "recipe_lab"
                )
            },
            {
                "DATABASE_URL": self.environment["DATABASE_URL"].replace(
                    "127.0.0.1", "remote.example.test"
                )
            },
        ):
            with self.subTest(overrides=overrides), self.assertRaises(ValueError):
                acceptance.sandbox_environment(
                    {**self.environment, **overrides},
                    started_at=datetime.now(UTC),
                    generation_id=uuid4(),
                )

    def test_preexisting_database_is_never_adopted_or_mutated(self) -> None:
        connection = MagicMock()
        connection.scalar.return_value = 123
        with self.assertRaises(ValueError):
            acceptance.create_isolated_database(connection)
        connection.execute.assert_not_called()

    def test_cleanup_rechecks_database_identity_before_drop(self) -> None:
        connection = MagicMock()
        connection.scalar.return_value = 456
        with self.assertRaises(ValueError):
            acceptance.destroy_isolated_database(connection, expected_oid=123)
        connection.execute.assert_not_called()
        connection.scalar.return_value = 123
        acceptance.destroy_isolated_database(connection, expected_oid=123)
        self.assertEqual(
            str(connection.execute.call_args.args[0]),
            "DROP DATABASE recipe_lab_sandbox_acceptance WITH (FORCE)",
        )

    def test_failed_migration_removes_only_created_database_and_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            runner_temp = Path(temporary)
            unrelated = runner_temp / "existing-artifact.txt"
            unrelated.write_text("Keep this", encoding="utf-8")
            engine = MagicMock()
            connection = engine.connect.return_value.__enter__.return_value
            with (
                patch.dict(os.environ, {**self.environment, "RUNNER_TEMP": temporary}, clear=True),
                patch.object(acceptance, "IS_LINUX_RUNNER", True),
                patch.object(acceptance, "create_engine", return_value=engine),
                patch.object(acceptance, "require_unused_ports"),
                patch.object(acceptance, "create_isolated_database", return_value=123),
                patch.object(acceptance, "destroy_isolated_database") as destroy,
                patch.object(
                    acceptance.subprocess,
                    "run",
                    side_effect=subprocess.CalledProcessError(1, "synthetic"),
                ),
                patch.object(acceptance.subprocess, "Popen") as start,
                patch("sys.stderr", new_callable=io.StringIO),
            ):
                self.assertEqual(acceptance.main(), 1)
            destroy.assert_called_once_with(connection, expected_oid=123)
            start.assert_not_called()
            self.assertFalse((runner_temp / acceptance.RESULTS_NAME).exists())
            self.assertTrue(unrelated.exists())

    def test_success_reuses_built_frontend_with_separate_runtime_and_cleans(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            engine = MagicMock()
            backend, browser = MagicMock(), MagicMock()
            browser.wait.return_value = 0
            with (
                patch.dict(os.environ, {**self.environment, "RUNNER_TEMP": temporary}, clear=True),
                patch.object(acceptance, "IS_LINUX_RUNNER", True),
                patch.object(acceptance, "create_engine", return_value=engine),
                patch.object(acceptance, "require_unused_ports"),
                patch.object(acceptance, "verify_backend_generation"),
                patch.object(acceptance, "create_isolated_database", return_value=123),
                patch.object(acceptance, "destroy_isolated_database") as destroy,
                patch.object(acceptance.subprocess, "run") as command,
                patch.object(
                    acceptance.subprocess, "Popen", side_effect=[backend, browser]
                ) as start,
                patch.object(acceptance, "endpoint_is_ready", return_value=True),
                patch.object(acceptance, "stop_process_group") as stop,
                patch("sys.stdout", new_callable=io.StringIO),
            ):
                self.assertEqual(acceptance.main(), 0)
            self.assertEqual(command.call_count, 3)
            backend_call, browser_call = start.call_args_list
            self.assertIn("--no-access-log", backend_call.args[0])
            self.assertEqual(backend_call.kwargs["env"]["APP_ENVIRONMENT"], "local")
            self.assertEqual(browser_call.kwargs["env"]["APP_ENVIRONMENT"], "production")
            self.assertIn("--reporter=github", browser_call.args[0])
            self.assertEqual(stop.call_args_list[0].args, (browser,))
            self.assertEqual(stop.call_args_list[1].args, (backend,))
            destroy.assert_called_once()
            self.assertFalse((Path(temporary) / acceptance.RESULTS_NAME).exists())

    def test_backend_generation_rejects_an_unrelated_ready_service(self) -> None:
        backend = MagicMock()
        backend.poll.return_value = None
        with patch.object(acceptance, "urlopen") as request:
            request.return_value.__enter__.return_value.read.return_value = (
                b'{"enabled":true,"generation_id":"another-generation"}'
            )
            with self.assertRaises(RuntimeError):
                acceptance.verify_backend_generation(
                    backend, {"SANDBOX_GENERATION_ID": str(uuid4())}
                )

    def test_stopped_backend_never_borrows_readiness_from_another_service(self) -> None:
        backend = MagicMock()
        backend.poll.return_value = 1
        with patch.object(acceptance, "urlopen") as request, self.assertRaises(RuntimeError):
            acceptance.verify_backend_generation(backend, {"SANDBOX_GENERATION_ID": str(uuid4())})
        request.assert_not_called()


if __name__ == "__main__":
    unittest.main()
