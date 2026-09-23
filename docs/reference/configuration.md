# Configuration Reference

This document is the reference for Recipe Lab's maintained environment configuration.

It describes:

- which service owns each setting;
- the development default, when one exists;
- whether production must override it;
- important validation or fallback behavior; and
- settings used only by Docker Compose or tests.

For setup instructions, see [Development](../development.md). For production runtime procedures, see [Operations](../operations.md). Security-sensitive behavior is explained in [Security](../security.md).

## Configuration sources

The main configuration sources are:

```text
.env.example
    example local values and the maintained cross-service variable inventory

backend/app/core/config.py
    backend runtime defaults, validation, and typed setting groups

frontend/server/runtime-config.mjs
frontend/server/trusted-network-signal.mjs
    frontend production-runtime validation

compose.yaml
    local container wiring and Compose-only PostgreSQL settings
```

The application should receive production secrets through the deployment platform's secret/configuration system, not through committed files or Docker build arguments.

## Environment modes

### `APP_ENVIRONMENT`

**Owner:** backend and frontend runtime  
**Allowed values:** `local`, `test`, `production`  
**Development default:** `local`

`APP_ENVIRONMENT` controls behavior that should differ by deployment class.

Important effects include:

- backend session cookies are secure outside `local`;
- production rejects the checked-in local abuse/network secrets;
- the production frontend server requires `APP_ENVIRONMENT=production`; and
- the production backend launcher also requires `APP_ENVIRONMENT=production`.

The production Docker images set this value to `production`.

Do not use `NODE_ENV` as a replacement for this application-level distinction. The frontend launcher manages `NODE_ENV` itself.

---

# Database

## `DATABASE_URL`

**Owner:** backend  
**Development default:**

```text
postgresql+psycopg://recipe_lab:recipe_lab@localhost:5432/recipe_lab
```

SQLAlchemy connection URL for the application database.

When the backend runs in Compose, `compose.yaml` constructs this value using the `db` service hostname rather than the host-local URL from `.env.example`.

Production must provide the deployment database URL through private runtime configuration.

## `DATABASE_OPERATION_TIMEOUT_SECONDS`

**Owner:** backend  
**Default:** `5`  
**Allowed range:** `1`–`30` seconds

Bounds database operations that use the application's database timeout policy, including readiness-related database work.

This is not a substitute for infrastructure-level database availability or connection-pool controls.

---

# HTTP and request boundaries

## `CORS_ORIGINS`

**Owner:** backend  
**Development default:**

```text
http://localhost:3000,http://127.0.0.1:3000
```

Comma-separated browser origins accepted by the backend CORS configuration.

Production should list only the intended frontend origin(s).

## `MAX_REQUEST_BODY_BYTES`

**Owner:** backend  
**Default:** `2097152` (2 MiB)  
**Allowed range:** `1024`–`16777216` bytes

Maximum request-body size accepted by the backend request-size middleware.

Increase this only for a demonstrated product requirement.

---

# Application sessions

## `AUTH_ALLOWED_ORIGINS`

**Owner:** backend authentication/CSRF boundary  
**Development default in `.env.example`:**

```text
http://localhost:3000,http://127.0.0.1:3000
```

Comma-separated origins allowed for authenticated state-changing requests.

If this value is empty, the backend falls back to `CORS_ORIGINS`.

In production, keep this set as narrowly as possible to the actual application origin(s).

## `AUTH_SESSION_TTL_SECONDS`

**Owner:** backend sessions  
**Default:** `1209600` (14 days)  
**Minimum:** `60`

Lifetime of a normal Recipe Lab application session.

## `AUTH_SESSION_TOUCH_INTERVAL_SECONDS`

**Owner:** backend sessions  
**Default:** `300` (5 minutes)  
**Allowed range:** `0`–`86400`

Minimum interval between persisted session last-seen updates.

`0` permits every eligible session resolution to update the timestamp; larger values reduce write frequency.

## `AUTH_RECENT_TTL_SECONDS`

**Owner:** backend authentication/account lifecycle  
**Default:** `600` (10 minutes)  
**Allowed range:** `60`–`3600`

