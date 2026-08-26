"""Guarded, loopback-only OpenID Connect provider for RCP-32 acceptance.

This process is test infrastructure. It keeps its signing key, authorization
requests, codes, provider subjects, and private emails in memory and never logs
HTTP requests. Nothing in this module is mounted by the Recipe Lab API.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import html
import ipaddress
import os
import re
import secrets
import threading
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Final, cast
from urllib.parse import parse_qs, urlencode, urlsplit

import jwt
import uvicorn
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response

_MAX_QUERY_BYTES: Final = 4_096
_MAX_FORM_BYTES: Final = 4_096
_MAX_AUTHORIZATION_REQUESTS: Final = 256
_MAX_AUTHORIZATION_CODES: Final = 256
_MAX_URL_LENGTH: Final = 512
_MAX_CLIENT_ID_LENGTH: Final = 256
_MAX_STATE_LENGTH: Final = 512
_MAX_NONCE_LENGTH: Final = 512
_MAX_SCOPE_LENGTH: Final = 256
_MAX_FORM_VALUE_LENGTH: Final = 1_024
_CODE_TTL: Final = timedelta(minutes=2)
_AUTHORIZATION_REQUEST_TTL: Final = timedelta(minutes=2)
_ID_TOKEN_TTL: Final = timedelta(minutes=5)
_PKCE_CHALLENGE_PATTERN: Final = re.compile(r"^[A-Za-z0-9_-]{43}$")
_PKCE_VERIFIER_PATTERN: Final = re.compile(r"^[A-Za-z0-9._~-]{43,128}$")
_OPAQUE_VALUE_PATTERN: Final = re.compile(r"^[A-Za-z0-9_-]{32,512}$")
_CLIENT_ID_PATTERN: Final = re.compile(r"^[A-Za-z0-9._~-]{1,256}$")


class LocalOIDCProviderError(RuntimeError):
    """Raised when the acceptance provider is configured or called unsafely."""


@dataclass(frozen=True, slots=True)
class LocalOIDCProviderConfig:
    issuer: str
    client_id: str
    redirect_uri: str

    def __post_init__(self) -> None:
        _validate_provider_url(self.issuer, name="issuer", require_root_path=True)
        _validate_provider_url(self.redirect_uri, name="redirect URI", require_root_path=False)
        if urlsplit(self.issuer).scheme != "http" or urlsplit(self.redirect_uri).scheme != "http":
            raise LocalOIDCProviderError("The local OIDC provider requires loopback HTTP URLs.")
        if (
            not self.client_id
            or len(self.client_id) > _MAX_CLIENT_ID_LENGTH
            or _CLIENT_ID_PATTERN.fullmatch(self.client_id) is None
        ):
            raise LocalOIDCProviderError("The local OIDC client ID is invalid.")


@dataclass(frozen=True, slots=True)
class LocalOIDCIdentity:
    key: str
    display_name: str
    subject: str
    email: str


LOCAL_IDENTITIES: Final = (
    LocalOIDCIdentity(
        key="alice",
        display_name="Alice",
        subject="rcp32-alice",
        email="alice@rcp32.recipe-lab.invalid",
    ),
    LocalOIDCIdentity(
        key="bob",
        display_name="Bob",
        subject="rcp32-bob",
        email="bob@rcp32.recipe-lab.invalid",
    ),
    LocalOIDCIdentity(
        key="curator",
        display_name="Curator",
        subject="rcp32-curator",
        email="curator@rcp32.recipe-lab.invalid",
    ),
    LocalOIDCIdentity(
        key="moderator",
        display_name="Moderator",
        subject="rcp32-moderator",
        email="moderator@rcp32.recipe-lab.invalid",
    ),
)
_IDENTITIES_BY_KEY: Final = {identity.key: identity for identity in LOCAL_IDENTITIES}


@dataclass(frozen=True, slots=True)
class _AuthorizationRequest:
    state: str
    nonce: str
    code_challenge: str
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class _AuthorizationCode:
    identity: LocalOIDCIdentity
    nonce: str
    code_challenge: str
    authenticated_at: datetime
    expires_at: datetime


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _is_loopback(hostname: str) -> bool:
    if hostname.casefold() == "localhost":
        return True
    try:
        return ipaddress.ip_address(hostname).is_loopback
    except ValueError:
        return False


def _validate_provider_url(value: str, *, name: str, require_root_path: bool) -> None:
    if not value or len(value) > _MAX_URL_LENGTH:
        raise LocalOIDCProviderError(f"The local OIDC {name} is invalid.")
    try:
        parsed = urlsplit(value)
        _port = parsed.port
    except ValueError as error:
        raise LocalOIDCProviderError(f"The local OIDC {name} is invalid.") from error
    if (
        parsed.scheme not in {"http", "https"}
        or parsed.hostname is None
        or not _is_loopback(parsed.hostname)
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or (require_root_path and parsed.path not in {"", "/"})
    ):
        raise LocalOIDCProviderError(f"The local OIDC {name} must use a loopback URL.")


def _loopback_origin(value: str) -> str:
    parsed = urlsplit(value)
    hostname = parsed.hostname
    if hostname is None:
        raise LocalOIDCProviderError("The local OIDC URL has no loopback origin.")
    authority = f"[{hostname}]" if ":" in hostname else hostname
    if parsed.port is not None:
        authority = f"{authority}:{parsed.port}"
    return f"{parsed.scheme}://{authority}"


def validate_acceptance_environment(environment: Mapping[str, str]) -> None:
    """Refuse to enable the provider without both destructive-test guards."""

    if environment.get("RCP32_ACCEPTANCE") != "1":
        raise LocalOIDCProviderError("RCP32_ACCEPTANCE=1 is required.")
    if environment.get("ACCEPTANCE_DATABASE_ISOLATED") != "1":
        raise LocalOIDCProviderError("ACCEPTANCE_DATABASE_ISOLATED=1 is required.")
    if environment.get("APP_ENVIRONMENT", "local") == "production":
        raise LocalOIDCProviderError("The local OIDC provider cannot run in production.")


def config_from_environment(environment: Mapping[str, str]) -> LocalOIDCProviderConfig:
    validate_acceptance_environment(environment)
    issuer = environment.get("OIDC_ISSUER", "").strip()
    client_id = environment.get("OIDC_CLIENT_ID", "").strip()
    redirect_uri = environment.get("OIDC_REDIRECT_URI", "").strip()
    if not issuer or not client_id or not redirect_uri:
        raise LocalOIDCProviderError(
            "OIDC_ISSUER, OIDC_CLIENT_ID, and OIDC_REDIRECT_URI are required."
        )
    return LocalOIDCProviderConfig(
        issuer=issuer,
        client_id=client_id,
        redirect_uri=redirect_uri,
    )


def _base64url_sha256(value: str) -> str:
    digest = hashlib.sha256(value.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _no_store(response: Response) -> Response:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


def _json_error(*, error: str, description: str, status_code: int) -> JSONResponse:
    return cast(
        JSONResponse,
        _no_store(
            JSONResponse(
                {"error": error, "error_description": description},
                status_code=status_code,
            )
        ),
    )


def _query_values(request: Request) -> dict[str, str] | None:
    raw_query = request.scope.get("query_string", b"")
    if not isinstance(raw_query, bytes) or len(raw_query) > _MAX_QUERY_BYTES:
        return None
    allowed = {
        "client_id",
        "code_challenge",
        "code_challenge_method",
        "max_age",
        "nonce",
        "prompt",
        "redirect_uri",
        "response_mode",
        "response_type",
        "scope",
        "state",
    }
    collected: dict[str, str] = {}
    for key, value in request.query_params.multi_items():
        if key not in allowed or key in collected or len(value) > _MAX_FORM_VALUE_LENGTH:
            return None
        collected[key] = value
    return collected


async def _form_values(request: Request, *, expected_keys: frozenset[str]) -> dict[str, str] | None:
    content_type = request.headers.get("content-type", "").partition(";")[0].strip().casefold()
    if content_type != "application/x-www-form-urlencoded":
        return None
    raw_length = request.headers.get("content-length")
    if raw_length is not None:
        try:
            if int(raw_length) > _MAX_FORM_BYTES:
                return None
        except ValueError:
            return None
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > _MAX_FORM_BYTES:
            return None
        body.extend(chunk)
    try:
        decoded = bytes(body).decode("utf-8", errors="strict")
        parsed = parse_qs(
            decoded,
            keep_blank_values=True,
            strict_parsing=True,
            max_num_fields=len(expected_keys),
        )
    except (UnicodeDecodeError, ValueError):
        return None
    if set(parsed) != expected_keys:
        return None
    values: dict[str, str] = {}
    for key, items in parsed.items():
        if len(items) != 1 or not items[0] or len(items[0]) > _MAX_FORM_VALUE_LENGTH:
            return None
        values[key] = items[0]
    return values


class LocalOIDCProvider:
    """In-memory state and signing material for one provider process."""

    def __init__(
        self,
        config: LocalOIDCProviderConfig,
        *,
        clock: Callable[[], datetime] = _utc_now,
    ) -> None:
        self.config = config
        self._clock = clock
        self._private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self._key_id = secrets.token_urlsafe(18)
        public_jwk = jwt.algorithms.RSAAlgorithm.to_jwk(
            self._private_key.public_key(),
            as_dict=True,
        )
        public_jwk.update({"alg": "RS256", "kid": self._key_id, "use": "sig"})
        self._public_jwk = public_jwk
        self._authorization_requests: dict[str, _AuthorizationRequest] = {}
        self._authorization_codes: dict[str, _AuthorizationCode] = {}
        self._lock = threading.Lock()

    def _now(self) -> datetime:
        now = self._clock()
        if now.tzinfo is None:
            raise LocalOIDCProviderError("The local OIDC clock must be timezone-aware.")
        return now.astimezone(UTC)

    def _prune(self, now: datetime) -> None:
        self._authorization_requests = {
            key: value
            for key, value in self._authorization_requests.items()
            if value.expires_at > now
        }
        self._authorization_codes = {
            key: value for key, value in self._authorization_codes.items() if value.expires_at > now
        }

    def provider_metadata(self) -> dict[str, object]:
        issuer = self.config.issuer.rstrip("/")
        return {
            "issuer": self.config.issuer,
            "authorization_endpoint": f"{issuer}/authorize",
            "token_endpoint": f"{issuer}/token",
            "jwks_uri": f"{issuer}/jwks",
            "response_types_supported": ["code"],
            "response_modes_supported": ["query"],
            "grant_types_supported": ["authorization_code"],
            "token_endpoint_auth_methods_supported": ["none"],
            "scopes_supported": ["openid", "email", "profile"],
            "subject_types_supported": ["public"],
            "id_token_signing_alg_values_supported": ["RS256"],
            "code_challenge_methods_supported": ["S256"],
        }

    def jwks(self) -> dict[str, object]:
        return {"keys": [dict(self._public_jwk)]}

    def begin_authorization(self, values: Mapping[str, str]) -> str | None:
        required = {
            "client_id",
            "code_challenge",
            "code_challenge_method",
            "nonce",
            "redirect_uri",
            "response_mode",
            "response_type",
            "scope",
            "state",
        }
        if not required <= set(values):
            return None
        if set(values) - required - {"max_age", "prompt"}:
            return None
        state = values["state"]
        nonce = values["nonce"]
        scope = values["scope"]
        if (
            values["client_id"] != self.config.client_id
            or values["redirect_uri"] != self.config.redirect_uri
            or values["response_type"] != "code"
            or values["response_mode"] != "query"
            or values["code_challenge_method"] != "S256"
            or _PKCE_CHALLENGE_PATTERN.fullmatch(values["code_challenge"]) is None
            or not 16 <= len(state) <= _MAX_STATE_LENGTH
            or _OPAQUE_VALUE_PATTERN.fullmatch(state) is None
            or not 16 <= len(nonce) <= _MAX_NONCE_LENGTH
            or _OPAQUE_VALUE_PATTERN.fullmatch(nonce) is None
            or not scope
            or len(scope) > _MAX_SCOPE_LENGTH
            or not {"openid", "email"} <= set(scope.split())
        ):
            return None
        prompt = values.get("prompt")
        max_age = values.get("max_age")
        if (prompt, max_age) not in {(None, None), ("login", "0")}:
            return None

        now = self._now()
        request_id = secrets.token_urlsafe(32)
        with self._lock:
            self._prune(now)
            if len(self._authorization_requests) >= _MAX_AUTHORIZATION_REQUESTS:
                return None
            self._authorization_requests[request_id] = _AuthorizationRequest(
                state=state,
                nonce=nonce,
                code_challenge=values["code_challenge"],
                expires_at=now + _AUTHORIZATION_REQUEST_TTL,
            )
        return request_id

    def approve_authorization(self, *, request_id: str, identity_key: str) -> str | None:
        if (
            _OPAQUE_VALUE_PATTERN.fullmatch(request_id) is None
            or identity_key not in _IDENTITIES_BY_KEY
        ):
            return None
        now = self._now()
        with self._lock:
            self._prune(now)
            authorization = self._authorization_requests.pop(request_id, None)
            if authorization is None or authorization.expires_at <= now:
                return None
            if len(self._authorization_codes) >= _MAX_AUTHORIZATION_CODES:
                return None
            code = secrets.token_urlsafe(32)
            self._authorization_codes[code] = _AuthorizationCode(
                identity=_IDENTITIES_BY_KEY[identity_key],
                nonce=authorization.nonce,
                code_challenge=authorization.code_challenge,
                authenticated_at=now,
                expires_at=now + _CODE_TTL,
            )
        return (
            f"{self.config.redirect_uri}?{urlencode({'code': code, 'state': authorization.state})}"
        )

    def exchange_code(self, values: Mapping[str, str]) -> tuple[str, int] | None:
        verifier = values.get("code_verifier", "")
        code = values.get("code", "")
        if (
            set(values) != {"client_id", "code", "code_verifier", "grant_type", "redirect_uri"}
            or values.get("grant_type") != "authorization_code"
            or values.get("client_id") != self.config.client_id
            or values.get("redirect_uri") != self.config.redirect_uri
            or _OPAQUE_VALUE_PATTERN.fullmatch(code) is None
            or _PKCE_VERIFIER_PATTERN.fullmatch(verifier) is None
        ):
            return None

        now = self._now()
        with self._lock:
            self._prune(now)
            authorization_code = self._authorization_codes.pop(code, None)
        if (
            authorization_code is None
            or authorization_code.expires_at <= now
            or not secrets.compare_digest(
                _base64url_sha256(verifier),
                authorization_code.code_challenge,
            )
        ):
            return None

        expires_in = int(_ID_TOKEN_TTL.total_seconds())
        claims: dict[str, object] = {
            "iss": self.config.issuer,
            "sub": authorization_code.identity.subject,
            "aud": self.config.client_id,
            "exp": int((now + _ID_TOKEN_TTL).timestamp()),
            "iat": int(now.timestamp()),
            "auth_time": int(authorization_code.authenticated_at.timestamp()),
            "nonce": authorization_code.nonce,
            "email": authorization_code.identity.email,
            "email_verified": True,
            "name": authorization_code.identity.display_name,
        }
        encoded = jwt.encode(
            claims,
            self._private_key,
            algorithm="RS256",
            headers={"kid": self._key_id},
        )
        return encoded, expires_in


def _authorization_page(request_id: str) -> str:
    buttons = "\n".join(
        (
            '<form method="post" action="/authorize">'
            f'<input type="hidden" name="request_id" value="{html.escape(request_id)}">'
            f'<input type="hidden" name="identity" value="{html.escape(identity.key)}">'
            f'<button type="submit">Continue as {html.escape(identity.display_name)}</button>'
            "</form>"
        )
        for identity in LOCAL_IDENTITIES
    )
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Recipe Lab acceptance sign-in</title>
  </head>
  <body>
    <main aria-labelledby="provider-heading">
      <h1 id="provider-heading">Choose a test cook</h1>
      <p>This local page is available only during the guarded RCP-32 acceptance run.</p>
      {buttons}
    </main>
  </body>
</html>"""


