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
import re
import stat
import subprocess
import sys
import tempfile
import unicodedata
import zipfile
from dataclasses import dataclass, replace
from pathlib import Path, PurePosixPath

TOOL_NAME = "recipe-lab-safe-source-export"
TOOL_VERSION = "1.2.0"
SCANNER_NAME = "recipe-lab-source-secret-scan"
SCANNER_VERSION = "2"
MANIFEST_SCHEMA_VERSION = 1
POLICY_VERSION = 5
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
            ".gitattributes",
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
            ".sh",
            ".toml",
            ".ts",
            ".tsx",
            ".typed",
            ".yaml",
            ".yml",
        }
    ),
    allowed_special_basenames=frozenset(
        {".dockerignore", ".env.example", ".gitattributes", ".gitignore", "Dockerfile"}
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
            "frontend/baselines/baseline-desktop-chromium/account-access-intermediate-normal.png",
            "9e4e3497680a1f17d4fdee862c6f5e1622fcaf02",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/account-activity-no-matches.png",
            "c783ec1a8f163a320c69affd53e741a06c0816de",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/account-activity-normal-intermediate.png",
            "57dc3be36872ecd466f46ef27834e784ea773e23",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/account-activity-normal.png",
            "74f8603ac6b7c37b38551614a77ed4ba7ce50fde",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/account-activity-saved-filtered.png",
            "58e3b1fe02f52f2334fb0940b1698d8f51c5f666",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/account-settings-danger-intermediate-normal.png",
            "4ab1129014b096d0a91ce9212f7659c1faf7d08c",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/account-settings-danger-normal.png",
            "f58a5ed205299fbf596b937e6eaa55a6d8a50ed1",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/account-settings-profile-intermediate-normal.png",
            "37e1357a155d405b446323cb1443249024a37236",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/account-settings-profile-normal.png",
            "eee2d09ae51472481ee6ed95b2e7ec28b1e683cf",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/auth-callback-error-intermediate.png",
            "a563b734841daf3278e97551e81190ed156c5fea",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/authoring-entry-desktop-normal.png",
            "05700e82963db19f69f5efd776f8895bc944e6de",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/catalog-empty.png",
            "8f2eca5f683f9d200cce415b820730629ce204ed",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/catalog-intermediate-normal.png",
            "04ab974181c3d5206ae17635817676e9be7f6c71",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/catalog-normal.png",
            "7c054d10ea026f2e1dc01fbd93607cd9f7915464",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/community-rules-normal.png",
            "a89148d154d4b0ffbdd55f640d0745207fa74f79",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/cook-profile-normal.png",
            "199dd9858ef1dcc911b6ca8d5a2e85dbf9ab9a7d",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/cook-profile-sparse-owner.png",
            "510d3e1069f7adef581ac050726266ad3f80fe5d",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/draft-discard-confirmation.png",
            "e721bad90041e1bdd0ef8baea17d176005e9bf0f",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/draft-editor-intermediate-normal.png",
            "3969d81d3dcc9baeb2267df999a33342c40f7dce",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/draft-editor-validation.png",
            "2403b22ea22df7e61bc3dbbdaeaf1a0db7b4c7f7",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/draft-fork-header-normal.png",
            "e1aa306f2765b3aac72c6e4aeb41606f542adaf2",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/draft-ingredient-editor-normal.png",
            "ca254176e534dc2fbbb5e741561c4caa74e31b1d",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/draft-instruction-editor-expanded.png",
            "d247e9b0b75b965b36fe48a5b6d8bc77a0522588",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/draft-instruction-editor-normal.png",
            "cf8017a73dc40be9e71d561a1d4129f4c3b59822",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/draft-publish-dialog.png",
            "27e843b4feabb9a5f9e60ef8aded819fe12e04d9",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/draft-similarity-publication-review.png",
            "0eb9817328d9453ba1073b86e37734ce2a87de3f",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/home-account-navigation.png",
            "d77650b710292c5d4226645358b41e54a1099ff1",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/home-intermediate-normal.png",
            "36c77dea82e9eced65d439a9473d9b3ba6f201a4",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/home-normal.png",
            "71492cf2a354b687dc36d9cd2495e7bd7464963d",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/ingredient-request-staff-review-intermediate.png",
            "e7d54f3bea80b511906a75d82ebf874141ddf3f2",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/ingredient-request-staff-review.png",
            "1c356c9b85b657cb19afad48fcbf0cbc7bfda71d",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/my-ingredient-requests-intermediate.png",
            "eec9ef7921eedca6789250b9257d5ef597ed5165",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/my-ingredient-requests.png",
            "7ebb1e806cce1d42e9520e8086a2c0060840a18f",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/my-recipes-intermediate-normal.png",
            "01fdcf8535f867f13e1a485d7557375a711212a5",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/my-recipes-normal.png",
            "9dfc3f31113f77f1a6895c7a5214e5180dc9ecb3",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/onboarding-form-normal.png",
            "7e2191d05f5330289e7e134fc17a7c9e1970427c",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/private-workspace-expired-session.png",
            "b5a0a03a1d72bcbabfdc8d2e81c4adbdcac78f9a",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/private-workspace-failure.png",
            "e070200697be71ca302cd37841b3cc58d6c8c082",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/private-workspace-loading.png",
            "fedaff7547cee8b3550a7ca3efd7eccba2aed9db",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/recipe-comparison-intermediate-normal.png",
            "79ea4e9966f7f2f792876422b9fc9b9da6bba8fc",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/recipe-comparison-normal.png",
            "58cbe5dcac95a70ff8cae00f19b788f50286d432",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/recipe-detail-error.png",
            "63b20f2280db505395285faf53914e00c0469a88",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/recipe-detail-history.png",
            "d18164895dfcdb748827558551802d479f35f5b3",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/recipe-detail-intermediate-normal.png",
            "60934ecb909def77d79a2e0de72f6d16fc48fb82",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/recipe-detail-normal.png",
            "e684823242f40956c95d4fa87e94e128372d2509",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/recipe-detail-unavailable.png",
            "d42c81a5657dfb4f503b39a9b2442df238a8a1f6",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/recipe-instructions-normal.png",
            "debef8ede82acb1b2ff717a436a10bf2f989b83f",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/recipe-moderation-staff-review-intermediate.png",
            "c4728b3e23871ed8b176ccf7c4f92ddfe63fc5bc",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/recipe-moderation-staff-review.png",
            "c982fac45487f76e727cd84a2952ab78486f70d1",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/staff-tools-moderator-selected-intermediate.png",
            "cca642dd9bf6360f78ef1f30e0638ccc7aa8461f",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/staff-tools-moderator-selected.png",
            "6e009f3bc64f6785bfa5a0a8c308c9c9e982213b",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/staff-tools-normal-intermediate.png",
            "57d46f0c8ff843171e1e73aaddec6876dfe8dc20",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/staff-tools-normal.png",
            "88a83e86c893894e5bbc055c6a20300f5ca01d56",
        ),
        (
            "frontend/baselines/baseline-desktop-chromium/stale-curation-decision.png",
            "a67f276b34f95952dad83defbf107a634eb25528",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/account-activity-normal.png",
            "03efd6a5c71146ae3f7a4e169e33ce3fa9fbc003",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/account-activity-requests-filtered.png",
            "0c8a8ca278830a3ce2e52052c5eddf7afc858e32",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/account-settings-danger-normal.png",
            "e6a4e9f45ca0f9d9e05a06d75b98192120918772",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/account-settings-profile-normal.png",
            "41c96b76b2c3c6dabd207d2c510cd5cbafe9369c",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/catalog-normal.png",
            "48966c5d24d065445a18e341e1149876d519bfd3",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/community-rules-normal.png",
            "b8b9e600f9585960a3e9a5b651d3f40a9330f97a",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/cook-profile-normal.png",
            "76ccf9f5cf2c371b1d7f6287abd7a9272b8ef485",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/cook-profile-sparse-owner.png",
            "d7bcf223f9fbe78b0ba0abcea56e261aff666f5b",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/draft-editor-validation.png",
            "397590b85f63dd3cf4e0891b9e384586b0ff667b",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/draft-fork-header-normal.png",
            "c3483e8b6d26f5ac582de8bcd583f9cf0b3e90b5",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/draft-ingredient-editor-normal.png",
            "b2febf42305aeba4c712eb50d022fa8be6237a21",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/draft-instruction-editor-expanded.png",
            "04ee40f260bc6b2225ad7f12d782ad7952ed705b",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/draft-instruction-editor-normal.png",
            "fb020bfac79d46c34b93468fdf86ee21b1ea6502",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/draft-similarity-publication-review.png",
            "83a813425be7662682fb130d7594297ce8158f93",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/draft-unresolved-ingredient-validation.png",
            "8a435b78407f677622b750cc07a7a57b91fc5d61",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/global-not-found.png",
            "619208dabfdfef86161cd5227ad9468fc2641240",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/home-account-navigation.png",
            "f91db2e4986a3d6d8e9adffa2d0609734490985a",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/home-normal.png",
            "051768839f71b928c1d7164254e58537ca1370d5",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/ingredient-request-staff-review.png",
            "4353def006134547b83c9e981b63bfd7750d6e4f",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/my-ingredient-requests.png",
            "28ebc715dfeb3cde1e04bfa1955e200eb232740a",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/my-recipes-normal.png",
            "b276779cbf356bcf2a1231759eebed56660a23d0",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/recipe-comparison-normal.png",
            "c3af05796ae41ae04a2ad2afbf5bbcfe83113d63",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/recipe-detail-history.png",
            "3eae3763ead39fbf5986df0e3eadc71e3c3a5f92",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/recipe-detail-normal.png",
            "c55ba519162cc02cee8edaf34e69d3d29c80a492",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/recipe-instructions-normal.png",
            "e1575f20c67ad3a9b995b30e1b47ffa36812dab7",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/recipe-moderation-staff-review.png",
            "8982e5b3f18a85e47d11d65f500e208a47166855",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/staff-tools-moderator-selected.png",
            "8c6de385e0dacbef2941d4fd4afe8b6a4a358a29",
        ),
        (
            "frontend/baselines/baseline-phone-chromium/staff-tools-normal.png",
            "7c8c365fe39345e03e464ffccadf4044e074c85f",
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
        re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----"),
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
CREDENTIAL_URI_COMPONENT = rb"(?:\$\{[A-Za-z_][A-Za-z0-9_]*(?::-[^{}\s/@]*)?\}|[^\s/:@]+)"
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
        capture_output=True,
    )
    if result.returncode != 0:
        raise PackagingError("Git could not resolve or read the requested revision.")
    return result.stdout


