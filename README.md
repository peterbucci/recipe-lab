# Recipe Lab

Recipe Lab is a portfolio project for exploring a simple idea: recipes should be
structured, versioned objects whose history stays understandable as cooks make
changes.

**Find recipes, make your own version, compare what changed, and follow recipe
history.** Those are the current public product capabilities. Recipe Lab does
not currently present recommendations or automatic substitutions to cooks.

## Product sequence

### MVP: prove structured recipe versioning

A user should be able to:

1. Browse a small, curated recipe catalog.
2. View structured ingredients, quantities, units, and instructions.
3. Make a recipe into your own version.
4. See an exact comparison with the version it is based on.
5. Save and rate versions.
6. Follow a recipe's history.

The concrete proof point is: make your own version of a carrot cake, reduce its
sugar, replace walnuts with pecans, and preserve both the changes and what it is
based on.

### Research preview: deterministic ranking data

Recipe Lab now has the schema needed to connect authored recipe text to
canonical ingredients, aliases, broad categories, dietary flags, allergens,
and directed substitution relationships. A curated, deterministic demo catalog
now exercises that structure. The product also records privacy-bounded,
timestamped view, save, rating, and fork events with retry-safe action IDs.
Those signals can be read by the API-only, research-preview `baseline-v1`
ranking endpoint. Every request uses aggregate activity for publicly readable
recipes. Signed-in personalization additionally uses only the active member's
account-specific history; signed-out requests load no account-specific history.
The baseline is request-time scoring, not a trained ML system, and it is not
exposed as a consumer recommendation surface.

### Offline research, not shipped product

The ML roadmap begins with a transparent popularity or rule-based baseline,
which is now available as the comparison point for later work. A separate
fixed-cutoff offline harness now measures that baseline reproducibly.
`content-v1` is the first offline comparison model: it combines canonical
ingredient overlap, normalized title tokens, version metadata, and signed
preference signals with a defined cold-start rule. A deterministic simulator
and aggregate readiness gate establish the engineering data contract for the
opt-in `collaborative-v1` experiment. That deterministic user-neighborhood model
uses signed interaction overlap, falls back to `content-v1` for sparse evidence,
and records aggregate training provenance in its offline report. The offline
`hybrid-v1` experiment now fuses baseline, content, and collaborative ranks with
explicit cold-start routes and a conservative same-split adoption decision. The
generated cohort retains the simpler approach and is not real-user or product
quality evidence. A separate offline `substitution-rules-v1` engine evaluates
curated direct replacements, declared dietary/allergen constraints, recipe
context, and explicit preference weights before any learned substitution
ranking is attempted. These offline strategies are engineering experiments, not
shipped product features. Online learned serving remains separate work; no
approach should be considered better without a comparable evaluation report.

See [product language and recommendation boundary](docs/product-language.md)
for the cook-facing terminology, research-preview rules, actual-member data
boundary, and explicit staff/diagnostic exceptions.

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
- a dedicated `/recipes/{id}/fork` workflow that copies the exact immutable
  source into a private draft; the unified editor supports reviewed ingredient,
  quantity, unit, instruction, and action controls, preserves entered values
  after errors, and keeps publishing separate from private saving;
- a bounded canonical-and-alias ingredient lookup plus a separate member
  missing-item request queue, narrow curator authorization, transactional
  approval with provenance, and append-only catalog audit evidence;
- a dedicated `/recipes/{id}/compare` view for variants, with accessible
  before/after values and distinct treatments for additions, removals,
  substitutions, amount changes, metadata changes, and instruction changes;
- distinct FastAPI liveness and database-readiness probes, fresh server-issued
  correlation IDs, privacy-safe fixed failure events, and paginated
  recipe-browse and structured recipe-detail endpoints with documented response
  and error schemas;
- a deterministic structured-diff endpoint that compares recipe metadata,
  ingredients, instruction prose, and reviewed action graphs while preserving
  exact decimal values and resolving every action input on both sides;
- a transactional recipe-forking endpoint that copies a complete snapshot,
  remaps structured action inputs to fresh child ingredient occurrences,
  applies validated structured edits, and preserves direct parentage;
