#!/usr/bin/env python3
"""Run the guarded sandbox browser journey in the existing CI PostgreSQL service."""

from __future__ import annotations

import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.request import urlopen
from uuid import UUID, uuid4

from sqlalchemy import Connection, create_engine, text
from sqlalchemy.engine import make_url

from scripts.wait_for_services import endpoint_is_ready

DATABASE_NAME = "recipe_lab_sandbox_acceptance"
RESULTS_NAME = "recipe-lab-sandbox-results"
REPOSITORY = Path(__file__).resolve().parents[1]
IS_LINUX_RUNNER = sys.platform == "linux"


def sandbox_environment(
    environment: dict[str, str], *, started_at: datetime, generation_id: UUID
) -> dict[str, str]:
    if environment.get("CI") != "true" or environment.get("GITHUB_ACTIONS") != "true":
        raise ValueError("Sandbox CI acceptance requires the isolated GitHub runner.")
    source = make_url(environment["DATABASE_URL"])
    if (
        source.database != "recipe_lab_acceptance"
        or source.host != "127.0.0.1"
        or source.port != 5432
        or source.username != "recipe_lab"
        or source.drivername != "postgresql+psycopg"
    ):
        raise ValueError("The isolated acceptance PostgreSQL service is required.")
    result = {
        **environment,
        "DATABASE_URL": source.set(database=DATABASE_NAME).render_as_string(hide_password=False),
        "APP_ENVIRONMENT": "local",
        "CORS_ORIGINS": "http://127.0.0.1:3100",
        "AUTH_ALLOWED_ORIGINS": "http://127.0.0.1:3100",
        "SANDBOX_ENABLED": "1",
        "SANDBOX_ACCEPTANCE": "1",
        "SANDBOX_GENERATION_ID": str(generation_id),
        "SANDBOX_STARTED_AT": started_at.isoformat(),
        "SANDBOX_EXPIRES_AT": (started_at + timedelta(hours=1)).isoformat(),
        "SANDBOX_CONTACT_URL": "https://portfolio.example.test/contact",
        "OIDC_ISSUER": "",
        "OIDC_CLIENT_ID": "",
        "OIDC_CLIENT_SECRET": "",
        "OIDC_REDIRECT_URI": "",
        "ACCEPTANCE_DATABASE_ISOLATED": "1",
        "PLAYWRIGHT_BASE_URL": "http://127.0.0.1:3100",
        "RECIPE_API_URL": "http://127.0.0.1:8100",
        "NEXT_PUBLIC_API_URL": "http://127.0.0.1:8100",
        "PLAYWRIGHT_WEB_SERVER_COMMAND": ("node server.mjs --hostname 127.0.0.1 --port 3100"),
    }
    result.pop("ACCEPTANCE_SESSION_FIXTURE", None)
    result.pop("MVP_ACCEPTANCE", None)
    return result


def create_isolated_database(connection: Connection) -> int:
    existing = connection.scalar(
        text("SELECT oid FROM pg_database WHERE datname = :name"),
        {"name": DATABASE_NAME},
    )
    if existing is not None:
        raise ValueError("Sandbox acceptance refuses an existing database.")
    connection.execute(text("CREATE DATABASE recipe_lab_sandbox_acceptance"))
    return int(
        connection.scalar(
            text("SELECT oid FROM pg_database WHERE datname = :name"),
            {"name": DATABASE_NAME},
        )
    )


def destroy_isolated_database(connection: Connection, *, expected_oid: int) -> None:
    current_oid = connection.scalar(
        text("SELECT oid FROM pg_database WHERE datname = :name"),
        {"name": DATABASE_NAME},
    )
    if current_oid != expected_oid:
        raise ValueError("Sandbox acceptance database ownership changed.")
    connection.execute(text("DROP DATABASE recipe_lab_sandbox_acceptance WITH (FORCE)"))


def stop_process_group(process: subprocess.Popen[bytes] | None) -> None:
    if process is None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass
    # Playwright's web-server child belongs to this explicitly created session.
    # Remove any descendant that outlived its parent; never search by port/name.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait(timeout=5)


def require_unused_ports() -> None:
    for port in (8100, 3100):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(("127.0.0.1", port))


