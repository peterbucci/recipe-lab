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

Recipe Lab now has the schema needed to connect authored recipe text to
canonical ingredients, aliases, broad categories, dietary flags, allergens,
and directed substitution relationships. A curated, deterministic demo catalog
now exercises that structure. The product also records privacy-bounded,
timestamped view, save, rating, and fork events with retry-safe action IDs.
Those signals now feed a deterministic, documented `baseline-v1` recommendation
read for the shared demo profile. The baseline is request-time scoring, not a
trained ML system.

### ML after useful signals exist

The ML roadmap begins with a transparent popularity or rule-based baseline,
which is now available as the comparison point for later work. A separate
fixed-cutoff offline harness now measures that baseline reproducibly.
`content-v1` is the first offline comparison model: it combines canonical
ingredient overlap, normalized title tokens, version metadata, and signed
preference signals with a defined cold-start rule. A deterministic simulator
and aggregate readiness gate establish the engineering data contract for the
opt-in `collaborative-v1` experiment. That deterministic user-neighborhood model
uses signed interaction overlap, falls back to `content-v1` for sparse evidence,
and records aggregate training provenance in its offline report. The generated
cohort is not real-user or quality evidence. Hybrid models and online learned
serving remain separate work; no approach should be considered better without a
comparable evaluation report.

## Repository layout

```text
recipe-lab/
|-- frontend/          Next.js and TypeScript web application
|-- backend/           FastAPI, SQLAlchemy, and pytest
|-- ml/                Offline recommenders, data readiness, and evaluation
|-- docs/              Product scope and architecture notes
|-- compose.yaml       Local frontend, API, and PostgreSQL services
`-- .env.example       Documented development configuration
```

## Current foundation

The repository currently provides:

- a responsive Next.js landing page, searchable recipe catalog, and structured
  recipe detail pages with loading, empty, error, rating, and immediate
  parent/current/direct-child lineage states;
- a dedicated `/recipes/{id}/fork` workflow with controlled structured edits
  for recipe details, ingredients, and instructions; validation failures keep
  the entered draft intact, while a successful `201 Created` response opens
  the new child version;
- a dedicated `/recipes/{id}/compare` view for variants, with accessible
  before/after values and distinct treatments for additions, removals,
  substitutions, amount changes, metadata changes, and instruction changes;
- FastAPI health, paginated recipe-browse, and structured recipe-detail
  endpoints with documented response and error schemas;
- a deterministic structured-diff endpoint that compares recipe metadata,
  ingredients, and instructions while preserving exact decimal values;
- a transactional recipe-forking endpoint that copies a complete snapshot,
  applies validated structured edits, and preserves direct parentage;
- a clearly labeled shared demo identity with persistent, retry-safe save,
  unsave, rating, and rating-update actions on exact recipe versions;
- append-only, server-timestamped preference events for explicit detail views,
  saves, ratings, and forks, with typed context and UUID action-key replay
  protection rather than free-form tracking data;
- a read-only `baseline-v1` recommendation API with documented Bayesian quality,
  normalized support, and bounded canonical-ingredient similarity signals,
  deterministic cold-start ordering, and a short reason for every result;
- a versioned, leakage-safe offline evaluation harness with mandatory baseline
  comparison, Precision@K, Recall@K, NDCG@K, coverage, popularity-bias metrics,
  deterministic reports, and an explicitly synthetic verification fixture;
- a reproducible offline `content-v1` recommender that represents structured
  ingredients and recipe metadata, combines positive and negative preference
  signals, and defines deterministic cold-start behavior;
- a versioned, privacy-safe synthetic preference simulator and deterministic
  collaborative-readiness report with explicit raw/effective support, usable
  neighbor evidence, and temporal minimums;
- an opt-in, readiness-gated `collaborative-v1` offline recommender with signed
  user-neighborhood scoring, deterministic content fallback, aggregate artifact
  metadata, and baseline/content comparison;
- a PostgreSQL-backed SQLAlchemy domain model for users, recipe lineages,
  immutable recipe-version snapshots, ingredients, instructions, saves, and
  ratings plus their separate interaction history;
- a canonical ingredient catalog with normalized aliases, category and
  dietary/allergen metadata, and explainable directed substitution edges;
- Alembic migrations and database-level lineage, ordering, rating, event
  privacy, and uniqueness constraints;
- PostgreSQL and local development services through Docker Compose.

The repository also includes a deterministic demo catalog with 25 recipe
lineages, useful variants, ingredient aliases, and directed substitutions.
Original-recipe creation remains a separate milestone. The variant workflow
deliberately omits arbitrary version comparison, graph visualization, row
reordering, autosave, and ML so the core fork, compare, and navigate path stays
focused on the MVP.

## Quick start with Docker

Requirements: Docker Desktop with Docker Compose.

```powershell
Copy-Item .env.example .env
docker compose up --build -d
docker compose exec backend python -m alembic upgrade head
docker compose exec backend python -m app.seeds load
```

Open:

- Web app: <http://localhost:3000>
- Recipe catalog: <http://localhost:3000/recipes>
- API health check: <http://localhost:8000/api/health>
- Recipe browse API: <http://localhost:8000/api/recipes>
- Baseline recommendation API: <http://localhost:8000/api/recommendations>
- Scoped demo identity: <http://localhost:8000/api/me>
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
python -m alembic upgrade head
python -m app.seeds load
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
$env:TEST_DATABASE_URL = "postgresql+psycopg://recipe_lab:recipe_lab@localhost:5432/recipe_lab"
python -m ruff format --check .
python -m ruff check .
python -m mypy app migrations tests
python -m alembic upgrade head
python -m alembic check
python -m pytest
```

