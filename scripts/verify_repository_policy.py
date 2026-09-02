#!/usr/bin/env python3
"""Audit reviewable repository and CI supply-chain invariants."""

from __future__ import annotations

import argparse
import re
import sys
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path

ACTION_REFERENCE = re.compile(r"^\s*(?:-\s*)?uses:\s*([^\s#]+)")
EXACT_ACTION_REFERENCE = re.compile(r"^[^/@\s]+/[^/@\s]+@[0-9a-f]{40}$")
RUNNER_REFERENCE = re.compile(r"^\s*runs-on:\s*([^\s#]+)")
TOOLCHAIN_REFERENCE = re.compile(r'^\s*(?:node|python)-version:\s*["\']?([^\s"\'#]+)')
EXACT_TOOLCHAIN_VERSION = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
WORKFLOW_IMAGE = re.compile(r"^\s*image:\s*([^\s#]+)")


@dataclass(frozen=True, order=True)
class Violation:
    path: str
    line: int
    message: str

    def render(self) -> str:
        return f"{self.path}:{self.line}: {self.message}"


def _relative(path: Path, repository: Path) -> str:
    return path.relative_to(repository).as_posix()


def audit_workflow(path: Path, repository: Path) -> list[Violation]:
    """Return immutable-reference violations from one GitHub workflow."""

    violations: list[Violation] = []
    relative = _relative(path, repository)
    lines = path.read_text(encoding="utf-8").splitlines()
    for line_number, line in enumerate(lines, 1):
        action_match = ACTION_REFERENCE.match(line)
        if action_match:
            reference = action_match.group(1)
            if reference.startswith("./"):
                continue
            if reference.startswith("docker://"):
                if "@sha256:" not in reference:
                    violations.append(
                        Violation(
                            relative,
                            line_number,
                            "container action is not digest-pinned",
                        )
                    )
            elif not EXACT_ACTION_REFERENCE.fullmatch(reference):
                violations.append(
                    Violation(
                        relative,
                        line_number,
                        "external action is not pinned to a full SHA",
                    )
                )
            if reference.startswith("actions/checkout@") and not any(
                candidate.strip() == "persist-credentials: false"
                for candidate in lines[line_number : line_number + 5]
            ):
                violations.append(
                    Violation(
                        relative,
                        line_number,
                        "checkout must disable persisted Git credentials",
                    )
                )

        runner_match = RUNNER_REFERENCE.match(line)
        if runner_match and runner_match.group(1).endswith("-latest"):
            violations.append(
                Violation(
                    relative, line_number, "runner image uses a mutable -latest label"
                )
            )

        toolchain_match = TOOLCHAIN_REFERENCE.match(line)
        if toolchain_match and not EXACT_TOOLCHAIN_VERSION.fullmatch(
            toolchain_match.group(1)
        ):
            violations.append(
                Violation(
                    relative,
                    line_number,
                    "language runtime is not pinned to a patch release",
                )
            )

        image_match = WORKFLOW_IMAGE.match(line)
        if image_match and "@sha256:" not in image_match.group(1):
            violations.append(
                Violation(
                    relative,
                    line_number,
                    "workflow service/container image is not digest-pinned",
                )
            )
    return violations


def audit_repository(repository: Path) -> tuple[Violation, ...]:
    """Audit every checked-in workflow without modifying policy or lock files."""

    workflow_directory = repository / ".github" / "workflows"
    workflows: Iterable[Path] = (
        path
        for pattern in ("*.yml", "*.yaml")
        for path in workflow_directory.glob(pattern)
    )
    return tuple(
        sorted(
            violation
            for workflow in workflows
            for violation in audit_workflow(workflow, repository)
        )
    )


def main(arguments: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repository",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Repository root (defaults to this script's checkout).",
    )
    parsed = parser.parse_args(arguments)
    repository = parsed.repository.resolve()
    violations = audit_repository(repository)
    if violations:
        print("Repository policy audit failed:", file=sys.stderr)
        for violation in violations:
            print(f"- {violation.render()}", file=sys.stderr)
        return 1
    print("Repository policy audit passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
