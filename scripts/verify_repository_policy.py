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
COMPOSE_VARIABLE = re.compile(r"\$\{([A-Z][A-Z0-9_]*)")
ENVIRONMENT_ASSIGNMENT = re.compile(r"^([A-Z][A-Z0-9_]*)=")
DOCKERFILE_IMAGE_ARGUMENT = re.compile(r"^ARG\s+[A-Z][A-Z0-9_]*_IMAGE=(\S+)")

REQUIRED_DOCKER_EXCLUSIONS = {
    ".dockerignore": frozenset(
        {
            ".env",
            ".env.*",
            ".git",
            "**/.venv",
            "artifacts",
            "ml/reports",
            "ml/snapshots",
        }
    ),
    "frontend/.dockerignore": frozenset(
        {
            ".env",
            ".env.*",
            ".git",
            ".next",
            "baselines",
            "e2e",
            "node_modules",
            "performance",
            "playwright-report",
            "scripts",
            "test-results",
        }
    ),
}


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
                Violation(relative, line_number, "runner image uses a mutable -latest label")
            )

        toolchain_match = TOOLCHAIN_REFERENCE.match(line)
        if toolchain_match and not EXACT_TOOLCHAIN_VERSION.fullmatch(toolchain_match.group(1)):
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


def audit_docker_policy(repository: Path) -> list[Violation]:
    """Verify deterministic build-context and base-image policy."""

    violations: list[Violation] = []
    for relative, required in REQUIRED_DOCKER_EXCLUSIONS.items():
        path = repository / relative
        entries = frozenset(
            line.strip()
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        )
        for missing in sorted(required - entries):
            violations.append(
                Violation(relative, 1, f"Docker build context does not exclude {missing}")
            )

    for relative in ("backend/Dockerfile", "frontend/Dockerfile"):
        path = repository / relative
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            image = DOCKERFILE_IMAGE_ARGUMENT.match(line)
            if image and "@sha256:" not in image.group(1):
                violations.append(
                    Violation(relative, line_number, "Docker base is not digest-pinned")
                )
            if line.strip().startswith("RUN apk upgrade"):
                violations.append(
                    Violation(
                        relative,
                        line_number,
                        "Docker build performs a time-dependent apk upgrade",
                    )
                )
    return violations


def audit_compose_environment(repository: Path) -> list[Violation]:
    """Require Compose inputs to be documented and runtime state to be isolated."""

    compose_path = repository / "compose.yaml"
    compose = compose_path.read_text(encoding="utf-8")
    example_lines = (repository / ".env.example").read_text(encoding="utf-8").splitlines()
    documented = {
        match.group(1) for line in example_lines if (match := ENVIRONMENT_ASSIGNMENT.match(line))
    }
    violations = [
        Violation(".env.example", 1, f"Compose variable {name} is not documented")
        for name in sorted(set(COMPOSE_VARIABLE.findall(compose)) - documented)
    ]
    for line_number, line in enumerate(compose.splitlines(), 1):
        image = WORKFLOW_IMAGE.match(line)
        if image and "@sha256:" not in image.group(1):
            violations.append(
                Violation(
                    "compose.yaml",
                    line_number,
                    "Compose service image is not digest-pinned",
                )
            )
    for required, message in (
        (
            "frontend_next_data:/app/.next",
            "frontend build output is not isolated from the host bind mount",
        ),
        ("http://127.0.0.1:3000/healthz", "frontend Compose health check is missing"),
    ):
        if required not in compose:
            violations.append(Violation("compose.yaml", 1, message))
    return violations


def audit_repository(repository: Path) -> tuple[Violation, ...]:
    """Audit every checked-in workflow without modifying policy or lock files."""

    github_directory = repository / ".github"
    workflows: Iterable[Path] = (
        path
        for pattern in ("workflows/*.yml", "workflows/*.yaml", "actions/**/action.yml")
        for path in github_directory.glob(pattern)
    )
    return tuple(
        sorted(
            [
                *(
                    violation
                    for workflow in workflows
                    for violation in audit_workflow(workflow, repository)
                ),
                *audit_docker_policy(repository),
                *audit_compose_environment(repository),
            ]
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