- configurable hosted OIDC sign-in with Authorization Code plus PKCE,
  server-managed opaque sessions, CSRF-protected account mutations, and an
  accessible onboarding/account UI;
- anonymous public recipe browsing and comparison, with member-specific save,
  unsave, rating, and recorded-view activity plus authenticated fork creation
  bound exclusively to the signed-in, onboarded member selected by the session;
- exact-version public cook attribution, direct-parent author context bounded by
  public visibility, paginated public cook profiles, and session-only My
  Recipes and Saved Recipes libraries without per-card API requests;
- author-controlled recipe withdrawal and restoration through one shared public
  read predicate, with unavailable-source tombstones that preserve public
  descendants without leaking hidden parent content;
- recent-provider-authenticated account deletion that revokes every session,
  erases private identity and activity, and retains immutable public topology
  only under unlinked `Deleted cook` attribution, backed by a reviewed
  table/field/artifact governance manifest and schema-drift test;
- explicit publication rights/community-rules confirmations, private bounded
  member reports, a separate operator-managed moderator role, de-identified
  case review, independent hide/restore state, and append-only decision audits;
- durable pseudonymous account/identity/network rate limits for sensitive write
  seams plus an application-wide request-body limit with stable 429 and 413
  responses;
- append-only, server-timestamped preference events for explicit detail views,
  saves, ratings, and forks, with typed context and UUID action-key replay
  protection scoped by member and operation rather than free-form tracking
  data;

Research-preview engineering capabilities, which are not consumer product
surfaces, include:

- a read-only `baseline-v1` ranking API with documented Bayesian quality,
  normalized support, and bounded canonical-ingredient similarity signals,
  isolated signed-in history, deterministic anonymous cold-start ordering, and
  a short reason for every result;
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
- an opt-in `hybrid-v1` offline rank-fusion experiment with explicit baseline,
  content, and collaborative component scores, deterministic cold-start reasons,
  and a versioned policy that retains the simpler model unless aggregate results
  clear every quality, support, and coverage guardrail;
- an offline `substitution-rules-v1` engine that filters curated directed edges
  by declared dietary/allergen constraints, orders eligible replacements with
  relationship evidence, recipe context, and explicit preference weights, and
  emits ratio-or-guidance, provenance-or-confidence, explanations, and an
  unknown-metadata caution;

Core data and platform capabilities also include:

- a PostgreSQL-backed SQLAlchemy domain model for users, recipe lineages,
  immutable recipe-version snapshots, ingredients, instructions, saves, and
  ratings plus their separate interaction history;
- a canonical ingredient catalog with normalized aliases, category and
  dietary/allergen metadata, explainable directed substitution edges, and a
  reviewed intake boundary that never treats member text as catalog identity;
- a curated cooking-action vocabulary and dual prose/structured instruction
  model with ordered occurrence inputs plus exact/range duration and
  temperature parameters using curated units;
- versioned, deterministic structural recipe fingerprints that normalize only
  reviewed safe conversions, preserve repeated occurrences and ordered action
  graphs, and confirm digest candidates against exact canonical JSON;
- a public-only, advisory duplicate preflight with versioned explainable
  similarity, direct-parent no-change warnings, and immutable acknowledgements;
- private persistent original and fork drafts with session-owned authorship,
  optimistic revisions, catalog-backed structured content, separate unresolved
  ingredient-request state, and immediate irreversible discard;
- original and source-backed fork publication that requires a revision-bound,
  source-aware similarity review, records an explicit advisory continue when
  needed, and atomically creates one immutable snapshot plus a durable
  publication receipt;
- deterministic sanitized desktop/phone visual baselines with fixed browser,
  fonts, locale, time, IDs, fixtures, keyboard/accessibility checks, and a
  public performance budget recorded before frontend refactoring;
- Alembic migrations and database-level lineage, ordering, rating, event
  privacy, and uniqueness constraints;
- PostgreSQL and local development services through Docker Compose.

