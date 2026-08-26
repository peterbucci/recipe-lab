# Abuse controls

Recipe Lab applies durable fixed-window limits before account authentication and
member write operations reach their endpoint handlers. The protected operations
are OIDC login/account creation, private draft creation and mutation, fork-capable
draft creation, publication, recipe reports and moderator decisions, and
save/rate/view interactions.

Every protected request increments a canonical network bucket. Authenticated
member requests also increment an account bucket. After an OIDC token has been
verified, the callback increments a separate issuer-and-subject identity bucket
before it creates an account or issues another session. That identity bucket
protects the first-account path where no local user ID exists yet.

The network, identity, and account subject values are HMAC-SHA-256 digests made
with `ABUSE_RATE_LIMIT_SECRET`; raw IP addresses, OIDC subjects, and user IDs are
not stored in the bucket key. IPv4 addresses are grouped at `/24` and IPv6
addresses at `/56`. The application uses the ASGI client address and does not
trust a caller-supplied forwarding header. The self-hosted Next.js server is the
trusted public boundary: it deletes `Forwarded`, `X-Forwarded-For`, `X-Real-IP`,
and any caller-provided internal signal, derives a canonical network from the
accepted socket, and signs a short-lived signal bound to the HTTP method and
path. The same-origin route verifies that signal before forwarding it, and the
backend verifies it again before using the network. Invalid or expired signals
fall back conservatively to the backend socket network. Direct backend requests
therefore retain safe socket-derived behavior, while proxied clients do not all
collapse into the frontend container network.

`INTERNAL_NETWORK_SIGNAL_SECRET` is shared only by the frontend and backend and
is required outside local development. It must not be exposed to the browser or
reused as `ABUSE_RATE_LIMIT_SECRET`. Raw network values exist only in the
short-lived internal request header; the database stores only the HMAC-derived
rate-limit subject, and application logs do not record the signal or request
headers.

## Intentional transaction boundary

Rate counters are atomically incremented in PostgreSQL and committed by the
router dependency **before** endpoint work begins. This is deliberate: validation
failures, authorization failures, conflicts, and later endpoint rollbacks cannot
erase the abuse-control evidence. Endpoint data starts in a new transaction.
This also means rate-limit counters are operational evidence, not part of the
domain write being attempted.

Exceeded limits return the standard private error envelope with HTTP `429`, code
`rate_limit_exceeded`, and an integer `Retry-After` header. If the durable counter
cannot be recorded, protected writes fail closed with HTTP `503` and code
`abuse_protection_unavailable`.

## Request size

`MAX_REQUEST_BODY_BYTES` limits raw request bodies before routing, validation, or
logging. The ASGI middleware checks both a declared `Content-Length` and the bytes
actually received, so chunked/streamed bodies cannot bypass the limit. Oversized
requests return HTTP `413` with code `request_body_too_large`. Request bodies are
never included in rate-limit or size-limit logs.

All window lengths and per-operation limits are configurable through the
`ABUSE_RATE_LIMIT_*` settings documented in `.env.example`. Production startup
rejects the documented local secret, and every configured secret must contain at
least 32 characters.