def _repository_root(repository: Path) -> Path:
    raw_root = _run_git(repository, "rev-parse", "--show-toplevel")
    try:
        return Path(os.fsdecode(raw_root.rstrip(b"\r\n"))).resolve(strict=True)
    except (OSError, UnicodeError) as error:
        raise PackagingError("The Git repository root is not a safe local path.") from error


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
        raise PackagingError("The archive and manifest must be written outside the repository.")
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
        raise PackagingError(f"Top-level path is not in the export allowlist: {path!r}.")

    basename = pure_path.name
    folded_basename = basename.casefold()
    suffix = pure_path.suffix.casefold()
    if basename.startswith(".env") and path != ".env.example":
        raise PackagingError(f"Environment file is not exportable: {path!r}.")
    if folded_basename in DENIED_FILENAMES or suffix in DENIED_SUFFIXES:
        raise PackagingError(f"Sensitive or generated file is not exportable: {path!r}.")
    if (
        not reviewed_root_file
        and basename not in policy.allowed_special_basenames
        and suffix not in policy.allowed_extensions
    ):
        raise PackagingError(f"File type is not in the export allowlist: {path!r}.")
    return path


def _list_tree(repository: Path, commit_sha: str, policy: PackagingPolicy) -> list[TreeEntry]:
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
        raise PackagingError("The selected revision exceeds the configured entry-count limit.")

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
            raise PackagingError("Git returned an unsafe or malformed tree entry.") from error

        _validate_source_path(path, policy)
        if len(_archive_member_path(commit_sha, path).encode("utf-8")) > policy.max_path_bytes:
            raise PackagingError(f"Archive path exceeds the configured limit: {path!r}.")
        if mode_text not in {"100644", "100755"} or object_type != "blob":
            raise PackagingError(f"Only regular tracked files may be exported: {path!r}.")
        if re.fullmatch(r"[0-9a-f]{40,64}", object_id) is None or not size_text.isdecimal():
            raise PackagingError(f"Git returned invalid metadata for: {path!r}.")
        size = int(size_text)
        if size > policy.max_file_bytes:
            raise PackagingError(f"Source file exceeds the configured size limit: {path!r}.")
        total_size += size
        if total_size > policy.max_uncompressed_bytes:
            raise PackagingError("The selected revision exceeds the uncompressed-size limit.")

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


