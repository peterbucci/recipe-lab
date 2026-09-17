#!/usr/bin/env python3
"""Rehearse two real disposable sandbox generations without retaining visitor artifacts.

Uses already-verified local production images. A temporary loopback TLS proxy
exercises Secure cookies and the actual frontend API proxy; it is not hosting.
"""

from __future__ import annotations

import argparse
import html
import http.client
import ipaddress
import json
import secrets
import signal
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from http.cookiejar import CookieJar
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, HTTPSHandler, ProxyHandler, Request, build_opener
from uuid import uuid4

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from scripts import run_portfolio_sandbox as sandbox

ORIGIN = "https://127.0.0.1:3443"
CONTACT = "https://example.invalid/portfolio-contact"
FRONTEND_PORT = 3100
TLS_PORT = 3443
HOP_HEADERS = frozenset(
    {
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
        "content-length",
    }
)
TABLES = (
    "users",
    "user_sessions",
    "sandbox_visitor_entries",
    "recipe_drafts",
    "recipe_versions",
    "recipe_saves",
    "recipe_ratings",
    "user_follows",
    "preference_events",
    "recipe_reports",
    "recipe_moderation_cases",
    "ingredient_catalog_requests",
    "ingredient_catalog_audit_events",
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise sandbox.SandboxOperationError(message)


def _require_free_port(port: int) -> None:
    with socket.socket() as listener:
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        listener.bind(("127.0.0.1", port))


class _Proxy(BaseHTTPRequestHandler):
    """One test-only origin; no request or response logging, caching, or forwarding hints."""

    def log_message(self, _format: str, *args: object) -> None:
        pass

    def _forward(self) -> None:
        connection = http.client.HTTPConnection("127.0.0.1", FRONTEND_PORT, timeout=20)
        try:
            body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
            headers = {
                name: value
                for name, value in self.headers.items()
                if name.lower() not in HOP_HEADERS and name.lower() != "host"
            }
            headers["Host"] = f"127.0.0.1:{TLS_PORT}"
            connection.request(self.command, self.path, body=body, headers=headers)
            response = connection.getresponse()
            content = response.read()
            self.send_response(response.status)
            for name, value in response.getheaders():
                if name.lower() not in HOP_HEADERS:
                    self.send_header(name, value)
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except (OSError, http.client.HTTPException, ValueError):
            self.send_error(502, "Sandbox listener unavailable")
        finally:
            connection.close()

    do_GET = _forward
    do_POST = _forward
    do_PUT = _forward
    do_PATCH = _forward
    do_DELETE = _forward


class _QuietServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def handle_error(self, request: object, client_address: object) -> None:
        # The normal server traceback can include request context. Keep evidence sanitized.
        pass


@contextmanager
def _https_proxy() -> Iterator[ssl.SSLContext]:
    _require_free_port(FRONTEND_PORT)
    _require_free_port(TLS_PORT)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = datetime.now(UTC)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "127.0.0.1")])
    certificate = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(hours=2))
        .add_extension(
            x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )
    pem = certificate.public_bytes(serialization.Encoding.PEM)
    # Only this short-lived TLS key/certificate reaches disk, never visitor credentials/data.
    # TemporaryDirectory removes the exact directory it creates; no system trust is changed.
    with tempfile.TemporaryDirectory(prefix="recipe-lab-sandbox-tls-") as directory:
        certificate_path = Path(directory) / "certificate.pem"
        key_path = Path(directory) / "key.pem"
        certificate_path.write_bytes(pem)
        key_path.write_bytes(
            key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            )
        )
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(certificate_path, key_path)
        client_context = ssl.create_default_context(cadata=pem.decode("ascii"))
        server = _QuietServer(("127.0.0.1", TLS_PORT), _Proxy)
        try:
            server.socket = context.wrap_socket(server.socket, server_side=True)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                yield client_context
            finally:
                server.shutdown()
                thread.join(timeout=5)
        finally:
            server.server_close()