The repository also includes a deterministic demo catalog with 25 recipe
lineages, useful variants, ingredient aliases, and directed substitutions.
Saving a draft deliberately creates no lineage, recipe version, fingerprint,
preference event, or recommendation signal. Publishing a saved source-less
draft creates one immutable original root. Publishing a saved fork draft locks
the existing lineage, preserves its exact public source as the direct parent,
attributes the child to the authenticated publisher, and records exactly one
fork event. RCP-29 presents that bounded attribution on recipe cards, details,
and public cook profiles while keeping drafts and saves inside private member
libraries. Authors can now withdraw or restore their own snapshots without
deleting valid descendants, and deleting an account retains only anonymous
public topology under `Deleted cook`. See
[cook profiles and recipe libraries](docs/cook-profiles-and-libraries.md) and
[private recipe drafts](docs/private-recipe-drafts.md), plus
[recipe visibility and account lifecycle](docs/recipe-visibility-and-account-lifecycle.md)
and [community rules, reporting, and moderation](docs/community-moderation.md).

## Quick start with Docker

Requirements: Docker Desktop with Docker Compose.

Compose explicitly builds the `development` targets with source mounts and
reload behavior. The separate locked `production` targets are verified without
publishing or deploying them; see
[locked dependencies and production images](docs/production-images.md).

```powershell
Copy-Item .env.example .env
docker compose build
docker compose up -d db
# Existing databases only: continue only when this exits successfully.
docker compose run --rm backend recipe-lab-measurements audit-legacy --format json
if ($LASTEXITCODE -ne 0) { throw "Resolve the measurement audit before migrating." }
docker compose run --rm backend python -m alembic upgrade head
docker compose run --rm backend python -m app.seeds load
docker compose up -d backend frontend
```

Skip the audit command and its exit-code check for a fresh empty database,
where the legacy recipe table does not exist yet. This order keeps the new
application processes stopped until the fail-closed audit and migration have
succeeded.

Open:

- Web app: <http://localhost:3000>
- Recipe catalog: <http://localhost:3000/recipes>
- API health check: <http://localhost:8000/api/health>
- API database readiness check: <http://localhost:8000/api/readiness>
- Recipe browse API: <http://localhost:8000/api/recipes>
- Research-preview baseline ranking API (no consumer UI):
  <http://localhost:8000/api/recommendations>
- Private draft API: `POST` or `GET /api/recipe-drafts`
- Draft similarity API: `POST /api/recipe-drafts/{id}/duplicate-preflights`
- Draft publication API: `POST /api/recipe-drafts/{id}/publish`
- Public cook profile API: `GET /api/cooks/{handle}`
- My Recipes API: `GET /api/my/recipes?view=drafts|published|withdrawn`
- Saved Recipes API: `GET /api/my/saved-recipes`
- Recipe visibility API: `PUT /api/recipes/{id}/visibility`
- Recipe report API: `POST /api/recipes/{id}/reports`
- Moderator queue API: `GET /api/moderation/recipe-reports`
- Account session status: <http://localhost:3000/api/auth/session>
- Account deletion API: `DELETE /api/auth/account` with an exact
  `confirmation` phrase
- Interactive API docs: <http://localhost:8000/docs>

Community-moderator grants are deployment operations, not browser actions. Use
`python -m app.moderators eligible`, `list`, `grant`, or `revoke` from the
backend environment; see the moderation document above for the bounded command
contract.

Stop the services with `docker compose down`. Add `--volumes` only when you
intentionally want to discard local database data.

## Run services directly

Start PostgreSQL first (the `db` Compose service is fine), then run the API:

```powershell
cd backend
uv lock --check
uv sync --frozen --package recipe-lab-api --extra dev
uv pip check
..\.venv\Scripts\Activate.ps1
python -m alembic upgrade head
python -m app.seeds load
uvicorn app.main:app --reload
```

In another terminal, run the web application:

```powershell
cd frontend
npm ci
npm run dev
```

## Tests and checks

Run the same backend checks enforced by CI:

