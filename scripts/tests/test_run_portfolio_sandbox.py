import io
import json
import unittest
from datetime import UTC, datetime, timedelta
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

        with (
            patch.object(sandbox, "docker", side_effect=command),
            patch.object(sandbox, "_verify_published_listener") as listener,
        ):
            sandbox.start_generation(
                self.generation,
                backend_image="sha256:" + "a" * 64,
                frontend_image="sha256:" + "b" * 64,
                origin="https://portfolio.example",
                contact_url="https://portfolio.example/contact",
                port=3100,
            )
        listener.assert_called_once_with(3100)
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
                self.assertIn("127.0.0.1:3100:3000", args)
            else:
                self.assertEqual(networks, [self.generation.prefix])
                self.assertNotIn("--publish", args)

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

    def test_published_listener_checks_host_liveness_and_browse(self) -> None:
        opener = MagicMock()
        response = opener.open.return_value.__enter__.return_value
        response.status = 200
        response.read.return_value = b"ok\n"
        with patch.object(sandbox, "build_opener", return_value=opener):
            sandbox._verify_published_listener(3100)
        self.assertEqual(
            [call.args[0] for call in opener.open.call_args_list],
            ["http://127.0.0.1:3100/healthz", "http://127.0.0.1:3100/recipes"],
        )

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
        with (
            patch.object(
                sandbox, "start_generation", side_effect=sandbox.SandboxOperationError()
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
                    "https://portfolio.example/contact",
                ]
            )
        self.assertEqual(result, 1)
        start.assert_called_once()
        destroy.assert_called_once_with(start.call_args.args[0])

    def test_interrupted_start_cleans_its_generation(self) -> None:
        with (
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
                ]
            )
        self.assertEqual(result, 0)
        start.assert_called_once()
        destroy.assert_called_once_with(start.call_args.args[0])

    def test_cleanup_failure_during_interruption_prevents_replacement(self) -> None:
        with (
            patch.object(sandbox, "start_generation", side_effect=KeyboardInterrupt()) as start,
            patch.object(
                sandbox, "destroy_generation", side_effect=sandbox.SandboxOperationError()
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
                ]
            )
        self.assertEqual(result, 1)
        start.assert_called_once()
        destroy.assert_called_once_with(start.call_args.args[0])
        self.assertIn("verify the isolated environment", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
