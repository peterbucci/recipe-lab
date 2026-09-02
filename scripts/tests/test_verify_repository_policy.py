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


if __name__ == "__main__":
    unittest.main()