```powershell
cd backend
$env:TEST_DATABASE_URL = "postgresql+psycopg://recipe_lab:recipe_lab@localhost:5432/recipe_lab"
uv lock --check
uv sync --frozen --package recipe-lab-api --extra dev
uv pip check
..\.venv\Scripts\Activate.ps1
python -m ruff format --check .
python -m ruff check .
python -m mypy app migrations tests
python -m app.openapi_contract check
python -m alembic upgrade head
python -m alembic check
python -m pytest
```

The PostgreSQL tests create and remove a uniquely named schema for each test
run. Point `TEST_DATABASE_URL` only at a local or otherwise disposable test
database, never production.

The backend OpenAPI contract is committed at `backend/openapi.json`. From
`backend`, use `python -m app.openapi_contract check` to detect drift and
`python -m app.openapi_contract write` only after an intentional contract change
has been reviewed. The four operation classifications, consumer-evidence rules,
stable operation-ID policy, and unresolved external-consumer boundary are in
[backend API contract baseline](docs/api-contracts.md).

Validate the bundled catalog without writing to the database with
`python -m app.seeds validate`. Seed loading is explicit, transactional, and
safe to rerun; it is never coupled to API startup. See
[seed data](docs/seed-data.md) for its reproducibility and provenance contract.
The reviewed vocabulary, authoring, fork, diff, and recommendation boundaries
for instruction graphs are documented in
[structured cooking actions](docs/cooking-actions.md).
Hosted account setup and the boundary between signed-in members and the shared
demo interaction profile are documented in
[account authentication and sessions](docs/authentication.md).

Run the same frontend checks enforced by CI:

```powershell
cd frontend
npm run lint
npm run typecheck
npm test
npm run build
npx playwright test --list
npm run test:e2e:baseline -- --list
```

Run the offline evaluation checks and reproduce the synthetic verification
report without touching a live database:

```powershell
cd ml
uv lock --check
uv sync --frozen --package recipe-lab-evaluation --extra dev
uv pip check
..\.venv\Scripts\Activate.ps1
python -m ruff format --check src tests
python -m ruff check src tests
python -m mypy src tests
python -m pytest
recipe-lab-eval run --snapshot tests/fixtures/synthetic_snapshot_v2.json `
  --k 5 --k 10 --seed 20260821 --output reports/synthetic-report.json
recipe-lab-eval simulate --catalog tests/fixtures/readiness_catalog_v2.json `
  --profiles 64 --seed 20260822 --output snapshots/readiness-simulated-v1.json
recipe-lab-eval readiness --snapshot snapshots/readiness-simulated-v1.json `
  --output reports/readiness-v2.json --strict
recipe-lab-eval run --snapshot snapshots/readiness-simulated-v1.json `
  --collaborative --k 1 --k 3 --seed 20260822 `
  --output reports/collaborative-v1.json --strict
recipe-lab-eval run --snapshot snapshots/readiness-simulated-v1.json `
  --hybrid --k 1 --k 3 --seed 20260822 `
  --output reports/hybrid-v1.json --strict
recipe-lab-eval substitution-run `
  --benchmark tests/fixtures/substitution_benchmark_v1.json `
  --output reports/substitution-rules-v1.json --strict
