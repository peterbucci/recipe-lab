#!/usr/bin/env python3
"""Build and verify Recipe Lab production images without publishing them."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypedDict
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

TOOL_NAME = "recipe-lab-production-image-verifier"
TOOL_VERSION = "1.1.0"
REPORT_SCHEMA_VERSION = 1
PRODUCTION_TARGET = "production"
BACKEND_CONTAINER_PORT = 8000
FRONTEND_CONTAINER_PORT = 3000
DATABASE_CONTAINER_PORT = 5432
DATABASE_IMAGE = (
    "postgres:17.11-alpine@sha256:7456ef82e5f5bc43d997f4781bbd7c0d6389bff397564649a356e206ba473aee"
)
DATABASE_NAME = "recipe_lab_image_check"
DATABASE_USER = "recipe_lab_image_check"
DATABASE_PASSWORD = "recipe-lab-image-check-database-password"
HEALTH_TIMEOUT_SECONDS = 60.0
DATABASE_OPERATION_TIMEOUT_SECONDS = 5
ENDPOINT_TIMEOUT_SECONDS = 15.0
LOCAL_IMAGE_TAG = re.compile(r"[A-Za-z0-9][A-Za-z0-9._/:@-]*\Z")
IMMUTABLE_IMAGE_ID = re.compile(r"sha256:[0-9a-f]{64}\Z")
FORBIDDEN_IMAGE_ENVIRONMENT_KEYS = frozenset(
    {
        "ABUSE_RATE_LIMIT_SECRET",
        "DATABASE_URL",
        "INTERNAL_NETWORK_SIGNAL_SECRET",
        "OIDC_CLIENT_SECRET",
        "POSTGRES_PASSWORD",
    }
)

BACKEND_CONTENT_CHECK = r"""
from importlib.util import find_spec
from pathlib import Path
from shutil import which

root = Path("/app")
forbidden = (
    root / ".env",
    root / ".mypy_cache",
    root / ".pytest_cache",
    root / ".ruff_cache",
    root / "app" / "testing",
    root / "build",
    root / "htmlcov",
    root / "tests",
)
if any(path.exists() for path in forbidden):
    raise SystemExit("The backend runtime contains excluded development material.")
if root.is_dir() and any(
    path.name == ".env" or path.name.startswith(".env.") for path in root.iterdir()
):
    raise SystemExit("The backend runtime contains an environment file.")
if find_spec("app.testing") is not None:
    raise SystemExit("The backend runtime contains the acceptance/testing package.")
if any(
    find_spec(package) is not None
    for package in ("ensurepip", "mypy", "pip", "pytest", "ruff", "setuptools", "wheel")
):
    raise SystemExit("The backend runtime contains a development-only Python package.")
if which("uv") is not None:
    raise SystemExit("The backend runtime contains the dependency resolver.")
""".strip()

FRONTEND_CONTENT_CHECK = r"""
import { existsSync, readdirSync } from "node:fs";
import { delimiter, join } from "node:path";