class Visitor:
    def __init__(self, context: ssl.SSLContext) -> None:
        self.cookies = CookieJar()
        self.opener = build_opener(
            ProxyHandler({}), HTTPSHandler(context=context), HTTPCookieProcessor(self.cookies)
        )

    def request(
        self,
        path: str,
        *,
        method: str = "GET",
        body: object = None,
        expected: int = 200,
        cookie_header: str | None = None,
    ) -> dict:
        require(path.startswith("/api/"), "Only local API routes may be requested.")
        headers = {"Accept": "application/json"}
        if cookie_header is not None:
            headers["Cookie"] = cookie_header
        if method != "GET":
            headers.update(
                {
                    "Origin": ORIGIN,
                    "Content-Type": "application/json",
                    "Idempotency-Key": str(uuid4()),
                }
            )
            csrf = next(
                (cookie.value for cookie in self.cookies if cookie.name == "recipe_lab_csrf"), ""
            )
            headers["X-CSRF-Token"] = csrf
        request = Request(
            ORIGIN + path,
            data=None if method == "GET" else json.dumps(body).encode(),
            headers=headers,
            method=method,
        )
        try:
            response = self.opener.open(request, timeout=25)
        except HTTPError as error:
            response = error
        with response:
            require(
                response.status == expected,
                f"An API check failed ({method}, expected {expected}, got {response.status}).",
            )
            data = response.read()
        return json.loads(data) if data else {}

    def enter(self, generation: sandbox.Generation) -> dict:
        available = self.request("/api/auth/demo")
        require(
            available["generation_id"] == str(generation.identifier),
            "Listener generation did not match.",
        )
        member = self.request(
            "/api/auth/demo",
            method="POST",
            body={
                "entry_key": secrets.token_urlsafe(32),
                "generation_id": str(generation.identifier),
            },
        )
        require(
            member["status"] == "authenticated" and member["temporary"],
            "Demo entry did not create a temporary member.",
        )
        require(
            not any(member["capabilities"].values()),
            "Demo identity unexpectedly has staff capabilities.",
        )
        require(
            all(cookie.secure for cookie in self.cookies),
            "Production demo cookies were not Secure.",
        )
        require(len(list(self.cookies)) == 2, "Demo session cookies were not established.")
        return member

    def verify_rendered_seeds(self) -> None:
        recipes = self.request("/api/recipes")
        require(bool(recipes["items"]), "Reviewed seed recipes are missing.")
        with self.opener.open(ORIGIN + "/recipes", timeout=25) as response:
            content = response.read().decode("utf-8")
        require(
            html.escape(recipes["items"][0]["title"]) in content,
            "Rendered browse did not contain a reviewed seed recipe.",
        )


def _database_counts(generation: sandbox.Generation) -> dict:
    name = f"{generation.prefix}-db"
    require(sandbox._owned_container(name, generation), "Owned database is missing.")
    fields = [f"'{table}', (SELECT count(*) FROM {table})" for table in TABLES]
    fields.append(
        "'seed_fingerprint', "
        "(SELECT md5(string_agg(id::text, ',' ORDER BY id)) FROM recipe_versions)"
    )
    sql = "BEGIN READ ONLY; SELECT json_build_object(" + ",".join(fields) + "); ROLLBACK;"
    output = sandbox.docker(
        [
            "exec",
            name,
            "psql",
            "--no-psqlrc",
            "-U",
            "recipe_lab_sandbox",
            "-d",
            generation.database_name,
            "-At",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            sql,
        ]
    )
    return json.loads(next(line for line in output.splitlines() if line.startswith("{")))


