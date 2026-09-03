#!/usr/bin/env python3
"""Run stable Recipe Lab quality gates from one checked-in command surface."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

REPOSITORY = Path(__file__).resolve().parents[1]


@dataclass(frozen=True, slots=True)
class Check:
    label: str
    arguments: tuple[str, ...]
    working_directory: Path = REPOSITORY


def _python(*arguments: str, working_directory: Path = REPOSITORY) -> Check:
    return Check(
        label=" ".join(arguments),
        arguments=(sys.executable, *arguments),
        working_directory=working_directory,
    )


def _npm(*arguments: str, working_directory: Path = REPOSITORY / "frontend") -> Check:
    return Check(
        label="npm " + " ".join(arguments),
        arguments=(shutil.which("npm") or "npm", *arguments),
        working_directory=working_directory,
    )


def _contracts() -> tuple[Check, ...]:
    return (
        _python("scripts/verify_repository_policy.py"),
        _python("scripts/verify_architecture.py"),
        _python("scripts/verify_doc_links.py"),
        _python(
            "-m",
            "app.openapi_contract",
            "check",
            working_directory=REPOSITORY / "backend",
        ),
        _python("-m", "app.seeds", "validate", working_directory=REPOSITORY / "backend"),
        _npm("run", "api:contracts:check"),
    )


def _lint() -> tuple[Check, ...]:
    return (
        _python(
            "-m",
            "ruff",
            "format",
            "--check",
            ".",
            working_directory=REPOSITORY / "backend",
        ),
        _python(
            "-m",
            "ruff",
            "check",
            "--output-format=github",
            ".",
            working_directory=REPOSITORY / "backend",
        ),
        _python(
            "-m",
            "ruff",
            "format",
            "--check",
            "src",
            "tests",
            working_directory=REPOSITORY / "ml",
        ),
        _python(
            "-m",
            "ruff",
            "check",
            "--output-format=github",
            "src",
            "tests",
            working_directory=REPOSITORY / "ml",
        ),
        _python("-m", "ruff", "format", "--config", "backend/pyproject.toml", "--check", "scripts"),
        _python(
            "-m",
            "ruff",
            "check",
            "--config",
            "backend/pyproject.toml",
            "--output-format=github",
            "scripts",
        ),
        _npm("run", "lint"),
    )


def _types() -> tuple[Check, ...]:
    return (
        _python(
            "-m",
            "mypy",
            "app",
            "migrations",
            "tests",
            working_directory=REPOSITORY / "backend",
        ),
        _python("-m", "mypy", "src", "tests", working_directory=REPOSITORY / "ml"),
        _npm("run", "typecheck"),
    )


def _backend() -> tuple[Check, ...]:
    return (
        _python("-m", "alembic", "upgrade", "head", working_directory=REPOSITORY / "backend"),
        _python("-m", "alembic", "check", working_directory=REPOSITORY / "backend"),
        _python("-m", "pytest", working_directory=REPOSITORY / "backend"),
    )


def _frontend() -> tuple[Check, ...]:
    test_arguments: tuple[str, ...] = ("test",)
    if os.name == "nt":
        test_arguments = ("test", "--", "--configLoader", "runner")
    return (
        _npm(*test_arguments),
        _npm("run", "build"),
        Check(
            label="npx --no-install playwright test --list",
            arguments=(
                shutil.which("npx") or "npx",
                "--no-install",
                "playwright",
                "test",
                "--list",
            ),
            working_directory=REPOSITORY / "frontend",
        ),
    )


def _ml() -> tuple[Check, ...]:
    return (_python("-m", "pytest", working_directory=REPOSITORY / "ml"),)


SUITES: dict[str, Callable[[], tuple[Check, ...]]] = {
    "backend": _backend,
    "contracts": _contracts,
    "frontend": _frontend,
    "lint": _lint,
    "ml": _ml,
    "types": _types,
}


def run_checks(
    checks: Sequence[Check],
    *,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> None:
    for check in checks:
        print(f"==> {check.label}", flush=True)
        runner(
            check.arguments,
            cwd=check.working_directory,
            check=True,
            text=True,
        )


def main(arguments: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("suites", nargs="+", choices=sorted(SUITES))
    parsed = parser.parse_args(arguments)

    try:
        for suite in parsed.suites:
            run_checks(SUITES[suite]())
    except (FileNotFoundError, subprocess.CalledProcessError) as error:
        print(f"Quality gate failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