const root = "/app";
const forbidden = [
  `${root}/.next/cache`,
  `${root}/coverage`,
  `${root}/e2e`,
  `${root}/playwright-report`,
  `${root}/test-results`,
  `${root}/node_modules/@playwright`,
  `${root}/node_modules/playwright`,
  `${root}/node_modules/playwright-core`,
  `${root}/node_modules/eslint`,
  `${root}/node_modules/typescript`,
  `${root}/node_modules/vitest`,
  "/opt/yarn-v1.22.22",
];
if (forbidden.some((path) => existsSync(path))) {
  throw new Error("The frontend runtime contains excluded development material.");
}
if (
  existsSync(root) &&
  readdirSync(root).some((name) => name === ".env" || name.startsWith(".env."))
) {
  throw new Error("The frontend runtime contains an environment file.");
}
const pathDirectories = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
if (
  ["npm", "npx", "yarn", "yarnpkg"].some((name) =>
    pathDirectories.some((directory) => existsSync(join(directory, name))),
  )
) {
  throw new Error("The frontend runtime contains a package-manager binary.");
}
""".strip()


class VerificationError(RuntimeError):
    """A privacy-safe production-image verification failure."""


class ImageIdentity(TypedDict):
    id: str


class ProductionImageReport(TypedDict):
    images: dict[str, ImageIdentity]
    schema_version: int
    status: str
    tool: dict[str, str]


@dataclass(frozen=True)
class CommandResult:
    arguments: tuple[str, ...]
    returncode: int
    stdout: str
    stderr: str


class DockerClient:
    """Small Docker CLI adapter whose text output is safe to unit test."""

    def run(self, arguments: Sequence[str], *, check: bool = True) -> CommandResult:
        command = ("docker", *arguments)
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        result = CommandResult(
            arguments=command,
            returncode=completed.returncode,
            stdout=completed.stdout,
            stderr=completed.stderr,
        )
        if check and completed.returncode != 0:
            raise VerificationError("A Docker verification command failed.")
        return result


def _validate_image_tag(image: str) -> str:
    if not LOCAL_IMAGE_TAG.fullmatch(image) or image.startswith("-"):
        raise VerificationError("A valid local Docker image tag is required.")
    return image


def _resolve_context(repository: Path, context: Path) -> Path:
    resolved_repository = repository.resolve(strict=True)
    candidate = context if context.is_absolute() else resolved_repository / context
    resolved_context = candidate.resolve(strict=True)
    if not resolved_context.is_dir():
        raise VerificationError("A Docker build context is not a directory.")
    try:
        resolved_context.relative_to(resolved_repository)
    except ValueError as error:
        raise VerificationError("Docker build contexts must stay inside the repository.") from error
    return resolved_context


def _resolve_dockerfile(repository: Path, context: Path, dockerfile: Path) -> Path:
    resolved_repository = repository.resolve(strict=True)
    candidate = dockerfile if dockerfile.is_absolute() else resolved_repository / dockerfile
    resolved_dockerfile = candidate.resolve(strict=True)
    if not resolved_dockerfile.is_file():
        raise VerificationError("A Dockerfile path is not a file.")
    try:
        resolved_dockerfile.relative_to(context)
    except ValueError as error:
        raise VerificationError("A Dockerfile must stay inside its build context.") from error
    return resolved_dockerfile


def build_image(client: DockerClient, image: str, context: Path, dockerfile: Path) -> None:
    client.run(
        (
            "build",
            "--no-cache",
            "--pull",
            "--target",
            PRODUCTION_TARGET,
            "--file",
            str(dockerfile),
            "--tag",
            image,
            str(context),
        )
    )


def _image_configuration(client: DockerClient, image: str) -> dict[str, Any]:
    result = client.run(("image", "inspect", image))
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise VerificationError("Docker returned unreadable image metadata.") from error
    if not isinstance(payload, list) or len(payload) != 1 or not isinstance(payload[0], dict):
        raise VerificationError("Docker returned an unexpected image metadata shape.")
    config = payload[0].get("Config")
    if not isinstance(config, dict):
        raise VerificationError("The image is missing runtime configuration metadata.")
    return config


def resolve_immutable_image_id(client: DockerClient, image: str) -> str:
    """Resolve one local tag to Docker's content-addressed image identifier."""

    result = client.run(("image", "inspect", "--format", "{{.Id}}", image))
    image_id = result.stdout.strip()
    if IMMUTABLE_IMAGE_ID.fullmatch(image_id) is None:
        raise VerificationError("Docker returned an invalid immutable image identifier.")
    return image_id