def _verify_storage(generation: sandbox.Generation) -> None:
    for role in ("db", "backend", "frontend"):
        name = f"{generation.prefix}-{role}"
        require(sandbox._owned_container(name, generation), "An owned container is missing.")
        metadata = json.loads(sandbox.docker(["container", "inspect", name]))[0]
        host = metadata["HostConfig"]
        require(
            host["LogConfig"]["Type"] == "none" and host["RestartPolicy"]["Name"] == "no",
            "A container retains logs or restarts.",
        )
        require(
            host["Memory"] > 0 and host["MemorySwap"] == host["Memory"],
            "A container has unbounded memory or swap.",
        )
        require(
            all(mount["Type"] == "tmpfs" for mount in metadata["Mounts"]),
            "A container has persistent storage.",
        )
        require(host["AutoRemove"], "A container is not automatically discarded.")
        if role != "db":
            require(host["ReadonlyRootfs"], "An application container has a writable image layer.")
        if role != "frontend":
            require(
                not host.get("PortBindings")
                and not any(metadata["NetworkSettings"]["Ports"].values()),
                "An internal service has a host-published port.",
            )
        expected_networks = {generation.prefix}
        if role == "frontend":
            expected_networks.add(f"{generation.prefix}-ingress")
            require(
                metadata["NetworkSettings"]["Ports"].get("3000/tcp")
                == [{"HostIp": "127.0.0.1", "HostPort": str(FRONTEND_PORT)}],
                "The frontend loopback listener is not effectively published.",
            )
        require(
            set(metadata["NetworkSettings"]["Networks"]) == expected_networks,
            "A container is connected outside its intended networks.",
        )
        if role == "db":
            require(
                "/var/lib/postgresql/data" in host["Tmpfs"], "Database data is not memory-only."
            )
    metadata = json.loads(sandbox.docker(["network", "inspect", generation.prefix]))[0]
    require(
        metadata["Internal"]
        and metadata["Labels"].get(sandbox.LABEL) == str(generation.identifier),
        "Generation network is not private and owned.",
    )
    ingress = json.loads(sandbox.docker(["network", "inspect", f"{generation.prefix}-ingress"]))[0]
    require(
        not ingress["Internal"]
        and ingress["Labels"].get(sandbox.LABEL) == str(generation.identifier)
        and {item["Name"] for item in ingress["Containers"].values()}
        == {f"{generation.prefix}-frontend"},
        "Ingress is not owned and limited to the frontend.",
    )


def _verify_binding(generation: sandbox.Generation) -> None:
    name = f"{generation.prefix}-backend"
    require(sandbox._owned_container(name, generation), "Owned backend is missing.")
    command = [
        "python",
        "-m",
        "app.sandbox",
        "verify",
        "--expected-database-name",
        generation.database_name,
    ]
    for override in (
        f"SANDBOX_GENERATION_ID={uuid4()}",
        f"SANDBOX_EXPIRES_AT={(generation.expires_at + timedelta(minutes=1)).isoformat()}",
    ):
        result = subprocess.run(
            ["docker", "exec", "--env", override, name, *command],
            capture_output=True,
            timeout=30,
            check=False,
        )
        require(
            result.returncode == 1
            and result.stderr.strip() == b"Sandbox generation operation failed."
            and not result.stdout.strip(),
            "Changed binding did not produce the expected application refusal.",
        )
    sandbox.docker(["exec", name, *command])