def create_provider_app(
    config: LocalOIDCProviderConfig,
    *,
    clock: Callable[[], datetime] = _utc_now,
) -> FastAPI:
    provider = LocalOIDCProvider(config, clock=clock)
    redirect_origin = _loopback_origin(config.redirect_uri)
    application = FastAPI(
        title="Recipe Lab local acceptance identity provider",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    application.state.local_oidc_provider = provider

    @application.get("/health")
    def health() -> JSONResponse:
        return cast(JSONResponse, _no_store(JSONResponse({"status": "ok"})))

    @application.get("/.well-known/openid-configuration")
    def discovery() -> JSONResponse:
        return cast(JSONResponse, _no_store(JSONResponse(provider.provider_metadata())))

    @application.get("/jwks")
    def jwks() -> JSONResponse:
        return cast(JSONResponse, _no_store(JSONResponse(provider.jwks())))

    @application.get("/authorize")
    def authorize(request: Request) -> Response:
        values = _query_values(request)
        request_id = provider.begin_authorization(values) if values is not None else None
        if request_id is None:
            return _json_error(
                error="invalid_request",
                description="The authorization request is invalid.",
                status_code=400,
            )
        response = HTMLResponse(_authorization_page(request_id))
        response.headers["Content-Security-Policy"] = (
            f"default-src 'none'; form-action 'self' {redirect_origin}; style-src 'none'; "
            "img-src 'none'; base-uri 'none'; frame-ancestors 'none'"
        )
        return _no_store(response)

    @application.post("/authorize")
    async def approve(request: Request) -> Response:
        values = await _form_values(
            request,
            expected_keys=frozenset({"identity", "request_id"}),
        )
        location = (
            provider.approve_authorization(
                request_id=values["request_id"],
                identity_key=values["identity"],
            )
            if values is not None
            else None
        )
        if location is None:
            return _json_error(
                error="invalid_request",
                description="The authorization selection is invalid or expired.",
                status_code=400,
            )
        return _no_store(RedirectResponse(location, status_code=303))

    @application.post("/token")
    async def token(request: Request) -> JSONResponse:
        values = await _form_values(
            request,
            expected_keys=frozenset(
                {"client_id", "code", "code_verifier", "grant_type", "redirect_uri"}
            ),
        )
        if values is None:
            return _json_error(
                error="invalid_request",
                description="The token request is invalid.",
                status_code=400,
            )
        exchanged = provider.exchange_code(values)
        if exchanged is None:
            return _json_error(
                error="invalid_grant",
                description="The authorization code is invalid or expired.",
                status_code=400,
            )
        id_token, expires_in = exchanged
        return cast(
            JSONResponse,
            _no_store(
                JSONResponse(
                    {
                        "id_token": id_token,
                        "token_type": "Bearer",
                        "expires_in": expires_in,
                    }
                )
            ),
        )

    return application


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run the guarded loopback OIDC provider for RCP-32 acceptance."
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8200)
    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    environment: Mapping[str, str] | None = None,
) -> int:
    arguments = build_parser().parse_args(argv)
    selected_environment = os.environ if environment is None else environment
    try:
        config = config_from_environment(selected_environment)
        if not _is_loopback(cast(str, arguments.host)):
            raise LocalOIDCProviderError("The local OIDC bind host must be loopback.")
        port = cast(int, arguments.port)
        if not 1 <= port <= 65_535:
            raise LocalOIDCProviderError("The local OIDC bind port is invalid.")
        issuer = urlsplit(config.issuer)
        expected_port = issuer.port or (443 if issuer.scheme == "https" else 80)
        if port != expected_port:
            raise LocalOIDCProviderError("The local OIDC bind port must match its issuer.")
    except LocalOIDCProviderError as error:
        raise SystemExit(f"Local OIDC provider refused startup: {error}") from error

    uvicorn.run(
        create_provider_app(config),
        host=cast(str, arguments.host),
        port=port,
        access_log=False,
        log_level="warning",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