def _production_image_report(
    *, backend_image_id: str, frontend_image_id: str
) -> ProductionImageReport:
    for image_id in (backend_image_id, frontend_image_id):
        if IMMUTABLE_IMAGE_ID.fullmatch(image_id) is None:
            raise VerificationError("An invalid immutable image identifier was reported.")
    return {
        "images": {
            "backend": {"id": backend_image_id},
            "frontend": {"id": frontend_image_id},
        },
        "schema_version": REPORT_SCHEMA_VERSION,
        "status": "passed",
        "tool": {"name": TOOL_NAME, "version": TOOL_VERSION},
    }


def write_production_image_report(path: Path, report: ProductionImageReport) -> None:
    """Publish a canonical report atomically without replacing an existing file."""

    destination = path.resolve()
    try:
        parent = destination.parent.resolve(strict=True)
    except OSError as error:
        raise VerificationError("The image report directory could not be resolved.") from error
    if not parent.is_dir():
        raise VerificationError("The image report directory is not a directory.")
    if destination.exists():
        raise VerificationError("The image report already exists; refusing to overwrite it.")

    temporary: Path | None = None
    published = False
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            prefix=f".{destination.name}.",
            suffix=".tmp",
            dir=parent,
            delete=False,
        ) as handle:
            temporary = Path(handle.name)
            os.chmod(temporary, 0o600)
            handle.write(json.dumps(report, sort_keys=True, separators=(",", ":")))
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary, destination)
        except FileExistsError as error:
            raise VerificationError(
                "The image report appeared during publication; refusing to overwrite it."
            ) from error
        published = True
    except VerificationError:
        raise
    except OSError as error:
        raise VerificationError("The image report could not be published.") from error
    finally:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError as error:
                if published:
                    try:
                        destination.unlink(missing_ok=True)
                    except OSError:
                        pass
                raise VerificationError(
                    "The temporary image report could not be removed."
                ) from error


def verify_image_metadata(
    client: DockerClient,
    image: str,
    *,
    required_command: tuple[str, ...] | None = None,
) -> None:
    config = _image_configuration(client, image)
    user = config.get("User")
    if not isinstance(user, str) or not user.strip() or user.strip().casefold() in {"0", "root"}:
        raise VerificationError("Production images must run as a non-root user.")

    healthcheck = config.get("Healthcheck")
    test = healthcheck.get("Test") if isinstance(healthcheck, dict) else None
    if not isinstance(test, list) or len(test) < 2:
        raise VerificationError("Production images must declare a Docker health check.")

    command_parts = [config.get("Entrypoint"), config.get("Cmd")]
    runtime_command = tuple(
        str(value)
        for part in command_parts
        for value in (part if isinstance(part, list) else [part])
        if value is not None
    )
    command = " ".join(runtime_command).casefold()
    if (
        "--reload" in command
        or re.search(r"(?:^|\s)(?:run\s+)?dev(?:\s|$)", command)
        or re.search(r"(?:^|\s)--dev(?:\s|$)", command)
    ):
        raise VerificationError("Production images must not run a development server.")
    if required_command is not None and runtime_command != required_command:
        raise VerificationError("The production image must use its approved server launcher.")

    environment = config.get("Env")
    if not isinstance(environment, list):
        raise VerificationError("The image is missing environment metadata.")
    configured_keys = {
        entry.partition("=")[0] for entry in environment if isinstance(entry, str) and "=" in entry
    }
    if configured_keys & FORBIDDEN_IMAGE_ENVIRONMENT_KEYS:
        raise VerificationError("A runtime secret or credential was baked into image metadata.")


def verify_runtime_contents(client: DockerClient, backend_image: str, frontend_image: str) -> None:
    client.run(
        (
            "run",
            "--rm",
            "--entrypoint",
            "python",
            backend_image,
            "-c",
            BACKEND_CONTENT_CHECK,
        )
    )
    client.run(
        (
            "run",
            "--rm",
            "--entrypoint",
            "node",
            frontend_image,
            "--input-type=module",
            "-e",
            FRONTEND_CONTENT_CHECK,
        )
    )


def _redaction_canary(label: str) -> str:
    return f"rcp33d-{label}-private-value"


