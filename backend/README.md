# Recipe Lab API

This package is Recipe Lab's FastAPI service. It owns the authoritative
authentication, authorization, publication, visibility, moderation,
account-lifecycle, and audit decisions for structured versioned recipes.
Browser presentation is never the security boundary.

The API uses SQLAlchemy with PostgreSQL and Alembic. Public recipes are
immutable snapshots; private drafts use a separate persistence model and cross
the public boundary only through the publication service and its transaction.

## Develop the package

From `backend/`:

The backend does not implicitly load the repository root `../.env` from this
working directory. Export the intended values into the process environment or
create an ignored `backend/.env`, and verify the host-facing database, origins,
OIDC configuration, and secrets before running the service.

```powershell
uv lock --check
uv sync --frozen --package recipe-lab-api --extra dev
uv pip check
..\.venv\Scripts\Activate.ps1
python -m alembic upgrade head
python -m app.seeds load
uvicorn app.main:app --reload
```

The default API is at <http://localhost:8000>. Use `/api/health` for process
liveness, `/api/readiness` for database readiness, and `/docs` for the generated
OpenAPI UI. Environment and database preparation are documented in the
[development guide](../docs/development.md).

## Package commands

- `recipe-lab-curator` manages bounded ingredient-catalog review operations.
- `recipe-lab-moderator` manages the separately granted moderator role.
- `recipe-lab-measurements` audits legacy measurements before migration.
- `recipe-lab-seed` validates and loads reviewed seed data.

These commands preserve backend policy and service boundaries; they are not
browser authorization shortcuts.

## Verification and design

Run focused tests with `python -m pytest`, strict types with
`python -m mypy app migrations tests`, and the contract check with
`python -m app.openapi_contract check`. The repository-wide command matrix is
in [Testing](../docs/testing.md).

See [Architecture](../docs/architecture.md), the
[recipe model](../docs/recipe-model.md), [security and data](../docs/security.md),
and [structured recipe data](../docs/reference/structured-data.md) for the
current invariants. Seed licensing and source identity remain authoritative in
[`app/seeds/data/PROVENANCE.md`](app/seeds/data/PROVENANCE.md).