def audit_opaque_policy(
    repository: Path,
    revision: str,
    *,
    policy: PackagingPolicy = EXPORT_POLICY,
) -> dict[str, object]:
    """Compare tracked PNG objects at one commit with the reviewed policy."""

    root = _repository_root(repository.resolve(strict=True))
    commit_sha = _resolve_commit(root, revision)
    tree_entries = _list_tree(root, commit_sha, policy)
    tracked_objects = {
        entry.path: entry.object_id for entry in tree_entries if entry.path.endswith(".png")
    }
    reviewed_objects = _reviewed_opaque_objects(policy)

    missing = [
        {"path": path, "actual_object_id": tracked_objects[path]}
        for path in sorted(tracked_objects.keys() - reviewed_objects.keys())
    ]
    mismatched = [
        {
            "path": path,
            "reviewed_object_id": reviewed_objects[path],
            "actual_object_id": tracked_objects[path],
        }
        for path in sorted(tracked_objects.keys() & reviewed_objects.keys())
        if tracked_objects[path] != reviewed_objects[path]
    ]
    stale = [
        {"path": path, "reviewed_object_id": reviewed_objects[path]}
        for path in sorted(reviewed_objects.keys() - tracked_objects.keys())
    ]
    in_sync = not missing and not mismatched and not stale

    return {
        "commit_sha": commit_sha,
        "counts": {
            "tracked_pngs": len(tracked_objects),
            "reviewed_entries": len(reviewed_objects),
            "missing": len(missing),
            "mismatched": len(mismatched),
            "stale": len(stale),
        },
        "mismatched": mismatched,
        "missing": missing,
        "policy_version": POLICY_VERSION,
        "result": "passed" if in_sync else "drift",
        "stale": stale,
    }


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
    return -sum((count / length) * math.log2(count / length) for count in counts.values())


