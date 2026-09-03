from __future__ import annotations

import io
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from scripts import verify_architecture as architecture


class ArchitectureBoundaryTests(unittest.TestCase):
    def test_accepts_domain_dependencies_and_standard_library_imports(self) -> None:
        source = """\
import json
from app.models.recipe import Recipe
from app.repositories.recipes import get_recipe
"""

        self.assertEqual(
            architecture.audit_source(path="backend/app/services/example.py", source=source),
            [],
        )

    def test_reports_fastapi_and_api_imports_with_locations(self) -> None:
        source = """\
from fastapi import HTTPException
import app.api.errors
from app.api.routes import recipes
"""

        violations = architecture.audit_source(
            path="backend/app/services/example.py", source=source
        )

        self.assertEqual(
            [(item.line, item.imported_module) for item in violations],
            [(1, "fastapi"), (2, "app.api.errors"), (3, "app.api.routes")],
        )

    def test_cli_scans_each_transport_independent_layer(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            repository = Path(temporary)
            for relative_root in architecture.DOMAIN_ROOTS:
                root = repository / relative_root
                root.mkdir(parents=True)
                (root / "example.py").write_text("import json\n", encoding="utf-8")

            stdout = io.StringIO()
            with redirect_stdout(stdout):
                result = architecture.main(["--repository", str(repository)])

        self.assertEqual(result, 0)
        self.assertIn("passed", stdout.getvalue())

    def test_cli_fails_closed_when_a_boundary_is_crossed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            repository = Path(temporary)
            for relative_root in architecture.DOMAIN_ROOTS:
                (repository / relative_root).mkdir(parents=True)
            path = repository / "backend/app/services/leaky.py"
            path.write_text("from app.api.errors import ApiError\n", encoding="utf-8")

            stderr = io.StringIO()
            with redirect_stderr(stderr):
                result = architecture.main(["--repository", str(repository)])

        self.assertEqual(result, 1)
        self.assertIn("app.api.errors", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
