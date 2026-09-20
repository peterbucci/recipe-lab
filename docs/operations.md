# Operations

Recipe Lab has three deliberately separate runtime profiles. Do not reuse one
profile's data, credentials, cleanup command, or recovery procedure in another.

| Profile | Purpose | Storage and identity |
| --- | --- | --- |
| Local development | Persistent developer workflow through Docker Compose or host processes | Named PostgreSQL volume; optional hosted OIDC configuration |
| Production image | Hardened deployable artifacts and release rehearsal | Platform-owned database and secrets; no development tools in images |
| Portfolio sandbox | Public, temporary product demonstration | Fresh generation-bound tmpfs database; temporary accounts; no backup or durable content store |

Local startup and dependency work are in [Development](development.md).
Security, privacy, and retention rules are in [Security](security.md). Restore
and rollback procedures are in [Recovery](reference/recovery.md).

## Local development profile

`compose.yaml` builds the development targets and publishes PostgreSQL, backend,
and frontend on ports 5432, 8000, and 3000 by default. It is not a deployment
manifest. The root `.env.example` is its only environment template and contains
local placeholders that production startup rejects.

Use `docker compose down` to stop this profile without deleting data. Add
`--volumes --remove-orphans` only when its database and generated frontend
volumes are intentionally disposable. Compose cleanup does not own sandbox
resources, and sandbox cleanup must not target Compose resources.

## Locked dependencies

The root `pyproject.toml` and `uv.lock` bind the backend and offline-research
packages into one Python workspace. CI requires `uv` 0.12.6 and checks the lock
before a frozen package sync. Production builds use `uv sync --locked` and do
not resolve a package graph at image runtime.

`frontend/package-lock.json` is the frontend dependency authority. CI and image
builds use `npm ci`. There is no member-local Python lock or alternate npm
dependency source.

External GitHub Actions are pinned to full commit SHAs, runner images and
language runtimes are versioned, and container bases use reviewed SHA-256
digests. Base tag and digest changes belong in one review. Production stages do
not run a mutable operating-system upgrade; security fixes arrive through a new
reviewed base digest and a complete rebuild/scan.

`python scripts/verify_repository_policy.py` audits these rules. It reports
drift but never updates a pin or allowlist.

## Production images

Both Dockerfiles expose explicit `development` and `production` targets. The
backend production build needs the repository root context because it consumes
the shared Python workspace; the frontend uses its own context:

```powershell
docker build --pull --no-cache --target production `
  --file backend/Dockerfile `
  --tag recipe-lab-backend:local .

docker build --pull --no-cache --target production `
  --file frontend/Dockerfile `
  --tag recipe-lab-frontend:local frontend
```

The runtime images use non-root users and omit tests, acceptance harnesses,
development dependencies, package managers/build tools, caches, coverage,
browser output, environment files, and source credentials. Runtime secrets are
injected by the deployment environment, never build arguments, Dockerfile
defaults, labels, or committed production environment files.

Verify the complete boundary with the checked-in gate:

```powershell
python scripts/verify_production_images.py `
  --backend-image recipe-lab-backend:local `
  --frontend-image recipe-lab-frontend:local `
  --backend-context . `
  --backend-dockerfile backend/Dockerfile `
  --frontend-context frontend `
  --frontend-dockerfile frontend/Dockerfile
```

The verifier performs clean production-target builds, checks non-root and
content/config boundaries, starts an isolated PostgreSQL 17 database, applies
the current migration head, and proves backend liveness/readiness plus frontend
liveness. It then stops PostgreSQL and requires backend liveness to remain
healthy while readiness fails with the generic dependency response. It removes
its containers and network even after failure. It does not push, upload, or
deploy an image.

The `Production images` CI check owns the same evidence. A passing check means
the local image boundary is verified; it is not proof of a registry artifact or
deployment.

## Runtime configuration and probes