def _looks_like_placeholder(value: bytes) -> bool:
    folded = value.lower()
    if folded in REVIEWED_PLACEHOLDER_VALUES:
        return True
    if any(pattern.fullmatch(value) for pattern in PLACEHOLDER_REFERENCE_PATTERNS):
        return True
    if len(set(value)) < GENERIC_MIN_UNIQUE_BYTES or _shannon_entropy(value) < GENERIC_MIN_ENTROPY:
        return True
    if HEX_CREDENTIAL.fullmatch(value):
        return False
    has_lower = any(97 <= byte <= 122 for byte in value)
    has_upper = any(65 <= byte <= 90 for byte in value)
    has_digit = any(48 <= byte <= 57 for byte in value)
    has_symbol = any(
        not (48 <= byte <= 57 or 65 <= byte <= 90 or 97 <= byte <= 122) for byte in value
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
    return sum((has_lower, has_upper, has_digit, has_symbol)) < GENERIC_MIN_CHARACTER_CLASSES


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
                        and PurePosixPath(entry.path).suffix in TYPE_ANNOTATION_EXTENSIONS
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
        raise PackagingError(f"The {phase} secret scan could not be completed.") from error
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
        _archive_member_path(commit_sha, entry.path): entry for entry in expected_entries
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
            if len(members) != len(expected_entries) or len(members) > policy.max_entries:
                raise PackagingError("The completed archive has an unexpected entry count.")
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
                    raise PackagingError("The completed archive contains a duplicate path.")
                portable_key = unicodedata.normalize("NFC", member.filename).casefold()
                if portable_key in seen_portable:
                    raise PackagingError("The completed archive contains a path collision.")
                seen.add(member.filename)
                seen_portable.add(portable_key)

                expected = expected_by_member.get(member.filename)
                if expected is None:
                    raise PackagingError("The completed archive contains an unexpected path.")
                if len(member.filename.encode("utf-8")) > policy.max_path_bytes:
                    raise PackagingError("The completed archive contains an overlong path.")
                member_mode = (member.external_attr >> 16) & 0xFFFF
                if not stat.S_ISREG(member_mode) or member_mode & 0o777 not in {
                    0o644,
                    0o755,
                }:
                    raise PackagingError("The completed archive contains a non-regular entry.")
                if member.file_size != expected.size or member.file_size > policy.max_file_bytes:
                    raise PackagingError("The completed archive contains an invalid file size.")
                total_size += member.file_size
                if total_size > policy.max_uncompressed_bytes:
                    raise PackagingError(
                        "The completed archive exceeds the uncompressed-size limit."
                    )
                data = archive.read(member)
                if hashlib.sha256(data).hexdigest() != expected.sha256:
                    raise PackagingError("The completed archive failed its content hash check.")
                verified.append(replace(expected, data=data, compressed_size=member.compress_size))
            if set(expected_by_member) != seen:
                raise PackagingError("The completed archive is missing an expected path.")
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
        json.dumps(policy_fingerprint_input, separators=(",", ":"), sort_keys=True).encode("utf-8")
    ).hexdigest()
    scanner_fingerprint_input = {
        "credential_key_pairs": [
            sorted(part.decode("ascii") for part in pair) for pair in CREDENTIAL_KEY_PAIRS
        ],
        "credential_key_tokens": sorted(token.decode("ascii") for token in CREDENTIAL_KEY_TOKENS),
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
                "pattern": GENERIC_UNQUOTED_CREDENTIAL_ASSIGNMENT.pattern.decode("ascii"),
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
        json.dumps(scanner_fingerprint_input, separators=(",", ":"), sort_keys=True).encode("utf-8")
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
        verified_sources = _verify_completed_archive(temporary_archive, commit_sha, sources, policy)
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
            raise PackagingError("The verified outputs could not be published safely.") from error
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
        type=Path,
        help=(
            "New .zip path outside the repository; required for packaging and "
            "not accepted for an opaque-policy audit."
        ),
    )
    parser.add_argument(
        "--audit-opaque-policy",
        action="store_true",
        help=(
            "Read the selected commit and report missing, mismatched, and stale "
            "reviewed PNG entries without changing the policy."
        ),
    )
    return parser


def main(arguments: list[str] | None = None) -> int:
    parser = _parser()
    options = parser.parse_args(arguments)
    if options.audit_opaque_policy and options.output is not None:
        parser.error("--output cannot be used with --audit-opaque-policy")
    if not options.audit_opaque_policy and options.output is None:
        parser.error("--output is required unless --audit-opaque-policy is used")
    operation = "Opaque policy audit" if options.audit_opaque_policy else "Safe source export"
    try:
        if options.audit_opaque_policy:
            report = audit_opaque_policy(Path.cwd(), options.revision)
        else:
            report = package_source(Path.cwd(), options.revision, options.output)
    except PackagingError as error:
        print(f"{operation} failed: {error}", file=sys.stderr)
        return 1
    except Exception:
        print(
            f"{operation} failed because an internal check could not be completed.",
            file=sys.stderr,
        )
        return 1
    print(json.dumps(report, indent=2, sort_keys=True))
    if options.audit_opaque_policy and report["result"] != "passed":
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