Window during which provider-backed authentication is considered recent enough for sensitive account-lifecycle operations.

If recent authentication is no longer sufficient, the frontend sends the member through the reauthentication flow instead of weakening this requirement.

---

# Hosted OpenID Connect

Recipe Lab uses generic hosted OpenID Connect Authorization Code + PKCE.

Hosted sign-in is not usable until the required provider configuration is supplied.

## `OIDC_ISSUER`

**Owner:** backend OIDC client  
**Development default:** empty

Issuer URL used for provider discovery and token validation.

Required for a working hosted sign-in configuration.

## `OIDC_CLIENT_ID`

**Owner:** backend OIDC client  
**Development default:** empty

OIDC client identifier registered with the provider.

Required for a working hosted sign-in configuration.

## `OIDC_CLIENT_SECRET`

**Owner:** backend OIDC client  
**Default:** absent

Optional client secret.

An empty string is normalized to no secret.

Whether a secret is required depends on the provider/client registration. Do not invent a placeholder secret for a public PKCE client.

## `OIDC_REDIRECT_URI`

**Owner:** backend OIDC workflow  
**Backend model default:** empty  
**Compose/local example:**

```text
http://localhost:3000/api/auth/callback
```

Callback URI sent to the provider.

It must exactly match an allowed callback registered with the provider.

## `OIDC_SCOPES`

**Owner:** backend OIDC client  
**Default:**

```text
openid email profile
```

Whitespace-separated scopes requested during sign-in.

Duplicate scopes are removed while preserving order.

## `OIDC_ALLOWED_SIGNING_ALGORITHMS`

**Owner:** backend OIDC token validation  
**Default:** `RS256`

Comma-separated list of accepted ID-token signing algorithms.

Keep this constrained to algorithms explicitly supported by the configured identity provider.

## `OIDC_LOGIN_TTL_SECONDS`

**Owner:** backend OIDC transaction state  
**Default:** `600`  
**Allowed range:** `60`–`3600`

Lifetime of the temporary login transaction used for state, nonce, PKCE, and return-path binding.

## `OIDC_HTTP_TIMEOUT_SECONDS`

**Owner:** backend OIDC client  
**Default:** `5`  
**Allowed range:** greater than `0`, up to `30`

Timeout for provider discovery, keys, and token-related HTTP requests.

## `OIDC_CLOCK_SKEW_SECONDS`

**Owner:** backend OIDC token validation  
**Default:** `30`  
**Allowed range:** `0`–`300`

Permitted clock skew when validating time-based OIDC claims.

---

# Abuse controls and trusted network signaling

Recipe Lab uses one secret to pseudonymize rate-limit subjects and a separate secret to authenticate the frontend-to-backend coarse network signal.

The two secrets must be different private random values in production.

## `ABUSE_RATE_LIMIT_SECRET`

**Owner:** backend abuse controls  
**Local default:**

```text
recipe-lab-local-development-rate-limit-secret
```

**Minimum length:** 32 characters

Used when deriving privacy-preserving abuse-control subject identifiers.

Production rejects the checked-in local default.

## `INTERNAL_NETWORK_SIGNAL_SECRET`

**Owner:** frontend runtime and backend abuse controls  
**Local default:**

```text
recipe-lab-local-internal-network-signal-secret
```

**Minimum length:** 32 characters

Shared HMAC secret used to authenticate the coarse network signal created by the trusted frontend server before the request reaches the backend.

Production frontend startup fails when this is missing, too short, or still set to the local default. The backend applies equivalent production checks.

The same private value must be supplied to both services.

## `INTERNAL_NETWORK_SIGNAL_TTL_SECONDS`

**Owner:** backend verification of the trusted signal  
**Default:** `30`  
**Allowed range:** `5`–`300`

Maximum age accepted for a signed frontend network signal.

## `TRUSTED_PROXY_CIDRS`

**Owner:** frontend runtime

**Default:** empty; no forwarding headers are trusted

Optional comma-separated direct-peer allowlist for a reviewed reverse proxy. Entries must be exact IPv4/IPv6 addresses or canonical CIDRs with no host bits. CIDRs are deliberately bounded to IPv4 `/16` or narrower and IPv6 `/64` or narrower.