Production backend startup requires validated settings including a database
URL, allowed origins, and separate abuse-limit and internal-network secrets.
Frontend startup requires an origin-only `RECIPE_API_URL` and the matching
private network-signal secret. Invalid fields are named without echoing their
values.

The probes have different meanings:

| Probe | Success | Operator action on failure |
| --- | --- | --- |
| backend `GET /api/health` | API process can answer; no database query | Restart or replace the process |
| backend `GET /api/readiness` | Fixed PostgreSQL check succeeds | Remove the instance from traffic |
| frontend `GET /healthz` | Uncached `200 ok` from the frontend process | Restart or replace the process |

Never use backend liveness for traffic admission. A running API can be live
while its database is unavailable. Database pool checkout, connection,
statement, and stalled TCP operations share the bounded
`DATABASE_OPERATION_TIMEOUT_SECONDS` value (default 5 seconds, allowed 1–30).

Every backend response and safe proxy failure receives a new canonical UUIDv4
`X-Correlation-ID`. When an error body includes the ID it must match the header.
Inbound correlation headers are discarded. Correlation IDs contain no account,
route, network, recipe, or error data and confer no authority.

## Observability

Production HTTP access logs and unrestricted exception telemetry are prohibited.
Approved backend events are limited to:

- `authentication_failure`
- `publication_failure`
- `database_failure`
- `application_failure`

Their complete payload is the fixed event name plus the generated correlation
ID. Approved frontend proxy events are
`recipe_lab.frontend.authentication_failed` and
`recipe_lab.frontend.recipe_api_unavailable`; they add only a numeric status
code. Adding any field or event is an account-data governance change.

Request-level events have a maximum retention of 7 days. Aggregate fixed-name,
low-cardinality metrics have a maximum retention of 30 days and may use only
reviewed operation, outcome, status-class, dependency, latency-bucket, and
deployment-revision labels. Never attach paths, caller values, correlation IDs,
or member/recipe dimensions to aggregates.

Initial operator signals are:

| Signal | Review threshold and first action |
| --- | --- |
| Authentication failures | More than 15% over 5 minutes with at least 20 attempts; compare fixed frontend/backend events and provider availability |
| Publication failures | More than 5% over 5 minutes with at least 10 attempts; check database readiness and deployment revision |
| Database availability | Two consecutive unavailable checks; page and remove the instance from traffic |
| Application failures | More than 2% over 5 minutes with at least 50 outcomes; inspect only allowlisted evidence |
| Latency | Reviewed buckets by fixed operation/outcome; no request or member labels |

These are conservative starting thresholds, not service-level objectives. Tune
them only from de-identified aggregate evidence. Before connecting a CDN,
proxy, APM, analytics, crash-reporting, or logging sink, prove redaction before
buffering/transport, enforce the allowlist and retention at replicas/backups,
disable exports/session replay/ad-hoc fields, and verify that a synthetic secret
is rejected before emission. A platform that cannot enforce the contract is not
approved.

## Portfolio sandbox

The sandbox supervisor runs verified immutable production image IDs in isolated,
successive generations. It builds and publishes nothing. First resolve the
local image IDs after the production-image gate, then run from the repository
root:

```powershell
$backendImage = docker image inspect --format '{{.Id}}' recipe-lab-backend:local
$frontendImage = docker image inspect --format '{{.Id}}' recipe-lab-frontend:local

python -m scripts.run_portfolio_sandbox `
  --backend-image $backendImage `
  --frontend-image $frontendImage `
  --origin https://<portfolio-demo-origin> `
  --contact-url mailto:me@peterbucci.com `
  --port 3100
```

The public origin must be HTTPS. Contact may be a public HTTPS URL or a direct
`mailto:` link without query/fragment. The frontend binds only to loopback for a
separately configured HTTPS proxy; backend and PostgreSQL expose no host port.

Each generation has an immutable UUID, start, and deadline of at most 24 hours.
It owns exact UUID-based containers/networks and ownership labels, fresh random
secrets, an internal service network, and a separate frontend ingress bridge.
PostgreSQL data and WAL share a size-bounded tmpfs: there is no volume, backup,
replica, archive, or dump. Docker logging is disabled and resource limits apply.
The database has its own absolute deadline guard, while every content API and
readiness check independently verifies the generation binding and deadline.

