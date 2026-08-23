import base64
import hashlib
import hmac
import re
import secrets
from urllib.parse import urlsplit

OPAQUE_TOKEN_BYTES = 32
PKCE_VERIFIER_BYTES = 64
AUTH_SESSION_COOKIE_NAME = "recipe_lab_session"
AUTH_CSRF_COOKIE_NAME = "recipe_lab_csrf"
AUTH_LOGIN_COOKIE_NAME = "recipe_lab_login"
_SHA256_HEX_RE = re.compile(r"^[0-9a-f]{64}$")


def generate_opaque_token() -> str:
    """Return a 256-bit URL-safe bearer token."""

    return secrets.token_urlsafe(OPAQUE_TOKEN_BYTES)


def generate_pkce_verifier() -> str:
    """Return an RFC 7636 verifier between 43 and 128 unreserved characters."""

    return secrets.token_urlsafe(PKCE_VERIFIER_BYTES)


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def is_sha256_digest(value: str) -> bool:
    return _SHA256_HEX_RE.fullmatch(value) is not None


def secrets_match(left: str, right: str) -> bool:
    return hmac.compare_digest(left.encode("utf-8"), right.encode("utf-8"))


def pkce_s256_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def validate_return_path(value: str) -> str:
    """Accept only a local absolute path, never an origin-changing redirect."""

    if len(value) > 2048 or not value.startswith("/") or value.startswith("//"):
        raise ValueError("Return path must be a local absolute path.")
    if "\\" in value or any(ord(character) < 0x20 for character in value):
        raise ValueError("Return path contains unsupported characters.")

    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc:
        raise ValueError("Return path must not include an origin.")
    return value


def normalize_origin(value: str) -> str:
    """Return the serialized HTTP origin or reject paths and credentials."""

    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or parsed.hostname is None
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Expected an HTTP origin without a path.")

    scheme = parsed.scheme.casefold()
    hostname = parsed.hostname.casefold()
    try:
        port = parsed.port
    except ValueError as error:
        raise ValueError("Origin contains an invalid port.") from error
    default_port = (scheme == "http" and port == 80) or (scheme == "https" and port == 443)
    serialized_host = f"[{hostname}]" if ":" in hostname else hostname
    authority = serialized_host if port is None or default_port else f"{serialized_host}:{port}"
    return f"{scheme}://{authority}"