def _populate(generation: sandbox.Generation, context: ssl.SSLContext) -> tuple[Visitor, dict]:
    alice, bob = Visitor(context), Visitor(context)
    a, b = alice.enter(generation), bob.enter(generation)
    require(a["user"]["id"] != b["user"]["id"], "Visitors shared an identity.")
    handle = "rehearsal-" + uuid4().hex[:12]
    alice.request(
        "/api/auth/session/profile",
        method="PATCH",
        body={
            "handle": handle,
            "display_name": "Fictional rehearsal cook",
            "description": "Synthetic reset evidence.",
        },
    )
    private = alice.request(
        "/api/recipe-drafts", method="POST", body={"draft_kind": "original"}, expected=201
    )
    alice.request(
        f"/api/recipe-drafts/{private['id']}",
        method="PUT",
        body={"revision": private["revision"], "title": "Unpublished fictional reset note"},
    )
    bob.request(f"/api/recipe-drafts/{private['id']}", expected=404)
    draft = alice.request(
        "/api/recipe-drafts", method="POST", body={"draft_kind": "original"}, expected=201
    )
    ingredients = alice.request("/api/ingredients?q=pecan")["items"]
    ingredient = next(item for item in ingredients if "pecan" in item["canonical_name"].lower())
    unit = next(
        item
        for item in alice.request("/api/measurement-units?semantic=ingredient_amount")["items"]
        if item["key"] == "g"
    )
    action = next(
        item for item in alice.request("/api/cooking-action-types")["items"] if item["key"] == "mix"
    )
    saved = alice.request(
        f"/api/recipe-drafts/{draft['id']}",
        method="PUT",
        body={
            "revision": draft["revision"],
            "title": "Fictional reset recipe " + uuid4().hex[:8],
            "servings": "2",
            "ingredients": [
                {
                    "ref": "pecan",
                    "selection": {
                        "kind": "catalog",
                        "ingredient_id": ingredient["id"],
                        "display_name": ingredient["canonical_name"],
                    },
                    "measure": {"kind": "exact", "value": "137", "unit_id": unit["id"]},
                }
            ],
            "instructions": [
                {
                    "ref": "mix",
                    "text": "Mix the fictional ingredients.",
                    "actions": [{"action_type_id": action["id"], "ingredient_refs": ["pecan"]}],
                }
            ],
        },
    )
    evidence = alice.request(
        f"/api/recipe-drafts/{draft['id']}/duplicate-preflights",
        method="POST",
        body={"revision": saved["revision"]},
        expected=201,
    )
    published = alice.request(
        f"/api/recipe-drafts/{draft['id']}/publish",
        method="POST",
        expected=201,
        body={
            "revision": saved["revision"],
            "community_rules_accepted": True,
            "content_rights_confirmed": True,
            "duplicate_review": {
                **{
                    key: evidence["acknowledgement"][key]
                    for key in ("preflight_id", "policy_version", "result_digest")
                },
                "decision": None if evidence["classification"] == "distinct" else "continue",
            },
        },
    )
    recipe_id = published["recipe_version_id"]
    alice.request(f"/api/recipes/{recipe_id}")
    bob.request(f"/api/recipes/{recipe_id}/save", method="PUT", body={})
    bob.request(f"/api/recipes/{recipe_id}/rating", method="PUT", body={"rating": 5})
    bob.request(f"/api/cooks/{handle}/follow", method="PUT", body={})
    bob.request(
        f"/api/recipes/{recipe_id}/reports",
        method="POST",
        body={"reason": "other", "details": "Synthetic rehearsal report."},
        expected=201,
    )
    request = alice.request(
        "/api/ingredient-requests",
        method="POST",
        body={
            "proposed_name": "Fictional rehearsal herb " + uuid4().hex[:8],
            "context": "Synthetic reset evidence.",
        },
        expected=201,
    )
    alice.request(f"/api/ingredient-requests/{request['id']}")
    alice.request(f"/api/cooks/{handle}")
    return alice, {
        "draft": private["id"],
        "recipe": recipe_id,
        "handle": handle,
        "request": request["id"],
    }


def _deadline(generation: sandbox.Generation, visitor: Visitor) -> None:
    # No supervisor main loop/process is running: only the in-container guard owns expiry.
    while datetime.now(UTC) < generation.expires_at + timedelta(seconds=3):
        time.sleep(
            min(
                5,
                max(
                    0.1,
                    (
                        generation.expires_at + timedelta(seconds=3) - datetime.now(UTC)
                    ).total_seconds(),
                ),
            )
        )
    for _ in range(10):
        if not sandbox._owned_container(f"{generation.prefix}-db", generation):
            break
        time.sleep(1)
    require(
        not sandbox._owned_container(f"{generation.prefix}-db", generation),
        "Database survived its independent deadline.",
    )
    visitor.request("/api/recipes", expected=503)
    visitor.request("/api/readiness", expected=503)
    visitor.request("/api/health")


