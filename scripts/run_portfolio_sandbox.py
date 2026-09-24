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
import stat
import subprocess
import sys
import time
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from ipaddress import IPv4Address, ip_address, ip_network
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import ProxyHandler, build_opener
from uuid import UUID, uuid4

from scripts.verify_production_images import DATABASE_IMAGE

LABEL = "org.recipe-lab.portfolio-generation"
IMAGE_ID = re.compile(r"sha256:[0-9a-f]{64}\Z")
CONTAINER_NAME = re.compile(
    r"/recipe-lab-sandbox-([0-9a-f]{32})-(frontend|backend|initialize|db)\Z"
)
NETWORK_NAME = re.compile(r"recipe-lab-sandbox-([0-9a-f]{32})(?:-ingress)?\Z")
HEARTBEAT_NAME = re.compile(r"recipe-lab-sandbox-([0-9a-f]{32})-([0-9a-f]{32})\.heartbeat\Z")
FAIL_STOP_EXIT_CODE = 78
MONITOR_INTERVAL_SECONDS = 10
HEARTBEAT_INTERVAL_SECONDS = 10
HEARTBEAT_TTL_SECONDS = 30
CLEANUP_RETRY_ATTEMPTS = 40
CLEANUP_RETRY_INTERVAL_SECONDS = 0.25
CLEANUP_TIMEOUT_SECONDS = 10
HEARTBEAT_CONTAINER_PATH = "/run/recipe-lab-supervisor/heartbeat"
HEARTBEAT_PATH_ENV = "SANDBOX_SUPERVISOR_HEARTBEAT_PATH"
HEARTBEAT_TTL_ENV = "SANDBOX_SUPERVISOR_HEARTBEAT_TTL_SECONDS"
TRUSTED_PROXY_PROOF_ENV = "TRUSTED_PROXY_PROOF_SECRET"
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


class SandboxOwnershipError(SandboxOperationError):
    pass


def _default_state_directory() -> Path:
    configured = os.environ.get("XDG_STATE_HOME")
    root = (
        Path(configured)
        if configured and Path(configured).is_absolute()
        else Path.home() / ".local" / "state"
    )
    return root / "recipe-lab" / "portfolio-sandbox"


def _default_heartbeat_directory() -> Path:
    configured = os.environ.get("XDG_RUNTIME_DIR")
    if configured and Path(configured).is_absolute():
        return Path(configured) / "recipe-lab" / "portfolio-sandbox"
    return _default_state_directory() / "heartbeat"


def _ensure_state_directory(path: Path) -> None:
    try:
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
        if not path.is_dir():
            raise OSError
    except OSError:
        raise SandboxOperationError("The sandbox state directory is unavailable.") from None


