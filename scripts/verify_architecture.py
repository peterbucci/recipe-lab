#!/usr/bin/env python3
"""Enforce the small set of backend dependency boundaries we rely on."""

from __future__ import annotations

import argparse
import ast
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

DOMAIN_ROOTS = (
    "backend/app/core",
    "backend/app/models",
    "backend/app/policies",
    "backend/app/repositories",
    "backend/app/services",
)
FORBIDDEN_IMPORT_ROOTS = ("app.api", "fastapi")


@dataclass(frozen=True, order=True)
class Violation:
    path: str
    line: int
    imported_module: str

    def render(self) -> str:
        return (
            f"{self.path}:{self.line}: domain and persistence code must not import "
            f"transport module {self.imported_module!r}"
        )


def _is_forbidden(module: str) -> bool:
    return any(module == root or module.startswith(f"{root}.") for root in FORBIDDEN_IMPORT_ROOTS)


def audit_source(*, path: str, source: str) -> list[Violation]:
    """Return transport imports found in one Python source file."""

    tree = ast.parse(source, filename=path)
    violations: list[Violation] = []
    for node in ast.walk(tree):
        modules: list[str]
        if isinstance(node, ast.Import):
            modules = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom) and node.module is not None:
            modules = [node.module]
        else:
            continue
        violations.extend(
            Violation(path, node.lineno, module) for module in modules if _is_forbidden(module)
        )
    return violations


def audit_repository(repository: Path) -> list[Violation]:
    """Audit every Python module in the transport-independent backend layers."""

    violations: list[Violation] = []
    for relative_root in DOMAIN_ROOTS:
        root = repository / relative_root
        for path in sorted(root.rglob("*.py")):
            relative = path.relative_to(repository).as_posix()
            violations.extend(audit_source(path=relative, source=path.read_text(encoding="utf-8")))
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
    except (OSError, SyntaxError) as error:
        print(f"Architecture dependency audit could not run: {error}", file=sys.stderr)
        return 1

    if violations:
        print("Architecture dependency audit failed:", file=sys.stderr)
        for violation in violations:
            print(f"- {violation.render()}", file=sys.stderr)
        return 1

    print("Architecture dependency audit passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
