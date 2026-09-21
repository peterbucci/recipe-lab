# Development

This guide covers the normal local-development workflow for Recipe Lab.

For the system design, see [Architecture](architecture.md). For the full test matrix, see [Testing](testing.md). Security-sensitive behavior is documented in [Security](security.md), and the complete environment-variable reference belongs in [Configuration](reference/configuration.md).

## Prerequisites

The repository is developed and verified with:

- Docker Desktop with Docker Compose;
- Python 3.13;
- `uv`;
- Node.js 22; and
- npm.

The backend supports Python 3.12 or newer, but using the same major toolchain as CI is the safest option when reproducing failures.

Run commands from the repository root unless a section says otherwise.

## Quick start with Docker Compose

Copy the example environment file:

```powershell
Copy-Item .env.example .env
```

Build the development images and start PostgreSQL:

```powershell
docker compose build
docker compose up -d db
```

Apply database migrations and load the development seed data:

```powershell
docker compose run --rm backend python -m alembic upgrade head
docker compose run --rm backend python -m app.seeds load
```

Start the application:

```powershell
docker compose up -d backend frontend
```

Useful local URLs:

- Web application: `http://localhost:3000`
- Recipe catalog: `http://localhost:3000/recipes`
- Backend health: `http://localhost:8000/api/health`
- Backend readiness: `http://localhost:8000/api/readiness`
- FastAPI documentation: `http://localhost:8000/docs`

Public recipe browsing works without an identity provider. Member workflows require valid OIDC configuration.

Check running services with:

```powershell
docker compose ps
```

View logs for one service with:

```powershell
docker compose logs <service>
```

Stop the application while preserving local volumes:

```powershell
docker compose down
```

Use the following only when the local database and generated frontend volumes are intentionally disposable:

```powershell
docker compose down --volumes --remove-orphans
```

That command deletes the local PostgreSQL volume.

## Running services directly

You can use Compose only for PostgreSQL and run the backend and frontend on the host.

Start the database:

```powershell
docker compose up -d db
```

### Backend

From `backend/`:

```powershell
uv lock --check
uv sync --frozen --package recipe-lab-api --extra dev
uv pip check

..\.venv\Scripts\Activate.ps1

python -m alembic upgrade head
python -m app.seeds load
python -m uvicorn app.main:app --reload
```

Backend settings do not automatically load the root `.env` when the process is started from `backend/`. Export the required values into the process environment or use a separate ignored `backend/.env`.

At minimum, verify the database URL, allowed origins, OIDC settings, and application secrets before running the service directly.

### Frontend

From `frontend/`:

```powershell
npm ci
npm run dev
```

Browser API requests use the frontend's same-origin `/api` route. Public server-rendered reads use the backend origin configured for the frontend server.

## Environment configuration

`.env.example` is the maintained example configuration.

Create local secrets and provider credentials in `.env`; never commit the resulting file.

The development environment includes settings for areas such as:

- PostgreSQL;
- frontend/backend origins;
- OIDC;
- trusted network signaling;
- abuse controls;
- request limits; and
- recommendation/evaluation bounds.

See [Configuration](reference/configuration.md) for the full list and production requirements.

## Database migrations

Alembic is the schema authority. Application startup does not create or migrate the database automatically.

Create a migration from `backend/`:

```powershell
python -m alembic revision --autogenerate -m "describe the schema change"
```

Always review the generated migration. Autogeneration can identify structural differences, but it cannot decide whether a data migration or constraint transition is correct.

Apply the full migration history:

```powershell
python -m alembic upgrade head
```

Check for model/schema drift:

```powershell
python -m alembic check
```

Do not use `Base.metadata.create_all()` as application schema management, and do not rewrite historical migrations after they have become part of the repository history.

For an existing database that still contains the legacy measurement schema, run the repository's read-only audit before migrating:

```powershell
docker compose run --rm backend recipe-lab-measurements audit-legacy --format json
```

A fresh database does not need that legacy-data audit.