```

The snapshot's explicit UTC cutoff defines training and holdout data. Each CLI
run evaluates `content-v1` beside the automatically included `baseline-v1` and
reports the metric deltas. `--collaborative` first requires the complete
snapshot to pass the readiness gate, then adds `collaborative-v1`; an
insufficient snapshot exits 3 before fitting or writing an evaluation report.
The mutually exclusive `--hybrid` suite applies the same gate and evaluates
baseline, collaborative, content, and hybrid models on one split. Its report
contains an aggregate `hybrid_adoption` decision; retaining a simpler model is a
successful evaluation and does not make the command fail.
The synthetic results validate only the engineering contracts, not product
quality or behavior for real users. The substitution command uses its own
synthetic direct-edge benchmark rather than the temporal recommendation
snapshot. Its `engineering_validated` result confirms deterministic rule and
report behavior only; it does not establish taste, cooking success,
cross-contact safety, or demand for a product surface. Relationship confidence
describes curation of an edge, not medical, allergen, or food-safety confidence.
See
[offline recommendation evaluation](docs/evaluation.md) for the snapshot
command, metric definitions, and leakage/privacy rules, and
[offline content recommender](docs/content-recommender.md) for the exact model
contract. The simulator assumptions, fixed readiness thresholds, and proceed
rule are documented in
[collaborative-filtering data readiness](docs/collaborative-readiness.md); the
signed-neighborhood, fallback, artifact, and interpretation rules are in the
[offline collaborative recommender](docs/collaborative-recommender.md). The
rank-fusion routes, reasons, and adoption guardrails are in the
[offline hybrid recommender](docs/hybrid-recommender.md). The curated candidate,
hard-constraint, ordering, caution, and benchmark contracts are in the
[offline substitution rules engine](docs/substitution-engine.md).

The Playwright list command validates test discovery without installing or
launching a browser. To run the browser flow locally, keep the migrated and
seeded backend running, install Chromium once, and then run the suite:

```powershell
cd frontend
npx playwright install chromium
npm run test:e2e
```

Ordinary browser flows stay anonymous: they can browse, inspect, and compare
recipes without creating private activity. Authenticated activity is covered by
the guarded acceptance run below.

The separate RCP-34B suite captures only sanitized invented states. Run its
single-pass comparison from `frontend` with
`npm run test:e2e:baseline`; use
`npm run test:e2e:baseline:update` only after an intentional UI change has been
reviewed. CI uses the pinned Playwright 1.62.1 Noble container and compares the
complete suite twice, so an image produced on a different browser, OS, or font
stack is not an authoritative golden. The exact desktop/phone state matrix,
fixture privacy contract, accessibility checks, screenshot review procedure,
performance budgets, and artifact-retention rules are in
[deterministic regression baselines](docs/regression-baselines.md).

The canonical MVP journey intentionally writes real member activity and an
immutable recipe variant, so it is skipped during ordinary local browser runs.
CI provisions short-lived sessions for five synthetic members, including a
narrow curator, a separate recipe moderator, and an account-deletion fixture,
directly in its isolated database. This is a command-line test fixture, not a
production HTTP authentication route: PostgreSQL receives only session and CSRF digests,
while the raw tokens exist only in a private temporary JSON file consumed by
Playwright.

To reproduce the authenticated run locally, create a fresh PostgreSQL database
named exactly `recipe_lab_acceptance_local`. Point both applications at that
database, use dedicated frontend/backend ports such as 3100 and 8100, and set:

```powershell
$env:DATABASE_URL = "postgresql+psycopg://recipe_lab:recipe_lab@127.0.0.1:5432/recipe_lab_acceptance_local"
$env:MVP_ACCEPTANCE = "1"
$env:ACCEPTANCE_DATABASE_ISOLATED = "1"
$env:ACCEPTANCE_SESSION_FIXTURE = Join-Path ([System.IO.Path]::GetTempPath()) "recipe-lab-acceptance-sessions.json"
$env:CORS_ORIGINS = "http://127.0.0.1:3100"
$env:AUTH_ALLOWED_ORIGINS = "http://127.0.0.1:3100"
$env:RECIPE_API_URL = "http://127.0.0.1:8100"
$env:NEXT_PUBLIC_API_URL = "http://127.0.0.1:8100"
$env:PLAYWRIGHT_BASE_URL = "http://127.0.0.1:3100"
$env:PLAYWRIGHT_WEB_SERVER_COMMAND = "npm run start -- --hostname 127.0.0.1 --port 3100"
```

After migrating and seeding from `backend`, run
`python -m app.testing.acceptance_sessions`, start the backend on port 8100,
build the frontend, and run `npm run test:e2e`. The provisioner refuses every
database name except `recipe_lab_acceptance` (CI) and
`recipe_lab_acceptance_local` (local), refuses a non-temporary fixture path, and
will not overwrite an existing token file. Delete that file after the run. The
two guard flags acknowledge a disposable target; they do not create one.

### Safe source export

To share source, package an explicit committed revision with the repository's
fail-closed exporter. Run it only from a clean tree and put both outputs outside
the checkout:

```powershell
$revision = git rev-parse --verify 'HEAD^{commit}'
$shortRevision = $revision.Substring(0, 12)
$exportDirectory = Join-Path ([System.IO.Path]::GetTempPath()) `
  ("recipe-lab-source-" + [System.Guid]::NewGuid())
$archive = Join-Path $exportDirectory "recipe-lab-source-$shortRevision.zip"
python scripts/package_source.py --ref $revision --output $archive
```