The PostgreSQL tests create and remove a uniquely named schema for each test
run. Point `TEST_DATABASE_URL` only at a local or otherwise disposable test
database, never production.

Validate the bundled catalog without writing to the database with
`python -m app.seeds validate`. Seed loading is explicit, transactional, and
safe to rerun; it is never coupled to API startup. See
[seed data](docs/seed-data.md) for its reproducibility and provenance contract.

Run the same frontend checks enforced by CI:

```powershell
cd frontend
npm run lint
npm run typecheck
npm test
npm run build
npx playwright test --list
```

Run the offline evaluation checks and reproduce the synthetic verification
report without touching a live database:

```powershell
cd ml
python -m pip install -e ../backend -e ".[dev]"
python -m ruff format --check src tests
python -m ruff check src tests
python -m mypy src tests
python -m pytest
recipe-lab-eval run --snapshot tests/fixtures/synthetic_snapshot_v1.json `
  --k 5 --k 10 --seed 20260821 --output reports/synthetic-report.json
recipe-lab-eval simulate --catalog tests/fixtures/readiness_catalog_v1.json `
  --profiles 64 --seed 20260822 --output snapshots/readiness-simulated-v1.json
recipe-lab-eval readiness --snapshot snapshots/readiness-simulated-v1.json `
  --output reports/readiness-v2.json --strict
recipe-lab-eval run --snapshot snapshots/readiness-simulated-v1.json `
  --collaborative --k 1 --k 3 --seed 20260822 `
  --output reports/collaborative-v1.json --strict
```

The snapshot's explicit UTC cutoff defines training and holdout data. Each CLI
run evaluates `content-v1` beside the automatically included `baseline-v1` and
reports the metric deltas. `--collaborative` first requires the complete
snapshot to pass the readiness gate, then adds `collaborative-v1`; an
insufficient snapshot exits 3 before fitting or writing an evaluation report.
The synthetic results validate only the engineering contracts, not product
quality or behavior for real users. See
[offline recommendation evaluation](docs/evaluation.md) for the snapshot
command, metric definitions, and leakage/privacy rules, and
[offline content recommender](docs/content-recommender.md) for the exact model
contract. The simulator assumptions, fixed readiness thresholds, and proceed
rule are documented in
[collaborative-filtering data readiness](docs/collaborative-readiness.md); the
signed-neighborhood, fallback, artifact, and interpretation rules are in the
[offline collaborative recommender](docs/collaborative-recommender.md).

The Playwright list command validates test discovery without installing or
launching a browser. To run the browser flow locally, keep the migrated and
seeded backend running, install Chromium once, and then run the suite:

```powershell
cd frontend
npx playwright install chromium
npm run test:e2e
```

Browser flows now exercise the real preference-event contract, including
invisible detail views, so even the ordinary suite appends demo event history.
Use a disposable local database whenever that history matters; rerunning the
seed loader intentionally does not erase it.

The canonical MVP journey intentionally writes a real save and an immutable
recipe variant, so it is skipped during ordinary local browser runs. CI enables
both acceptance guards only after creating a disposable PostgreSQL database.
If you reproduce that test locally, point both applications at a fresh,
disposable database and use dedicated ports before setting both
`MVP_ACCEPTANCE=1` and `ACCEPTANCE_DATABASE_ISOLATED=1`; never run it against a
database whose history you want to keep. Those flags are an explicit safety
acknowledgment, not a database provisioner. The Playwright configuration also
requires explicit application URLs and refuses the normal ports 3000 and 8000
for a guarded local run.

## Continuous integration

The `CI` GitHub Actions workflow runs on every pull request and every push to
`main`. Separate backend and frontend jobs make failures easy to locate. The
backend job starts PostgreSQL 17, applies the migration history, checks for
uncommitted model changes, and runs the schema tests. Python and npm download
caches are keyed from their dependency files; the frontend uses `npm ci` with
the committed `package-lock.json`.

An independent `Offline evaluation` job installs the backend scoring core and
the `ml` package, runs its static checks and tests, then generates the synthetic
`content-v1` versus `baseline-v1` report twice and compares the bytes. It also
verifies same-seed simulator and readiness-report reproducibility, a distinct
changed-seed cohort, and a strict ready result for the engineering fixture. It
then runs the gated collaborative experiment twice at K values 1 and 3, checks
its quality, coverage, and artifact contract, and compares the report bytes. It
is deliberately outside the backend/frontend dependency chain and never starts
a product service.

After the backend and frontend quality jobs pass, the stable `MVP acceptance`
job creates a fresh PostgreSQL 17 database, applies every migration, loads the
deterministic seed catalog, builds the production frontend, and runs the full
Playwright suite with one worker. Its canonical test uses the real API and
database for browse → save → fork → edit → compare, including the 180 g to
140 g sugar change, Walnut-to-Pecan substitution, keyboard navigation, and
WCAG A/AA checks. M1 is not considered complete unless this job passes.

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
the initial boundaries and component responsibilities. The exact scoring and
cold-start contract is documented in
[baseline recommendations](docs/recommendations.md). The fixed-cutoff metrics
and report contract are documented in
[offline recommendation evaluation](docs/evaluation.md), and the structured
features, signed profile, and cold-start formula are documented in
[offline content recommender](docs/content-recommender.md). The engineering
cohort and structural gate are defined in
[collaborative-filtering data readiness](docs/collaborative-readiness.md), and
the signed-neighborhood experiment is documented in the
[offline collaborative recommender](docs/collaborative-recommender.md).
