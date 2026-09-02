# Locked dependencies and production images

RCP-33D defines the reproducible dependency and container boundary used by the
later release rehearsal. It produces local backend and frontend images; it does
not publish an image, create a registry, deploy Recipe Lab, run migrations, or
contact a hosted identity provider.

## One Python lock

The root `pyproject.toml` is the Python workspace definition. It binds the
`backend` and `ml` distributions together, requires exactly `uv 0.12.6`, and
keeps the evaluator's `recipe-lab-api` dependency on the reviewed local
workspace package rather than resolving that name from a package index. The
single root `uv.lock` is authoritative for backend runtime, backend development,
and offline-evaluation runtime, development, and transitive dependencies. Each
member also pins its PEP 517 build backend exactly so isolated wheel builds do
not introduce an open build-tool range.

Install `uv 0.12.6`, then reproduce an environment without changing the lock:

```powershell
# API runtime or acceptance harness
uv lock --check
uv sync --frozen --package recipe-lab-api
uv pip check

# API quality environment
uv sync --frozen --package recipe-lab-api --extra dev
uv pip check

# Offline-evaluation quality environment
uv sync --frozen --package recipe-lab-evaluation --extra dev
uv pip check
```

Local and CI environments run `uv lock --check` before a package-specific
`uv sync --frozen`. Production image builds use `uv sync --locked`, which both
refuses dependency-resolution drift and verifies that the copied project
metadata still matches the lock. Do not replace these commands with an editable
`pip install`, an unbounded `pip install --upgrade`, or a separately generated
lock inside a workspace member.

To change a Python dependency, edit the owning member's `pyproject.toml`, run
`uv lock` with `uv 0.12.6` from the repository root, review both the declared
requirement and the complete `uv.lock` diff, then run all three frozen syncs
above. Use `uv lock --upgrade-package <name>` only for a deliberate reviewed
upgrade; do not refresh unrelated packages opportunistically.

## Frontend lock

`frontend/package-lock.json` is the authoritative npm dependency graph. CI and
both Docker build stages use `npm ci`; `npm install` is not an image-build or
verification command. To change a frontend package, use the repository's Node
22/npm toolchain to make the deliberate `package.json` and lockfile update,
review both files, remove `node_modules`, and prove a clean `npm ci` before
running the frontend checks.

## Development and production targets

Each application Dockerfile has separate named targets:

- `development` retains the local tooling and reload behavior used by Docker
  Compose. `compose.yaml` selects this target explicitly.
- `production` is the final/default artifact. It uses locked dependency inputs,
  a non-root runtime user, and a production server with no reload or development
  mode.

The backend build needs the repository root as its context because the shared
Python workspace metadata and lock are root files. The frontend has its own
context:

```powershell
docker build --pull --no-cache --target production `
  --file backend/Dockerfile `
  --tag recipe-lab-backend:rcp33d .

docker build --pull --no-cache --target production `
  --file frontend/Dockerfile `
  --tag recipe-lab-frontend:rcp33d frontend
```

The reviewed base-image digests are part of the Dockerfile inputs. Update a
base tag and digest together in a dedicated review, rebuild both targets from a
clean cache, and rerun the verifier. A successful lock check and clean build
mean the selected dependency graph is reproducible; RCP-33D does not claim that
ordinary Docker builds are byte-identical OCI archives across different hosts.
The production stages do not run `apk upgrade`: that would resolve mutable
repository state after selecting an immutable base. Receive operating-system
fixes by reviewing a new base digest, then run the security and image gates.

## Runtime boundary

The production images intentionally retain only what the running services need.
They exclude environment files and source credentials, test and acceptance
harnesses, browser output, coverage and tool caches, development dependencies,
package-manager caches, and build-only tools. In particular:

- the backend image excludes `app.testing`, backend tests, uv, pip, setuptools,
  wheel, pytest, Ruff, and Mypy; and
- the frontend image excludes e2e and unit tests, Playwright/Vitest/ESLint
  configuration, application/test TypeScript source trees, `.next/cache`, npm,
  npx, and frontend development packages. The reviewed `next.config.ts` remains
  because the production Next.js server loads it at runtime.

The build contexts also deny environment files and generated artifacts before
Docker receives them. The frontend context excludes committed visual baselines
and test/performance harnesses, which are CI evidence rather than runtime build
inputs. Runtime secrets must be injected by the eventual
deployment environment; they must never be Docker build arguments, Dockerfile
defaults, image labels, or committed files.

## Startup configuration and health

