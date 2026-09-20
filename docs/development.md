# Development

This guide covers the maintained local-development workflow. The repository is
the authority for exact settings and commands: `compose.yaml` defines the local
service topology, `.env.example` documents configuration, the root `uv.lock`
owns Python dependencies, and `frontend/package-lock.json` owns frontend
dependencies.

For system and dependency boundaries, see [Architecture](architecture.md). For
the complete verification matrix, see [Testing](testing.md). Production and demo
runtime procedures are intentionally separate in [Operations](operations.md).

## Toolchain

The closest match to CI is:

- Docker Desktop with Docker Compose;
- Python 3.13.15;
- `uv` 0.12.6; and
- Node.js 22.23.2 with the npm version bundled by that runtime.

The backend package supports Python 3.12 or newer, but CI and reproducibility
evidence use the exact versions above. Run commands from the repository root
unless a section says otherwise.

## Start the application with Docker Compose

Compose builds the `development` Dockerfile targets, mounts application source,
and keeps PostgreSQL, frontend dependencies, and Next.js build output in named
volumes.

```powershell
Copy-Item .env.example .env
docker compose build
docker compose up -d db
```

For an existing database that has the legacy measurement columns, run the
read-only audit before migrating and stop if it reports a problem:

```powershell
docker compose run --rm backend recipe-lab-measurements audit-legacy --format json
if ($LASTEXITCODE -ne 0) { throw "Resolve the measurement audit before migrating." }
```

Skip that audit only for a fresh empty database, where the legacy recipe table
does not exist. Then migrate, seed explicitly, and start the application:

```powershell
docker compose run --rm backend python -m alembic upgrade head
docker compose run --rm backend python -m app.seeds load
docker compose up -d backend frontend
docker compose ps
```

The main local endpoints are:

- web application: <http://localhost:3000>
- recipe catalog: <http://localhost:3000/recipes>
- backend liveness: <http://localhost:8000/api/health>
- backend database readiness: <http://localhost:8000/api/readiness>
- interactive API documentation: <http://localhost:8000/docs>

Authentication remains disabled until valid OIDC settings are supplied. Public
browsing still works. Browser API calls use the frontend's same-origin `/api`
proxy; `NEXT_PUBLIC_API_URL` exists only for compatible server fallbacks and is
not a replacement for that boundary.

Inspect the current state with `docker compose ps` and use
`docker compose logs <service>` for local-only diagnosis. Do not copy logs that
contain request data into public issues.

Stop services while preserving local data:

```powershell
docker compose down
```

Only use the following command when the PostgreSQL data and generated frontend
volumes are intentionally disposable:

```powershell
docker compose down --volumes --remove-orphans
```

`--volumes` deletes the local database volume. Export anything you intend to
keep first.

## Run services directly

Start PostgreSQL first; using only the Compose database is supported:

```powershell
docker compose up -d db
```

Prepare and run the backend in one terminal:

These commands use `backend` as the working directory. Backend settings do not
implicitly load the root `../.env`; export the intended root values into the
process environment or create a separate ignored `backend/.env` before running
them. In particular, confirm that `DATABASE_URL`, origins, OIDC settings, and
secrets match the host-run process instead of silently relying on defaults.

```powershell
cd backend
uv lock --check
uv sync --frozen --package recipe-lab-api --extra dev
uv pip check
..\.venv\Scripts\Activate.ps1
python -m alembic upgrade head
python -m app.seeds load
python -m uvicorn app.main:app --reload
```

Prepare and run the frontend in a second terminal:

```powershell
cd frontend
npm ci
npm run dev
```

The root `.env.example` is the only maintained local environment template.
Compose reads the root `.env` and replaces host-facing database and backend
URLs with service-network URLs; direct host processes need their own exported
environment as described above. Never commit a copied `.env`, use its example
secrets outside local development, or point a test or sandbox command at a
production database.

## Database changes

Alembic migrations are the deployable schema authority. Application startup
does not create tables and does not run migrations or seeds.

After importing the affected models through `app.models`, create a candidate
revision from `backend`:

```powershell
python -m alembic revision --autogenerate -m "describe the schema change"
```

Review generated SQL and data movement before applying it. Verify the complete
history with:

```powershell
python -m alembic upgrade head
python -m alembic check
```

Do not use `Base.metadata.create_all()` as application schema management. Do
not edit historical migrations after release. A change that adds account-linked
data must also update the field-level account-data manifest and its independent
metadata test; see [Security](security.md#account-data-governance).

### Transaction ownership

Repositories own persistence queries and row locking; they do not commit.
Domain services own policy and multi-row state transitions without inventing a
second transaction boundary. The route or explicit workflow that begins an
operation owns its final commit or rollback. Authentication workflows are
explicit transaction owners, and durable abuse counters deliberately commit in
a separate pre-handler transaction so a later domain rollback cannot erase the
attempt.

Do not add a repository commit, split an atomic publication/account-lifecycle
operation across commits, or move an authorization decision into the frontend.
Publication, stable edition topology, visibility, moderation, deletion,
idempotency, and audit evidence must remain in their established backend
transaction owners.

## Seed data

Validate packaged seed assets without a database:

```powershell
cd backend
python -m app.seeds validate
```

Load them only after migrations:

```powershell
python -m app.seeds load
```

Loading is explicit, deterministic, transactional, and safe to rerun. It reuses
compatible catalog data, adds missing seed metadata, and fails instead of
rewriting conflicting immutable history. It never deletes member data. Dataset
licensing and interpretation are recorded in
[seed provenance](../backend/app/seeds/data/PROVENANCE.md); structured catalog
ownership is described in
[Structured data](reference/structured-data.md).

## Dependency changes

The root Python workspace and `uv.lock` are the only Python dependency
authority. Reproduce an environment without changing the lock:

```powershell
uv lock --check
uv sync --frozen --package recipe-lab-api --extra dev
uv pip check
```

To change a Python dependency, edit the owning package's `pyproject.toml`, run
`uv lock` with the required `uv` version, and review the declaration and the
entire lockfile diff. Use `uv lock --upgrade-package <name>` only for an
intentional upgrade; do not refresh unrelated packages opportunistically.

The frontend lock is `frontend/package-lock.json`. Use the repository's Node
toolchain to make a deliberate package change, review both `package.json` and
the lockfile, then prove a clean install:

```powershell
cd frontend
Remove-Item -Recurse -Force node_modules
npm ci
```

Production and CI builds use `npm ci`, not `npm install`. Base-image tag and
digest updates are reviewed together and require the production-image and
security gates in [Operations](operations.md#production-images).

## Change workflow

Keep changes within the existing ownership boundaries:

1. Locate the feature, domain service, repository, and composition owner before
   editing.
2. Add or update the smallest behavior-focused tests beside that owner.
3. Run focused tests while iterating.
4. Run the applicable contract, architecture, type, build, and browser gates
   from [Testing](testing.md).
5. Regenerate committed OpenAPI or frontend contract artifacts only when an
   intentional public contract change requires it.

Avoid unrelated cleanup, duplicate state, feature-to-feature imports, policy in
global shared code, and UI-only authorization. The backend remains the security
authority even when the interface hides unavailable actions.