def _require_redacted_failure(result: CommandResult, canary: str, service: str) -> None:
    if result.returncode == 0:
        raise VerificationError(f"The {service} accepted invalid production configuration.")
    if canary in result.stdout or canary in result.stderr:
        raise VerificationError(f"The {service} exposed a production configuration value.")


def verify_invalid_configuration_is_redacted(
    client: DockerClient,
    backend_image: str,
    frontend_image: str,
) -> None:
    backend_canary = _redaction_canary("backend")
    backend_result = client.run(
        (
            "run",
            "--rm",
            "-e",
            "APP_ENVIRONMENT=production",
            "-e",
            f"ABUSE_RATE_LIMIT_SECRET={backend_canary}",
            "-e",
            "INTERNAL_NETWORK_SIGNAL_SECRET=valid-internal-network-value-for-image-check",
            backend_image,
        ),
        check=False,
    )
    _require_redacted_failure(backend_result, backend_canary, "backend image")

    frontend_canary = _redaction_canary("frontend")
    frontend_result = client.run(
        (
            "run",
            "--rm",
            "-e",
            f"INTERNAL_NETWORK_SIGNAL_SECRET={frontend_canary}",
            "-e",
            "RECIPE_API_URL=http://backend.invalid:8000",
            frontend_image,
        ),
        check=False,
    )
    _require_redacted_failure(frontend_result, frontend_canary, "frontend image")


def _container_state(client: DockerClient, container: str) -> tuple[bool, str | None]:
    result = client.run(("inspect", container))
    try:
        payload = json.loads(result.stdout)
        state = payload[0]["State"]
        health = state.get("Health")
    except (IndexError, KeyError, TypeError, json.JSONDecodeError) as error:
        raise VerificationError("Docker returned unreadable container state.") from error
    if not isinstance(state, dict):
        raise VerificationError("Docker returned unreadable container state.")
    status = health.get("Status") if isinstance(health, dict) else None
    return bool(state.get("Running")), status if isinstance(status, str) else None


def _wait_for_container_health(client: DockerClient, container: str) -> None:
    deadline = time.monotonic() + HEALTH_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        running, health = _container_state(client, container)
        if not running:
            raise VerificationError("A production container stopped before becoming healthy.")
        if health == "healthy":
            return
        if health == "unhealthy":
            raise VerificationError("A production container reported an unhealthy state.")
        time.sleep(1)
    raise VerificationError("A production container did not become healthy in time.")


def _published_port(client: DockerClient, container: str, container_port: int) -> int:
    result = client.run(("port", container, f"{container_port}/tcp"))
    candidates = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    for candidate in candidates:
        _, separator, raw_port = candidate.rpartition(":")
        if separator and raw_port.isdigit():
            port = int(raw_port)
            if 1 <= port <= 65535:
                return port
    raise VerificationError("Docker did not publish the expected health-check port.")


def _read_endpoint(port: int, path: str, *, accept: str) -> tuple[int, dict[str, str], bytes]:
    request = Request(f"http://127.0.0.1:{port}{path}", headers={"Accept": accept})
    try:
        with urlopen(request, timeout=ENDPOINT_TIMEOUT_SECONDS) as response:
            status = response.status
            headers = {name.casefold(): value for name, value in response.headers.items()}
            body = response.read(16 * 1024)
    except HTTPError as error:
        status = error.code
        headers = {name.casefold(): value for name, value in error.headers.items()}
        body = error.read(16 * 1024)
    except (OSError, URLError) as error:
        raise VerificationError("A production service endpoint could not be reached.") from error
    return status, headers, body


def _read_health(port: int, path: str, *, accept: str) -> tuple[int, dict[str, str], bytes]:
    status, headers, body = _read_endpoint(port, path, accept=accept)
    if status != 200:
        raise VerificationError("A production health endpoint returned a non-success status.")
    return status, headers, body