The backend starts with `APP_ENVIRONMENT=production` and validates its bounded
settings before serving. At minimum the deployment supplies a database URL,
allowed origins, and separate private abuse-control and internal-network
secrets. The frontend production server validates an origin-only
`RECIPE_API_URL` and a private `INTERNAL_NETWORK_SIGNAL_SECRET` before it binds
its port. Configuration failures identify the invalid field without printing
the supplied value.

The root `.env.example` is the single local template and documents every value
interpolated by Compose. `POSTGRES_*` and `POSTGRES_IMAGE` configure only the
local database container. Host-run `DATABASE_URL`, `TEST_DATABASE_URL`, and
`RECIPE_API_URL` remain documented there but are intentionally replaced by
service-network URLs inside Compose. A deployment must supply production
database, origin, OIDC, and secret-store values through its runtime platform;
do not copy the local passwords or secret placeholders into production and do
not create a committed production environment file.

The backend container health check calls the dependency-independent
`GET /api/health` endpoint on port 8000 and expects the Recipe Lab API status
payload. The frontend container health check calls `GET /healthz` on port 3000;
that endpoint returns `ok` as uncached plain text and does not call the backend.
These are process-liveness checks. The separate backend `GET /api/readiness`
probe executes one fixed PostgreSQL check. It returns the fixed ready response
only while the dependency is usable and otherwise fails closed with a generic
`503 dependency_unavailable` response. Every backend response includes a fresh
application-issued UUIDv4 `X-Correlation-ID`.

Run the same local verification as CI from the repository root:

```powershell
python scripts/verify_production_images.py `
  --backend-image recipe-lab-backend:rcp33d `
  --frontend-image recipe-lab-frontend:rcp33d `
  --backend-context . `
  --backend-dockerfile backend/Dockerfile `
  --frontend-context frontend `
  --frontend-dockerfile frontend/Dockerfile
```

The command performs clean production-target builds, rejects root users,
development commands, missing image health checks, baked credential settings,
and excluded runtime content, and verifies that invalid configuration fails
without echoing synthetic private values. It starts a disposable PostgreSQL 17
container, applies the current migration head through the production backend
image, and starts both application images on an isolated Docker network. The
smoke test requires backend liveness, database readiness, frontend liveness,
and fresh valid correlation headers. It then stops PostgreSQL and requires the
backend to remain live while readiness returns the generic `503` whose header
and body correlation IDs match. The smoke environment fixes the application's
database failure bound at five seconds and gives the HTTP probe fifteen seconds,
so the API has time to return its controlled dependency response instead of the
probe racing the database timeout. A timeout or unexpected payload fails the
gate. All containers and the temporary network are removed even when
verification fails. The command never pushes or uploads an image.

`--database-image` defaults to the exact PostgreSQL 17.11 multi-platform digest
used by local Compose and CI and may select a separately reviewed local tag.
Compose also checks frontend `/healthz`, documents every interpolated input in
`.env.example`, and keeps `.next` plus `node_modules` in named volumes rather
than writing generated build output into the host source bind mount. The
backend Compose check remains liveness; database readiness is the separate
`GET /api/readiness` contract. This database is disposable verification
infrastructure; no dump, volume, log, or database artifact is retained.

## CI and no-deploy boundary

The stable `Production images` GitHub check installs immutable `uv 0.12.6`,
checks and freezes the root Python lock, tests the verifier, builds both local
images without cache, and runs all runtime checks above. It does not log private
configuration, upload an image archive, authenticate to a registry, or invoke a
cloud deployment API. Its local image tags are removed at the end of the
disposable runner job.

`RCP-32 community release gate` now requires this check alongside backend,
frontend, MVP, community-journey, safe-source, and ordinary security checks.
Passing it authorizes only the later RCP-33 release rehearsal; it is not itself
a deployment. The ordinary `Security` gate scans frozen Python/npm dependencies
and reviewed committed source on each pull request and weekly. See
[repository quality gates](quality-gates.md).
Within the separate RCP-33G rehearsal, each local candidate image is built
once, its immutable local image ID is recorded, and that same image is scanned
and smoked. The verifier is repeated for local images built from a reviewed
representative ancestor. These are rehearsal artifacts, not registry artifacts
or proof of a deployed revision. The images and raw scan results remain in
temporary runner storage; only bounded identity and pass-state evidence
survives.
See [release, recovery, and rollback rehearsal](release-rehearsal.md).
Deployment probe routing, fixed event sinks, initial operator signals,
retention, smoke testing, and rollback are defined in
[privacy-safe operations and observability](operations-observability.md).