Changes that introduce new account-linked data must also update the account-data inventory described in [Security](security.md#account-deletion-and-retained-history).

## Seed data

Validate the packaged seed data without changing the database:

```powershell
cd backend
python -m app.seeds validate
```

Load it after migrations:

```powershell
python -m app.seeds load
```

The seed loader is deterministic and safe to rerun against compatible development data. It does not delete member data or rewrite published recipe history to force a match.

Seed provenance is recorded alongside the seed assets in `backend/app/seeds/data/PROVENANCE.md`.

## Backend dependencies

Python dependencies are managed by the root workspace and `uv.lock`.

Verify that the lockfile is current and reproduce the locked backend environment with:

```powershell
uv lock --check
uv sync --frozen --package recipe-lab-api --extra dev
uv pip check
```

To change a dependency:

1. Edit the owning package's `pyproject.toml`.
2. Run `uv lock`.
3. Review both the declaration and lockfile diff.
4. Run the affected backend checks.

For an intentional single-package upgrade:

```powershell
uv lock --upgrade-package <package-name>
```

Avoid refreshing unrelated dependencies as part of an otherwise unrelated change.

## Frontend dependencies

Frontend dependencies are owned by:

- `frontend/package.json`
- `frontend/package-lock.json`

After changing dependencies, verify a clean install:

```powershell
cd frontend
Remove-Item -Recurse -Force node_modules
npm ci
```

CI and production builds use `npm ci`, so a change is not complete if it works only with an existing local `node_modules` directory.

## API contract changes

FastAPI is the source of the HTTP contract, and the generated frontend types are checked into the repository.

When a backend API change intentionally modifies that contract, regenerate and verify the committed artifacts using the commands documented in [API contracts](api-contracts.md).

Do not manually edit the generated frontend contract.

A normal frontend refactor that only moves an API helper or changes component ownership should not change the HTTP contract.

## Working on the frontend

The frontend is organized around a few ownership rules:

- `app/` owns routes and multi-feature composition;
- `features/` owns product behavior;
- `shared/` owns domain-neutral infrastructure;
- `shell/` owns application framing; and
- `server/` owns proxy/runtime behavior.

Before adding a cross-feature import or new shared abstraction, check [Frontend](frontend.md). Existing architecture checks are designed to make unusual dependencies explicit rather than silently expanding the shared layer.

## Working on the backend

Routes own HTTP concerns and usually the final transaction boundary. Services are used where a workflow has real domain orchestration, and repositories own persistence queries and row locking.

Do not add a service layer solely to forward a simple read, and do not add transaction commits inside repositories.

See [Architecture](architecture.md) for the backend dependency and transaction model.

## Running checks

Use focused tests while working. Before considering a change complete, run the applicable repository checks described in [Testing](testing.md).

The repository exposes the main local quality suites through:

```powershell
python scripts/run_quality_gate.py contracts lint types
python scripts/run_quality_gate.py backend frontend ml
```

Some browser, visual, performance, image, recovery, and release checks require additional services or controlled environments. `testing.md` describes when those checks apply.

## Common development workflow

A typical change should be small enough that its owner and verification are obvious:

1. Find the route, feature, service, or repository that owns the behavior.
2. Make the smallest change that preserves the existing boundaries.
3. Add or update behavior-focused tests beside that owner.
4. Run focused tests while iterating.
5. Run the relevant type, contract, architecture, build, and browser checks.
6. Regenerate committed artifacts only when the underlying contract or reviewed baseline intentionally changed.

Avoid combining unrelated cleanup with a functional change. Recipe Lab has several security, publication, recovery, and compatibility boundaries where seemingly small cleanup can alter behavior that another layer relies on.

## Where to look next

- [Architecture](architecture.md) — system boundaries and major request paths
- [Frontend](frontend.md) — frontend ownership, state, accessibility, and styling
- [Security](security.md) — authentication, authorization, privacy, and data lifecycle
- [Testing](testing.md) — test tiers and verification commands
- [Operations](operations.md) — runtime and operator procedures
- [API contracts](api-contracts.md) — OpenAPI and generated frontend types
- [Configuration](reference/configuration.md) — complete environment reference