def _assert_backend_health(body: bytes, service: str) -> None:
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as error:
        raise VerificationError("The backend health endpoint returned unreadable JSON.") from error
    if payload != {"service": service, "status": "ok"}:
        raise VerificationError("The backend health endpoint returned an unexpected payload.")


def _assert_backend_readiness(status: int, body: bytes, service: str) -> None:
    if status != 200:
        raise VerificationError(
            "The backend readiness endpoint reported an unavailable dependency."
        )
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as error:
        raise VerificationError(
            "The backend readiness endpoint returned unreadable JSON."
        ) from error
    if payload != {"service": service, "status": "ready"}:
        raise VerificationError("The backend readiness endpoint returned an unexpected payload.")


def _assert_backend_dependency_failure(
    status: int,
    body: bytes,
    correlation_id: str,
) -> None:
    if status != 503:
        raise VerificationError(
            "The backend readiness endpoint did not fail closed when its database stopped."
        )
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as error:
        raise VerificationError(
            "The unavailable readiness response returned unreadable JSON."
        ) from error
    if payload != {
        "error": {
            "code": "dependency_unavailable",
            "correlation_id": correlation_id,
            "issues": [],
            "message": "A required service dependency is temporarily unavailable.",
        }
    }:
        raise VerificationError("The unavailable readiness response exposed an unexpected payload.")


def _assert_correlation_id(
    headers: dict[str, str],
    *,
    seen: set[str] | None = None,
) -> str:
    value = headers.get("x-correlation-id")
    if value is None:
        raise VerificationError("A backend response omitted its correlation ID.")
    try:
        correlation_id = uuid.UUID(value)
    except ValueError as error:
        raise VerificationError("A backend response returned an invalid correlation ID.") from error
    if correlation_id.version != 4 or str(correlation_id) != value:
        raise VerificationError("A backend response returned an invalid correlation ID.")
    if seen is not None:
        if value in seen:
            raise VerificationError("A backend response reused a correlation ID.")
        seen.add(value)
    return value


def _assert_frontend_health(headers: dict[str, str], body: bytes) -> None:
    if body != b"ok\n":
        raise VerificationError("The frontend health endpoint returned an unexpected payload.")
    if headers.get("cache-control") != "no-store":
        raise VerificationError("The frontend health endpoint must disable caching.")
    if headers.get("content-type", "").casefold() != "text/plain; charset=utf-8":
        raise VerificationError("The frontend health endpoint returned an unexpected media type.")