The command reads tracked blobs from Git rather than the working directory,
applies the bounded source allowlist, scans before archive creation, reopens and
scans the completed archive, and emits a SHA-256 manifest next to the ZIP. It
never overwrites prior output. See [safe source packaging](docs/source-packaging.md)
for the policy, limits, deterministic-output contract, and credential-rotation
boundary.

## Continuous integration

The `CI` GitHub Actions workflow runs on every pull request and every push to
`main`. Separate backend and frontend jobs make failures easy to locate. The
backend job starts PostgreSQL 17, applies the migration history, checks for
uncommitted model changes, runs a separately attributed committed-OpenAPI drift
check, and runs the schema tests. Every Python job installs
immutable `uv 0.12.6`, requires the single root `uv.lock` to match both
workspace members, and uses a frozen package-specific sync followed by
`uv pip check`. The frontend uses `npm ci` with the committed
`package-lock.json`. Download caches are keyed from those lockfiles and never
replace their resolution checks.

The required `RCP-34B deterministic baselines` job runs the synthetic
visual/accessibility suite in an immutable linux/amd64 Playwright 1.62.1 Noble
image with bundled Chromium 151.0.7922.34. It fixes the two viewports and all
environmental inputs and requires two successful comparisons while stability
is being established. It uploads only a privacy-reviewed public aggregate JSON
for 7 days and, on failure, sanitized actual/diff PNGs for 7 days. It never
uploads traces, video, HTML reports, network logs, expected images, fixture
responses, or a whole browser-output directory.

The independent stable `Production images` job performs clean, no-cache builds
of both Dockerfile `production` targets. Its reviewed verifier rejects
development commands, root runtime users, missing health checks, embedded
credential configuration, acceptance/test packages, caches, reports,
development dependencies, and package/build tools. It also proves that invalid
production configuration fails without echoing synthetic private values, then
starts a migrated disposable PostgreSQL database and both images. It proves
backend `/api/health`, database-backed `/api/readiness`, frontend `/healthz`,
fresh correlation IDs, and fail-closed readiness after PostgreSQL is stopped.
Images remain local to the disposable runner, are never uploaded or pushed, and
are removed after the check. See
[locked dependencies and production images](docs/production-images.md) for the
update, build, smoke-test, and no-deploy contracts. The fixed event allowlist,
operator signals, retention, redaction, and rollback procedure are in
[privacy-safe operations and observability](docs/operations-observability.md).

An independent `Offline evaluation` job installs the backend scoring core and
the `ml` package, runs its static checks and tests, then generates the synthetic
`content-v1` versus `baseline-v1` report twice and compares the bytes. It also
verifies same-seed simulator and readiness-report reproducibility, a distinct
changed-seed cohort, and a strict ready result for the engineering fixture. It
then runs the gated collaborative experiment twice at K values 1 and 3, checks
its quality, coverage, and artifact contract, and compares the report bytes. It
also runs the complete hybrid suite twice, checks its exact synthetic metrics
and conservative `retain_simpler` decision, and compares those report bytes. It
then runs the substitution rules benchmark twice, compares the report bytes,
and checks the exact aggregate validation result. It is deliberately outside
the backend/frontend dependency chain and never starts a product service.

After the backend and frontend quality jobs pass, the stable `MVP acceptance`
job creates a fresh PostgreSQL 17 database, applies every migration, loads the
deterministic seed catalog, provisions Alice and Bob through the isolated
session harness, builds the production frontend, and runs the full Playwright
suite with one worker. Its canonical tests use the real session, CSRF, API, and
database paths to prove anonymous read-only access and two-member activity
isolation across browse → save → fork → edit → compare, including the 180 g to
140 g sugar change, Walnut-to-Pecan substitution, keyboard navigation, and
WCAG A/AA checks. The temporary raw-token fixture is deleted after the suite
and is never uploaded with diagnostics. M1 is not considered complete unless
this job passes. Before that state-mutating journey, the same fixed Ubuntu 24.04
job checks the committed RCP-34B public performance baseline against the fresh
seeded stack. API latency, bounded query counts, selected production JavaScript
sizes, and public-page responsiveness must remain within their reviewed
budgets; an ignored aggregate observation is never promoted automatically.

