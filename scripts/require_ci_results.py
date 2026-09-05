#!/usr/bin/env python3
"""Fail closed when prerequisite GitHub Actions jobs do not match a CI tier."""

from __future__ import annotations

import argparse
from collections.abc import Sequence


def _result(value: str) -> tuple[str, str]:
    label, separator, result = value.partition("=")
    if not separator or not label.strip() or not result.strip():
        raise argparse.ArgumentTypeError("results must use LABEL=RESULT")
    return label.strip(), result.strip()


def validate_results(
    *,
    tier: str,
    required: Sequence[tuple[str, str]],
    full_only: Sequence[tuple[str, str]],
    fast_only: Sequence[tuple[str, str]] = (),
) -> list[str]:
    """Return failures, accepting tier-specific skips only outside that tier."""
    failures = [
        f"{label}: expected success, got {result}"
        for label, result in required
        if result != "success"
    ]
    accepted_full_only = {"success"} if tier == "full" else {"success", "skipped"}
    failures.extend(
        f"{label}: expected {'success' if tier == 'full' else 'success or skipped'}, got {result}"
        for label, result in full_only
        if result not in accepted_full_only
    )
    accepted_fast_only = {"success"} if tier == "fast" else {"success", "skipped"}
    failures.extend(
        f"{label}: expected {'success' if tier == 'fast' else 'success or skipped'}, got {result}"
        for label, result in fast_only
        if result not in accepted_fast_only
    )
    return failures


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tier", choices=("fast", "full"), required=True)
    parser.add_argument("--required", action="append", default=[], type=_result)
    parser.add_argument("--full-only", action="append", default=[], type=_result)
    parser.add_argument("--fast-only", action="append", default=[], type=_result)
    args = parser.parse_args(argv)

    failures = validate_results(
        tier=args.tier,
        required=args.required,
        full_only=args.full_only,
        fast_only=args.fast_only,
    )
    if failures:
        for failure in failures:
            print(f"ERROR: {failure}")
        return 1
    print(f"All {args.tier}-tier prerequisites satisfied.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
