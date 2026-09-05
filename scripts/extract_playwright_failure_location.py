"""Extract one privacy-safe RCP-32 failure location from a private Playwright log."""

from __future__ import annotations

import re
import sys
from pathlib import Path


_STACK_LOCATION = re.compile(
    r"(?m)^\s*at\s+[^\r\n]*[/\\]frontend[/\\]e2e[/\\]"
    r"rcp32-community-release-gate\.spec\.ts:"
    r"(?P<line>[1-9][0-9]{0,4}):(?P<column>[1-9][0-9]{0,3})\)?\s*$"
)


def extract_failure_location(log_text: str) -> tuple[int, int] | None:
    """Return only the first validated spec stack location."""

    match = _STACK_LOCATION.search(log_text)
    if match is None:
        return None
    return int(match.group("line")), int(match.group("column"))


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        return 2
    try:
        log_text = Path(argv[1]).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return 0
    location = extract_failure_location(log_text)
    if location is not None:
        print(f"{location[0]}:{location[1]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
