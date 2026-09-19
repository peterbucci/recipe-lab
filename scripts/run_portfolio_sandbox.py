#!/usr/bin/env python3
"""Run and replace one disposable, bounded portfolio environment on Docker.

This local supervisor does not provision hosting, TLS, or a deployment scheduler.
Each database also terminates itself at its deadline if this process disappears.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import signal
import subprocess
import sys
import time
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse
from urllib.request import ProxyHandler, build_opener
from uuid import UUID, uuid4

from scripts.verify_production_images import DATABASE_IMAGE

LABEL = "org.recipe-lab.portfolio-generation"
IMAGE_ID = re.compile(r"sha256:[0-9a-f]{64}\Z")
CONTACT_EMAIL = re.compile(
    r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@"
    r"[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}\Z"
)
# PID 1 exits when PostgreSQL exits. --rm then destroys its tmpfs, including WAL.
# The deadline guard is inside the container, independent of the host supervisor.
DATABASE_DEADLINE_COMMAND = (
    "remaining=$((SANDBOX_EXPIRES_EPOCH - $(date +%s))); "
    '[ "$remaining" -gt 0 ] || exit 1; '
    "docker-entrypoint.sh postgres -c logging_collector=off -c log_statement=none "
    "-c log_min_duration_statement=-1 -c archive_mode=off -c max_wal_senders=0 & "
    "database_pid=$!; "
    '(sleep "$remaining"; kill -KILL "$database_pid" 2>/dev/null) & '
    'wait "$database_pid"'
)


class SandboxOperationError(RuntimeError):
    pass


def docker(arguments: Sequence[str], *, environment: dict[str, str] | None = None) -> str:
    result = subprocess.run(
        ["docker", *arguments],
        check=False,
        capture_output=True,
        text=True,
        env=None if environment is None else {**os.environ, **environment},
        timeout=180,
    )
    if result.returncode:
        raise SandboxOperationError("A sandbox container operation failed.")
    return result.stdout.strip()


@dataclass(frozen=True)
class Generation:
    identifier: UUID
    started_at: datetime
    expires_at: datetime

    @property
    def prefix(self) -> str:
        return f"recipe-lab-sandbox-{self.identifier.hex}"

    @property
    def database_name(self) -> str:
        return f"recipe_lab_sandbox_{self.identifier.hex}"


def _owned_container(name: str, generation: Generation) -> bool:
    # Exact-name listing tolerates resources already removed by their deadline.
    identifiers = docker(["container", "ls", "--all", "--quiet", "--filter", f"name=^/{name}$"])
    if not identifiers:
        return False
    metadata = json.loads(docker(["container", "inspect", name]))
    if (
        len(metadata) != 1
        or metadata[0]["Name"] != f"/{name}"
        or metadata[0]["Config"]["Labels"].get(LABEL) != str(generation.identifier)
    ):
        raise SandboxOperationError("Sandbox resource ownership could not be verified.")
    return True


def destroy_generation(generation: Generation) -> None:
    # Remove the listener first, then writers, then the complete memory database.
    for role in ("frontend", "backend", "initialize", "db"):
        name = f"{generation.prefix}-{role}"
        if _owned_container(name, generation):
            docker(["container", "rm", "--force", name])
    for name in (f"{generation.prefix}-ingress", generation.prefix):
        names = docker(["network", "ls", "--quiet", "--filter", f"name=^{name}$"])
        if names:
            metadata = json.loads(docker(["network", "inspect", name]))
            if (
                len(metadata) != 1
                or metadata[0]["Name"] != name
                or metadata[0]["Labels"].get(LABEL) != str(generation.identifier)
            ):
                raise SandboxOperationError("Sandbox network ownership could not be verified.")
            docker(["network", "rm", name])


def _container_arguments(generation: Generation, role: str) -> list[str]:
    return [
        "run",
        "--rm",
        "--name",
        f"{generation.prefix}-{role}",
        "--label",
        f"{LABEL}={generation.identifier}",
        "--network",
        generation.prefix,
        "--log-driver",
        "none",
        "--memory",
        "768m",
        "--memory-swap",
        "768m",
        "--cpus",
        "1",
        "--pids-limit",
        "256",
    ]


def _environment_arguments(environment: dict[str, str]) -> list[str]:
    return [value for name in environment for value in ("--env", name)]


def _verify_published_listener(port: int) -> None:
    # Check the actual reverse-proxy target without inherited HTTP proxy settings.
    opener = build_opener(ProxyHandler({}))
    try:
        for path in ("/healthz", "/recipes"):
            with opener.open(f"http://127.0.0.1:{port}{path}", timeout=3) as response:
                if response.status != 200:
                    raise SandboxOperationError("The sandbox listener is not ready.")
                if path == "/healthz" and response.read(32) != b"ok\n":
                    raise SandboxOperationError("The sandbox listener is not ready.")
    except (OSError, ValueError):
        raise SandboxOperationError("The sandbox listener is not ready.") from None


def start_generation(
    generation: Generation,
    *,
    backend_image: str,
    frontend_image: str,
    origin: str,
    contact_url: str,
    port: int,
) -> None:
    for image_id in (backend_image, frontend_image):
        if IMAGE_ID.fullmatch(image_id) is None:
            raise SandboxOperationError("Use exact verified local image IDs.")
        if docker(["image", "inspect", "--format", "{{.Id}}", image_id]) != image_id:
            raise SandboxOperationError("An image identity did not match.")
    remaining = int((generation.expires_at - datetime.now(UTC)).total_seconds())
    if remaining <= 0 or generation.expires_at - generation.started_at > timedelta(hours=24):
        raise SandboxOperationError("The generation lifetime is invalid.")

    password = secrets.token_urlsafe(32)
    signal_secret = secrets.token_urlsafe(48)
    database_environment = {
        "POSTGRES_USER": "recipe_lab_sandbox",
        "POSTGRES_PASSWORD": password,
        "POSTGRES_DB": generation.database_name,
        "PGDATA": "/var/lib/postgresql/data",
        "SANDBOX_EXPIRES_EPOCH": str(int(generation.expires_at.timestamp())),
    }
    backend_environment = {
        "APP_ENVIRONMENT": "production",
        "DATABASE_URL": (
            f"postgresql+psycopg://recipe_lab_sandbox:{password}@"
            f"{generation.prefix}-db:5432/{generation.database_name}"
        ),
        "AUTH_ALLOWED_ORIGINS": origin,
        "CORS_ORIGINS": origin,
        "ABUSE_RATE_LIMIT_SECRET": secrets.token_urlsafe(48),
        "INTERNAL_NETWORK_SIGNAL_SECRET": signal_secret,
        "SANDBOX_ENABLED": "true",
        "SANDBOX_GENERATION_ID": str(generation.identifier),
        "SANDBOX_STARTED_AT": generation.started_at.isoformat(),
        "SANDBOX_EXPIRES_AT": generation.expires_at.isoformat(),
        "SANDBOX_CONTACT_URL": contact_url,
    }
    docker(
        [
            "network",
            "create",
            "--internal",
            "--label",
            f"{LABEL}={generation.identifier}",
            generation.prefix,
        ]
    )
    docker(
        [
            *_container_arguments(generation, "db"),
            "--detach",
            "--tmpfs",
            "/var/lib/postgresql/data:rw,nosuid,noexec,size=512m",
            *_environment_arguments(database_environment),
            "--entrypoint",
            "/bin/sh",
            DATABASE_IMAGE,
            "-c",
            DATABASE_DEADLINE_COMMAND,
        ],
        environment=database_environment,
    )
    for attempt in range(60):
        try:
            docker(
                [
                    "exec",
                    f"{generation.prefix}-db",
                    "pg_isready",
                    "-U",
                    "recipe_lab_sandbox",
                    "-d",
                    generation.database_name,
                ]
            )
            break
        except SandboxOperationError:
            if attempt == 59:
                raise
            time.sleep(1)

    initialize = (
        "python -m alembic upgrade head && "
        f"python -m app.sandbox initialize --expected-database-name {generation.database_name} && "
        "python -m app.seeds load && "
        f"python -m app.sandbox verify --expected-database-name {generation.database_name}"
    )
    docker(
        [
            *_container_arguments(generation, "initialize"),
            *_environment_arguments(backend_environment),
            "--entrypoint",
            "/bin/sh",
            backend_image,
            "-c",
            initialize,
        ],
        environment=backend_environment,
    )
    docker(
        [
            *_container_arguments(generation, "backend"),
            "--detach",
            "--read-only",
            "--tmpfs",
            "/tmp:rw,nosuid,noexec,size=16m",
            *_environment_arguments(backend_environment),
            backend_image,
        ],
        environment=backend_environment,
    )
    # No public listener exists until migration, initialization, and backend readiness pass.
    for attempt in range(60):
        try:
            docker(
                [
                    "exec",
                    f"{generation.prefix}-backend",
                    "python",
                    "-c",
                    (
                        "import urllib.request; "
                        "urllib.request.urlopen('http://127.0.0.1:8000/api/readiness', timeout=3)"
                    ),
                ]
            )
            break
        except SandboxOperationError:
            if attempt == 59:
                raise
            time.sleep(1)
    frontend_environment = {
        "APP_ENVIRONMENT": "production",
        "RECIPE_API_URL": f"http://{generation.prefix}-backend:8000",
        "INTERNAL_NETWORK_SIGNAL_SECRET": signal_secret,
    }
    # Docker does not publish ports for internal-only networks. Give only the
    # frontend an ingress bridge; the API/database remain on the private network.
    docker(
        [
            "network",
            "create",
            "--label",
            f"{LABEL}={generation.identifier}",
            f"{generation.prefix}-ingress",
        ]
    )
    docker(
        [
            *_container_arguments(generation, "frontend"),
            "--network",
            f"name={generation.prefix}-ingress,gw-priority=1",
            "--detach",
            "--read-only",
            "--tmpfs",
            "/tmp:rw,nosuid,noexec,size=16m",
            "--publish",
            f"127.0.0.1:{port}:3000",
            *_environment_arguments(frontend_environment),
            frontend_image,
        ],
        environment=frontend_environment,
    )
    for attempt in range(60):
        try:
            docker(
                [
                    "exec",
                    f"{generation.prefix}-frontend",
                    "node",
                    "-e",
                    (
                        "Promise.all(['/healthz','/recipes'].map(async path => { "
                        "const response = await fetch('http://127.0.0.1:3000' + path); "
                        "if (response.status !== 200) throw Error(); "
                        "})).catch(() => process.exit(1))"
                    ),
                ]
            )
            break
        except SandboxOperationError:
            if attempt == 59:
                raise
            time.sleep(1)

    _verify_published_listener(port)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend-image", required=True)
    parser.add_argument("--frontend-image", required=True)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--contact-url", required=True)
    parser.add_argument("--port", type=int, default=3100)
    parser.add_argument("--lifetime-seconds", type=int, default=24 * 60 * 60)
    parser.add_argument("--once", action="store_true", help="Stop after one generation expires.")
    arguments = parser.parse_args(argv)
    origin = urlparse(arguments.origin)
    contact = urlparse(arguments.contact_url)
    https_contact = (
        contact.scheme == "https"
        and bool(contact.netloc)
        and not contact.username
        and not contact.password
        and not contact.fragment
    )
    email_contact = (
        contact.scheme == "mailto"
        and not contact.netloc
        and not contact.params
        and not contact.query
        and not contact.fragment
        and CONTACT_EMAIL.fullmatch(contact.path) is not None
    )
    if (
        not 60 <= arguments.lifetime_seconds <= 86_400
        or not 1024 <= arguments.port <= 65535
        or origin.scheme != "https"
        or not origin.netloc
        or origin.username
        or origin.password
        or origin.path not in ("", "/")
        or origin.query
        or origin.fragment
        or not (https_contact or email_contact)
    ):
        parser.error(
            "Use a HTTPS origin, HTTPS or mailto contact, unprivileged port, "
            "and 60–86400 second lifetime."
        )

    def stop_supervisor(_signum: int, _frame: object) -> None:
        raise KeyboardInterrupt

    previous_sigterm = signal.signal(signal.SIGTERM, stop_supervisor)
    try:
        while True:
            started_at = datetime.now(UTC)
            generation = Generation(
                uuid4(),
                started_at,
                started_at + timedelta(seconds=arguments.lifetime_seconds),
            )
            try:
                start_generation(
                    generation,
                    backend_image=arguments.backend_image,
                    frontend_image=arguments.frontend_image,
                    origin=arguments.origin.rstrip("/"),
                    contact_url=arguments.contact_url,
                    port=arguments.port,
                )
                print(
                    "Portfolio sandbox ready; all visitor content expires with this generation.",
                    flush=True,
                )
                while datetime.now(UTC) < generation.expires_at:
                    time.sleep(
                        min(
                            10,
                            max(
                                0,
                                (generation.expires_at - datetime.now(UTC)).total_seconds(),
                            ),
                        )
                    )
            finally:
                destroy_generation(generation)
            if arguments.once:
                break
    except (SandboxOperationError, OSError, ValueError, subprocess.SubprocessError):
        print(
            "Portfolio sandbox stopped; verify the isolated environment before restarting.",
            file=sys.stderr,
        )
        return 1
    except KeyboardInterrupt:
        return 0
    finally:
        signal.signal(signal.SIGTERM, previous_sigterm)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