The later stable `RCP-32 community release gate` is the deployment handoff for
the account-backed community product. A separate fresh-database job creates
Alice, Bob, a curator, and a moderator through a guarded loopback OIDC provider
and runs one stateful production-build journey across ingredient approval,
private authoring, original publication, cross-user forking, duplicate advice,
reporting, visibility, and account deletion. It also rehearses migration
rollback and re-upgrade, stages fixed legacy Demo Cook activity to prove that
account creation never claims it, verifies a real backup/restore, and scans
retained evidence for private values. Only identifier-free aggregate JSON
summaries are retained. RCP-21 remains blocked until that aggregate check
passes. The aggregate also explicitly requires the independent RCP-34B
visual/accessibility result and the MVP job that owns the public performance
check; the private RCP-32 job and its no-raw-artifact policy are unchanged.
Offline ML evaluation is intentionally independent. See the
[community release gate](docs/community-release-gate.md) for the exact contract
and guarded local reproduction.

The separate `RCP-33G automated rehearsal` exercises one exact candidate
commit, its safe-source archive, exact local candidate and representative
ancestor image IDs, pinned
source/dependency/image security scans, migration and failed-migration
recovery, an older pre-deletion backup plus durable deletion-ledger replay,
candidate smoke, and a schema-compatible image rollback without a database
downgrade. It runs for changes to the rehearsal boundary and can be started
manually for a chosen release candidate; it does not replace the stable RCP-32
gate on ordinary pull requests. Raw dumps, ledgers, scans, logs, manifests, and
images remain in temporary runner storage; only bounded identifier-free
evidence is retained.
Passing automation does not complete the separate owner-only inventory and
rotation of live deployment credentials. See
[release, recovery, and rollback rehearsal](docs/release-rehearsal.md).

The independent `Safe source package` job tests the exporter and creates the
selected CI commit twice in runner-temporary storage to prove deterministic
archive and manifest bytes. It never uploads either output and always deletes
them. The stable RCP-32 aggregate check requires this source-safety job and the
production-image check alongside the deployable application gates. Committed
RCP-34B golden PNGs are opaque source objects: each new or changed image must be
visually reviewed and bound to its exact Git object ID in the export policy.
Generated actual/diff images and performance observations remain rejected test
output.

## Working agreements

- Keep recipe data normalized enough to compare variants without hiding the
  original author intent.
- Preserve recipe history: every version remains linked to the version it is
  based on.
- Prefer explainable baselines over premature model complexity.
- Treat seed recipes, ingredient metadata, and evaluation datasets as versioned
  project assets with documented provenance.
- Keep credentials out of source control; `.env.example` contains local-only
  defaults, not production values.

See [MVP scope](docs/mvp-scope.md) and [architecture](docs/architecture.md) for
the initial boundaries and component responsibilities. The exact scoring and
cold-start contract for the API-only research preview is documented in
[baseline ranking research](docs/recommendations.md). The fixed-cutoff metrics
and report contract are documented in
[offline recommendation evaluation](docs/evaluation.md), and the structured
features, signed profile, and cold-start formula are documented in
[offline content recommender](docs/content-recommender.md). The engineering
cohort and structural gate are defined in
[collaborative-filtering data readiness](docs/collaborative-readiness.md), and
the signed-neighborhood experiment is documented in the
[offline collaborative recommender](docs/collaborative-recommender.md). The
offline rank-fusion and model-adoption policy are documented in the
[offline hybrid recommender](docs/hybrid-recommender.md). The deterministic
substitution baseline, declared-tag filtering, and non-safety boundary are documented in
the [offline substitution rules engine](docs/substitution-engine.md).