This setting has no effect by itself. `TRUSTED_PROXY_PROOF_SECRET` must be configured at the same time. The frontend accepts the final `X-Forwarded-For` hop only when it is a valid bare IP, the direct socket peer matches this allowlist, **and** the proof header matches. It never scans leftward past a malformed final hop because earlier values can be caller-supplied. It otherwise derives the client network from the direct peer, preserving the secure default used by direct and local deployments.

Keep the allowlist as narrow as the proxy topology permits. Prefer the exact proxy address; use its narrow private container-network CIDR only when that address is not stable.

## `TRUSTED_PROXY_PROOF_SECRET`

**Owner:** frontend runtime and the immediately adjacent reverse proxy

**Default:** empty; proxy trust is disabled

**Required format:** exactly 64 lowercase hexadecimal characters generated from 32 random bytes

Shared proof used only to authenticate the final reverse-proxy hop. The proxy must overwrite `X-Recipe-Lab-Proxy-Proof` on every request with this value; it must not preserve a caller-supplied value. The frontend compares it in constant time and strips the proof plus every forwarding header before Next.js or the backend handles the request.

`TRUSTED_PROXY_CIDRS` and `TRUSTED_PROXY_PROOF_SECRET` must either both be absent/empty or both be valid. A partial or malformed configuration prevents frontend startup. Store the proof in the deployment secret store; do not put it in Git, command-line arguments, logs, or public proxy labels.

## `SANDBOX_SUPERVISOR_HEARTBEAT_PATH`

**Owner:** frontend runtime in the portfolio sandbox

**Default:** empty; supervisor gating is disabled

Optional path to the supervisor heartbeat used to gate `/readyz`. When enabled,
the only accepted value is:

```text
/run/recipe-lab-supervisor/heartbeat
```

The deployment mounts that single regular file read-only into the frontend
container. The frontend checks file metadata only; it does not parse file
contents. A missing, non-regular, stale, or implausibly future-dated heartbeat
makes readiness fail closed without contacting the backend.

## `SANDBOX_SUPERVISOR_HEARTBEAT_TTL_SECONDS`

**Owner:** frontend runtime in the portfolio sandbox

**Default:** empty; supervisor gating is disabled

**Allowed range:** `1`–`300` seconds

**Portfolio sandbox value:** `30`

Maximum age of the supervisor heartbeat accepted by `/readyz`.
`SANDBOX_SUPERVISOR_HEARTBEAT_PATH` and
`SANDBOX_SUPERVISOR_HEARTBEAT_TTL_SECONDS` must either both be absent/empty or
both be valid. The normal local and persistent deployment defaults remain
unchanged when both are empty.

---

# Rate-limit window and thresholds

## `ABUSE_RATE_LIMIT_WINDOW_SECONDS`

**Owner:** backend abuse controls  
**Default:** `60`  
**Allowed range:** `1`–`3600`

Window used by the configured abuse counters.

The remaining abuse settings are maximum attempts/counts within the configured window.

Each accepts values from `1` to `100000`.

| Variable                               | Default | Subject / workflow                                |
| -------------------------------------- | ------: | ------------------------------------------------- |
| `ABUSE_RATE_LIMIT_AUTH_NETWORK`        |   `120` | Authentication attempts by coarse network         |
| `ABUSE_RATE_LIMIT_AUTH_IDENTITY`       |    `30` | Authentication attempts by pseudonymized identity |
| `ABUSE_RATE_LIMIT_DRAFT_ACCOUNT`       |   `120` | Draft activity by account                         |
| `ABUSE_RATE_LIMIT_DRAFT_NETWORK`       |   `600` | Draft activity by network                         |
| `ABUSE_RATE_LIMIT_FORK_ACCOUNT`        |    `30` | Adaptation/fork starts by account                 |
| `ABUSE_RATE_LIMIT_FORK_NETWORK`        |   `120` | Adaptation/fork starts by network                 |
| `ABUSE_RATE_LIMIT_PUBLICATION_ACCOUNT` |    `30` | Publication attempts by account                   |
| `ABUSE_RATE_LIMIT_PUBLICATION_NETWORK` |   `120` | Publication attempts by network                   |
| `ABUSE_RATE_LIMIT_REPORT_ACCOUNT`      |    `30` | Recipe reports by account                         |
| `ABUSE_RATE_LIMIT_REPORT_NETWORK`      |   `120` | Recipe reports by network                         |
| `ABUSE_RATE_LIMIT_INTERACTION_ACCOUNT` |   `600` | Save/rating/view interaction activity by account  |
| `ABUSE_RATE_LIMIT_INTERACTION_NETWORK` |  `2400` | Save/rating/view interaction activity by network  |