Startup is fail-closed: empty storage, migrations, immutable generation binding,
seeds, binding verification, backend readiness, then frontend listener. Cleanup
is the reverse: stop ingress, stop writers, remove database, then remove only
resources whose exact names and ownership labels match. If cleanup fails, the
supervisor stops instead of opening another generation. Interrupting the
supervisor invokes that owned cleanup. Never replace it with a broad Docker
deletion command.

`--once` runs one generation and stops. `--lifetime-seconds` accepts 60–86400
for isolated supervisor use. Early replacement means stopping the supervisor
and creating a fresh generation, never extending or changing the current
deadline. An old database cannot be rebound to a new generation.

Rehearse expiry and replacement locally after verifying images:

```powershell
python -m scripts.rehearse_portfolio_sandbox `
  --backend-image $backendImage `
  --frontend-image $frontendImage
```

The rehearsal uses loopback ports 3100 and 3443, creates temporary TLS trusted
only by its own client, exercises two independent visitors and ordinary product
workflows, waits for deadline enforcement, then proves a clean second generation
cannot recover old cookies or content. It retains only identifier-free results
and removes owned resources and TLS files.

Before public routing, separately verify the actual host disables swap spill,
snapshots, backups, replication, crash dumps, caches, raw access logs, service
worker body retention, and durable APM/browser artifacts; enforces supervised
restart and traffic-closed failure; preserves Origin/cookie/CSRF behavior; and
passes a two-generation rehearsal through the real HTTPS proxy. Local container
tests cannot attest to those platform controls.

Sandbox recovery is always a clean generation. Never restore a visitor sandbox
backup or present normal account deletion as a reset. Previously delivered
content may remain in a visitor's own copy; server expiry cannot recall it.

## Safe source packaging

Share only an explicit committed revision through the fail-closed exporter. The
working tree must have no staged, unstaged, or non-ignored untracked changes,
and outputs must be outside the checkout:

```powershell
$revision = git rev-parse --verify 'HEAD^{commit}'
$shortRevision = $revision.Substring(0, 12)
$exportDirectory = Join-Path ([System.IO.Path]::GetTempPath()) `
  ("recipe-lab-source-" + [System.Guid]::NewGuid())
New-Item -ItemType Directory -Path $exportDirectory | Out-Null
$archive = Join-Path $exportDirectory "recipe-lab-source-$shortRevision.zip"
python scripts/package_source.py --ref $revision --output $archive
```

The exporter reads Git objects, not ignored working-tree files. It enforces the
reviewed path/type/size policy, rejects environment/credential/archive/cache/
build/report/browser-output content, scans exact committed blobs before writing,
reopens and structurally verifies the deterministic ZIP, then scans the archive
again. It never overwrites output. Success creates the ZIP and a manifest with
commit, policy/rules fingerprints, limits, archive hash, and per-file hashes.

Reviewed PNGs are opaque to text scanning and therefore require exact Git object
allowlisting. Audit without changing policy:

```powershell
python scripts/package_source.py --ref HEAD --audit-opaque-policy
```

After visually reviewing an intentional PNG change, update its exact object ID
in `EXPORT_POLICY` by hand and review the image and policy together. Never add
actual/diff screenshots or browser diagnostics to that allowlist. Passing scans
do not prove a credential never existed in Git history; rotate anything that
may have been exposed.

## Release boundary

No ordinary quality, image, source, sandbox, or rehearsal command deploys the
application, pushes an image, configures a registry/domain/TLS/OIDC tenant,
approves its own dependency update, or admits public traffic. A release must
bind reviewed source and immutable registry manifests, apply migrations as a
separate step, complete private credential review, satisfy the platform checks,
and pass the smoke/restore/rollback sequence in
[Recovery](reference/recovery.md).
