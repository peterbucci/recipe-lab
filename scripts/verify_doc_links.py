#!/usr/bin/env python3
"""Verify local links and Markdown heading fragments in tracked documentation."""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlsplit

LINK = re.compile(r"!?\[[^\]]*\]\((?P<target>[^)]+)\)")
HEADING = re.compile(r"^#{1,6}\s+(?P<label>.+?)\s*#*\s*$", re.MULTILINE)
HTML_TAG = re.compile(r"<[^>]+>")
MARKUP = re.compile(r"[`*_~]")
NON_SLUG_CHARACTER = re.compile(r"[^\w\- ]", re.UNICODE)
SPACE = re.compile(r"\s")
EXTERNAL_SCHEMES = frozenset({"http", "https", "mailto", "tel"})


@dataclass(frozen=True, order=True)
class Violation:
    source: str
    line: int
    message: str

    def render(self) -> str:
        return f"{self.source}:{self.line}: {self.message}"


def heading_anchors(markdown: str) -> frozenset[str]:
    """Return GitHub-style anchors for the headings in one Markdown document."""

    anchors: set[str] = set()
    occurrences: Counter[str] = Counter()
    for match in HEADING.finditer(markdown):
        label = HTML_TAG.sub("", match.group("label"))
        label = MARKUP.sub("", label).strip().lower()
        base = SPACE.sub("-", NON_SLUG_CHARACTER.sub("", label))
        suffix = occurrences[base]
        occurrences[base] += 1
        anchors.add(base if suffix == 0 else f"{base}-{suffix}")
    return frozenset(anchors)


def _link_target(raw_target: str) -> str:
    target = raw_target.strip()
    if target.startswith("<") and ">" in target:
        return target[1 : target.index(">")]
    return target.split(maxsplit=1)[0]


def audit_document(path: Path, repository: Path) -> list[Violation]:
    """Return broken local-link violations from one Markdown document."""

    source = path.relative_to(repository).as_posix()
    markdown = path.read_text(encoding="utf-8")
    violations: list[Violation] = []
    for match in LINK.finditer(markdown):
        raw_target = _link_target(match.group("target"))
        parsed = urlsplit(raw_target)
        if parsed.scheme.lower() in EXTERNAL_SCHEMES or raw_target.startswith("//"):
            continue

        line = markdown.count("\n", 0, match.start()) + 1
        target_path_text = unquote(parsed.path)
        if not target_path_text:
            target_path = path
        elif target_path_text.startswith("/"):
            target_path = repository / target_path_text.lstrip("/")
        else:
            target_path = path.parent / target_path_text
        target_path = target_path.resolve()

        try:
            target_path.relative_to(repository.resolve())
        except ValueError:
            violations.append(Violation(source, line, f"link escapes repository: {raw_target}"))
            continue

        if not target_path.exists():
            violations.append(Violation(source, line, f"missing link target: {raw_target}"))
            continue

        fragment = unquote(parsed.fragment).lower()
        if fragment and target_path.suffix.lower() == ".md":
            anchors = heading_anchors(target_path.read_text(encoding="utf-8"))
            if fragment not in anchors:
                violations.append(
                    Violation(source, line, f"missing heading fragment: {raw_target}")
                )
    return violations


def tracked_markdown_files(repository: Path) -> Iterable[Path]:
    """Yield tracked Markdown files without walking dependency/build directories."""

    result = subprocess.run(
        ["git", "ls-files", "-z", "--", "*.md"],
        cwd=repository,
        check=True,
        stdout=subprocess.PIPE,
    )
    for relative in result.stdout.decode("utf-8").split("\0"):
        if relative:
            yield repository / relative


def audit_repository(repository: Path) -> list[Violation]:
    violations: list[Violation] = []
    for path in tracked_markdown_files(repository):
        violations.extend(audit_document(path, repository))
    return sorted(violations)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repository",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="repository root (defaults to the parent of scripts/)",
    )
    arguments = parser.parse_args(argv)

    try:
        violations = audit_repository(arguments.repository.resolve())
    except (OSError, subprocess.SubprocessError, UnicodeError) as error:
        print(f"Documentation link audit could not run: {error}", file=sys.stderr)
        return 1

    if violations:
        print("Documentation link audit failed:", file=sys.stderr)
        for violation in violations:
            print(f"- {violation.render()}", file=sys.stderr)
        return 1

    print("Documentation link audit passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