These are security controls, not user-facing quotas.

Changes should be based on observed aggregate behavior and reviewed alongside the abuse-control policy in [Security](../security.md).

---

# Recommendation bounds

These settings apply to the deterministic online recommendation research preview.

## `RECOMMENDATION_MAX_CANDIDATES`

**Owner:** backend recommendation repository/service  
**Default:** `2000`  
**Allowed range:** `50`–`50000`

Maximum bounded candidate shortlist considered by the online scorer.

## `RECOMMENDATION_MAX_PROFILE_RECORDS`

**Owner:** backend recommendation repository/service  
**Default:** `5000`  
**Allowed range:** `50`–`100000`

Maximum number of strongest/recent profile records loaded for personalized scoring.

These settings bound serving work; they do not configure the offline evaluator.

See [Recommendations](../recommendations.md).

---

# Frontend backend origin

## `RECIPE_API_URL`

**Owner:** frontend server/runtime  
**Local direct-run default:** `http://localhost:8000`  
**Compose value:** `http://backend:8000`  
**Production:** required

Backend origin used by server-side frontend code and the same-origin proxy.

The production frontend validates that the value is an HTTP(S) **origin only**:

- no username/password;
- no path other than `/`;
- no query; and
- no fragment.

Example:

```text
https://api.example.com
```

The production frontend server refuses to start without this setting.

## `NEXT_PUBLIC_API_URL`

**Owner:** legacy frontend server fallback  
**Example value:** `http://localhost:8000`

This is a compatibility setting from the earlier browser-visible API configuration.

Current browser mutations use the frontend's same-origin `/api` proxy.

Server-side API resolution still falls back in this order:

```text
RECIPE_API_URL
→ NEXT_PUBLIC_API_URL
→ http://localhost:8000
```

The production runtime launcher itself requires `RECIPE_API_URL`, so `NEXT_PUBLIC_API_URL` is not the production server authority.

Do not add new browser code that depends on this value.

Its eventual removal is a compatibility decision rather than an automatic cleanup.

---

# Process ports

## `PORT`

**Owner:** production process launcher  
**Backend default:** `8000`  
**Frontend default:** `3000`  
**Allowed range:** `1`–`65535`

Both production launchers accept the standard `PORT` environment variable.

The backend production server binds to `0.0.0.0:<PORT>`.

The frontend custom Next.js server also uses `PORT`, unless an explicit `--port` command-line argument is supplied.

The production Docker images set their normal defaults to `8000` and `3000` respectively.

`PORT` is intentionally not part of the shared `.env.example` because local Compose exposes the conventional service ports directly.

---

# Docker Compose PostgreSQL settings

The following settings configure the **local Compose database service**. They are not backend application settings.

## `POSTGRES_IMAGE`

**Owner:** Docker Compose  
**Default:** reviewed PostgreSQL 17 Alpine image with an exact digest

The maintained example currently uses:

```text
postgres:17.11-alpine@sha256:7456ef82e5f5bc43d997f4781bbd7c0d6389bff397564649a356e206ba473aee
```

Update the tag and digest together after review. Do not replace the digest-pinned value with `latest`.

## `POSTGRES_DB`

**Owner:** Docker Compose  
**Default:** `recipe_lab`

Database created by the local PostgreSQL container.

## `POSTGRES_USER`

**Owner:** Docker Compose  
**Default:** `recipe_lab`

Local PostgreSQL user.

## `POSTGRES_PASSWORD`

**Owner:** Docker Compose  
**Development default:** `recipe_lab`

Local development password.

