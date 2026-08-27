from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
from pytest import MonkeyPatch

from app.production_server import _port, main

BACKEND_ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("raw_port", ["", "0", "65536", "not-a-port"])
def test_invalid_server_ports_are_rejected_without_echoing_values(raw_port: str) -> None:
    with pytest.raises(RuntimeError, match="PORT must be an integer") as captured:
        _port({"PORT": raw_port})
    assert raw_port not in str(captured.value) or raw_port == ""


def test_production_server_is_non_reloading_and_uses_the_configured_port(
    monkeypatch: MonkeyPatch,
) -> None:
    application = object()
    captured: dict[str, object] = {}
    monkeypatch.setattr("app.production_server._load_backend_application", lambda: application)
    monkeypatch.setattr(
        "app.production_server.uvicorn.run",
        lambda loaded, **options: captured.update({"application": loaded, **options}),
    )

    main({"APP_ENVIRONMENT": "production", "PORT": "8123"})

    assert captured == {
        "application": application,
        "host": "0.0.0.0",
        "port": 8123,
        "reload": False,
    }


def test_production_server_refuses_non_production_mode(monkeypatch: MonkeyPatch) -> None:
    loaded = False

    def forbidden_load() -> object:
        nonlocal loaded
        loaded = True
        return object()

    monkeypatch.setattr("app.production_server._load_backend_application", forbidden_load)
    with pytest.raises(RuntimeError, match="APP_ENVIRONMENT must be set to production"):
        main({"APP_ENVIRONMENT": "local"})
    assert loaded is False


def test_invalid_production_secrets_are_redacted_from_startup_errors() -> None:
    abuse_sentinel = "sentinel-abuse-secret"
    network_sentinel = "sentinel-network-secret"
    environment = {
        **os.environ,
        "APP_ENVIRONMENT": "production",
        "ABUSE_RATE_LIMIT_SECRET": abuse_sentinel,
        "INTERNAL_NETWORK_SIGNAL_SECRET": network_sentinel,
    }

    completed = subprocess.run(
        [sys.executable, "-m", "app.production_server"],
        cwd=BACKEND_ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    output = completed.stdout + completed.stderr

    assert completed.returncode != 0
    assert "Recipe Lab configuration is invalid" in output
    assert "ABUSE_RATE_LIMIT_SECRET" in output
    assert "INTERNAL_NETWORK_SIGNAL_SECRET" in output
    assert abuse_sentinel not in output
    assert network_sentinel not in output
