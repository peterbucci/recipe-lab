from __future__ import annotations

import contextlib
import io
import tempfile
import unittest
from pathlib import Path

from scripts.extract_playwright_failure_location import (
    extract_failure_location,
    main,
)


class ExtractPlaywrightFailureLocationTests(unittest.TestCase):
    def test_extracts_only_the_first_stack_location(self) -> None:
        spec_path = "/work/frontend/e2e/rcp32-community-release-gate.spec.ts"
        log = f"""
        1) [chromium] › e2e/rcp32-community-release-gate.spec.ts:549:7
        RCP32_PRIVATE_REQUEST_CONTEXT_CANARY secret@example.invalid
            at publishDistinctOriginal ({spec_path}:324:22)
            at another helper ({spec_path}:999:4)
        """
        self.assertEqual(
            extract_failure_location(log),
            (324, 22),
        )

    def test_ignores_headers_and_unrelated_stack_frames(self) -> None:
        log = """
        [chromium] › e2e/rcp32-community-release-gate.spec.ts:549:7
            at helper (/work/frontend/e2e/home.spec.ts:480:5)
        """
        self.assertIsNone(extract_failure_location(log))

    def test_cli_never_copies_private_log_content(self) -> None:
        canary = "RCP32_PRIVATE_MODERATOR_NOTE_CANARY"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "browser.log"
            path.write_text(
                canary
                + "\n    at helper (C:\\work\\frontend\\e2e\\"
                + "rcp32-community-release-gate.spec.ts:1017:9)\n",
                encoding="utf-8",
            )
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                self.assertEqual(main(["extract", str(path)]), 0)
        self.assertEqual(output.getvalue(), "1017:9\n")
        self.assertNotIn(canary, output.getvalue())


if __name__ == "__main__":
    unittest.main()
