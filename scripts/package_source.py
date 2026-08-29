#!/usr/bin/env python3
"""Create a bounded, deterministic, secret-scanned source archive.

The exporter reads one explicit Git commit. It never reads source files from the
working tree, which prevents ignored local files from entering either scan.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import tempfile
from dataclasses import dataclass, replace
import unicodedata
import zipfile


TOOL_NAME = "recipe-lab-safe-source-export"
TOOL_VERSION = "1.0.0"
SCANNER_NAME = "recipe-lab-source-secret-scan"
SCANNER_VERSION = "2"
MANIFEST_SCHEMA_VERSION = 1
POLICY_VERSION = 2
FIXED_ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)
MAX_REPORTED_FINDINGS = 20


class PackagingError(RuntimeError):
    """A privacy-safe packaging failure suitable for command-line output."""


@dataclass(frozen=True)
class PackagingPolicy:
    """The single versioned allowlist and resource-limit configuration."""

    max_entries: int
    max_path_bytes: int
    max_file_bytes: int
    max_uncompressed_bytes: int
    max_compressed_bytes: int
    allowed_top_level_directories: frozenset[str]
    allowed_root_files: frozenset[str]
    allowed_extensions: frozenset[str]
    allowed_special_basenames: frozenset[str]
    reviewed_opaque_git_objects: tuple[tuple[str, str], ...]


EXPORT_POLICY = PackagingPolicy(
    max_entries=2_000,
    max_path_bytes=512,
    max_file_bytes=10 * 1024 * 1024,
    max_uncompressed_bytes=25 * 1024 * 1024,
    max_compressed_bytes=25 * 1024 * 1024,
    allowed_top_level_directories=frozenset(
        {".github", "backend", "docs", "frontend", "ml", "scripts"}
    ),
    allowed_root_files=frozenset(
        {
            ".dockerignore",
            ".env.example",
            ".gitignore",
            "README.md",
            "compose.yaml",
            "pyproject.toml",
            "uv.lock",
        }
    ),
    allowed_extensions=frozenset(
        {
            ".css",
            ".ini",
            ".json",
            ".mako",
            ".md",
            ".mjs",
            ".mts",
            ".png",
            ".py",
            ".toml",
            ".ts",
            ".tsx",
            ".typed",
            ".yaml",
            ".yml",
        }
    ),
    allowed_special_basenames=frozenset(
        {".dockerignore", ".env.example", ".gitignore", "Dockerfile"}
    ),
    # Opaque files cannot receive a meaningful text secret scan. Keep their Git
    # object IDs explicit so any content change requires a policy review.
    reviewed_opaque_git_objects=(
        (
            "docs/assets/rcp-13a-catalog-desktop.png",
            "b912e0901366c54159b0721917a72e1972961a59",
        ),
        (
            "docs/assets/rcp-13a-comparison-desktop.png",
            "e7abed44190d4d10ad1c8a9216c39aceb043b59b",
        ),
        (
            "docs/assets/rcp-13a-detail-desktop.png",
            "0bb9ccb1878e8f92ee2e1c50cb5695d8188a666f",
        ),
        (
            "docs/assets/rcp-13a-detail-phone.png",
            "d22524f68c63d8cde053bf874b0c6fe21a337a71",
        ),
        (
            "docs/assets/rcp-13a-home-desktop.png",
            "b9812ff36485b1b3736348f230a3b5a663cfc561",
        ),
        (
            "docs/assets/rcp-13a-home-phone.png",
            "aae4cad63a144996119c07aa3cddcd6fd3f8517b",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/catalog-empty.png",
            "ee1cfdedec78ad93acb8c29bcf6bd86b95d4a670",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/catalog-normal.png",
            "abc76e816ac815ba03cea2ae7a9744e427370ea1",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/draft-editor-validation.png",
            "bbb6d1d1d463648fd22f49b8552107ecc1ad26b6",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/draft-ingredient-editor-normal.png",
            "e13dc3ba0ca64854e74e8356f053809ca55effac",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/draft-similarity-publication-review.png",
            "9737b26812d4e606b3be93ff8a54fd4f16f7c976",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/home-account-navigation.png",
            "6359daeac2aaa2ae7f8ea97a2f097e803eeb3719",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/home-normal.png",
            "4e8750adfa854de8bb6e8b9c055068c2d2f3c019",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/ingredient-request-staff-review.png",
            "c9432a759446765826d63ee0163babc96dd55304",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/my-recipes-normal.png",
            "6cf0a06c38be8e5e4f4e4f00dd949588b61a5ee6",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/private-workspace-expired-session.png",
            "826a2bfcff8433a58276dddcb812b4d96aa78ac4",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/private-workspace-failure.png",
            "ef79a027a9f87d70c4564b0cec9ec2ce0ac7beaf",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/private-workspace-loading.png",
            "2313ba19799c90bb1b68ed122a9e7fc1aa64f018",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/recipe-comparison-normal.png",
            "bfc80f4a640103579b18b3085b23e2a969a44dd0",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/recipe-detail-history.png",
            "24d2c39ef3432f8beb642f2c879e87622ef3fe8a",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/recipe-detail-normal.png",
            "dbf1e8110d4403ca72e1c89f65aabc111bffbd91",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/recipe-moderation-staff-review.png",
            "c75ce18a7eb9fcbb475f61b9e20ef8baf2ca1259",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/catalog-normal.png",
            "6d7640d2f71e63fc1dff47c6374ae5075265e06e",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/draft-editor-validation.png",
            "6940ea4fe50913e19f5a6631fd868a01cae5c937",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/draft-ingredient-editor-normal.png",
            "d41dd924b432585c46e54c4cdeb184a2cd9d8b33",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/home-account-navigation.png",
            "43a8102b67c9c627c78809a7c68113fba6764b67",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/home-normal.png",
            "fb7c001c7ea26cf53270cf290d261dfeefd62d64",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/my-recipes-normal.png",
            "2802bc2f0ca4c5cfc4988a79af9c25a157140322",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/recipe-comparison-normal.png",
            "453b056269d27687ce531720ec50c5fa43a31086",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/recipe-detail-history.png",
            "7f26921c133168f98cc20f4ffa5fd87e00e23e74",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/recipe-detail-normal.png",
            "289e1b4bf8412c68a04abdef785596dca9f9f47a",
        ),
    ),
)


DENIED_COMPONENTS = frozenset(
    {
        ".git",
        ".hg",
        ".cache",
        ".mypy_cache",
        ".next",
        ".nyc_output",
        ".nox",
        ".nuxt",
        ".output",
        ".parcel-cache",
        ".pnpm-store",
        ".pytest_cache",
        ".ruff_cache",
        ".svn",
        ".svelte-kit",
        ".turbo",
        ".tox",
        ".venv",
        ".vercel",
        ".vite",
        ".yarn",
        "__pycache__",
        "allure-report",
        "allure-results",
        "artifacts",
        "blob-report",
        "bower_components",
        "build",
        "cache",
        "coverage",
        "dist",
        "env",
        "htmlcov",
        "jspm_packages",
        "logs",
        "node_modules",
        "out",
        "playwright-report",
        "reports",
        "screenshots",
        "site-packages",
        "snapshots",
        "storybook-static",
        "target",
        "test-artifacts",
        "test-output",
        "test-results",
        "traces",
        "vendor",
        "venv",
    }
)
DENIED_FILENAMES = frozenset(
    {
        ".coverage",
        ".eslintcache",
        ".gitmodules",
        ".netrc",
        ".npmrc",
        ".pypirc",
        "credentials.json",
        "coverage.json",
        "junit.xml",
        "lcov.info",
        "npm-debug.log",
        "recipe-lab-acceptance-sessions.json",
        "service-account.json",
        "test-results.xml",
        "thumbs.db",
    }
)
DENIED_SUFFIXES = frozenset(
    {
        ".7z",
        ".der",
        ".dump",
        ".gz",
        ".jks",
        ".key",
        ".keystore",
        ".log",
        ".p12",
        ".pem",
        ".pfx",
        ".pkcs12",
        ".rar",
        ".tar",
        ".tgz",
        ".tsbuildinfo",
        ".zip",
    }
)
WINDOWS_RESERVED_NAMES = frozenset(
    {
        "aux",
        "clock$",
        "con",
        "nul",
        "prn",
        *(f"com{number}" for number in range(1, 10)),
        *(f"lpt{number}" for number in range(1, 10)),
    }
)
BIDI_CONTROLS = frozenset(
    {
        "\u061c",
        "\u200e",
        "\u200f",
        "\u202a",
        "\u202b",
        "\u202c",
        "\u202d",
        "\u202e",
        "\u2066",
        "\u2067",
        "\u2068",
        "\u2069",
    }
)


@dataclass(frozen=True)
class TreeEntry:
    path: str
    mode: int
    object_id: str
    size: int


@dataclass(frozen=True)
class SourceEntry:
    path: str
    mode: int
    object_id: str
    size: int
    sha256: str
    data: bytes
    opaque: bool
    compressed_size: int | None = None


@dataclass(frozen=True)
class SecretFinding:
    rule: str
    path: str
    line: int


HIGH_CONFIDENCE_SECRET_RULES: tuple[tuple[str, re.Pattern[bytes]], ...] = (
    (
        "private-key",
        re.compile(
            rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----"
        ),
    ),
    (
        "aws-access-key-id",
        re.compile(
            rb"(?<![A-Z0-9])(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA|A3T)"
            rb"[A-Z0-9]{16}(?![A-Z0-9])"
        ),
    ),
    ("github-token", re.compile(rb"(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{36,}")),
    (
        "github-fine-grained-token",
        re.compile(rb"(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{50,}"),
    ),
    (
        "slack-token",
        re.compile(rb"(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{20,}"),
    ),
    ("stripe-live-key", re.compile(rb"(?<![A-Za-z0-9])sk_live_[A-Za-z0-9]{16,}")),
    ("google-api-key", re.compile(rb"(?<![A-Za-z0-9])AIza[A-Za-z0-9_-]{35}")),
)
GENERIC_QUOTED_CREDENTIAL_ASSIGNMENT = re.compile(
    rb"(?:^|[\s,{;(])['\"]?"
    rb"(?P<key>[A-Za-z_][A-Za-z0-9_.-]*)"
    rb"['\"]?\s*(?:=|:)\s*(?P<quote>['\"])"
    rb"(?P<value>[^'\"\r\n]{16,})(?P=quote)"
)
GENERIC_UNQUOTED_CREDENTIAL_ASSIGNMENT = re.compile(
    rb"(?:^|[\s,{;(])(?:export\s+)?"
    rb"['\"]?(?P<key>[A-Za-z_][A-Za-z0-9_.-]*)['\"]?"
    rb"\s*(?P<operator>=|:)\s*(?P<value>[A-Za-z0-9_./+=%-]{16,})"
    rb"(?=\s*(?:$|[,;}#]))"
)
CREDENTIAL_URI_COMPONENT = (
    rb"(?:\$\{[A-Za-z_][A-Za-z0-9_]*(?::-[^{}\s/@]*)?\}|[^\s/:@]+)"
)
CREDENTIAL_URI = re.compile(
    rb"(?i)(?:postgres(?:ql)?(?:\+[a-z0-9_-]+)?|mysql|mariadb|redis|"
    rb"mongodb(?:\+srv)?|amqp|amqps)://"
    + CREDENTIAL_URI_COMPONENT
    + rb":(?P<value>"
    + CREDENTIAL_URI_COMPONENT
    + rb")@"
)
REVIEWED_PLACEHOLDER_VALUES = frozenset(
    {
        b"frontend-network-signal-test-secret-123456",
        b"invalid-rcp32-csrf-evidence",
        b"production-abuse-rate-limit-secret-123",
        b"recipe-lab-rcp32-ci-network-signal-secret-2026",
        b"recipe-lab-rcp32-ci-rate-limit-secret-2026",
        b"${postgres_password:-recipe_lab}",
    }
)
CREDENTIAL_KEY_TOKENS = frozenset(
    {
        b"accesskey",
        b"apikey",
        b"clientsecret",
        b"credential",
        b"credentials",
        b"passwd",
        b"password",
        b"privatekey",
        b"secret",
        b"secretkey",
        b"token",
    }
)
CREDENTIAL_KEY_PAIRS = (
    frozenset({b"access", b"key"}),
    frozenset({b"api", b"key"}),
    frozenset({b"client", b"secret"}),
    frozenset({b"private", b"key"}),
)
CREDENTIAL_KEY_SEPARATOR = re.compile(rb"[._-]+")
GENERIC_MIN_UNIQUE_BYTES = 8
GENERIC_MIN_ENTROPY = 3.25
GENERIC_ALPHANUMERIC_MIN_LENGTH = 24
GENERIC_ALPHANUMERIC_MIN_ENTROPY = 3.5
GENERIC_ALPHA_ONLY_MIN_ENTROPY = 4.0
GENERIC_MIN_CHARACTER_CLASSES = 3
HEX_CREDENTIAL = re.compile(rb"[0-9a-fA-F]{32,}")
ALPHANUMERIC_CREDENTIAL = re.compile(rb"[A-Za-z0-9]+")
PLACEHOLDER_REFERENCE_PATTERNS = (
    re.compile(rb"\$\{[A-Za-z_][A-Za-z0-9_]*\}"),
    re.compile(rb"\{\{\s*[A-Za-z_][A-Za-z0-9_.]*\s*\}\}"),
)
TYPE_ANNOTATION_EXTENSIONS = frozenset({".mjs", ".mts", ".py", ".ts", ".tsx"})
TYPE_ANNOTATION_TERMINATORS = (b",", b";")
TYPE_ANNOTATION_VALUE = re.compile(rb"[A-Za-z_][A-Za-z0-9_.<>\[\]|]*")
OPAQUE_SCAN_STRATEGY = "reviewed-git-object plus high-confidence byte rules only"


def _run_git(repository: Path, *arguments: str) -> bytes:
    environment = os.environ.copy()
    environment["GIT_OPTIONAL_LOCKS"] = "0"
    result = subprocess.run(
        ["git", *arguments],
        cwd=repository,
        env=environment,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        raise PackagingError("Git could not resolve or read the requested revision.")
    return result.stdout


def _repository_root(repository: Path) -> Path:
    raw_root = _run_git(repository, "rev-parse", "--show-toplevel")
    try:
        return Path(os.fsdecode(raw_root.rstrip(b"\r\n"))).resolve(strict=True)
    except (OSError, UnicodeError) as error:
        raise PackagingError(
            "The Git repository root is not a safe local path."
        ) from error


def _resolve_commit(repository: Path, revision: str) -> str:
    if not revision or any(character in revision for character in ("\0", "\r", "\n")):
        raise PackagingError("A single explicit Git revision is required.")
    raw_sha = _run_git(
        repository,
        "rev-parse",
        "--verify",
        "--end-of-options",
        f"{revision}^{{commit}}",
    ).strip()
    try:
        commit_sha = raw_sha.decode("ascii")
    except UnicodeDecodeError as error:
        raise PackagingError("Git returned an invalid commit identifier.") from error
    if re.fullmatch(r"[0-9a-f]{40,64}", commit_sha) is None:
        raise PackagingError("Git returned an invalid commit identifier.")
    return commit_sha


def _require_clean_tree(repository: Path) -> None:
    status = _run_git(
        repository,
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--ignore-submodules=none",
    )
    if status:
        raise PackagingError(
            "The working tree is dirty; commit or remove staged, unstaged, and "
            "untracked changes before exporting."
        )


def _is_inside(path: Path, directory: Path) -> bool:
    try:
        path.relative_to(directory)
    except ValueError:
        return False
    return True


def _prepare_output(repository: Path, output: Path) -> tuple[Path, Path]:
    if output.suffix.casefold() != ".zip":
        raise PackagingError("The output must use the .zip extension.")
    resolved_output = output.expanduser().resolve(strict=False)
    manifest = resolved_output.with_name(f"{resolved_output.name}.manifest.json")
    if _is_inside(resolved_output, repository) or _is_inside(manifest, repository):
        raise PackagingError(
            "The archive and manifest must be written outside the repository."
        )
    for destination in (resolved_output, manifest):
        if destination.exists() or destination.is_symlink():
            raise PackagingError(
                "The archive or manifest output already exists; refusing to overwrite it."
            )
    try:
        resolved_output.parent.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise PackagingError("The output directory could not be created.") from error
    if not resolved_output.parent.is_dir():
        raise PackagingError("The output parent is not a directory.")
    return resolved_output, manifest


def _validate_source_path(path: str, policy: PackagingPolicy) -> str:
    if not path or path != unicodedata.normalize("NFC", path):
        raise PackagingError(f"Unsafe or non-normalized source path: {path!r}.")
    if len(path.encode("utf-8")) > policy.max_path_bytes:
        raise PackagingError(f"Source path exceeds the configured limit: {path!r}.")
    if "\\" in path or ":" in path or path.startswith(("/", "//")):
        raise PackagingError(f"Unsafe source path: {path!r}.")
    if any(ord(character) < 32 or ord(character) == 127 for character in path):
        raise PackagingError(f"Control character in source path: {path!r}.")
    if any(character in BIDI_CONTROLS for character in path):
        raise PackagingError(f"Bidirectional control in source path: {path!r}.")

    pure_path = PurePosixPath(path)
    if pure_path.is_absolute() or not pure_path.parts:
        raise PackagingError(f"Unsafe source path: {path!r}.")
    for component in pure_path.parts:
        folded = component.casefold()
        device_stem = folded.split(".", 1)[0]
        if component in {"", ".", ".."} or component.endswith((".", " ")):
            raise PackagingError(f"Unsafe source path component: {path!r}.")
        if folded in DENIED_COMPONENTS or device_stem in WINDOWS_RESERVED_NAMES:
            raise PackagingError(f"Disallowed source path component: {path!r}.")

    top_level = pure_path.parts[0]
    reviewed_root_file = len(pure_path.parts) == 1 and path in policy.allowed_root_files
    if len(pure_path.parts) == 1:
        if not reviewed_root_file:
            raise PackagingError(f"Root file is not in the export allowlist: {path!r}.")
    elif top_level not in policy.allowed_top_level_directories:
        raise PackagingError(
            f"Top-level path is not in the export allowlist: {path!r}."
        )

    basename = pure_path.name
    folded_basename = basename.casefold()
    suffix = pure_path.suffix.casefold()
    if basename.startswith(".env") and path != ".env.example":
        raise PackagingError(f"Environment file is not exportable: {path!r}.")
    if folded_basename in DENIED_FILENAMES or suffix in DENIED_SUFFIXES:
        raise PackagingError(
            f"Sensitive or generated file is not exportable: {path!r}."
        )
    if (
        not reviewed_root_file
        and basename not in policy.allowed_special_basenames
        and suffix not in policy.allowed_extensions
    ):
        raise PackagingError(f"File type is not in the export allowlist: {path!r}.")
    return path


def _list_tree(
    repository: Path, commit_sha: str, policy: PackagingPolicy
) -> list[TreeEntry]:
    raw_tree = _run_git(
        repository,
        "ls-tree",
        "-r",
        "-l",
        "-z",
        "--full-tree",
        commit_sha,
    )
    records = [record for record in raw_tree.split(b"\0") if record]
    if len(records) > policy.max_entries:
        raise PackagingError(
            "The selected revision exceeds the configured entry-count limit."
        )

    entries: list[TreeEntry] = []
    seen: set[str] = set()
    seen_portable: set[str] = set()
    total_size = 0
    for record in records:
        try:
            metadata, raw_path = record.split(b"\t", 1)
            mode_raw, object_type_raw, object_id_raw, size_raw = metadata.split()
            path = raw_path.decode("utf-8", errors="strict")
            mode_text = mode_raw.decode("ascii")
            object_type = object_type_raw.decode("ascii")
            object_id = object_id_raw.decode("ascii")
            size_text = size_raw.decode("ascii")
        except (UnicodeDecodeError, ValueError) as error:
            raise PackagingError(
                "Git returned an unsafe or malformed tree entry."
            ) from error

        _validate_source_path(path, policy)
        if (
            len(_archive_member_path(commit_sha, path).encode("utf-8"))
            > policy.max_path_bytes
        ):
            raise PackagingError(
                f"Archive path exceeds the configured limit: {path!r}."
            )
        if mode_text not in {"100644", "100755"} or object_type != "blob":
            raise PackagingError(
                f"Only regular tracked files may be exported: {path!r}."
            )
        if (
            re.fullmatch(r"[0-9a-f]{40,64}", object_id) is None
            or not size_text.isdecimal()
        ):
            raise PackagingError(f"Git returned invalid metadata for: {path!r}.")
        size = int(size_text)
        if size > policy.max_file_bytes:
            raise PackagingError(
                f"Source file exceeds the configured size limit: {path!r}."
            )
        total_size += size
        if total_size > policy.max_uncompressed_bytes:
            raise PackagingError(
                "The selected revision exceeds the uncompressed-size limit."
            )

        portable_key = unicodedata.normalize("NFC", path).casefold()
        if path in seen or portable_key in seen_portable:
            raise PackagingError(f"Duplicate or non-portable source path: {path!r}.")
        seen.add(path)
        seen_portable.add(portable_key)
        entries.append(
            TreeEntry(
                path=path,
                mode=int(mode_text, 8),
                object_id=object_id,
                size=size,
            )
        )

    if not entries:
        raise PackagingError("The selected revision has no exportable files.")
    return sorted(entries, key=lambda entry: entry.path.encode("utf-8"))


def _looks_like_lfs_pointer(data: bytes) -> bool:
    lines = data.splitlines()
    return bool(
        lines
        and lines[0] == b"version https://git-lfs.github.com/spec/v1"
        and any(re.fullmatch(rb"oid sha256:[0-9a-f]{64}", line) for line in lines[1:])
        and any(re.fullmatch(rb"size [0-9]+", line) for line in lines[1:])
    )


def _reviewed_opaque_objects(policy: PackagingPolicy) -> dict[str, str]:
    opaque_objects: dict[str, str] = {}
    for path, object_id in policy.reviewed_opaque_git_objects:
        if any(character in path for character in "*?[]{}"):
            raise PackagingError(
                "Opaque-file policy entries must use literal paths, not wildcards."
            )
        _validate_source_path(path, policy)
        if not path.endswith(".png"):
            raise PackagingError(f"Invalid opaque-file policy entry: {path!r}.")
        if path in opaque_objects:
            raise PackagingError(f"Duplicate opaque-file policy entry: {path!r}.")
        if re.fullmatch(r"[0-9a-f]{40,64}", object_id) is None:
            raise PackagingError(f"Invalid opaque-file Git object ID: {path!r}.")
        opaque_objects[path] = object_id
    return opaque_objects


def _read_sources(
    repository: Path, tree_entries: list[TreeEntry], policy: PackagingPolicy
) -> list[SourceEntry]:
    opaque_objects = _reviewed_opaque_objects(policy)
    sources: list[SourceEntry] = []
    for entry in tree_entries:
        data = _run_git(repository, "cat-file", "blob", entry.object_id)
        if len(data) != entry.size:
            raise PackagingError(f"Git blob size changed unexpectedly: {entry.path!r}.")
        if _looks_like_lfs_pointer(data):
            raise PackagingError(f"Git LFS pointer is not exportable: {entry.path!r}.")

        expected_opaque_object = opaque_objects.get(entry.path)
        opaque = expected_opaque_object is not None
        if entry.path.endswith(".png"):
            if expected_opaque_object != entry.object_id:
                raise PackagingError(
                    f"Opaque file is not the reviewed object in the export policy: {entry.path!r}."
                )
        elif expected_opaque_object is not None:
            raise PackagingError(f"Invalid opaque-file policy entry: {entry.path!r}.")
        else:
            try:
                data.decode("utf-8", errors="strict")
            except UnicodeDecodeError as error:
                raise PackagingError(
                    f"Unreviewed binary or non-UTF-8 file is not exportable: {entry.path!r}."
                ) from error

        sources.append(
            SourceEntry(
                path=entry.path,
                mode=entry.mode,
                object_id=entry.object_id,
                size=entry.size,
                sha256=hashlib.sha256(data).hexdigest(),
                data=data,
                opaque=opaque,
            )
        )
    return sources


def _shannon_entropy(value: bytes) -> float:
    if not value:
        return 0.0
    counts = {byte: value.count(byte) for byte in set(value)}
    length = len(value)
    return -sum(
        (count / length) * math.log2(count / length) for count in counts.values()
    )


def _looks_like_placeholder(value: bytes) -> bool:
    folded = value.lower()
    if folded in REVIEWED_PLACEHOLDER_VALUES:
        return True
    if any(pattern.fullmatch(value) for pattern in PLACEHOLDER_REFERENCE_PATTERNS):
        return True
    if (
        len(set(value)) < GENERIC_MIN_UNIQUE_BYTES
        or _shannon_entropy(value) < GENERIC_MIN_ENTROPY
    ):
        return True
    if HEX_CREDENTIAL.fullmatch(value):
        return False
    has_lower = any(97 <= byte <= 122 for byte in value)
    has_upper = any(65 <= byte <= 90 for byte in value)
    has_digit = any(48 <= byte <= 57 for byte in value)
    has_symbol = any(
        not (48 <= byte <= 57 or 65 <= byte <= 90 or 97 <= byte <= 122)
        for byte in value
    )
    if (
        len(value) >= GENERIC_ALPHANUMERIC_MIN_LENGTH
        and ALPHANUMERIC_CREDENTIAL.fullmatch(value)
        and _shannon_entropy(value) >= GENERIC_ALPHANUMERIC_MIN_ENTROPY
        and (
            (has_digit and (has_lower or has_upper))
            or _shannon_entropy(value) >= GENERIC_ALPHA_ONLY_MIN_ENTROPY
        )
    ):
        return False
    return (
        sum((has_lower, has_upper, has_digit, has_symbol))
        < GENERIC_MIN_CHARACTER_CLASSES
    )


def _is_credential_key(raw_key: bytes) -> bool:
    parts = {part for part in CREDENTIAL_KEY_SEPARATOR.split(raw_key.lower()) if part}
    if parts & CREDENTIAL_KEY_TOKENS:
        return True
    return any(pair <= parts for pair in CREDENTIAL_KEY_PAIRS)


def _line_number(data: bytes, offset: int) -> int:
    return data.count(b"\n", 0, offset) + 1


def _scan_entries(entries: list[SourceEntry]) -> list[SecretFinding]:
    findings: list[SecretFinding] = []
    for entry in entries:
        for rule, pattern in HIGH_CONFIDENCE_SECRET_RULES:
            for secret_match in pattern.finditer(entry.data):
                findings.append(
                    SecretFinding(
                        rule=rule,
                        path=entry.path,
                        line=_line_number(entry.data, secret_match.start()),
                    )
                )
                if len(findings) >= MAX_REPORTED_FINDINGS:
                    return findings
        if entry.opaque:
            continue
        for uri_match in CREDENTIAL_URI.finditer(entry.data):
            if _looks_like_placeholder(uri_match.group("value")):
                continue
            findings.append(
                SecretFinding(
                    rule="credential-uri",
                    path=entry.path,
                    line=_line_number(entry.data, uri_match.start()),
                )
            )
            if len(findings) >= MAX_REPORTED_FINDINGS:
                return findings
        for line_number, line in enumerate(entry.data.splitlines(), start=1):
            for pattern in (
                GENERIC_QUOTED_CREDENTIAL_ASSIGNMENT,
                GENERIC_UNQUOTED_CREDENTIAL_ASSIGNMENT,
            ):
                for credential_match in pattern.finditer(line):
                    if not _is_credential_key(credential_match.group("key")):
                        continue
                    value = credential_match.group("value")
                    if (
                        pattern is GENERIC_UNQUOTED_CREDENTIAL_ASSIGNMENT
                        and credential_match.group("operator") == b":"
                        and PurePosixPath(entry.path).suffix
                        in TYPE_ANNOTATION_EXTENSIONS
                        and line.rstrip().endswith(TYPE_ANNOTATION_TERMINATORS)
                        and TYPE_ANNOTATION_VALUE.fullmatch(value)
                    ):
                        continue
                    if not _looks_like_placeholder(value):
                        findings.append(
                            SecretFinding(
                                rule="generic-credential",
                                path=entry.path,
                                line=line_number,
                            )
                        )
                        if len(findings) >= MAX_REPORTED_FINDINGS:
                            return findings
    return findings


def _require_secret_scan(entries: list[SourceEntry], phase: str) -> None:
    try:
        findings = _scan_entries(entries)
    except Exception as error:
        raise PackagingError(
            f"The {phase} secret scan could not be completed."
        ) from error
    if findings:
        redacted_locations = ", ".join(
            f"{finding.rule} at {finding.path}:{finding.line}" for finding in findings
        )
        raise PackagingError(
            f"The {phase} secret scan found prohibited material ({redacted_locations})."
        )


def _archive_member_path(commit_sha: str, source_path: str) -> str:
    return f"recipe-lab-{commit_sha[:12]}/{source_path}"


def _write_archive(path: Path, commit_sha: str, entries: list[SourceEntry]) -> None:
    with zipfile.ZipFile(
        path,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
        strict_timestamps=True,
    ) as archive:
        archive.comment = b""
        for entry in entries:
            member_path = _archive_member_path(commit_sha, entry.path)
            member = zipfile.ZipInfo(member_path, date_time=FIXED_ZIP_TIMESTAMP)
            member.compress_type = zipfile.ZIP_DEFLATED
            member.create_system = 3
            member.external_attr = (entry.mode & 0xFFFF) << 16
            member.flag_bits |= 0x800
            archive.writestr(
                member,
                entry.data,
                compress_type=zipfile.ZIP_DEFLATED,
                compresslevel=9,
            )


def _verify_completed_archive(
    path: Path,
    commit_sha: str,
    expected_entries: list[SourceEntry],
    policy: PackagingPolicy,
) -> list[SourceEntry]:
    if path.stat().st_size > policy.max_compressed_bytes:
        raise PackagingError("The completed archive exceeds the compressed-size limit.")

    expected_by_member = {
        _archive_member_path(commit_sha, entry.path): entry
        for entry in expected_entries
    }
    verified: list[SourceEntry] = []
    seen: set[str] = set()
    seen_portable: set[str] = set()
    total_size = 0
    try:
        with zipfile.ZipFile(path, mode="r") as archive:
            if archive.comment:
                raise PackagingError("The completed archive has an unexpected comment.")
            members = archive.infolist()
            if (
                len(members) != len(expected_entries)
                or len(members) > policy.max_entries
            ):
                raise PackagingError(
                    "The completed archive has an unexpected entry count."
                )
            for member in members:
                if member.flag_bits & 0x1:
                    raise PackagingError("Encrypted archive members are not allowed.")
                if member.is_dir() or member.filename.endswith("/"):
                    raise PackagingError("Directory archive members are not allowed.")
                if (
                    member.compress_type != zipfile.ZIP_DEFLATED
                    or member.date_time != FIXED_ZIP_TIMESTAMP
                    or member.create_system != 3
                    or member.comment
                    or member.extra
                ):
                    raise PackagingError(
                        "The completed archive contains non-deterministic metadata."
                    )
                if member.filename in seen:
                    raise PackagingError(
                        "The completed archive contains a duplicate path."
                    )
                portable_key = unicodedata.normalize("NFC", member.filename).casefold()
                if portable_key in seen_portable:
                    raise PackagingError(
                        "The completed archive contains a path collision."
                    )
                seen.add(member.filename)
                seen_portable.add(portable_key)

                expected = expected_by_member.get(member.filename)
                if expected is None:
                    raise PackagingError(
                        "The completed archive contains an unexpected path."
                    )
                if len(member.filename.encode("utf-8")) > policy.max_path_bytes:
                    raise PackagingError(
                        "The completed archive contains an overlong path."
                    )
                member_mode = (member.external_attr >> 16) & 0xFFFF
                if not stat.S_ISREG(member_mode) or member_mode & 0o777 not in {
                    0o644,
                    0o755,
                }:
                    raise PackagingError(
                        "The completed archive contains a non-regular entry."
                    )
                if (
                    member.file_size != expected.size
                    or member.file_size > policy.max_file_bytes
                ):
                    raise PackagingError(
                        "The completed archive contains an invalid file size."
                    )
                total_size += member.file_size
                if total_size > policy.max_uncompressed_bytes:
                    raise PackagingError(
                        "The completed archive exceeds the uncompressed-size limit."
                    )
                data = archive.read(member)
                if hashlib.sha256(data).hexdigest() != expected.sha256:
                    raise PackagingError(
                        "The completed archive failed its content hash check."
                    )
                verified.append(
                    replace(expected, data=data, compressed_size=member.compress_size)
                )
            if set(expected_by_member) != seen:
                raise PackagingError(
                    "The completed archive is missing an expected path."
                )
    except (OSError, zipfile.BadZipFile, RuntimeError) as error:
        if isinstance(error, PackagingError):
            raise
        raise PackagingError("The completed archive could not be verified.") from error
    return verified


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _manifest(
    commit_sha: str,
    archive_path: Path,
    entries: list[SourceEntry],
    policy: PackagingPolicy,
) -> dict[str, object]:
    uncompressed_bytes = sum(entry.size for entry in entries)
    policy_limits = {
        "max_compressed_bytes": policy.max_compressed_bytes,
        "max_entries": policy.max_entries,
        "max_file_bytes": policy.max_file_bytes,
        "max_path_bytes": policy.max_path_bytes,
        "max_uncompressed_bytes": policy.max_uncompressed_bytes,
    }
    policy_fingerprint_input = {
        "allowed_extensions": sorted(policy.allowed_extensions),
        "allowed_root_files": sorted(policy.allowed_root_files),
        "allowed_special_basenames": sorted(policy.allowed_special_basenames),
        "allowed_top_level_directories": sorted(policy.allowed_top_level_directories),
        "bidirectional_controls": sorted(ord(character) for character in BIDI_CONTROLS),
        "denied_components": sorted(DENIED_COMPONENTS),
        "denied_filenames": sorted(DENIED_FILENAMES),
        "denied_suffixes": sorted(DENIED_SUFFIXES),
        "environment_file_exception": ".env.example at repository root only",
        "limits": policy_limits,
        "path_normalization": "UTF-8 NFC with portable casefold collision checks",
        "reviewed_opaque_git_objects": list(policy.reviewed_opaque_git_objects),
        "version": POLICY_VERSION,
        "windows_reserved_names": sorted(WINDOWS_RESERVED_NAMES),
    }
    policy_sha256 = hashlib.sha256(
        json.dumps(
            policy_fingerprint_input, separators=(",", ":"), sort_keys=True
        ).encode("utf-8")
    ).hexdigest()
    scanner_fingerprint_input = {
        "credential_key_pairs": [
            sorted(part.decode("ascii") for part in pair)
            for pair in CREDENTIAL_KEY_PAIRS
        ],
        "credential_key_tokens": sorted(
            token.decode("ascii") for token in CREDENTIAL_KEY_TOKENS
        ),
        "credential_key_tokenization": {
            "flags": CREDENTIAL_KEY_SEPARATOR.flags,
            "pattern": CREDENTIAL_KEY_SEPARATOR.pattern.decode("ascii"),
        },
        "credential_uri": {
            "flags": CREDENTIAL_URI.flags,
            "pattern": CREDENTIAL_URI.pattern.decode("ascii"),
        },
        "generic_assignments": [
            {
                "flags": GENERIC_QUOTED_CREDENTIAL_ASSIGNMENT.flags,
                "pattern": GENERIC_QUOTED_CREDENTIAL_ASSIGNMENT.pattern.decode("ascii"),
            },
            {
                "flags": GENERIC_UNQUOTED_CREDENTIAL_ASSIGNMENT.flags,
                "pattern": GENERIC_UNQUOTED_CREDENTIAL_ASSIGNMENT.pattern.decode(
                    "ascii"
                ),
            },
        ],
        "high_confidence_rules": [
            [rule, pattern.pattern.decode("ascii"), pattern.flags]
            for rule, pattern in HIGH_CONFIDENCE_SECRET_RULES
        ],
        "entropy_algorithm": "Shannon base-2 over raw byte frequencies",
        "opaque_scan_strategy": OPAQUE_SCAN_STRATEGY,
        "placeholder_rules": {
            "alphanumeric": {
                "flags": ALPHANUMERIC_CREDENTIAL.flags,
                "pattern": ALPHANUMERIC_CREDENTIAL.pattern.decode("ascii"),
            },
            "hex": {
                "flags": HEX_CREDENTIAL.flags,
                "pattern": HEX_CREDENTIAL.pattern.decode("ascii"),
            },
            "reference_patterns": [
                {
                    "flags": pattern.flags,
                    "pattern": pattern.pattern.decode("ascii"),
                }
                for pattern in PLACEHOLDER_REFERENCE_PATTERNS
            ],
        },
        "reviewed_placeholder_values": sorted(
            value.decode("ascii") for value in REVIEWED_PLACEHOLDER_VALUES
        ),
        "rules_version": SCANNER_VERSION,
        "scan_order": [
            "high-confidence-all-bytes",
            "credential-uri-text",
            "quoted-and-unquoted-assignments-per-line",
        ],
        "thresholds": {
            "alpha_only_min_entropy": GENERIC_ALPHA_ONLY_MIN_ENTROPY,
            "alphanumeric_min_entropy": GENERIC_ALPHANUMERIC_MIN_ENTROPY,
            "alphanumeric_min_length": GENERIC_ALPHANUMERIC_MIN_LENGTH,
            "generic_min_entropy": GENERIC_MIN_ENTROPY,
            "generic_min_character_classes": GENERIC_MIN_CHARACTER_CLASSES,
            "generic_min_unique_bytes": GENERIC_MIN_UNIQUE_BYTES,
            "max_reported_findings": MAX_REPORTED_FINDINGS,
        },
        "type_annotation_exception": {
            "extensions": sorted(TYPE_ANNOTATION_EXTENSIONS),
            "terminators": [
                terminator.decode("ascii") for terminator in TYPE_ANNOTATION_TERMINATORS
            ],
            "value_flags": TYPE_ANNOTATION_VALUE.flags,
            "value_pattern": TYPE_ANNOTATION_VALUE.pattern.decode("ascii"),
        },
    }
    scanner_sha256 = hashlib.sha256(
        json.dumps(
            scanner_fingerprint_input, separators=(",", ":"), sort_keys=True
        ).encode("utf-8")
    ).hexdigest()
    return {
        "archive": {
            "format": "zip",
            "root": f"recipe-lab-{commit_sha[:12]}/",
            "sha256": _sha256_file(archive_path),
            "compressed_bytes": archive_path.stat().st_size,
            "uncompressed_bytes": uncompressed_bytes,
            "entry_count": len(entries),
        },
        "files": [
            {
                "git_object_id": entry.object_id,
                "mode": f"{entry.mode:06o}",
                "path": entry.path,
                "sha256": entry.sha256,
                "compressed_bytes": entry.compressed_size,
                "size_bytes": entry.size,
            }
            for entry in entries
        ],
        "policy": {
            "limits": policy_limits,
            "reviewed_opaque_entries": sum(entry.opaque for entry in entries),
            "sha256": policy_sha256,
            "version": POLICY_VERSION,
        },
        "scanner": {
            "name": SCANNER_NAME,
            "version": SCANNER_VERSION,
            "sha256": scanner_sha256,
            "result": "passed",
            "passes": ["commit-tree", "completed-archive"],
            "findings": 0,
            "text_files_scanned_per_pass": sum(not entry.opaque for entry in entries),
        },
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "source": {
            "commit_sha": commit_sha,
            "working_tree": "clean",
        },
        "tool": {"name": TOOL_NAME, "version": TOOL_VERSION},
    }


def _temporary_path(parent: Path, output_name: str, suffix: str) -> Path:
    handle = tempfile.NamedTemporaryFile(
        mode="wb",
        prefix=f".{output_name}.",
        suffix=suffix,
        dir=parent,
        delete=False,
    )
    path = Path(handle.name)
    handle.close()
    return path


def package_source(
    repository: Path,
    revision: str,
    output: Path,
    *,
    policy: PackagingPolicy = EXPORT_POLICY,
) -> dict[str, object]:
    """Package one commit and return the privacy-safe manifest."""

    root = _repository_root(repository.resolve(strict=True))
    commit_sha = _resolve_commit(root, revision)
    resolved_output, manifest_path = _prepare_output(root, output)
    _require_clean_tree(root)

    tree_entries = _list_tree(root, commit_sha, policy)
    sources = _read_sources(root, tree_entries, policy)
    _require_secret_scan(sources, "commit-tree")

    temporary_archive: Path | None = None
    temporary_manifest: Path | None = None
    published_archive = False
    published_manifest = False
    try:
        temporary_archive = _temporary_path(
            resolved_output.parent, resolved_output.name, ".archive.tmp"
        )
        _write_archive(temporary_archive, commit_sha, sources)
        verified_sources = _verify_completed_archive(
            temporary_archive, commit_sha, sources, policy
        )
        _require_secret_scan(verified_sources, "completed-archive")
        report = _manifest(commit_sha, temporary_archive, verified_sources, policy)

        temporary_manifest = _temporary_path(
            resolved_output.parent, resolved_output.name, ".manifest.tmp"
        )
        temporary_manifest.write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )

        # Recheck immediately before publishing. A concurrent working-tree edit
        # invalidates the clean-tree claim even though archive bytes are frozen.
        _require_clean_tree(root)
        if any(
            destination.exists() or destination.is_symlink()
            for destination in (resolved_output, manifest_path)
        ):
            raise PackagingError(
                "The archive or manifest appeared during export; refusing to overwrite it."
            )
        try:
            # Hard-linking within one directory atomically creates each new name
            # and, unlike replace(), can never overwrite a racing destination.
            os.link(temporary_archive, resolved_output)
            published_archive = True
            os.link(temporary_manifest, manifest_path)
            published_manifest = True
            temporary_archive.unlink()
            temporary_archive = None
            temporary_manifest.unlink()
            temporary_manifest = None
        except OSError as error:
            raise PackagingError(
                "The verified outputs could not be published safely."
            ) from error
        return report
    except BaseException as error:
        cleanup_failed = False
        for published, destination in (
            (published_manifest, manifest_path),
            (published_archive, resolved_output),
        ):
            if not published:
                continue
            try:
                destination.unlink(missing_ok=True)
            except OSError:
                cleanup_failed = True
        if cleanup_failed:
            raise PackagingError(
                "Source export failed and partial-output cleanup could not be confirmed."
            ) from error
        raise
    finally:
        for temporary in (temporary_archive, temporary_manifest):
            if temporary is not None:
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    # No published path points to an unverified temporary file.
                    # The command already fails closed; avoid masking that error.
                    pass


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Create a deterministic, fail-closed Recipe Lab source archive."
    )
    parser.add_argument(
        "--ref",
        required=True,
        dest="revision",
        help="Explicit Git commit, tag, or branch to package.",
    )
    parser.add_argument(
        "--output",
        required=True,
        type=Path,
        help="New .zip path outside the repository; no existing file is overwritten.",
    )
    return parser


def main(arguments: list[str] | None = None) -> int:
    options = _parser().parse_args(arguments)
    try:
        report = package_source(Path.cwd(), options.revision, options.output)
    except PackagingError as error:
        print(f"Safe source export failed: {error}", file=sys.stderr)
        return 1
    except Exception:
        print(
            "Safe source export failed because an internal check could not be completed.",
            file=sys.stderr,
        )
        return 1
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
