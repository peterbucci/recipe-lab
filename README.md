# Recipe Lab

Recipe Lab is a portfolio project for exploring a simple idea: recipes should be
structured, versioned objects that people can fork, compare, save, and rate.
Once the product records meaningful interactions, those signals can support
personalized recipe and ingredient-substitution recommendations.

The repository is deliberately **MVP first**. Recommendation models are not part
of the initial product milestone.

## Product sequence

### MVP: prove structured recipe versioning

A user should be able to:

1. Browse a small, curated recipe catalog.
2. View structured ingredients, quantities, units, and instructions.
3. Fork a recipe into a new variant.
4. See an exact diff between a variant and its parent.
5. Save and rate variants.
6. Navigate a recipe's variant lineage.

The concrete proof point is: fork a carrot cake, reduce its sugar, replace
walnuts with pecans, and preserve both the changes and the parent relationship.

### Product data before ML

After the MVP works, Recipe Lab will record preference events such as views,
saves, ratings, and forks. Ingredient metadata and explicit substitution
relationships will be added with auditable source and confidence fields.

### ML after useful signals exist

The ML roadmap begins with a transparent popularity or rule-based baseline,
then moves to content-based, collaborative, and hybrid recommenders. Offline
evaluation must be in place before a more complex model is considered better.

## Repository layout

```text
recipe-lab/
|-- frontend/          Next.js and TypeScript web application
|-- backend/           FastAPI, SQLAlchemy, and pytest
|-- ml/                Deferred ML workspace and entry criteria
|-- docs/              Product scope and architecture notes
|-- compose.yaml       Local frontend, API, and PostgreSQL services
`-- .env.example       Documented development configuration
```

## Current scaffold

The initial scaffold provides:

- a Next.js landing page and frontend unit/e2e test harnesses;
- a FastAPI health endpoint and pytest coverage;
- SQLAlchemy engine/session foundations without prematurely defining the schema;
- PostgreSQL and local development services through Docker Compose.

Recipe schema, migrations, APIs, and screens are intentionally tracked as
separate milestones.

## Quick start with Docker

Requirements: Docker Desktop with Docker Compose.

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Open:

- Web app: <http://localhost:3000>
- API health check: <http://localhost:8000/api/health>
- Interactive API docs: <http://localhost:8000/docs>

Stop the services with `docker compose down`. Add `--volumes` only when you
intentionally want to discard local database data.

## Run services directly

Start PostgreSQL first (the `db` Compose service is fine), then run the API:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
uvicorn app.main:app --reload
```

In another terminal, run the web application:

```powershell
cd frontend
npm install
npm run dev
```

## Tests and checks

Run the same backend checks enforced by CI:

```powershell
cd backend
python -m ruff format --check .
python -m ruff check .
python -m mypy app tests
python -m pytest
```

Run the same frontend checks enforced by CI:

```powershell
cd frontend
npm run lint
npm run typecheck
npm test
npm run build
npx playwright test --list
```

The Playwright list command validates test discovery without installing or
launching a browser. To run the current end-to-end smoke test locally, install
Chromium once and then run the suite:

```powershell
cd frontend
npx playwright install chromium
npm run test:e2e
```

## Continuous integration

The `CI` GitHub Actions workflow runs on every pull request and every push to
`main`. Separate backend and frontend jobs make failures easy to locate. Python
and npm download caches are keyed from their dependency files; the frontend
uses `npm ci` with the committed `package-lock.json`.

The browser-based Playwright suite remains outside the required gate until the
MVP has meaningful user flows. CI still loads the configuration and discovers
the smoke test so end-to-end support cannot silently break in the meantime.

## Working agreements

- Keep recipe data normalized enough to compare variants without hiding the
  original author intent.
- Preserve lineage: every variant points to its direct parent.
- Prefer explainable baselines over premature model complexity.
- Treat seed recipes, ingredient metadata, and evaluation datasets as versioned
  project assets with documented provenance.
- Keep credentials out of source control; `.env.example` contains local-only
  defaults, not production values.

See [MVP scope](docs/mvp-scope.md) and [architecture](docs/architecture.md) for
the initial boundaries and planned component responsibilities.