def verify_startup_and_health(
    client: DockerClient,
    backend_image: str,
    frontend_image: str,
    database_image: str = DATABASE_IMAGE,
) -> None:
    suffix = uuid.uuid4().hex
    network = f"recipe-lab-image-check-{suffix}"
    database = f"recipe-lab-database-check-{suffix}"
    backend = f"recipe-lab-backend-check-{suffix}"
    frontend = f"recipe-lab-frontend-check-{suffix}"
    internal_value = "production-internal-network-image-check-value"
    abuse_value = "production-abuse-rate-limit-image-check-value"
    database_url = (
        f"postgresql+psycopg://{DATABASE_USER}:{DATABASE_PASSWORD}"
        f"@{database}:{DATABASE_CONTAINER_PORT}/{DATABASE_NAME}"
    )
    seen_correlation_ids: set[str] = set()

    client.run(("network", "create", network))
    try:
        client.run(
            (
                "run",
                "--detach",
                "--name",
                database,
                "--network",
                network,
                "--health-cmd",
                f"pg_isready --username {DATABASE_USER} --dbname {DATABASE_NAME}",
                "--health-interval",
                "1s",
                "--health-timeout",
                "3s",
                "--health-retries",
                "30",
                "-e",
                f"POSTGRES_DB={DATABASE_NAME}",
                "-e",
                f"POSTGRES_USER={DATABASE_USER}",
                "-e",
                f"POSTGRES_PASSWORD={DATABASE_PASSWORD}",
                database_image,
            )
        )
        _wait_for_container_health(client, database)
        client.run(
            (
                "run",
                "--rm",
                "--network",
                network,
                "-e",
                "APP_ENVIRONMENT=production",
                "-e",
                f"DATABASE_OPERATION_TIMEOUT_SECONDS={DATABASE_OPERATION_TIMEOUT_SECONDS}",
                "-e",
                f"ABUSE_RATE_LIMIT_SECRET={abuse_value}",
                "-e",
                f"INTERNAL_NETWORK_SIGNAL_SECRET={internal_value}",
                "-e",
                f"DATABASE_URL={database_url}",
                "--entrypoint",
                "python",
                backend_image,
                "-m",
                "alembic",
                "upgrade",
                "head",
            )
        )
        client.run(
            (
                "run",
                "--detach",
                "--name",
                backend,
                "--network",
                network,
                "--publish",
                f"127.0.0.1::{BACKEND_CONTAINER_PORT}",
                "-e",
                "APP_ENVIRONMENT=production",
                "-e",
                f"DATABASE_OPERATION_TIMEOUT_SECONDS={DATABASE_OPERATION_TIMEOUT_SECONDS}",
                "-e",
                f"ABUSE_RATE_LIMIT_SECRET={abuse_value}",
                "-e",
                f"INTERNAL_NETWORK_SIGNAL_SECRET={internal_value}",
                "-e",
                f"DATABASE_URL={database_url}",
                "-e",
                "CORS_ORIGINS=http://127.0.0.1:3000",
                "-e",
                "AUTH_ALLOWED_ORIGINS=http://127.0.0.1:3000",
                backend_image,
            )
        )
        _wait_for_container_health(client, backend)
        backend_port = _published_port(client, backend, BACKEND_CONTAINER_PORT)
        _, backend_headers, backend_body = _read_health(
            backend_port,
            "/api/health",
            accept="application/json",
        )
        _assert_backend_health(backend_body, "recipe-lab-api")
        _assert_correlation_id(backend_headers, seen=seen_correlation_ids)
        readiness_status, readiness_headers, readiness_body = _read_endpoint(
            backend_port,
            "/api/readiness",
            accept="application/json",
        )
        _assert_backend_readiness(readiness_status, readiness_body, "recipe-lab-api")
        _assert_correlation_id(readiness_headers, seen=seen_correlation_ids)

        client.run(
            (
                "run",
                "--detach",
                "--name",
                frontend,
                "--network",
                network,
                "--publish",
                f"127.0.0.1::{FRONTEND_CONTAINER_PORT}",
                "-e",
                f"INTERNAL_NETWORK_SIGNAL_SECRET={internal_value}",
                "-e",
                f"RECIPE_API_URL=http://{backend}:{BACKEND_CONTAINER_PORT}",
                frontend_image,
            )
        )
        _wait_for_container_health(client, frontend)
        frontend_port = _published_port(client, frontend, FRONTEND_CONTAINER_PORT)
        _, frontend_headers, frontend_body = _read_health(
            frontend_port,
            "/healthz",
            accept="text/plain",
        )
        _assert_frontend_health(frontend_headers, frontend_body)

        client.run(("stop", "--time", "0", database))
        _, degraded_health_headers, degraded_health_body = _read_health(
            backend_port,
            "/api/health",
            accept="application/json",
        )
        _assert_backend_health(degraded_health_body, "recipe-lab-api")
        _assert_correlation_id(degraded_health_headers, seen=seen_correlation_ids)
        unavailable_status, unavailable_headers, unavailable_body = _read_endpoint(
            backend_port,
            "/api/readiness",
            accept="application/json",
        )
        unavailable_correlation_id = _assert_correlation_id(
            unavailable_headers,
            seen=seen_correlation_ids,
        )
        _assert_backend_dependency_failure(
            unavailable_status,
            unavailable_body,
            unavailable_correlation_id,
        )
    finally:
        client.run(("rm", "--force", frontend), check=False)
        client.run(("rm", "--force", backend), check=False)
        client.run(("rm", "--force", database), check=False)
        client.run(("network", "rm", network), check=False)