Use a real private credential outside local development.

## `POSTGRES_PORT`

**Owner:** Docker Compose host mapping  
**Default:** `5432`

Host port mapped to PostgreSQL's container port 5432.

Changing this does not automatically change a host-run `DATABASE_URL`; update that URL separately.

---

# Test configuration

## `TEST_DATABASE_URL`

**Owner:** backend/ML tests  
**Example default in `.env.example`:**

```text
postgresql+psycopg://recipe_lab:recipe_lab@localhost:5432/recipe_lab
```

Database connection used by tests that create isolated schemas or temporary test state.

It must point to a local or otherwise disposable database.

Do not point `TEST_DATABASE_URL` at production.

The backend test suite creates and removes uniquely named schemas inside the configured test database.

---

# Settings derived by the application

These values are derived from the settings above rather than configured independently.

## Secure session cookies

The backend derives:

```text
cookie_secure = APP_ENVIRONMENT != "local"
```

There is no separate `AUTH_COOKIE_SECURE` setting.

## Authentication allowed-origin fallback

If `AUTH_ALLOWED_ORIGINS` is empty:

```text
AUTH_ALLOWED_ORIGINS = CORS_ORIGINS
```

Conceptually, the authentication/CSRF boundary remains separate even when it inherits the same local values.

## OIDC scope parsing

`OIDC_SCOPES` is parsed as whitespace-separated values and duplicate scopes are removed.

## OIDC signing-algorithm parsing

`OIDC_ALLOWED_SIGNING_ALGORITHMS` is parsed as comma-separated values.

---

# Values managed internally, not normal configuration

Several process variables appear in runtime files but should not be treated as normal Recipe Lab settings.

## `NODE_ENV`

The frontend launcher sets this to `development` or `production` according to how the server is started.

Use `APP_ENVIRONMENT` for Recipe Lab's application environment semantics.

## `NEXT_TELEMETRY_DISABLED`

The frontend production image sets this during build/runtime to disable Next.js telemetry.

It is image/runtime hygiene rather than a product configuration surface.

## `PYTHONDONTWRITEBYTECODE`, `PYTHONUNBUFFERED`, and uv settings

The backend Dockerfile configures these for the Python/container runtime.

They are implementation details of the image, not deployment options expected from operators.

---

# Where `.env` is loaded

Environment loading differs by execution mode.

## Docker Compose

Compose reads the root `.env` for variable substitution into `compose.yaml`.

That is the normal local all-container workflow.

## Backend run directly

Backend settings use Pydantic Settings with:

```text
env_file=".env"
```

That path is relative to the backend process working directory.

When you start the backend from `backend/`, the repository-root `.env` is not automatically loaded as `backend/.env`.

Either:

- export the needed environment variables into the process; or
- create a separate ignored `backend/.env`.

See [Development](../development.md) for the normal direct-run workflow.

## Frontend run directly

The custom frontend server uses Next's environment loader from the frontend process working directory.

Normal frontend development therefore follows Next.js environment loading conventions within `frontend/`.

---

# Production requirements

At minimum, a persistent production deployment should deliberately provide:

```text
APP_ENVIRONMENT=production

DATABASE_URL=<private production PostgreSQL URL>

CORS_ORIGINS=<trusted frontend origin(s)>
AUTH_ALLOWED_ORIGINS=<trusted authenticated origin(s)>

ABUSE_RATE_LIMIT_SECRET=<private random secret, at least 32 characters>
INTERNAL_NETWORK_SIGNAL_SECRET=<private random secret, at least 32 characters>

RECIPE_API_URL=<backend HTTP(S) origin>
```

A deployment behind a reverse proxy that needs forwarded client-network attribution must also provide both:

```text
TRUSTED_PROXY_CIDRS=<exact proxy IP or narrow canonical proxy CIDR>
TRUSTED_PROXY_PROOF_SECRET=<64-character lowercase-hex secret generated from 32 random bytes>
```

Leave both unset when forwarded attribution is not required.

The ephemeral portfolio sandbox additionally enables supervisor liveness
gating with:

