#!/usr/bin/env python3
"""Wait for named local services while proving their processes remain alive."""

from __future__ import annotations

import argparse
import os
import signal
import sys
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DEFAULT_POLL_SECONDS = 1.0
ENDPOINT_TIMEOUT_SECONDS = 2.0


class ServiceReadinessError(RuntimeError):
    """Raised when a managed service cannot become ready safely."""


@dataclass(frozen=True, slots=True)
class Service:
    name: str
    health_url: str
    pid_file: Path


def parse_service(value: str) -> Service:
    """Parse NAME=URL,PID_FILE without confusing the colon in an HTTP URL."""

    name, separator, details = value.partition("=")
    health_url, detail_separator, raw_pid_file = details.rpartition(",")
    if (
        not separator
        or not detail_separator
        or not name.strip()
        or not health_url.startswith(("http://127.0.0.1:", "http://localhost:"))
        or not raw_pid_file.strip()
    ):
        raise argparse.ArgumentTypeError(
            "service must use NAME=http://127.0.0.1:PORT/PATH,PID_FILE"
        )
    return Service(name.strip(), health_url, Path(raw_pid_file).expanduser())


def read_pid(service: Service) -> int:
    try:
        raw_pid = service.pid_file.read_text(encoding="ascii").strip()
        pid = int(raw_pid)
    except (OSError, UnicodeError, ValueError) as error:
        raise ServiceReadinessError(
            f"{service.name} has no readable process identifier."
        ) from error
    if pid <= 0:
        raise ServiceReadinessError(
            f"{service.name} has no readable process identifier."
        )
    return pid


def process_is_running(pid: int) -> bool:
    try:
        os.kill(pid, signal.SIG_DFL)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def endpoint_is_ready(url: str) -> bool:
    request = Request(url, headers={"Accept": "application/json"})
    try:
        with urlopen(request, timeout=ENDPOINT_TIMEOUT_SECONDS) as response:
            response.read(1)
            return 200 <= response.status < 300
    except (HTTPError, OSError, URLError):
        return False


def wait_for_services(
    services: Sequence[Service],
    *,
    timeout_seconds: float,
    poll_seconds: float = DEFAULT_POLL_SECONDS,
    monotonic: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
    is_running: Callable[[int], bool] = process_is_running,
    is_ready: Callable[[str], bool] = endpoint_is_ready,
) -> None:
    if not services:
        raise ValueError("At least one service is required.")
    if timeout_seconds <= 0 or poll_seconds <= 0:
        raise ValueError("Timeout and poll intervals must be positive.")

    managed = tuple((service, read_pid(service)) for service in services)
    deadline = monotonic() + timeout_seconds
    while True:
        readiness: list[bool] = []
        for service, pid in managed:
            if not is_running(pid):
                raise ServiceReadinessError(
                    f"{service.name} stopped before becoming ready."
                )
            readiness.append(is_ready(service.health_url))
        if all(readiness):
            return

        remaining = deadline - monotonic()
        if remaining <= 0:
            names = ", ".join(
                service.name
                for (service, _), ready in zip(managed, readiness, strict=True)
                if not ready
            )
            raise ServiceReadinessError(
                f"Services did not become ready before the deadline: {names}."
            )
        sleep(min(poll_seconds, remaining))


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--service",
        action="append",
        required=True,
        type=parse_service,
        help="repeatable NAME=HEALTH_URL,PID_FILE service specification",
    )
    parser.add_argument("--timeout", type=float, default=45.0)
    parser.add_argument("--poll", type=float, default=DEFAULT_POLL_SECONDS)
    arguments = parser.parse_args(argv)

    try:
        wait_for_services(
            arguments.service,
            timeout_seconds=arguments.timeout,
            poll_seconds=arguments.poll,
        )
    except (OSError, ServiceReadinessError, ValueError) as error:
        print(f"Service readiness check failed: {error}", file=sys.stderr)
        return 1

    print(
        "Service readiness check passed: "
        + ", ".join(service.name for service in arguments.service)
        + "."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
