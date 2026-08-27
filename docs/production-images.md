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
Docker receives them. Runtime secrets must be injected by the eventual
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

The backend container health check calls the existing dependency-independent
`GET /api/health` endpoint on port 8000 and expects the Recipe Lab API status
payload. The frontend container health check calls `GET /healthz` on port 3000;
that endpoint returns `ok` as uncached plain text and does not call the backend.
These are process-liveness checks. Database migration and end-to-end service
readiness remain explicit responsibilities of RCP-33F and the later release
rehearsal.

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
and excluded runtime content, verifies that invalid configuration fails without
echoing synthetic private values, then starts both images on an isolated Docker
network and exercises their health endpoints. Containers and the temporary
network are removed even when verification fails. The command never pushes or
uploads an image.

## CI and no-deploy boundary

The stable `Production images` GitHub check installs immutable `uv 0.12.6`,
checks and freezes the root Python lock, tests the verifier, builds both local
images without cache, and runs all runtime checks above. It does not log private
configuration, upload an image archive, authenticate to a registry, or invoke a
cloud deployment API. Its local image tags are removed at the end of the
disposable runner job.

`RCP-32 community release gate` now requires this check alongside backend,
frontend, MVP, community-journey, and safe-source checks. Passing it authorizes
only the later RCP-33 release rehearsal; it is not itself a deployment.