```text
SANDBOX_SUPERVISOR_HEARTBEAT_PATH=/run/recipe-lab-supervisor/heartbeat
SANDBOX_SUPERVISOR_HEARTBEAT_TTL_SECONDS=30
```

Other deployment classes leave both settings unset.

A deployment that supports member sign-in must also provide a valid OIDC configuration:

```text
OIDC_ISSUER
OIDC_CLIENT_ID
OIDC_REDIRECT_URI
```

and `OIDC_CLIENT_SECRET` when required by that provider/client registration.

The default local abuse/network secrets are rejected in production.

The production frontend refuses to start without `RECIPE_API_URL` and a valid private internal network-signal secret.

The production backend launcher refuses to start unless `APP_ENVIRONMENT=production`.

Production credentials should come from the deployment secret store and should not be written to:

- Git;
- `.env.example`;
- Dockerfiles;
- Docker build arguments;
- CI logs; or
- generated artifacts.

---

# Changing configuration

When adding a new setting:

1. Put it in the service that owns the behavior.
2. Give it a type and bounds/defaults where appropriate.
3. Add it to `.env.example` when a developer/operator is expected to configure it.
4. Wire it through Compose only when local containers need it.
5. Add production validation when an unsafe default must not reach production.
6. Update this reference.
7. Add focused configuration tests.
8. Update Operations or Security only when the setting changes an operational or security procedure.

Avoid introducing two names for the same setting unless a real compatibility requirement exists.

When removing a setting, search:

- application source;
- Dockerfiles;
- Compose;
- CI/release workflows;
- Playwright configuration;
- scripts;
- current documentation; and
- compatibility metadata.

A setting that is unused by the current product may still be part of a supported local, release, or compatibility workflow.

---

# Quick lookup

| Area                    | Main settings                                                                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Environment             | `APP_ENVIRONMENT`, `PORT`                                                                                                                                                                                      |
| PostgreSQL/backend      | `DATABASE_URL`, `DATABASE_OPERATION_TIMEOUT_SECONDS`                                                                                                                                                           |
| Browser origins         | `CORS_ORIGINS`, `AUTH_ALLOWED_ORIGINS`                                                                                                                                                                         |
| Sessions                | `AUTH_SESSION_TTL_SECONDS`, `AUTH_SESSION_TOUCH_INTERVAL_SECONDS`, `AUTH_RECENT_TTL_SECONDS`                                                                                                                   |
| Request bounds          | `MAX_REQUEST_BODY_BYTES`                                                                                                                                                                                       |
| OIDC                    | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `OIDC_SCOPES`, `OIDC_ALLOWED_SIGNING_ALGORITHMS`, `OIDC_LOGIN_TTL_SECONDS`, `OIDC_HTTP_TIMEOUT_SECONDS`, `OIDC_CLOCK_SKEW_SECONDS` |
| Abuse/network           | `ABUSE_RATE_LIMIT_SECRET`, `INTERNAL_NETWORK_SIGNAL_SECRET`, `INTERNAL_NETWORK_SIGNAL_TTL_SECONDS`, `ABUSE_RATE_LIMIT_*`                                                                                       |
| Reverse-proxy trust     | `TRUSTED_PROXY_CIDRS`, `TRUSTED_PROXY_PROOF_SECRET`                                                                                                                                                           |
| Sandbox supervision     | `SANDBOX_SUPERVISOR_HEARTBEAT_PATH`, `SANDBOX_SUPERVISOR_HEARTBEAT_TTL_SECONDS`                                                                                                                               |
| Recommendations         | `RECOMMENDATION_MAX_CANDIDATES`, `RECOMMENDATION_MAX_PROFILE_RECORDS`                                                                                                                                          |
| Frontend backend origin | `RECIPE_API_URL`, compatibility `NEXT_PUBLIC_API_URL`                                                                                                                                                          |
| Local Compose DB        | `POSTGRES_IMAGE`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`                                                                                                                         |
| Tests                   | `TEST_DATABASE_URL`                                                                                                                                                                                            |

The executable configuration remains authoritative. If this reference disagrees with `backend/app/core/config.py`, the frontend runtime validators, or `compose.yaml`, fix the documentation rather than treating this file as an alternate configuration source.
