from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts import verify_doc_links as links


class DocumentationLinkTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.repository = Path(self.temporary.name).resolve()

    def _write(self, relative: str, contents: str) -> Path:
        path = self.repository / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(contents, encoding="utf-8")
        return path

    def test_heading_anchors_match_github_duplicates_and_markup(self) -> None:
        self.assertEqual(
            links.heading_anchors("# API `contracts`\n## Retry & recovery\n## Retry & recovery\n"),
            frozenset({"api-contracts", "retry--recovery", "retry--recovery-1"}),
        )

    def test_accepts_files_fragments_root_links_and_external_links(self) -> None:
        source = self._write(
            "docs/source.md",
            "[local](target.md#expected-heading)\n"
            "[root](/README.md)\n"
            "[web](https://example.invalid/missing)\n",
        )
        self._write("docs/target.md", "# Expected heading\n")
        self._write("README.md", "# Fixture\n")

        self.assertEqual(links.audit_document(source, self.repository), [])

    def test_reports_missing_file_and_fragment_with_source_lines(self) -> None:
        source = self._write(
            "docs/source.md",
            "[missing](nope.md)\n\n[heading](target.md#not-there)\n",
        )
        self._write("docs/target.md", "# Present\n")

        violations = links.audit_document(source, self.repository)

        self.assertEqual([item.line for item in violations], [1, 3])
        self.assertIn("missing link target", violations[0].message)
        self.assertIn("missing heading fragment", violations[1].message)

    def test_rejects_links_that_escape_the_repository(self) -> None:
        source = self._write("docs/source.md", "[outside](../../private.md)\n")

        [violation] = links.audit_document(source, self.repository)

        self.assertIn("escapes repository", violation.message)


if __name__ == "__main__":
    unittest.main()
