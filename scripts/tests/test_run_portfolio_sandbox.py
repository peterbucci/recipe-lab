# ruff: noqa: SIM117

import io
import json
import os
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.error import URLError
from uuid import UUID

from scripts import run_portfolio_sandbox as sandbox


class PortfolioSandboxTests(unittest.TestCase):
    def setUp(self) -> None:
        start = datetime.now(UTC)
        self.generation = sandbox.Generation(
            UUID("40000000-0000-4000-8000-000000000001"),
            start,
            start + timedelta(hours=24),
        )

    def test_destruction_requires_exact_resource_owner(self) -> None:
        prefix = self.generation.prefix
        metadata = [
            {
                "Name": f"/{prefix}-frontend",
                "Config": {"Labels": {sandbox.LABEL: "another-generation"}},
            }
        ]
        with patch.object(
            sandbox, "docker", side_effect=["container-id", json.dumps(metadata)]
        ) as command:
            with self.assertRaises(sandbox.SandboxOperationError):
                sandbox.destroy_generation(self.generation)
            self.assertFalse(any("rm" in call.args[0] for call in command.call_args_list))

    def test_destruction_closes_listener_before_writers_and_storage(self) -> None:
        removed: list[str] = []

        def command(arguments: list[str], **_kwargs: object) -> str:
            if arguments[:2] == ["container", "ls"]:
                return "container-id"
            if arguments[:2] == ["container", "inspect"]:
                return json.dumps(
                    [
                        {
                            "Name": f"/{arguments[2]}",
                            "Config": {"Labels": {sandbox.LABEL: str(self.generation.identifier)}},
                        }
                    ]
                )
            if arguments[:2] == ["container", "rm"]:
                removed.append(arguments[-1])
            return ""

        with patch.object(sandbox, "docker", side_effect=command):
            sandbox.destroy_generation(self.generation)
        self.assertEqual(
            removed,
            [
                f"{self.generation.prefix}-{role}"
                for role in ("frontend", "backend", "initialize", "db")
            ],
        )

    def test_start_refuses_mutable_images_without_creating_resources(self) -> None:
        with patch.object(sandbox, "docker") as command:
            with self.assertRaises(sandbox.SandboxOperationError):
                sandbox.start_generation(
                    self.generation,
                    backend_image="backend:latest",
                    frontend_image="frontend:latest",
                    origin="https://portfolio.example",
                    contact_url="https://portfolio.example/contact",
                    port=3100,
                )
            command.assert_not_called()

    def test_start_uses_memory_storage_deadline_and_private_network(self) -> None:
        commands: list[tuple[list[str], dict[str, str] | None]] = []

        def command(arguments: list[str], *, environment: dict[str, str] | None = None) -> str:
            commands.append((arguments, environment))
            return arguments[-1] if arguments[:2] == ["image", "inspect"] else ""

        heartbeat_directory = tempfile.TemporaryDirectory()
        heartbeat = sandbox.SupervisorHeartbeat.create(
            Path(heartbeat_directory.name), self.generation
        )
        try:
            with (
                patch.dict(os.environ, {sandbox.TRUSTED_PROXY_PROOF_ENV: "a" * 64}),
                patch.object(sandbox, "docker", side_effect=command),
                patch.object(sandbox, "_verify_published_listener") as listener,
            ):
                sandbox.start_generation(
                    self.generation,
                    backend_image="sha256:" + "a" * 64,
                    frontend_image="sha256:" + "b" * 64,
                    origin="https://portfolio.example",
                    contact_url="mailto:me@peterbucci.com",
                    port=3100,
                    listen_host="172.17.0.1",
                    trusted_proxy_cidrs="172.18.0.0/16",
                    heartbeat=heartbeat,
                )
        finally:
            heartbeat.invalidate()
            heartbeat_directory.cleanup()
        listener.assert_called_once_with(3100, "172.17.0.1")
        db_args, db_env = next(
            (args, env)
            for args, env in commands
            if "--tmpfs" in args and sandbox.DATABASE_IMAGE in args
        )
        self.assertIn("/var/lib/postgresql/data:rw,nosuid,noexec,size=512m", db_args)
        self.assertIn("--rm", db_args)
        self.assertIn("--log-driver", db_args)
        self.assertNotIn("--publish", db_args)
        self.assertNotIn("--volume", db_args)
        assert db_env is not None
        self.assertEqual(
            db_env["SANDBOX_EXPIRES_EPOCH"],
            str(int(self.generation.expires_at.timestamp())),
        )
        backend_env = next(
            env
            for args, env in commands
            if args[0] == "run" and args[args.index("--name") + 1].endswith("-backend")
        )
        assert backend_env is not None
        self.assertEqual(backend_env["SANDBOX_CONTACT_URL"], "mailto:me@peterbucci.com")
        frontend_env = next(
            env
            for args, env in commands
            if args[0] == "run" and args[args.index("--name") + 1].endswith("-frontend")
        )
        assert frontend_env is not None
        self.assertEqual(frontend_env["TRUSTED_PROXY_CIDRS"], "172.18.0.0/16")
        self.assertEqual(frontend_env[sandbox.TRUSTED_PROXY_PROOF_ENV], "a" * 64)
        self.assertEqual(frontend_env[sandbox.HEARTBEAT_PATH_ENV], sandbox.HEARTBEAT_CONTAINER_PATH)
        self.assertEqual(
            frontend_env[sandbox.HEARTBEAT_TTL_ENV], str(sandbox.HEARTBEAT_TTL_SECONDS)
        )
        self.assertIn("kill -KILL", sandbox.DATABASE_DEADLINE_COMMAND)
        self.assertTrue(
            any(args[:3] == ["network", "create", "--internal"] for args, _ in commands)
        )
        for args, _ in commands:
            if args[0] != "run":
                continue
            networks = [args[index + 1] for index, value in enumerate(args) if value == "--network"]
            role_name = args[args.index("--name") + 1]
            if role_name.endswith("-frontend"):
                self.assertEqual(
                    networks,
                    [
                        self.generation.prefix,
                        f"name={self.generation.prefix}-ingress,gw-priority=1",
                    ],
                )
                self.assertIn("172.17.0.1:3100:3000", args)
                self.assertIn("--mount", args)
                self.assertIn(
                    (
                        f"type=bind,src={heartbeat.path},"
                        f"dst={sandbox.HEARTBEAT_CONTAINER_PATH},readonly"
                    ),
                    args,
                )
            else:
                self.assertEqual(networks, [self.generation.prefix])
                self.assertNotIn("--publish", args)
                self.assertNotIn("--mount", args)
            self.assertIn("--ulimit", args)
            self.assertIn("core=0:0", args)

    def test_heartbeat_is_unique_empty_and_refreshes_the_same_inode(self) -> None:
        initial = 1_700_000_000_000_000_000
        refreshed = initial + sandbox.HEARTBEAT_INTERVAL_SECONDS * 1_000_000_000
        with tempfile.TemporaryDirectory() as heartbeat_directory:
            with patch.object(sandbox.time, "time_ns", return_value=initial):
                heartbeat = sandbox.SupervisorHeartbeat.create(
                    Path(heartbeat_directory), self.generation
                )
            original = heartbeat.path.stat()
            self.assertRegex(heartbeat.path.name, sandbox.HEARTBEAT_NAME)
            self.assertEqual(original.st_size, 0)
            self.assertEqual(original.st_mtime_ns, initial)
            with patch.object(sandbox.time, "time_ns", return_value=refreshed):
                heartbeat.refresh()
            updated = heartbeat.path.stat()
            self.assertEqual((updated.st_dev, updated.st_ino), (original.st_dev, original.st_ino))
            self.assertEqual(updated.st_mtime_ns, refreshed)
            heartbeat.invalidate()

    def test_heartbeat_becomes_stale_when_updates_stop(self) -> None:
        now = 1_700_000_000_000_000_000
        stale = now - (sandbox.HEARTBEAT_TTL_SECONDS + 1) * 1_000_000_000
        with tempfile.TemporaryDirectory() as heartbeat_directory:
            with patch.object(sandbox.time, "time_ns", return_value=stale):
                heartbeat = sandbox.SupervisorHeartbeat.create(
                    Path(heartbeat_directory), self.generation
                )
            age_seconds = (now - heartbeat.path.stat().st_mtime_ns) / 1_000_000_000
            self.assertGreater(age_seconds, sandbox.HEARTBEAT_TTL_SECONDS)
            heartbeat.invalidate()

    def test_heartbeat_invalidation_sets_epoch_before_unlink(self) -> None:
        with tempfile.TemporaryDirectory() as heartbeat_directory:
            heartbeat = sandbox.SupervisorHeartbeat.create(
                Path(heartbeat_directory), self.generation
            )
            observed_mtime: list[int] = []
            real_unlink = sandbox.os.unlink

            def inspect_then_unlink(path: Path) -> None:
                observed_mtime.append(Path(path).stat().st_mtime_ns)
                real_unlink(path)

            with patch.object(sandbox.os, "unlink", side_effect=inspect_then_unlink):
                heartbeat.invalidate()
            self.assertEqual(observed_mtime, [0])
            self.assertFalse(heartbeat.path.exists())

    def test_orphaned_heartbeat_is_invalidated_and_removed(self) -> None:
        with tempfile.TemporaryDirectory() as heartbeat_directory:
            heartbeat = sandbox.SupervisorHeartbeat.create(
                Path(heartbeat_directory), self.generation
            )
            self.assertEqual(sandbox.invalidate_orphaned_heartbeats(Path(heartbeat_directory)), 1)
            self.assertFalse(heartbeat.path.exists())

    def test_malformed_reserved_heartbeat_name_is_not_removed(self) -> None:
        with tempfile.TemporaryDirectory() as heartbeat_directory:
            path = Path(heartbeat_directory) / "recipe-lab-sandbox-invalid.heartbeat"
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            os.close(descriptor)
            with self.assertRaises(sandbox.SandboxOperationError):
                sandbox.invalidate_orphaned_heartbeats(Path(heartbeat_directory))
            self.assertTrue(path.exists())

    def test_network_cleanup_checks_both_network_owners(self) -> None:
        removed: list[str] = []

        def command(arguments: list[str], **_kwargs: object) -> str:
            if arguments[:2] == ["network", "ls"]:
                return "network-id"
            if arguments[:2] == ["network", "inspect"]:
                return json.dumps(
                    [
                        {
                            "Name": arguments[2],
                            "Labels": {sandbox.LABEL: str(self.generation.identifier)},
                        }
                    ]
                )
            if arguments[:2] == ["network", "rm"]:
                removed.append(arguments[2])
            return ""

        with patch.object(sandbox, "docker", side_effect=command):
            sandbox.destroy_generation(self.generation)
        self.assertEqual(removed, [f"{self.generation.prefix}-ingress", self.generation.prefix])

    def test_network_cleanup_refuses_another_owner(self) -> None:
        def command(arguments: list[str], **_kwargs: object) -> str:
            if arguments[:2] == ["network", "ls"]:
                return "network-id"
            if arguments[:2] == ["network", "inspect"]:
                return json.dumps([{"Name": arguments[2], "Labels": {sandbox.LABEL: "other"}}])
            return ""

        with patch.object(sandbox, "docker", side_effect=command) as run:
            with self.assertRaises(sandbox.SandboxOperationError):
                sandbox.destroy_generation(self.generation)
        self.assertFalse(any(call.args[0][:2] == ["network", "rm"] for call in run.call_args_list))

    def test_orphan_reconciliation_removes_only_exact_validated_generation(
        self,
    ) -> None:
        identifier = str(self.generation.identifier)

        def command(arguments: list[str], **_kwargs: object) -> str:
            if arguments[:2] == ["container", "ls"]:
                return "container-id"
            if arguments[:2] == ["container", "inspect"]:
                return json.dumps(
                    [
                        {
                            "Name": f"/{self.generation.prefix}-backend",
                            "Config": {"Labels": {sandbox.LABEL: identifier}},
                        }
                    ]
                )
            if arguments[:2] == ["network", "ls"]:
                return "network-id"
            if arguments[:2] == ["network", "inspect"]:
                return json.dumps(
                    [
                        {
                            "Name": f"{self.generation.prefix}-ingress",
                            "Labels": {sandbox.LABEL: identifier},
                        }
                    ]
                )
            raise AssertionError(arguments)

        with (
            patch.object(sandbox, "docker", side_effect=command),
            patch.object(sandbox, "destroy_generation") as destroy,
        ):
            count = sandbox.reconcile_orphaned_generations()
        self.assertEqual(count, 1)
        reconciled = destroy.call_args.args[0]
        self.assertEqual(reconciled.identifier, self.generation.identifier)

    def test_orphan_reconciliation_validates_every_resource_before_removal(
        self,
    ) -> None:
        identifier = str(self.generation.identifier)

        def command(arguments: list[str], **_kwargs: object) -> str:
            if arguments[:2] == ["container", "ls"]:
                return "container-id"
            if arguments[:2] == ["container", "inspect"]:
                return json.dumps(
                    [
                        {
                            "Name": f"/{self.generation.prefix}-frontend",
                            "Config": {"Labels": {sandbox.LABEL: identifier}},
                        }
                    ]
                )
            if arguments[:2] == ["network", "ls"]:
                return "network-id"
            if arguments[:2] == ["network", "inspect"]:
                return json.dumps(
                    [
                        {
                            "Name": "unrelated-network",
                            "Labels": {sandbox.LABEL: identifier},
                        }
                    ]
                )
            raise AssertionError(arguments)

        with (
            patch.object(sandbox, "docker", side_effect=command),
            patch.object(sandbox, "destroy_generation") as destroy,
        ):
            with self.assertRaises(sandbox.SandboxOperationError):
                sandbox.reconcile_orphaned_generations()
        destroy.assert_not_called()

    def test_listener_host_accepts_private_address_and_rejects_public_or_wildcard(
        self,
    ) -> None:
        self.assertEqual(sandbox._validated_listen_host("172.17.0.1"), "172.17.0.1")
        self.assertEqual(sandbox._validated_listen_host("127.0.0.1"), "127.0.0.1")
        for value in ("0.0.0.0", "8.8.8.8", "host.docker.internal", "::1"):
            with self.subTest(value=value):
                with self.assertRaises(sandbox.SandboxOperationError):
                    sandbox._validated_listen_host(value)

    def test_trusted_proxy_list_is_private_narrow_and_canonical(self) -> None:
        self.assertEqual(
            sandbox._validated_trusted_proxy_cidrs(" 172.18.0.9,172.18.0.0/16,172.18.0.9 "),
            "172.18.0.9,172.18.0.0/16",
        )
        for value in (
            "",
            "172.18.0.1/16",
            "10.0.0.0/8",
            "0.0.0.0/0",
            "8.8.8.8",
            "172.18.0.1,",
            ",".join(["172.18.0.9"] * 33),
            "a" * 4097,
        ):
            with self.subTest(value=value):
                if value == "":
                    self.assertIsNone(sandbox._validated_trusted_proxy_cidrs(value))
                else:
                    with self.assertRaises(sandbox.SandboxOperationError):
                        sandbox._validated_trusted_proxy_cidrs(value)

    def test_private_listener_requires_explicit_trusted_proxy(self) -> None:
        with (
            patch.dict(os.environ, {sandbox.TRUSTED_PROXY_PROOF_ENV: ""}),
            patch.object(sandbox, "docker") as command,
        ):
            with self.assertRaises(sandbox.SandboxOperationError):
                sandbox.start_generation(
                    self.generation,
                    backend_image="sha256:" + "a" * 64,
                    frontend_image="sha256:" + "b" * 64,
                    origin="https://portfolio.example",
                    contact_url="https://portfolio.example/contact",
                    port=3100,
                    listen_host="172.17.0.1",
                )
        command.assert_not_called()

    def test_proxy_cidrs_and_proof_secret_are_required_together(self) -> None:
        with patch.dict(os.environ, {sandbox.TRUSTED_PROXY_PROOF_ENV: ""}):
            with self.assertRaises(sandbox.SandboxOperationError):
                sandbox._validated_proxy_configuration("172.18.0.9")
        with patch.dict(os.environ, {sandbox.TRUSTED_PROXY_PROOF_ENV: "a" * 64}):
            with self.assertRaises(sandbox.SandboxOperationError):
                sandbox._validated_proxy_configuration(None)
            self.assertEqual(
                sandbox._validated_proxy_configuration("172.18.0.9"),
                ("172.18.0.9", "a" * 64),
            )
        for invalid_secret in ("too-short", "p" * 64, "A" * 64, "a" * 63):
            with (
                self.subTest(invalid_secret=invalid_secret),
                patch.dict(os.environ, {sandbox.TRUSTED_PROXY_PROOF_ENV: invalid_secret}),
                self.assertRaises(sandbox.SandboxOperationError),
            ):
                sandbox._validated_proxy_configuration("172.18.0.9")

    def test_generation_health_checks_containers_backend_and_published_readiness(
        self,
    ) -> None:
        with (
            patch.object(sandbox, "_verify_running_container") as running,
            patch.object(sandbox, "_verify_backend_readiness") as backend,
            patch.object(sandbox, "_verify_published_listener") as listener,
        ):
            sandbox.verify_generation_health(self.generation, port=3100, listen_host="172.17.0.1")
        self.assertEqual(
            [call.args[0] for call in running.call_args_list],
            [f"{self.generation.prefix}-{role}" for role in ("db", "backend", "frontend")],
        )
        backend.assert_called_once_with(self.generation)
        listener.assert_called_once_with(3100, "172.17.0.1")

    def test_generation_health_rejects_stopped_container(self) -> None:
        with (
            patch.object(sandbox, "_owned_container", return_value=True),
            patch.object(sandbox, "docker", return_value=json.dumps({"Running": False})),
            self.assertRaises(sandbox.SandboxOperationError),
        ):
            sandbox._verify_running_container(f"{self.generation.prefix}-frontend", self.generation)

    def test_monitor_refreshes_heartbeat_before_and_after_healthy_check(self) -> None:
        heartbeat = MagicMock(spec=sandbox.SupervisorHeartbeat)
        current = self.generation.started_at
        clock = MagicMock(wraps=datetime)
        clock.now.side_effect = [current, current, self.generation.expires_at]
        with (
            patch.object(sandbox, "datetime", clock),
            patch.object(sandbox.time, "sleep") as sleep,
            patch.object(sandbox, "verify_generation_health") as health,
        ):
            sandbox.monitor_generation(
                self.generation,
                port=3100,
                listen_host="127.0.0.1",
                heartbeat=heartbeat,
            )
        sleep.assert_called_once_with(sandbox.HEARTBEAT_INTERVAL_SECONDS)
        health.assert_called_once_with(self.generation, port=3100, listen_host="127.0.0.1")
        self.assertEqual(heartbeat.refresh.call_count, 2)

    def test_singleton_lock_rejects_a_second_supervisor(self) -> None:
        with tempfile.TemporaryDirectory() as state_directory:
            lock_path = Path(state_directory) / "supervisor.lock"
            with sandbox._supervisor_lock(lock_path):
                with self.assertRaises(sandbox.SandboxOperationError):
                    with sandbox._supervisor_lock(lock_path):
                        self.fail("A second supervisor acquired the same lock.")

    def test_singleton_lock_does_not_relabel_body_oserror(self) -> None:
        with tempfile.TemporaryDirectory() as state_directory:
            lock_path = Path(state_directory) / "supervisor.lock"
            with self.assertRaisesRegex(OSError, "body failure"):
                with sandbox._supervisor_lock(lock_path):
                    raise OSError("body failure")

    def test_published_listener_checks_host_liveness_and_browse(self) -> None:
        opener = MagicMock()
        response = opener.open.return_value.__enter__.return_value
        response.status = 200
        response.read.return_value = b"ready\n"
        with patch.object(sandbox, "build_opener", return_value=opener):
            sandbox._verify_published_listener(3100)
        self.assertEqual(
            [call.args[0] for call in opener.open.call_args_list],
            ["http://127.0.0.1:3100/readyz", "http://127.0.0.1:3100/recipes"],
        )
        self.assertTrue(all(call.kwargs["timeout"] == 5 for call in opener.open.call_args_list))

    def test_published_listener_failure_is_sanitized(self) -> None:
        opener = MagicMock()
        opener.open.side_effect = URLError("private host diagnostic")
        with patch.object(sandbox, "build_opener", return_value=opener):
            with self.assertRaises(sandbox.SandboxOperationError) as error:
                sandbox._verify_published_listener(3100)
        self.assertEqual(str(error.exception), "The sandbox listener is not ready.")

    def test_published_listener_rejects_wrong_liveness_body(self) -> None:
        opener = MagicMock()
        response = opener.open.return_value.__enter__.return_value
        response.status = 200
        response.read.return_value = b"unrelated service"
        with patch.object(sandbox, "build_opener", return_value=opener):
            with self.assertRaises(sandbox.SandboxOperationError):
                sandbox._verify_published_listener(3100)

    def test_failed_start_is_cleaned_and_does_not_open_another_generation(self) -> None:
        with tempfile.TemporaryDirectory() as state_directory:
            with (
                patch.object(sandbox, "reconcile_orphaned_generations", return_value=0),
                patch.object(
                    sandbox,
                    "start_generation",
                    side_effect=sandbox.SandboxOperationError(),
                ) as start,
                patch.object(sandbox, "destroy_generation") as destroy,
                patch("sys.stderr", new_callable=io.StringIO),
            ):
                result = sandbox.main(
                    [
                        "--backend-image",
                        "sha256:" + "a" * 64,
                        "--frontend-image",
                        "sha256:" + "b" * 64,
                        "--origin",
                        "https://portfolio.example",
                        "--contact-url",
                        "mailto:me@peterbucci.com",
                        "--state-directory",
                        state_directory,
                        "--heartbeat-directory",
                        state_directory,
                    ]
                )
        self.assertEqual(result, 1)
        start.assert_called_once()
        destroy.assert_called_once_with(start.call_args.args[0])

    def test_continuous_monitor_failure_closes_generation_and_is_sanitized(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as state_directory:
            with (
                patch.object(sandbox, "reconcile_orphaned_generations", return_value=0),
                patch.object(sandbox, "start_generation") as start,
                patch.object(
                    sandbox,
                    "monitor_generation",
                    side_effect=sandbox.SandboxOperationError("private monitor diagnostic"),
                ) as monitor,
                patch.object(sandbox, "destroy_generation") as destroy,
                patch("sys.stderr", new_callable=io.StringIO) as stderr,
                patch("sys.stdout", new_callable=io.StringIO),
            ):
                result = sandbox.main(
                    [
                        "--backend-image",
                        "sha256:" + "a" * 64,
                        "--frontend-image",
                        "sha256:" + "b" * 64,
                        "--origin",
                        "https://portfolio.example",
                        "--contact-url",
                        "mailto:me@peterbucci.com",
                        "--state-directory",
                        state_directory,
                        "--heartbeat-directory",
                        state_directory,
                    ]
                )
        self.assertEqual(result, 1)
        start.assert_called_once()
        monitor.assert_called_once()
        destroy.assert_called_once_with(start.call_args.args[0])
        self.assertNotIn("private monitor diagnostic", stderr.getvalue())

    def test_existing_fail_stop_marker_prevents_reconciliation_and_start(self) -> None:
        with tempfile.TemporaryDirectory() as state_directory:
            heartbeat = sandbox.SupervisorHeartbeat.create(Path(state_directory), self.generation)
            marker = Path(state_directory) / "fail-stop"
            sandbox._mark_fail_stop(marker)
            with (
                patch.object(sandbox, "reconcile_orphaned_generations") as reconcile,
                patch.object(sandbox, "start_generation") as start,
                patch("sys.stderr", new_callable=io.StringIO) as stderr,
            ):
                result = sandbox.main(
                    [
                        "--backend-image",
                        "sha256:" + "a" * 64,
                        "--frontend-image",
                        "sha256:" + "b" * 64,
                        "--origin",
                        "https://portfolio.example",
                        "--contact-url",
                        "mailto:me@peterbucci.com",
                        "--state-directory",
                        state_directory,
                        "--heartbeat-directory",
                        state_directory,
                    ]
                )
            self.assertFalse(heartbeat.path.exists())
        self.assertEqual(result, sandbox.FAIL_STOP_EXIT_CODE)
        reconcile.assert_not_called()
        start.assert_not_called()
        self.assertIn("fail-stopped", stderr.getvalue())

    def test_unsafe_orphan_reconciliation_creates_fail_stop_marker(self) -> None:
        with tempfile.TemporaryDirectory() as state_directory:
            with (
                patch.object(
                    sandbox,
                    "reconcile_orphaned_generations",
                    side_effect=sandbox.SandboxOperationError("private orphan diagnostic"),
                ),
                patch.object(sandbox, "start_generation") as start,
                patch("sys.stderr", new_callable=io.StringIO) as stderr,
            ):
                result = sandbox.main(
                    [
                        "--backend-image",
                        "sha256:" + "a" * 64,
                        "--frontend-image",
                        "sha256:" + "b" * 64,
                        "--origin",
                        "https://portfolio.example",
                        "--contact-url",
                        "mailto:me@peterbucci.com",
                        "--state-directory",
                        state_directory,
                        "--heartbeat-directory",
                        state_directory,
                    ]
                )
            self.assertTrue((Path(state_directory) / "fail-stop").is_file())
            self.assertEqual(list(Path(state_directory).glob("*.heartbeat")), [])
        self.assertEqual(result, sandbox.FAIL_STOP_EXIT_CODE)
        start.assert_not_called()
        self.assertNotIn("private orphan diagnostic", stderr.getvalue())

    def test_unsafe_heartbeat_namespace_fail_stops_before_docker_reconciliation(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as state_directory:
            malformed = Path(state_directory) / "recipe-lab-sandbox-malformed.heartbeat"
            descriptor = os.open(malformed, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            os.close(descriptor)
            with (
                patch.object(sandbox, "reconcile_orphaned_generations") as reconcile,
                patch.object(sandbox, "start_generation") as start,
                patch("sys.stderr", new_callable=io.StringIO) as stderr,
            ):
                result = sandbox.main(
                    [
                        "--backend-image",
                        "sha256:" + "a" * 64,
                        "--frontend-image",
                        "sha256:" + "b" * 64,
                        "--origin",
                        "https://portfolio.example",
                        "--contact-url",
                        "mailto:me@peterbucci.com",
                        "--state-directory",
                        state_directory,
                        "--heartbeat-directory",
                        state_directory,
                    ]
                )
            self.assertTrue(malformed.exists())
            self.assertTrue((Path(state_directory) / "fail-stop").is_file())
        self.assertEqual(result, sandbox.FAIL_STOP_EXIT_CODE)
        reconcile.assert_not_called()
        start.assert_not_called()
        self.assertIn("heartbeat ownership", stderr.getvalue())

    def test_interrupted_start_cleans_its_generation(self) -> None:
        with tempfile.TemporaryDirectory() as state_directory:
            with (
                patch.object(sandbox, "reconcile_orphaned_generations", return_value=0),
                patch.object(sandbox, "start_generation", side_effect=KeyboardInterrupt()) as start,
                patch.object(sandbox, "destroy_generation") as destroy,
            ):
                result = sandbox.main(
                    [
                        "--backend-image",
                        "sha256:" + "a" * 64,
                        "--frontend-image",
                        "sha256:" + "b" * 64,
                        "--origin",
                        "https://portfolio.example",
                        "--contact-url",
                        "https://portfolio.example/contact",
                        "--state-directory",
                        state_directory,
                        "--heartbeat-directory",
                        state_directory,
                    ]
                )
        self.assertEqual(result, 0)
        start.assert_called_once()
        destroy.assert_called_once_with(start.call_args.args[0])

    def test_cleanup_failure_during_interruption_prevents_replacement(self) -> None:
        with tempfile.TemporaryDirectory() as state_directory:
            with (
                patch.object(sandbox, "reconcile_orphaned_generations", return_value=0),
                patch.object(sandbox, "start_generation", side_effect=KeyboardInterrupt()) as start,
                patch.object(
                    sandbox,
                    "destroy_generation",
                    side_effect=sandbox.SandboxOperationError("private diagnostic"),
                ) as destroy,
                patch("sys.stderr", new_callable=io.StringIO) as stderr,
            ):
                result = sandbox.main(
                    [
                        "--backend-image",
                        "sha256:" + "a" * 64,
                        "--frontend-image",
                        "sha256:" + "b" * 64,
                        "--origin",
                        "https://portfolio.example",
                        "--contact-url",
                        "https://portfolio.example/contact",
                        "--state-directory",
                        state_directory,
                        "--heartbeat-directory",
                        state_directory,
                    ]
                )
            self.assertTrue((Path(state_directory) / "fail-stop").is_file())
            heartbeat = start.call_args.kwargs["heartbeat"]
            self.assertTrue(heartbeat.invalidated)
            self.assertFalse(heartbeat.path.exists())
        self.assertEqual(result, sandbox.FAIL_STOP_EXIT_CODE)
        start.assert_called_once()
        destroy.assert_called_once_with(start.call_args.args[0])
        self.assertIn("fail-stopped", stderr.getvalue())
        self.assertNotIn("private diagnostic", stderr.getvalue())

    def test_heartbeat_invalidation_failure_is_fail_stop_even_after_docker_cleanup(
        self,
    ) -> None:
        created: list[sandbox.SupervisorHeartbeat] = []

        def fail_invalidation(heartbeat: sandbox.SupervisorHeartbeat) -> None:
            created.append(heartbeat)
            raise sandbox.SandboxOperationError("private heartbeat diagnostic")

        with tempfile.TemporaryDirectory() as state_directory:
            with (
                patch.object(sandbox, "reconcile_orphaned_generations", return_value=0),
                patch.object(sandbox, "start_generation", side_effect=KeyboardInterrupt()) as start,
                patch.object(sandbox, "destroy_generation") as destroy,
                patch.object(
                    sandbox.SupervisorHeartbeat,
                    "invalidate",
                    autospec=True,
                    side_effect=fail_invalidation,
                ),
                patch("sys.stderr", new_callable=io.StringIO) as stderr,
            ):
                result = sandbox.main(
                    [
                        "--backend-image",
                        "sha256:" + "a" * 64,
                        "--frontend-image",
                        "sha256:" + "b" * 64,
                        "--origin",
                        "https://portfolio.example",
                        "--contact-url",
                        "https://portfolio.example/contact",
                        "--state-directory",
                        state_directory,
                        "--heartbeat-directory",
                        state_directory,
                    ]
                )
            self.assertTrue((Path(state_directory) / "fail-stop").is_file())
            self.assertEqual(len(created), 1)
            self.assertTrue(created[0].path.exists())
            created[0].invalidate()
        self.assertEqual(result, sandbox.FAIL_STOP_EXIT_CODE)
        start.assert_called_once()
        destroy.assert_called_once_with(start.call_args.args[0])
        self.assertNotIn("private heartbeat diagnostic", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
