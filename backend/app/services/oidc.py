from __future__ import annotations

import ipaddress
import unicodedata
from dataclasses import dataclass
from threading import Lock
from time import monotonic
from typing import Any, cast
from urllib.parse import urlencode, urlsplit

import httpx
import jwt

from app.core.config import Settings
from app.core.security import secrets_match

_DISCOVERY_CACHE_SECONDS = 5 * 60
_JWKS_CACHE_SECONDS = 5 * 60
_MAX_PROVIDER_RESPONSE_BYTES = 1024 * 1024
_MAX_ID_TOKEN_BYTES = 32 * 1024
_ASYMMETRIC_SIGNING_ALGORITHMS = frozenset(
    {"RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "EdDSA"}
)


class OIDCConfigurationError(RuntimeError):
    pass


class OIDCProviderUnavailableError(RuntimeError):
    pass


class InvalidOIDCLoginError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class OIDCProviderMetadata:
    issuer: str
    authorization_endpoint: str
    token_endpoint: str
    jwks_uri: str
    signing_algorithms: frozenset[str]


@dataclass(frozen=True, slots=True)
class VerifiedOIDCIdentity:
    issuer: str
    subject: str
    email: str
    email_verified: bool
    suggested_display_name: str


def _json_object(response: httpx.Response) -> dict[str, Any]:
    if len(response.content) > _MAX_PROVIDER_RESPONSE_BYTES:
        raise OIDCProviderUnavailableError("Identity provider response is too large.")
    try:
        payload = response.json()
    except ValueError as error:
        raise OIDCProviderUnavailableError("Identity provider returned invalid JSON.") from error
    if not isinstance(payload, dict):
        raise OIDCProviderUnavailableError("Identity provider returned an invalid object.")
    return cast(dict[str, Any], payload)


def _required_string(payload: dict[str, Any], name: str) -> str:
    value = payload.get(name)
    if not isinstance(value, str) or not value:
        raise OIDCProviderUnavailableError(
            f"Identity provider metadata is missing required field {name}."
        )
    return value


def _validate_https_url(value: str, *, allow_local_http: bool) -> None:
    try:
        parsed = urlsplit(value)
        # urllib defers port validation until this property is read.
        _validated_port = parsed.port
    except ValueError as error:
        raise OIDCConfigurationError("OIDC endpoint contains an invalid port.") from error
    if (
        parsed.scheme not in {"http", "https"}
        or parsed.hostname is None
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
    ):
        raise OIDCConfigurationError("OIDC endpoints must be absolute HTTP URLs.")
    if parsed.scheme != "https":
        hostname = parsed.hostname.casefold()
        try:
            loopback = hostname == "localhost" or ipaddress.ip_address(hostname).is_loopback
        except ValueError:
            loopback = hostname == "localhost"
        if not allow_local_http or not loopback:
            raise OIDCConfigurationError(
                "Cleartext OIDC endpoints are allowed only on local loopback hosts."
            )


class OIDCClient:
    """Small synchronous OIDC Authorization Code + PKCE client.

    Provider responses and tokens are kept in process only for the duration of a
    callback. The class never logs or persists provider credentials.
    """

    def __init__(
        self,
        settings: Settings,
        *,
        http_client: httpx.Client | None = None,
    ) -> None:
        self._settings = settings
        self._http = http_client or httpx.Client(
            timeout=settings.oidc_http_timeout_seconds,
            follow_redirects=False,
            headers={"Accept": "application/json"},
        )
        self._metadata: tuple[float, OIDCProviderMetadata] | None = None
        self._jwks: tuple[float, dict[str, Any]] | None = None
        self._cache_lock = Lock()

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> OIDCClient:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    def validate_configuration(self) -> None:
        settings = self._settings
        if (
            not settings.oidc_issuer
            or not settings.oidc_client_id
            or not settings.oidc_redirect_uri
        ):
            raise OIDCConfigurationError("OIDC is not configured.")
        if len(settings.oidc_issuer) > 512 or len(settings.oidc_client_id) > 512:
            raise OIDCConfigurationError("OIDC configuration exceeds supported lengths.")
        if settings.oidc_login_ttl_seconds <= 0 or settings.auth_session_ttl_seconds <= 0:
            raise OIDCConfigurationError("Authentication lifetimes must be positive.")
        if settings.oidc_http_timeout_seconds <= 0 or settings.oidc_clock_skew_seconds < 0:
            raise OIDCConfigurationError("OIDC timeout and clock skew are invalid.")
        if not {"openid", "email"} <= set(settings.oidc_scope_list):
            raise OIDCConfigurationError("OIDC scopes must include openid and email.")

        algorithms = set(settings.oidc_allowed_signing_algorithm_list)
        if not algorithms or not algorithms <= _ASYMMETRIC_SIGNING_ALGORITHMS:
            raise OIDCConfigurationError(
                "OIDC signing algorithms must be approved asymmetric values."
            )

        allow_local_http = settings.app_environment == "local"
        _validate_https_url(settings.oidc_issuer, allow_local_http=allow_local_http)
        _validate_https_url(settings.oidc_redirect_uri, allow_local_http=allow_local_http)
        issuer = urlsplit(settings.oidc_issuer)
        if issuer.query or issuer.fragment:
            raise OIDCConfigurationError("OIDC issuer must not contain a query or fragment.")
        redirect = urlsplit(settings.oidc_redirect_uri)
        if redirect.query or redirect.fragment:
            raise OIDCConfigurationError("OIDC redirect URI must not contain a query or fragment.")

    def build_authorization_url(
        self,
        *,
        state: str,
        nonce: str,
        code_challenge: str,
    ) -> str:
        metadata = self._get_metadata()
        query = urlencode(
            {
                "response_type": "code",
                "response_mode": "query",
                "client_id": self._settings.oidc_client_id,
                "redirect_uri": self._settings.oidc_redirect_uri,
                "scope": " ".join(self._settings.oidc_scope_list),
                "state": state,
                "nonce": nonce,
                "code_challenge": code_challenge,
                "code_challenge_method": "S256",
            }
        )
        delimiter = "&" if urlsplit(metadata.authorization_endpoint).query else "?"
        return f"{metadata.authorization_endpoint}{delimiter}{query}"

    def exchange_code(
        self,
        *,
        code: str,
        code_verifier: str,
        expected_nonce: str,
    ) -> VerifiedOIDCIdentity:
        metadata = self._get_metadata()
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "client_id": self._settings.oidc_client_id,
            "redirect_uri": self._settings.oidc_redirect_uri,
            "code_verifier": code_verifier,
        }
        client_secret = (
            self._settings.oidc_client_secret.get_secret_value()
            if self._settings.oidc_client_secret is not None
            else None
        )
        auth: httpx.BasicAuth | None = None
        if client_secret:
            auth = httpx.BasicAuth(self._settings.oidc_client_id, client_secret)

        try:
            if auth is None:
                response = self._http.post(
                    metadata.token_endpoint,
                    data=data,
                    headers={"Accept": "application/json"},
                )
            else:
                response = self._http.post(
                    metadata.token_endpoint,
                    data=data,
                    auth=auth,
                    headers={"Accept": "application/json"},
                )
        except (httpx.HTTPError, httpx.InvalidURL) as error:
            raise OIDCProviderUnavailableError(
                "Identity provider token exchange failed."
            ) from error
        if response.status_code < 200 or response.status_code >= 300:
            raise InvalidOIDCLoginError("Identity provider rejected the authorization code.")

        payload = _json_object(response)
        id_token = payload.get("id_token")
        if not isinstance(id_token, str) or not id_token or len(id_token) > _MAX_ID_TOKEN_BYTES:
            raise InvalidOIDCLoginError("Identity provider did not return a valid ID token.")
        return self._verify_id_token(id_token, expected_nonce=expected_nonce, metadata=metadata)

    def _get_metadata(self) -> OIDCProviderMetadata:
        self.validate_configuration()
        now = monotonic()
        with self._cache_lock:
            if self._metadata is not None and self._metadata[0] > now:
                return self._metadata[1]

        discovery_url = f"{self._settings.oidc_issuer.rstrip('/')}/.well-known/openid-configuration"
        try:
            response = self._http.get(discovery_url, headers={"Accept": "application/json"})
        except (httpx.HTTPError, httpx.InvalidURL) as error:
            raise OIDCProviderUnavailableError("OIDC discovery failed.") from error
        if response.status_code < 200 or response.status_code >= 300:
            raise OIDCProviderUnavailableError("OIDC discovery failed.")
        payload = _json_object(response)

        issuer = _required_string(payload, "issuer")
        if not secrets_match(issuer, self._settings.oidc_issuer):
            raise OIDCProviderUnavailableError(
                "OIDC discovery issuer does not match configuration."
            )
        authorization_endpoint = _required_string(payload, "authorization_endpoint")
        token_endpoint = _required_string(payload, "token_endpoint")
        jwks_uri = _required_string(payload, "jwks_uri")
        supported = payload.get("id_token_signing_alg_values_supported")
        if not isinstance(supported, list) or not all(isinstance(item, str) for item in supported):
            raise OIDCProviderUnavailableError("OIDC discovery signing algorithms are invalid.")

        allow_local_http = self._settings.app_environment == "local"
        for endpoint in (authorization_endpoint, token_endpoint, jwks_uri):
            try:
                _validate_https_url(endpoint, allow_local_http=allow_local_http)
            except OIDCConfigurationError as error:
                raise OIDCProviderUnavailableError(
                    "OIDC discovery returned an unsafe endpoint."
                ) from error

        supported_algorithms = frozenset(cast(list[str], supported))
        if not supported_algorithms.intersection(
            self._settings.oidc_allowed_signing_algorithm_list
        ):
            raise OIDCProviderUnavailableError("OIDC provider has no approved signing algorithm.")
        metadata = OIDCProviderMetadata(
            issuer=issuer,
            authorization_endpoint=authorization_endpoint,
            token_endpoint=token_endpoint,
            jwks_uri=jwks_uri,
            signing_algorithms=supported_algorithms,
        )
        with self._cache_lock:
            self._metadata = (monotonic() + _DISCOVERY_CACHE_SECONDS, metadata)
        return metadata

    def _get_jwks(self, metadata: OIDCProviderMetadata, *, force: bool = False) -> dict[str, Any]:
        now = monotonic()
        with self._cache_lock:
            if not force and self._jwks is not None and self._jwks[0] > now:
                return self._jwks[1]

        try:
            response = self._http.get(metadata.jwks_uri, headers={"Accept": "application/json"})
        except (httpx.HTTPError, httpx.InvalidURL) as error:
            raise OIDCProviderUnavailableError("OIDC signing-key request failed.") from error
        if response.status_code < 200 or response.status_code >= 300:
            raise OIDCProviderUnavailableError("OIDC signing-key request failed.")
        payload = _json_object(response)
        keys = payload.get("keys")
        if (
            not isinstance(keys, list)
            or not keys
            or not all(isinstance(item, dict) for item in keys)
        ):
            raise OIDCProviderUnavailableError("OIDC signing-key response is invalid.")
        with self._cache_lock:
            self._jwks = (monotonic() + _JWKS_CACHE_SECONDS, payload)
        return payload

    def _select_signing_key(
        self,
        *,
        jwks: dict[str, Any],
        key_id: str | None,
        algorithm: str,
    ) -> jwt.PyJWK | None:
        raw_keys = cast(list[dict[str, Any]], jwks["keys"])
        matches: list[dict[str, Any]] = []
        for raw_key in raw_keys:
            if key_id is not None and raw_key.get("kid") != key_id:
                continue
            if key_id is None and len(raw_keys) != 1:
                continue
            if raw_key.get("use") not in {None, "sig"}:
                continue
            if raw_key.get("alg") not in {None, algorithm}:
                continue
            matches.append(raw_key)
        if len(matches) != 1:
            return None
        try:
            return jwt.PyJWK.from_dict(matches[0], algorithm=algorithm)
        except (jwt.PyJWTError, ValueError, TypeError):
            return None

    def _verify_id_token(
        self,
        id_token: str,
        *,
        expected_nonce: str,
        metadata: OIDCProviderMetadata,
    ) -> VerifiedOIDCIdentity:
        try:
            header = jwt.get_unverified_header(id_token)
        except jwt.PyJWTError as error:
            raise InvalidOIDCLoginError("ID token header is invalid.") from error
        algorithm = header.get("alg")
        key_id = header.get("kid")
        if (
            not isinstance(algorithm, str)
            or algorithm not in self._settings.oidc_allowed_signing_algorithm_list
            or algorithm not in metadata.signing_algorithms
            or (key_id is not None and not isinstance(key_id, str))
        ):
            raise InvalidOIDCLoginError("ID token signing algorithm is invalid.")

        jwks = self._get_jwks(metadata)
        signing_key = self._select_signing_key(
            jwks=jwks,
            key_id=key_id,
            algorithm=algorithm,
        )
        if signing_key is None:
            jwks = self._get_jwks(metadata, force=True)
            signing_key = self._select_signing_key(
                jwks=jwks,
                key_id=key_id,
                algorithm=algorithm,
            )
        if signing_key is None:
            raise InvalidOIDCLoginError("ID token signing key is unavailable.")

        try:
            raw_claims = jwt.decode(
                id_token,
                key=signing_key.key,
                algorithms=[algorithm],
                audience=self._settings.oidc_client_id,
                issuer=self._settings.oidc_issuer,
                leeway=self._settings.oidc_clock_skew_seconds,
                options={
                    "require": ["iss", "sub", "aud", "exp", "iat", "nonce", "email"],
                    "verify_signature": True,
                    "verify_aud": True,
                    "verify_iss": True,
                    "verify_exp": True,
                    "verify_iat": True,
                    "verify_nbf": True,
                },
            )
        except jwt.PyJWTError as error:
            raise InvalidOIDCLoginError("ID token validation failed.") from error
        claims = raw_claims

        nonce = claims.get("nonce")
        if not isinstance(nonce, str) or not secrets_match(nonce, expected_nonce):
            raise InvalidOIDCLoginError("ID token nonce is invalid.")

        audiences = claims.get("aud")
        audience_list = [audiences] if isinstance(audiences, str) else audiences
        if (
            not isinstance(audience_list, list)
            or not audience_list
            or not all(isinstance(item, str) for item in audience_list)
        ):
            raise InvalidOIDCLoginError("ID token audience is invalid.")
        authorized_party = claims.get("azp")
        if len(audience_list) > 1 and authorized_party != self._settings.oidc_client_id:
            raise InvalidOIDCLoginError("ID token authorized party is invalid.")
        if authorized_party is not None and authorized_party != self._settings.oidc_client_id:
            raise InvalidOIDCLoginError("ID token authorized party is invalid.")

        subject = claims.get("sub")
        email = claims.get("email")
        if not isinstance(subject, str) or not subject or len(subject) > 255:
            raise InvalidOIDCLoginError("ID token subject is invalid.")
        normalized_email = email.strip().casefold() if isinstance(email, str) else ""
        if (
            not normalized_email
            or len(normalized_email) > 320
            or normalized_email.startswith("@")
            or normalized_email.endswith("@")
            or normalized_email.count("@") != 1
            or any(
                character.isspace() or unicodedata.category(character).startswith("C")
                for character in normalized_email
            )
        ):
            raise InvalidOIDCLoginError("ID token email is invalid.")
        if claims.get("email_verified") is not True:
            raise InvalidOIDCLoginError("ID token email is not verified.")

        raw_name = claims.get("name")
        suggested_name = raw_name.strip() if isinstance(raw_name, str) else ""
        if (
            not suggested_name
            or len(suggested_name) > 120
            or any(unicodedata.category(character).startswith("C") for character in suggested_name)
        ):
            suggested_name = "New cook"
        return VerifiedOIDCIdentity(
            issuer=self._settings.oidc_issuer,
            subject=subject,
            email=normalized_email,
            email_verified=True,
            suggested_display_name=suggested_name,
        )