@contextmanager
def _supervisor_lock(path: Path) -> Iterator[None]:
    """Hold a non-blocking, process-scoped lock for the supervisor lifetime."""

    _ensure_state_directory(path.parent)
    flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags, 0o600)
    except OSError:
        raise SandboxOperationError("The sandbox supervisor lock is unavailable.") from None
    locked = False
    try:
        if os.name == "nt":
            import msvcrt

            if os.fstat(descriptor).st_size == 0:
                os.write(descriptor, b"\0")
            os.lseek(descriptor, 0, os.SEEK_SET)
            msvcrt.locking(descriptor, msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        locked = True
    except OSError:
        os.close(descriptor)
        raise SandboxOperationError("Another sandbox supervisor is already running.") from None
    try:
        yield
    finally:
        if locked:
            try:
                if os.name == "nt":
                    import msvcrt

                    os.lseek(descriptor, 0, os.SEEK_SET)
                    msvcrt.locking(descriptor, msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(descriptor, fcntl.LOCK_UN)
            except OSError:
                pass
        os.close(descriptor)


def _fail_stop_exists(path: Path) -> bool:
    return os.path.lexists(path)


def _mark_fail_stop(path: Path) -> None:
    """Persist a generic marker without recording exception or visitor data."""

    try:
        _ensure_state_directory(path.parent)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(path, flags, 0o600)
        try:
            os.write(
                descriptor,
                b"Sandbox cleanup or reconciliation was not proven. Manual review is required.\n",
            )
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    except FileExistsError:
        return
    except (OSError, SandboxOperationError):
        # The distinct exit status still lets the service manager prevent a restart.
        return


def docker(
    arguments: Sequence[str],
    *,
    environment: dict[str, str] | None = None,
    timeout: float = 180,
) -> str:
    try:
        result = subprocess.run(
            ["docker", *arguments],
            check=False,
            capture_output=True,
            text=True,
            env=None if environment is None else {**os.environ, **environment},
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        raise SandboxOperationError("A sandbox container operation timed out.") from None
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


def _ensure_heartbeat_directory(path: Path) -> None:
    if "," in str(path) or "\n" in str(path) or "\r" in str(path):
        raise SandboxOperationError("The sandbox heartbeat directory is invalid.")
    try:
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
        metadata = path.lstat()
    except OSError:
        raise SandboxOperationError("The sandbox heartbeat directory is unavailable.") from None
    if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        raise SandboxOperationError("The sandbox heartbeat directory is unsafe.")
    if os.name != "nt" and metadata.st_mode & 0o022:
        raise SandboxOperationError("The sandbox heartbeat directory is unsafe.")
    if hasattr(os, "geteuid") and metadata.st_uid != os.geteuid():
        raise SandboxOperationError("The sandbox heartbeat directory is unsafe.")


@dataclass
class SupervisorHeartbeat:
    path: Path
    generation_identifier: UUID
    invalidated: bool = False

    @classmethod
    def create(cls, directory: Path, generation: Generation) -> SupervisorHeartbeat:
        _ensure_heartbeat_directory(directory)
        path = directory / (f"{generation.prefix}-{secrets.token_hex(16)}.heartbeat")
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        try:
            descriptor = os.open(path, flags, 0o444)
            try:
                if hasattr(os, "fchmod"):
                    os.fchmod(descriptor, 0o444)
                else:
                    os.chmod(path, 0o444)
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        except OSError:
            raise SandboxOperationError("The sandbox heartbeat could not be created.") from None
        heartbeat = cls(path=path, generation_identifier=generation.identifier)
        try:
            heartbeat.refresh()
        except SandboxOperationError:
            try:
                heartbeat.invalidate()
            except SandboxOperationError:
                pass
            raise
        return heartbeat

    def _open_validated(self) -> tuple[int, os.stat_result]:
        match = HEARTBEAT_NAME.fullmatch(self.path.name)
        if match is None or match.group(1) != self.generation_identifier.hex:
            raise SandboxOperationError("Sandbox heartbeat ownership could not be verified.")
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        descriptor: int | None = None
        try:
            descriptor = os.open(self.path, flags)
            metadata = os.fstat(descriptor)
            path_metadata = self.path.lstat()
        except OSError:
            if descriptor is not None:
                os.close(descriptor)
            raise SandboxOperationError(
                "Sandbox heartbeat ownership could not be verified."
            ) from None
        assert descriptor is not None
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_size != 0
            or metadata.st_nlink != 1
            or metadata.st_dev != path_metadata.st_dev
            or metadata.st_ino != path_metadata.st_ino
            or (os.name != "nt" and stat.S_IMODE(metadata.st_mode) != 0o444)
            or (hasattr(os, "geteuid") and metadata.st_uid != os.geteuid())
        ):
            os.close(descriptor)
            raise SandboxOperationError("Sandbox heartbeat ownership could not be verified.")
        return descriptor, metadata

    def _set_timestamp(self, descriptor: int, timestamp_ns: int) -> None:
        try:
            if os.utime in os.supports_fd:
                os.utime(descriptor, ns=(timestamp_ns, timestamp_ns))
            elif os.utime in os.supports_follow_symlinks:
                os.utime(
                    self.path,
                    ns=(timestamp_ns, timestamp_ns),
                    follow_symlinks=False,
                )
            else:
                os.utime(self.path, ns=(timestamp_ns, timestamp_ns))
        except OSError:
            raise SandboxOperationError("The sandbox heartbeat could not be updated.") from None

    def refresh(self) -> None:
        if self.invalidated:
            raise SandboxOperationError("The sandbox heartbeat is inactive.")
        descriptor, _metadata = self._open_validated()
        try:
            self._set_timestamp(descriptor, time.time_ns())
        finally:
            os.close(descriptor)

    def invalidate(self) -> None:
        if self.invalidated:
            return
        descriptor, metadata = self._open_validated()
        try:
            self._set_timestamp(descriptor, 0)
            try:
                current = self.path.lstat()
            except OSError:
                raise SandboxOperationError(
                    "Sandbox heartbeat ownership could not be verified."
                ) from None
            if current.st_dev != metadata.st_dev or current.st_ino != metadata.st_ino:
                raise SandboxOperationError("Sandbox heartbeat ownership could not be verified.")
        finally:
            os.close(descriptor)
        try:
            if os.name == "nt":
                os.chmod(self.path, 0o600)
            os.unlink(self.path)
            self.invalidated = True
        except OSError:
            raise SandboxOperationError("The sandbox heartbeat could not be invalidated.") from None


def invalidate_orphaned_heartbeats(directory: Path) -> int:
    _ensure_heartbeat_directory(directory)
    heartbeats: list[SupervisorHeartbeat] = []
    try:
        entries = sorted(directory.iterdir(), key=lambda path: path.name)
    except OSError:
        raise SandboxOperationError("Sandbox heartbeats could not be inspected.") from None
    for path in entries:
        if not path.name.startswith("recipe-lab-sandbox-"):
            continue
        match = HEARTBEAT_NAME.fullmatch(path.name)
        if match is None:
            raise SandboxOperationError("Sandbox heartbeat ownership could not be verified.")
        heartbeats.append(
            SupervisorHeartbeat(path=path, generation_identifier=UUID(hex=match.group(1)))
        )
    for heartbeat in heartbeats:
        heartbeat.invalidate()
    return len(heartbeats)


def _validated_listen_host(value: str) -> str:
    try:
        address = ip_address(value)
    except ValueError:
        raise SandboxOperationError(
            "Use a loopback or private IPv4 address for the sandbox listener."
        ) from None
    if (
        not isinstance(address, IPv4Address)
        or address.is_unspecified
        or address.is_multicast
        or not (address.is_loopback or address.is_private)
    ):
        raise SandboxOperationError(
            "Use a loopback or private IPv4 address for the sandbox listener."
        )
    return str(address)


def _validated_trusted_proxy_cidrs(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    if len(value) > 4096 or len(value.split(",")) > 32:
        raise SandboxOperationError("Use exact private proxy addresses or narrow CIDRs.")
    normalized: list[str] = []
    for raw_entry in value.split(","):
        entry = raw_entry.strip()
        if not entry:
            raise SandboxOperationError("Use exact private proxy addresses or narrow CIDRs.")
        try:
            if "/" not in entry:
                address = ip_address(entry)
                if not (address.is_private or address.is_loopback or address.is_link_local):
                    raise ValueError
                canonical = str(address)
            else:
                network = ip_network(entry, strict=True)
                address = network.network_address
                minimum_prefix = 16 if network.version == 4 else 64
                if network.prefixlen < minimum_prefix or not (
                    address.is_private or address.is_loopback or address.is_link_local
                ):
                    raise ValueError
                canonical = network.with_prefixlen
        except ValueError:
            raise SandboxOperationError(
                "Use exact private proxy addresses or narrow CIDRs."
            ) from None
        if canonical not in normalized:
            normalized.append(canonical)
    return ",".join(normalized)


def _validated_proxy_configuration(value: str | None) -> tuple[str | None, str | None]:
    cidrs = _validated_trusted_proxy_cidrs(value)
    proof_secret = os.environ.get(TRUSTED_PROXY_PROOF_ENV) or None
    if (cidrs is None) != (proof_secret is None):
        raise SandboxOperationError("Trusted proxy configuration is incomplete.")
    if proof_secret is not None and re.fullmatch(r"[0-9a-f]{64}", proof_secret) is None:
        raise SandboxOperationError("Trusted proxy configuration is invalid.")
    return cidrs, proof_secret


def _identifier_from_resource(name: object, label: object, pattern: re.Pattern[str]) -> UUID:
    if not isinstance(name, str) or not isinstance(label, str):
        raise SandboxOperationError("Sandbox resource ownership could not be verified.")
    match = pattern.fullmatch(name)
    try:
        identifier = UUID(label)
    except (AttributeError, ValueError):
        raise SandboxOperationError("Sandbox resource ownership could not be verified.") from None
    if match is None or label != str(identifier) or match.group(1) != identifier.hex:
        raise SandboxOperationError("Sandbox resource ownership could not be verified.")
    return identifier


def _inspect_labeled_resources(kind: str) -> list[dict[str, object]]:
    listing = [kind, "ls"]
    if kind == "container":
        listing.append("--all")
    identifiers = docker([*listing, "--quiet", "--filter", f"label={LABEL}"])
    if not identifiers:
        return []
    resource_ids = identifiers.splitlines()
    metadata = json.loads(docker([kind, "inspect", *resource_ids]))
    if not isinstance(metadata, list) or len(metadata) != len(resource_ids):
        raise SandboxOperationError("Sandbox resource ownership could not be verified.")
    if not all(isinstance(item, dict) for item in metadata):
        raise SandboxOperationError("Sandbox resource ownership could not be verified.")
    return metadata


def reconcile_orphaned_generations() -> int:
    """Remove fully validated resources left by an earlier supervisor process."""

    generations: set[UUID] = set()
    resource_names: set[str] = set()
    for metadata in _inspect_labeled_resources("container"):
        name = metadata.get("Name")
        labels = metadata.get("Config", {})
        labels = labels.get("Labels", {}) if isinstance(labels, dict) else {}
        label = labels.get(LABEL) if isinstance(labels, dict) else None
        identifier = _identifier_from_resource(name, label, CONTAINER_NAME)
        if not isinstance(name, str) or name in resource_names:
            raise SandboxOperationError("Sandbox resource ownership could not be verified.")
        resource_names.add(name)
        generations.add(identifier)
    for metadata in _inspect_labeled_resources("network"):
        name = metadata.get("Name")
        labels = metadata.get("Labels", {})
        label = labels.get(LABEL) if isinstance(labels, dict) else None
        identifier = _identifier_from_resource(name, label, NETWORK_NAME)
        if not isinstance(name, str) or name in resource_names:
            raise SandboxOperationError("Sandbox resource ownership could not be verified.")
        resource_names.add(name)
        generations.add(identifier)

    # Validate the full discovery set before removing any resource.
    now = datetime.now(UTC)
    for identifier in sorted(generations, key=str):
        destroy_generation(Generation(identifier, now, now))
    return len(generations)


def _exact_resource_identifier(kind: str, name: str, *, timeout: float = 180) -> str | None:
    arguments = (
        [kind, "ls", "--all", "--quiet", "--no-trunc", "--filter", f"name=^/{name}$"]
        if kind == "container"
        else [kind, "ls", "--quiet", "--no-trunc", "--filter", f"name=^{name}$"]
    )
    identifiers = docker(arguments, timeout=timeout).splitlines()
    if len(identifiers) > 1:
        raise SandboxOwnershipError("Sandbox resource ownership could not be verified.")
    return identifiers[0] if identifiers else None


def _validate_owned_container_identifier(
    identifier: str, name: str, generation: Generation, *, timeout: float = 180
) -> None:
    try:
        metadata = json.loads(docker(["container", "inspect", identifier], timeout=timeout))
        record = metadata[0]
        labels = record["Config"]["Labels"]
    except (json.JSONDecodeError, IndexError, KeyError, TypeError):
        raise SandboxOwnershipError("Sandbox resource ownership could not be verified.") from None
    if (
        len(metadata) != 1
        or record.get("Id") != identifier
        or record.get("Name") != f"/{name}"
        or not isinstance(labels, dict)
        or labels.get(LABEL) != str(generation.identifier)
    ):
        raise SandboxOwnershipError("Sandbox resource ownership could not be verified.")


def _owned_container_identifier(name: str, generation: Generation) -> str | None:
    # Exact-name listing tolerates resources already removed by their deadline.
    identifier = _exact_resource_identifier("container", name)
    if identifier is None:
        return None
    _validate_owned_container_identifier(identifier, name, generation)
    return identifier


def _owned_container(name: str, generation: Generation) -> bool:
    return _owned_container_identifier(name, generation) is not None


def _validate_owned_network_identifier(
    identifier: str, name: str, generation: Generation, *, timeout: float = 180
) -> None:
    try:
        metadata = json.loads(docker(["network", "inspect", identifier], timeout=timeout))
        record = metadata[0]
        labels = record["Labels"]
    except (json.JSONDecodeError, IndexError, KeyError, TypeError):
        raise SandboxOwnershipError("Sandbox network ownership could not be verified.") from None
    if (
        len(metadata) != 1
        or record.get("Id") != identifier
        or record.get("Name") != name
        or not isinstance(labels, dict)
        or labels.get(LABEL) != str(generation.identifier)
    ):
        raise SandboxOwnershipError("Sandbox network ownership could not be verified.")


def _owned_network_identifier(name: str, generation: Generation) -> str | None:
    identifier = _exact_resource_identifier("network", name)
    if identifier is None:
        return None
    _validate_owned_network_identifier(identifier, name, generation)
    return identifier


def _remove_owned_resource(kind: str, name: str, generation: Generation) -> None:
    expected_identifier: str | None = None
    validator = (
        _validate_owned_container_identifier
        if kind == "container"
        else _validate_owned_network_identifier
    )
    deadline = time.monotonic() + CLEANUP_TIMEOUT_SECONDS
    for attempt in range(CLEANUP_RETRY_ATTEMPTS):
        try:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            identifier = _exact_resource_identifier(kind, name, timeout=remaining)
            if identifier is None:
                return
            if expected_identifier is not None and identifier != expected_identifier:
                raise SandboxOwnershipError("Sandbox resource ownership could not be verified.")
            expected_identifier = identifier
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            validator(identifier, name, generation, timeout=remaining)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            docker(
                [kind, "rm", "--force", identifier]
                if kind == "container"
                else [kind, "rm", identifier],
                timeout=remaining,
            )
        except SandboxOwnershipError:
            raise
        except SandboxOperationError:
            # Docker may be concurrently completing --rm or releasing network links.
            # The next pass proves absence or revalidates the same immutable resource.
            pass
        if attempt + 1 < CLEANUP_RETRY_ATTEMPTS:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            time.sleep(min(CLEANUP_RETRY_INTERVAL_SECONDS, remaining))
    raise SandboxOperationError("Sandbox cleanup did not converge.")


def destroy_generation(generation: Generation) -> None:
    # Remove the listener first, then writers, then the complete memory database.
    for role in ("frontend", "backend", "initialize", "db"):
        name = f"{generation.prefix}-{role}"
        _remove_owned_resource("container", name, generation)
    for name in (f"{generation.prefix}-ingress", generation.prefix):
        _remove_owned_resource("network", name, generation)


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
        "--ulimit",
        "core=0:0",
    ]


def _environment_arguments(environment: dict[str, str]) -> list[str]:
    return [value for name in environment for value in ("--env", name)]


def _verify_published_listener(port: int, listen_host: str = "127.0.0.1") -> None:
    # Check the actual reverse-proxy target without inherited HTTP proxy settings.
    opener = build_opener(ProxyHandler({}))
    try:
        for path in ("/readyz", "/recipes"):
            with opener.open(f"http://{listen_host}:{port}{path}", timeout=5) as response:
                if response.status != 200:
                    raise SandboxOperationError("The sandbox listener is not ready.")
                if path == "/readyz" and response.read(32) != b"ready\n":
                    raise SandboxOperationError("The sandbox listener is not ready.")
    except (OSError, ValueError):
        raise SandboxOperationError("The sandbox listener is not ready.") from None


def _verify_backend_readiness(generation: Generation) -> None:
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


def _verify_running_container(name: str, generation: Generation) -> None:
    if not _owned_container(name, generation):
        raise SandboxOperationError("A sandbox container is not running.")
    state = json.loads(docker(["container", "inspect", "--format", "{{json .State}}", name]))
    health = state.get("Health") if isinstance(state, dict) else None
    if (
        not isinstance(state, dict)
        or state.get("Running") is not True
        or state.get("Paused") is True
        or (isinstance(health, dict) and health.get("Status") == "unhealthy")
    ):
        raise SandboxOperationError("A sandbox container is not running.")


def verify_generation_health(
    generation: Generation, *, port: int, listen_host: str = "127.0.0.1"
) -> None:
    for role in ("db", "backend", "frontend"):
        _verify_running_container(f"{generation.prefix}-{role}", generation)
    _verify_backend_readiness(generation)
    _verify_published_listener(port, listen_host)


def monitor_generation(
    generation: Generation,
    *,
    port: int,
    listen_host: str = "127.0.0.1",
    heartbeat: SupervisorHeartbeat | None = None,
) -> None:
    while True:
        remaining = (generation.expires_at - datetime.now(UTC)).total_seconds()
        if remaining <= 0:
            return
        time.sleep(min(HEARTBEAT_INTERVAL_SECONDS, MONITOR_INTERVAL_SECONDS, remaining))
        if datetime.now(UTC) >= generation.expires_at:
            return
        if heartbeat is not None:
            heartbeat.refresh()
        verify_generation_health(generation, port=port, listen_host=listen_host)
        if heartbeat is not None:
            heartbeat.refresh()


def start_generation(
    generation: Generation,
    *,
    backend_image: str,
    frontend_image: str,
    origin: str,
    contact_url: str,
    port: int,
    listen_host: str = "127.0.0.1",
    trusted_proxy_cidrs: str | None = None,
    heartbeat: SupervisorHeartbeat | None = None,
) -> None:
    listen_host = _validated_listen_host(listen_host)
    trusted_proxy_cidrs, trusted_proxy_proof = _validated_proxy_configuration(trusted_proxy_cidrs)
    if not ip_address(listen_host).is_loopback and trusted_proxy_cidrs is None:
        raise SandboxOperationError("Trusted proxy addresses are required for a proxy listener.")
    if heartbeat is not None and heartbeat.generation_identifier != generation.identifier:
        raise SandboxOperationError("The sandbox heartbeat generation does not match.")
    for image_id in (backend_image, frontend_image):
        if IMAGE_ID.fullmatch(image_id) is None:
            raise SandboxOperationError("Use exact verified immutable runtime image IDs.")
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
            _verify_backend_readiness(generation)
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
    if trusted_proxy_cidrs is not None:
        frontend_environment["TRUSTED_PROXY_CIDRS"] = trusted_proxy_cidrs
        assert trusted_proxy_proof is not None
        frontend_environment[TRUSTED_PROXY_PROOF_ENV] = trusted_proxy_proof
    heartbeat_arguments: list[str] = []
    if heartbeat is not None:
        heartbeat.refresh()
        frontend_environment[HEARTBEAT_PATH_ENV] = HEARTBEAT_CONTAINER_PATH
        frontend_environment[HEARTBEAT_TTL_ENV] = str(HEARTBEAT_TTL_SECONDS)
        heartbeat_arguments = [
            "--mount",
            (f"type=bind,src={heartbeat.path},dst={HEARTBEAT_CONTAINER_PATH},readonly"),
        ]
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
    if heartbeat is not None:
        heartbeat.refresh()
    docker(
        [
            *_container_arguments(generation, "frontend"),
            "--network",
            f"name={generation.prefix}-ingress,gw-priority=1",
            "--detach",
            "--read-only",
            "--tmpfs",
            "/tmp:rw,nosuid,noexec,size=16m",
            *heartbeat_arguments,
            "--publish",
            f"{listen_host}:{port}:3000",
            *_environment_arguments(frontend_environment),
            frontend_image,
        ],
        environment=frontend_environment,
    )
    for attempt in range(60):
        try:
            if heartbeat is not None:
                heartbeat.refresh()
            docker(
                [
                    "exec",
                    f"{generation.prefix}-frontend",
                    "node",
                    "-e",
                    (
                        "Promise.all(['/readyz','/recipes'].map(async path => { "
                        "const response = await fetch('http://127.0.0.1:3000' + path); "
                        "if (response.status !== 200) throw Error(); "
                        "})).catch(() => process.exit(1))"
                    ),
                ]
            )
            if heartbeat is not None:
                heartbeat.refresh()
            break
        except SandboxOperationError:
            if attempt == 59:
                raise
            time.sleep(1)

    if heartbeat is not None:
        heartbeat.refresh()
    _verify_published_listener(port, listen_host)
    if heartbeat is not None:
        heartbeat.refresh()


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend-image", required=True)
    parser.add_argument("--frontend-image", required=True)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--contact-url", required=True)
    parser.add_argument("--port", type=int, default=3100)
    parser.add_argument(
        "--listen-host",
        default="127.0.0.1",
        help="Loopback or a private host address reachable by the HTTPS proxy.",
    )
    parser.add_argument(
        "--trusted-proxy-cidrs",
        help="Exact private proxy addresses or narrow CIDRs trusted for forwarded clients.",
    )
    parser.add_argument("--state-directory", type=Path, default=_default_state_directory())
    parser.add_argument("--heartbeat-directory", type=Path, default=_default_heartbeat_directory())
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
    try:
        listen_host = _validated_listen_host(arguments.listen_host)
        trusted_proxy_cidrs, _trusted_proxy_proof = _validated_proxy_configuration(
            arguments.trusted_proxy_cidrs
        )
    except SandboxOperationError:
        listen_host = ""
        trusted_proxy_cidrs = None
    if (
        not 60 <= arguments.lifetime_seconds <= 86_400
        or not 1024 <= arguments.port <= 65535
        or not listen_host
        or (listen_host and not ip_address(listen_host).is_loopback and not trusted_proxy_cidrs)
        or not arguments.state_directory.is_absolute()
        or not arguments.heartbeat_directory.is_absolute()
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
            "loopback/private IPv4 listener, absolute state/heartbeat directories, "
            "and 60–86400 second lifetime."
        )

    lock_path = arguments.state_directory / "supervisor.lock"
    fail_stop_path = arguments.state_directory / "fail-stop"

    def stop_supervisor(_signum: int, _frame: object) -> None:
        raise KeyboardInterrupt

    previous_sigterm = signal.signal(signal.SIGTERM, stop_supervisor)
    try:
        with _supervisor_lock(lock_path):
            try:
                stale_heartbeat_count = invalidate_orphaned_heartbeats(
                    arguments.heartbeat_directory
                )
            except BaseException:  # noqa: BLE001 - invalidation is fail-stop
                _mark_fail_stop(fail_stop_path)
                print(
                    "Portfolio sandbox is fail-stopped because heartbeat ownership "
                    "could not be reconciled safely.",
                    file=sys.stderr,
                )
                return FAIL_STOP_EXIT_CODE
            if _fail_stop_exists(fail_stop_path):
                print(
                    "Portfolio sandbox is fail-stopped; review cleanup before removing "
                    "the state marker.",
                    file=sys.stderr,
                )
                return FAIL_STOP_EXIT_CODE
            try:
                orphan_count = reconcile_orphaned_generations()
            except BaseException:  # noqa: BLE001 - reconciliation is fail-stop
                _mark_fail_stop(fail_stop_path)
                print(
                    "Portfolio sandbox is fail-stopped because previous resources "
                    "could not be reconciled safely.",
                    file=sys.stderr,
                )
                return FAIL_STOP_EXIT_CODE
            if orphan_count:
                print("Validated leftover sandbox resources were removed.", flush=True)
            if stale_heartbeat_count:
                print(
                    "Validated leftover sandbox heartbeats were invalidated.",
                    flush=True,
                )

            while True:
                started_at = datetime.now(UTC)
                generation = Generation(
                    uuid4(),
                    started_at,
                    started_at + timedelta(seconds=arguments.lifetime_seconds),
                )
                generation_error: BaseException | None = None
                heartbeat: SupervisorHeartbeat | None = None
                try:
                    heartbeat = SupervisorHeartbeat.create(
                        arguments.heartbeat_directory, generation
                    )
                    start_generation(
                        generation,
                        backend_image=arguments.backend_image,
                        frontend_image=arguments.frontend_image,
                        origin=arguments.origin.rstrip("/"),
                        contact_url=arguments.contact_url,
                        port=arguments.port,
                        listen_host=listen_host,
                        trusted_proxy_cidrs=trusted_proxy_cidrs,
                        heartbeat=heartbeat,
                    )
                    print(
                        "Portfolio sandbox ready; all visitor content expires with this "
                        "generation.",
                        flush=True,
                    )
                    monitor_generation(
                        generation,
                        port=arguments.port,
                        listen_host=listen_host,
                        heartbeat=heartbeat,
                    )
                except BaseException as error:  # noqa: BLE001 - cleanup must always run
                    generation_error = error
                heartbeat_error = False
                try:
                    if heartbeat is not None:
                        heartbeat.invalidate()
                except BaseException:  # noqa: BLE001 - invalidation is fail-stop
                    heartbeat_error = True
                cleanup_error = False
                try:
                    destroy_generation(generation)
                except BaseException:  # noqa: BLE001 - cleanup is fail-stop
                    cleanup_error = True
                if heartbeat_error or cleanup_error:
                    _mark_fail_stop(fail_stop_path)
                    print(
                        "Portfolio sandbox is fail-stopped because cleanup and traffic "
                        "withdrawal could not be proven. Review the isolated resources "
                        "before removing the state marker.",
                        file=sys.stderr,
                    )
                    return FAIL_STOP_EXIT_CODE

                if isinstance(generation_error, KeyboardInterrupt):
                    return 0
                if generation_error is not None:
                    if not isinstance(generation_error, Exception):
                        raise generation_error
                    print(
                        "Portfolio sandbox stopped; verify the isolated environment before "
                        "restarting.",
                        file=sys.stderr,
                    )
                    return 1
                if arguments.once:
                    return 0
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
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