def verify_production_images(
    repository: Path,
    backend_image: str,
    frontend_image: str,
    backend_context: Path,
    frontend_context: Path,
    backend_dockerfile: Path,
    frontend_dockerfile: Path,
    *,
    build: bool,
    database_image: str = DATABASE_IMAGE,
    client: DockerClient | None = None,
) -> ProductionImageReport:
    docker = client or DockerClient()
    backend_tag = _validate_image_tag(backend_image)
    frontend_tag = _validate_image_tag(frontend_image)
    database_tag = _validate_image_tag(database_image)
    backend_build_context = _resolve_context(repository, backend_context)
    frontend_build_context = _resolve_context(repository, frontend_context)
    backend_build_file = _resolve_dockerfile(
        repository,
        backend_build_context,
        backend_dockerfile,
    )
    frontend_build_file = _resolve_dockerfile(
        repository,
        frontend_build_context,
        frontend_dockerfile,
    )

    if build:
        build_image(docker, backend_tag, backend_build_context, backend_build_file)
        build_image(docker, frontend_tag, frontend_build_context, frontend_build_file)
    backend_image_id = resolve_immutable_image_id(docker, backend_tag)
    frontend_image_id = resolve_immutable_image_id(docker, frontend_tag)
    verify_image_metadata(
        docker,
        backend_tag,
        required_command=("python", "-m", "app.production_server"),
    )
    verify_image_metadata(docker, frontend_tag)
    verify_runtime_contents(docker, backend_tag, frontend_tag)
    verify_invalid_configuration_is_redacted(docker, backend_tag, frontend_tag)
    verify_startup_and_health(docker, backend_tag, frontend_tag, database_tag)
    if resolve_immutable_image_id(docker, backend_tag) != backend_image_id:
        raise VerificationError("The backend image tag changed during verification.")
    if resolve_immutable_image_id(docker, frontend_tag) != frontend_image_id:
        raise VerificationError("The frontend image tag changed during verification.")
    return _production_image_report(
        backend_image_id=backend_image_id,
        frontend_image_id=frontend_image_id,
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build and verify local Recipe Lab production images without publishing them."
    )
    parser.add_argument("--backend-image", required=True, help="Local backend image tag.")
    parser.add_argument("--frontend-image", required=True, help="Local frontend image tag.")
    parser.add_argument(
        "--database-image",
        default=DATABASE_IMAGE,
        help="PostgreSQL image used only for the disposable readiness smoke test.",
    )
    parser.add_argument("--backend-context", type=Path, default=Path("."))
    parser.add_argument("--frontend-context", type=Path, default=Path("frontend"))
    parser.add_argument("--backend-dockerfile", type=Path, default=Path("backend/Dockerfile"))
    parser.add_argument("--frontend-dockerfile", type=Path, default=Path("frontend/Dockerfile"))
    parser.add_argument(
        "--skip-build",
        action="store_true",
        help="Verify existing local image tags without rebuilding them.",
    )
    parser.add_argument(
        "--report",
        type=Path,
        help=(
            "Optional new JSON path for the privacy-safe immutable image report. "
            "Existing files are never replaced."
        ),
    )
    parser.add_argument("--version", action="version", version=f"{TOOL_NAME} {TOOL_VERSION}")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    try:
        report = verify_production_images(
            Path.cwd(),
            arguments.backend_image,
            arguments.frontend_image,
            arguments.backend_context,
            arguments.frontend_context,
            arguments.backend_dockerfile,
            arguments.frontend_dockerfile,
            build=not arguments.skip_build,
            database_image=arguments.database_image,
        )
        if arguments.report is not None:
            write_production_image_report(arguments.report, report)
    except VerificationError as error:
        print(f"Production image verification failed: {error}", file=sys.stderr)
        return 1
    print("Production image verification passed; no image was pushed or uploaded.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
