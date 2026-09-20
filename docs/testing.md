# Testing

Recipe Lab tests behavior at the narrowest useful owner, then adds explicit
cross-layer and browser evidence for boundaries that cannot be proved locally.
Tests protect product and architecture invariants; they should not freeze a
wrapper, callback shape, or file boundary that is not itself a contract.

The checked-in orchestration entry point is
`scripts/run_quality_gate.py`. CI calls the same suites rather than maintaining
a second command list.

## Prepare a quality environment

Start a disposable/local PostgreSQL instance and install locked dependencies:

```powershell
docker compose up -d db

uv lock --check
uv sync --frozen --all-packages --all-extras
uv pip check

cd frontend
npm ci
cd ..
```

Backend tests create a uniquely named schema and remove it after the run. The
`backend` quality suite also migrates and checks the application database named
by `DATABASE_URL` before Pytest starts. Point both variables only at the intended
local or otherwise disposable PostgreSQL database:

```powershell
$env:DATABASE_URL = "postgresql+psycopg://recipe_lab:recipe_lab@localhost:5432/recipe_lab"
$env:TEST_DATABASE_URL = "postgresql+psycopg://recipe_lab:recipe_lab@localhost:5432/recipe_lab"
```

Never run the backend, acceptance, performance, release, sandbox, or recovery
test harnesses against production.

## Stable local gates

Run one or more suites from the repository root:

```powershell
python scripts/run_quality_gate.py contracts
python scripts/run_quality_gate.py lint types
python scripts/run_quality_gate.py backend frontend ml
```

The available suites own these checks:

| Suite | Evidence |
| --- | --- |
| `contracts` | repository policy, backend/frontend architecture, documentation links, OpenAPI, seeds, generated API types, and CSS contracts |
| `lint` | backend, ML, and script Ruff checks plus frontend ESLint |
| `types` | strict backend/ML Mypy plus generated Next.js and TypeScript types |
| `backend` | migration upgrade/check and PostgreSQL-backed Pytest suite |
| `frontend` | Vitest, frontend architecture, source reachability, production build, and browser-mode discovery |
| `ml` | deterministic offline-research Pytest suite |

From `frontend`, `npm run ci:verify` is a convenience alias for the same
`frontend` suite. On Windows the orchestrator uses Vitest's portable runner
loader.

The contract gate does not install dependencies and does not run the external
workflow linter. To reproduce those additional checks:

```powershell
docker compose config --quiet
docker run --rm `
  --volume "${PWD}:/repo:ro" `
  --workdir /repo `
  docker.io/rhysd/actionlint:1.7.7@sha256:887a259a5a534f3c4f36cb02dca341673c6089431057242cdc931e9f133147e9 `
  -color
```

## Test placement

Use the smallest layer that proves the behavior:

| Test kind | Location | Purpose |
| --- | --- | --- |
| Backend unit/integration | `backend/tests` | Policies, services, repositories, API contracts, migrations, and real PostgreSQL behavior |
| Frontend unit/component | Beside its owner in `app`, `features`, `shared`, `shell`, `server`, or `scripts` | One production owner and its rendered behavior |
| Frontend config/contract | `frontend/tests/config` or `frontend/tests/contracts` | Cross-cutting configuration, language, route, architecture, and inventory rules |
| Shared test support | `frontend/tests/support` or an owner-local `*-test-support` module | Reusable fixtures without becoming production state |
| Browser journey | One explicit directory under `frontend/e2e` | Cross-service behavior in a named execution mode |
| Script unit tests | `scripts/tests` | Release, packaging, verification, and orchestration behavior |
| Offline research | `ml/tests` | Deterministic evaluation and recommendation experiments |

Use `.test.ts`, `.test.tsx`, or `.test.mjs` for Vitest and `.spec.ts` for
Playwright. Do not create a generic integration dumping ground or move a test
away from a clear production owner merely to centralize files.

Backend route tests may use the shared application harness, but feature
fixtures still own actor and domain setup. Repositories do not gain commits for
test convenience. When a test deliberately permits internal flushes or commits,
the connection-owned outer rollback helper must make that transaction policy
visible in the test.

## Frontend checks

Run focused tests while iterating, then the relevant broader gates:

```powershell
cd frontend
npm test -- --configLoader=runner path/to/owner.test.tsx
npm run lint
npm run typecheck
npm test -- --configLoader=runner
npm run architecture:check
npm run reachability:check
npm run styles:contracts:check
npm run build
npm run test:e2e:discover
```

`architecture:check` enforces feature/domain ownership and the `app`
composition boundary. `reachability:check` walks maintained production imports;
it is not permission to remove compatibility routes or external API operations.
`styles:contracts:check` protects the CSS ownership rules. Browser-mode
discovery loads every configuration with inert allowlisted values, requires a
nonempty selection, and starts no server or browser.

Coverage is diagnostic, not a release threshold:

```powershell
npm run test:coverage
```

It writes ignored output under `frontend/coverage`. Delete it when review is
complete. Do not add low-value assertions merely to increase a percentage.

## Browser execution modes

Every Playwright invocation selects exactly one mode. Unqualified
`npm run test:e2e` and `npx playwright test` intentionally fail because they
cannot safely mix controlled fixtures with guarded stateful tests.

| Mode | Command | Boundary |
| --- | --- | --- |
| Smoke | `npm run test:e2e:smoke` | Short controlled-data public journeys; no real account or database authority |
| Acceptance | `npm run test:e2e:acceptance` | Isolated PostgreSQL plus provisioned digest-only synthetic sessions |
| Performance | `npm run test:e2e:performance` | Isolated public-route measurements against the reviewed JSON budget |
| Release | `npm run test:e2e:release` | Stateful local OIDC, role, privacy, deletion, backup, and restore proof |
| Sandbox | `npm run test:e2e:sandbox` | Isolated temporary-account profile and generation-bound behavior |
| Visual/accessibility | `npm run test:e2e:visual` | Built frontend, sanitized fixtures, screenshots, overflow, keyboard, and accessibility checks |

Smoke mode is the only ordinary pull-request browser suite. Install its engines
and run either Chromium alone or the complete small cross-engine selection:

```powershell
cd frontend
npx playwright install chromium
npm run test:e2e:smoke -- --project=chromium

npx playwright install firefox webkit
npm run test:e2e:smoke
```

Acceptance, performance, release, and sandbox modes require their guard flags,
exact disposable database names, loopback service URLs, and temporary fixture
paths. Prefer the checked-in CI or rehearsal wrappers over reconstructing those
environments by hand. Guard flags acknowledge isolation; they do not create it.
Raw tokens may exist only in restricted temporary fixture files and must be
deleted after the run.

The visual command builds before comparing. Update goldens only after an
intentional visual change has been reviewed:

```powershell
npm run test:e2e:visual -- --update-snapshots=all
```

CI's pinned browser, operating system, fonts, locale, time, and fixtures define
authoritative output. Inspect every changed expected image. Never approve an
actual/diff image or a screenshot containing real member data as a baseline.
Reviewed baseline PNG changes also require a manual safe-source opaque-object
policy update; see [Operations](operations.md#safe-source-packaging).

## API and schema contracts

The backend OpenAPI snapshot and generated frontend types are committed review
artifacts. Check them without rewriting:

```powershell
cd backend
python -m app.openapi_contract check

cd ..\frontend
npm run api:contracts:check
```

After an intentional HTTP contract change, preserve stable `operationId`
values unless the identifier itself is deliberately changing, update consumer
evidence and lifecycle metadata, then regenerate and review both artifacts:

```powershell
cd backend
python -m app.openapi_contract write

cd ..\frontend
npm run api:contracts:generate
npm run api:contracts:check
```

Generated TypeScript is a compile-time wire contract, not another HTTP client.
Feature parsers and domain/view models retain runtime validation and privacy
responsibilities. The shared transport continues to own same-origin routing,
sessions, CSRF, idempotency headers, cancellation, and safe failures.

For a migration, run the migration and backend suites against PostgreSQL and
include upgrade/check coverage. For a seed change, run
`python -m app.seeds validate`. For a documentation move, run
`python scripts/verify_doc_links.py` and search for executable references to the
old path.

## CI tiers

`Repository quality` is the stable aggregate check.

- Pull requests use the **fast** tier: contracts, lint, types, security,
  PostgreSQL-backed backend tests, frontend tests/build, controlled-data
  Chromium smoke, and one Firefox/WebKit sanity journey.
- Pushes to `main`, nightly schedules, and manual runs use the **full** tier. It
  adds offline evaluation, verified production images, safe-source packaging,
  authenticated MVP/sandbox journeys, the stateful community release journey,
  public performance, and deterministic visual/accessibility baselines.

Full-only jobs are expected to be skipped on pull requests; the aggregate
accepts that skip only for the inactive tier. Failures and cancellations always
fail closed. The separately triggered `Release rehearsal` workflow adds source,
image, migration, deletion-ledger recovery, smoke, and compatible application
rollback evidence; see [Recovery](reference/recovery.md).

## Privacy and artifact rules

Controlled smoke and sanitized visual fixtures may retain their reviewed
diagnostics. Authenticated, release, sandbox, and recovery paths must not retain
real or synthetic private payloads beyond their bounded disposable run.

Do not upload raw session fixtures, database dumps, deletion ledgers, server
logs, browser traces, screenshots, videos, request/response bodies, OIDC values,
report text, moderator notes, or private recipe text. Release automation keeps
only bounded identifier-free summaries. Secret findings must never be printed
or pasted into an issue. The complete boundary is in
[Security](security.md#logs-scans-and-test-evidence).