def verify_backend_generation(
    backend: subprocess.Popen[bytes], environment: dict[str, str]
) -> None:
    if backend.poll() is not None:
        raise RuntimeError("The sandbox backend process stopped.")
    with urlopen("http://127.0.0.1:8100/api/auth/demo", timeout=2) as response:
        availability = json.loads(response.read(2048))
    if (
        not isinstance(availability, dict)
        or availability.get("enabled") is not True
        or availability.get("generation_id") != environment["SANDBOX_GENERATION_ID"]
        or backend.poll() is not None
    ):
        raise RuntimeError("The backend is not this acceptance generation.")


def main() -> int:
    if not IS_LINUX_RUNNER:
        print("Sandbox CI acceptance requires its isolated Linux runner.", file=sys.stderr)
        return 1
    backend: subprocess.Popen[bytes] | None = None
    browser: subprocess.Popen[bytes] | None = None
    database_oid: int | None = None
    outputs_created = False
    phase = "setup"

    def interrupted(_signal: int, _frame: object) -> None:
        raise KeyboardInterrupt

    previous_sigterm = signal.signal(signal.SIGTERM, interrupted)
    try:
        environment = sandbox_environment(
            dict(os.environ), started_at=datetime.now(UTC), generation_id=uuid4()
        )
        require_unused_ports()
        runner_temp = Path(environment["RUNNER_TEMP"]).resolve(strict=True)
        results = runner_temp / RESULTS_NAME
        if results.exists() or results.is_symlink():
            raise ValueError("Sandbox acceptance refuses existing output storage.")
        results.mkdir(mode=0o700)
        outputs_created = True
        admin_url = make_url(environment["DATABASE_URL"]).set(database="postgres")
        engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
        try:
            with engine.connect() as connection:
                try:
                    database_oid = create_isolated_database(connection)
                    for command_phase, command in (
                        ("migration", ["alembic", "upgrade", "head"]),
                        (
                            "binding",
                            [
                                "app.sandbox",
                                "initialize",
                                "--expected-database-name",
                                DATABASE_NAME,
                            ],
                        ),
                        ("seeding", ["app.seeds", "load"]),
                    ):
                        phase = command_phase
                        subprocess.run(
                            [sys.executable, "-m", *command],
                            cwd=REPOSITORY / "backend",
                            env=environment,
                            check=True,
                            timeout=120,
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL,
                        )
                    phase = "backend"
                    backend = subprocess.Popen(
                        [
                            sys.executable,
                            "-m",
                            "uvicorn",
                            "app.main:app",
                            "--host",
                            "127.0.0.1",
                            "--port",
                            "8100",
                            "--no-access-log",
                        ],
                        cwd=REPOSITORY / "backend",
                        env=environment,
                        start_new_session=True,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                    deadline = time.monotonic() + 30
                    while not endpoint_is_ready("http://127.0.0.1:8100/api/readiness"):
                        if backend.poll() is not None or time.monotonic() >= deadline:
                            raise RuntimeError("Sandbox backend did not become ready.")
                        time.sleep(0.5)
                    verify_backend_generation(backend, environment)
                    phase = "browser"
                    browser = subprocess.Popen(
                        [
                            "node",
                            "scripts/run-playwright-mode.mjs",
                            "sandbox",
                            "--reporter=github",
                            f"--output={results}",
                        ],
                        cwd=REPOSITORY / "frontend",
                        env={**environment, "APP_ENVIRONMENT": "production"},
                        start_new_session=True,
                    )
                    if browser.wait(timeout=240) != 0:
                        raise RuntimeError("Sandbox browser journey failed.")
                finally:
                    try:
                        stop_process_group(browser)
                    finally:
                        try:
                            stop_process_group(backend)
                        finally:
                            if database_oid is not None:
                                destroy_isolated_database(connection, expected_oid=database_oid)
        finally:
            engine.dispose()
    except (Exception, KeyboardInterrupt):  # noqa: BLE001
        # Do not expose credentials, connection strings, or raw database errors.
        print(f"Sandbox CI acceptance failed during {phase}.", file=sys.stderr)
        return 1
    finally:
        signal.signal(signal.SIGTERM, previous_sigterm)
        if outputs_created:
            # The fixed child was created exclusively above, never adopted from a
            # prior run or discovered with a broad glob. All artifacts are synthetic.
            try:
                shutil.rmtree(results)
            except OSError:
                print("Sandbox CI acceptance output cleanup failed.", file=sys.stderr)
                return 1
    print("Sandbox browser acceptance passed; temporary processes and data removed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
