from __future__ import annotations

import io
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from scripts import verify_repository_policy as policy


class RepositoryPolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.repository = Path(self.temporary.name)
        (self.repository / ".github" / "workflows").mkdir(parents=True)
        (self.repository / "backend").mkdir()
        (self.repository / "frontend").mkdir()
        (self.repository / ".dockerignore").write_text(
            "\n".join(policy.REQUIRED_DOCKER_EXCLUSIONS[".dockerignore"]),
            encoding="utf-8",
        )
        (self.repository / "frontend" / ".dockerignore").write_text(
            "\n".join(policy.REQUIRED_DOCKER_EXCLUSIONS["frontend/.dockerignore"]),
            encoding="utf-8",
        )
        for relative in ("backend/Dockerfile", "frontend/Dockerfile"):
            (self.repository / relative).write_text(
                "ARG BASE_IMAGE=example.invalid/base:v1@sha256:" + "a" * 64 + "\n",
                encoding="utf-8",
            )
        (self.repository / ".env.example").write_text(
            "POSTGRES_IMAGE=example.invalid/postgres:v1@sha256:" + "b" * 64 + "\n",
            encoding="utf-8",
        )
        (self.repository / "compose.yaml").write_text(
            """services:
  db:
    image: ${POSTGRES_IMAGE:-example.invalid/postgres:v1@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb}
  frontend:
    volumes:
      - frontend_next_data:/app/.next
    healthcheck:
      test: http://127.0.0.1:3000/healthz
""",
            encoding="utf-8",
        )

    def _workflow(self, content: str) -> Path:
        path = self.repository / ".github" / "workflows" / "ci.yml"
        path.write_text(content, encoding="utf-8")
        return path

    def test_accepts_exact_actions_runtimes_runners_and_images(self) -> None:
        workflow = self._workflow(
            """jobs:
  checks:
    runs-on: ubuntu-24.04
    container:
      image: example.invalid/tool:v1@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    steps:
      - uses: owner/action@bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb # v1
        with:
          persist-credentials: false
      - uses: ./local-action
      - uses: docker://example.invalid/action:v1@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
      - with:
          python-version: "3.13.15"
          node-version: "22.23.2"
"""
        )

        self.assertEqual(policy.audit_workflow(workflow, self.repository), [])

    def test_reports_every_mutable_reference_with_location(self) -> None:
        workflow = self._workflow(
            """jobs:
  checks:
    runs-on: ubuntu-latest
    services:
      db:
        image: postgres:17-alpine
    steps:
      - uses: actions/checkout@v7
      - uses: docker://example.invalid/action:v1
      - with:
          python-version: "3.13"
"""
        )

        violations = policy.audit_workflow(workflow, self.repository)

        self.assertEqual(len(violations), 6)
        self.assertTrue(
            all(item.path == ".github/workflows/ci.yml" for item in violations)
        )
        self.assertEqual([item.line for item in violations], [3, 6, 8, 8, 9, 11])

    def test_cli_fails_closed_and_does_not_modify_workflow(self) -> None:
        workflow = self._workflow("steps:\n  - uses: actions/checkout@v7\n")
        original = workflow.read_bytes()
        stderr = io.StringIO()

        with redirect_stderr(stderr):
            result = policy.main(["--repository", str(self.repository)])

        self.assertEqual(result, 1)
        self.assertIn("full SHA", stderr.getvalue())
        self.assertEqual(workflow.read_bytes(), original)

    def test_cli_passes_an_empty_workflow_directory(self) -> None:
        stdout = io.StringIO()
        with redirect_stdout(stdout):
            result = policy.main(["--repository", str(self.repository)])

        self.assertEqual(result, 0)
        self.assertIn("passed", stdout.getvalue())

    def test_reports_docker_context_compose_and_base_drift(self) -> None:
        (self.repository / ".dockerignore").write_text(".git\n", encoding="utf-8")
        (self.repository / "backend" / "Dockerfile").write_text(
            "ARG PYTHON_IMAGE=python:3.13-alpine\nRUN apk upgrade --no-cache\n",
            encoding="utf-8",
        )
        (self.repository / "compose.yaml").write_text(
            "services:\n  db:\n    image: ${UNDOCUMENTED_IMAGE}\n",
            encoding="utf-8",
        )

        violations = policy.audit_repository(self.repository)
        messages = [item.message for item in violations]

        self.assertIn("Docker base is not digest-pinned", messages)
        self.assertIn("Docker build performs a time-dependent apk upgrade", messages)
        self.assertIn("Compose variable UNDOCUMENTED_IMAGE is not documented", messages)
        self.assertIn("Compose service image is not digest-pinned", messages)
        self.assertIn("frontend Compose health check is missing", messages)
        self.assertTrue(
            any(
                "Docker build context does not exclude" in message
                for message in messages
            )
        )


if __name__ == "__main__":
    unittest.main()