def _removed(generation: sandbox.Generation) -> None:
    require(
        not sandbox.docker(
            [
                "container",
                "ls",
                "--all",
                "--quiet",
                "--filter",
                f"label={sandbox.LABEL}={generation.identifier}",
            ]
        ),
        "Generation containers remain after cleanup.",
    )
    require(
        not sandbox.docker(
            [
                "network",
                "ls",
                "--quiet",
                "--filter",
                f"label={sandbox.LABEL}={generation.identifier}",
            ]
        ),
        "Generation network remains after cleanup.",
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend-image", required=True)
    parser.add_argument("--frontend-image", required=True)
    parser.add_argument("--lifetime-seconds", type=int, default=240)
    arguments = parser.parse_args(argv)
    if not 120 <= arguments.lifetime_seconds <= 900:
        parser.error("Use a rehearsal lifetime of 120–900 seconds.")
    generations: list[sandbox.Generation] = []

    def stop_rehearsal(_signum: int, _frame: object) -> None:
        raise KeyboardInterrupt

    previous_sigterm = signal.signal(signal.SIGTERM, stop_rehearsal)

    def start() -> sandbox.Generation:
        now = datetime.now(UTC)
        generation = sandbox.Generation(
            uuid4(), now, now + timedelta(seconds=arguments.lifetime_seconds)
        )
        generations.append(generation)
        sandbox.start_generation(
            generation,
            backend_image=arguments.backend_image,
            frontend_image=arguments.frontend_image,
            origin=ORIGIN,
            contact_url=CONTACT,
            port=FRONTEND_PORT,
        )
        _verify_storage(generation)
        return generation

    result = 0
    try:
        with _https_proxy() as context:
            first = start()
            baseline = _database_counts(first)
            require(
                baseline["recipe_versions"] > 0 and baseline["user_sessions"] == 0,
                "Reviewed seeds or clean startup check failed.",
            )
            Visitor(context).verify_rendered_seeds()
            _verify_binding(first)
            visitor, identifiers = _populate(first, context)
            old_cookie = "; ".join(f"{cookie.name}={cookie.value}" for cookie in visitor.cookies)
            populated = _database_counts(first)
            for table in (
                "recipe_saves",
                "recipe_ratings",
                "user_follows",
                "recipe_reports",
                "ingredient_catalog_requests",
            ):
                require(
                    populated[table] > baseline[table],
                    "Synthetic domain evidence was not persisted.",
                )
            print(
                "PASS: isolated generation, Secure cookies, real workflows and memory-only storage",
                flush=True,
            )
            _deadline(first, visitor)
            print(
                "PASS: database self-deadline removed storage without a host supervisor; "
                "API failed closed.",
                flush=True,
            )
            sandbox.destroy_generation(first)
            _removed(first)
            second = start()
            require(
                _database_counts(second) == baseline,
                "The replacement did not match clean reviewed seed state.",
            )
            require(
                visitor.request("/api/auth/session", cookie_header=old_cookie)["status"]
                == "anonymous",
                "An old cookie authenticated in the replacement.",
            )
            visitor.request(f"/api/recipe-drafts/{identifiers['draft']}", expected=401)
            visitor.request(f"/api/recipes/{identifiers['recipe']}", expected=404)
            visitor.request(f"/api/cooks/{identifiers['handle']}", expected=404)
            fresh = Visitor(context)
            fresh.enter(second)
            fresh.request(f"/api/recipe-drafts/{identifiers['draft']}", expected=404)
            fresh.request(f"/api/ingredient-requests/{identifiers['request']}", expected=404)
            fresh.verify_rendered_seeds()
            print(
                "PASS: fresh generation restored seeds and entry; "
                "old identities and synthetic domain records did not carry over.",
                flush=True,
            )
    except sandbox.SandboxOperationError as error:
        print(f"FAIL: {error}", file=sys.stderr)
        result = 1
    except (Exception, KeyboardInterrupt) as error:
        print(
            f"FAIL: sandbox rehearsal did not finish ({type(error).__name__}); "
            "no visitor diagnostics were retained.",
            file=sys.stderr,
        )
        result = 1
    finally:
        cleanup_failed = False
        for generation in reversed(generations):
            try:
                sandbox.destroy_generation(generation)
                _removed(generation)
            except Exception:
                cleanup_failed = True
        if cleanup_failed:
            print(
                "FAIL: owned resource cleanup needs inspection; no further generation was started.",
                file=sys.stderr,
            )
            result = 1
        signal.signal(signal.SIGTERM, previous_sigterm)
    if result == 0:
        print(
            "PASS: all rehearsal containers, networks, and temporary TLS files removed.", flush=True
        )
    return result


if __name__ == "__main__":
    raise SystemExit(main())
