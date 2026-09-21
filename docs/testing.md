# Testing

Recipe Lab uses several test layers because different failures are easiest to catch at different boundaries.

For most changes, start with the smallest test that owns the behavior you are changing. Run the broader repository checks before the change is considered complete. Browser, performance, visual, and release suites are reserved for changes that need those environments.

## Quick reference

From the repository root, the main quality suites are:

```powershell
python scripts/run_quality_gate.py contracts
python scripts/run_quality_gate.py lint types
python scripts/run_quality_gate.py backend frontend ml
```

The suites cover:

| Suite       | What it checks                                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| `contracts` | Repository policy, architecture rules, documentation links, OpenAPI, seed data, generated API types, and CSS contracts |
| `lint`      | Python Ruff checks and frontend ESLint                                                                                 |
| `types`     | Backend/ML Mypy plus Next.js and TypeScript type checking                                                              |
| `backend`   | Migrations and the PostgreSQL-backed backend test suite                                                                |
| `frontend`  | Vitest, architecture checks, source reachability, production build, and browser-mode discovery                         |
| `ml`        | Deterministic offline evaluation and recommendation tests                                                              |

From `frontend/`, this is the same frontend suite:

```powershell
npm run ci:verify
```

## Test environment

Install the locked dependencies and start a local PostgreSQL database before running the full backend or repository quality gates:

```powershell
docker compose up -d db

uv lock --check
uv sync --frozen --all-packages --all-extras
uv pip check

cd frontend
npm ci
cd ..
```

Set the application and test database URLs to a local or otherwise disposable PostgreSQL database:

```powershell
$env:DATABASE_URL = "postgresql+psycopg://recipe_lab:recipe_lab@localhost:5432/recipe_lab"
$env:TEST_DATABASE_URL = "postgresql+psycopg://recipe_lab:recipe_lab@localhost:5432/recipe_lab"
```

Backend tests create and remove their own uniquely named schema. The backend quality suite also runs the migration history against the database named by `DATABASE_URL`.

Do not point backend, acceptance, performance, release, sandbox, or recovery test environments at a production database.

## Where tests live

Tests should stay close to the behavior they protect.

| Test type                      | Location                                                                    | Best for                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Backend tests                  | `backend/tests`                                                             | APIs, services, repositories, policies, migrations, security, and real PostgreSQL behavior     |
| Frontend unit/component tests  | Beside code in `app`, `features`, `shared`, `shell`, `server`, or `scripts` | Component behavior, state transitions, parsers, async races, focus, and accessibility behavior |
| Frontend contract/config tests | `frontend/tests/config` and `frontend/tests/contracts`                      | Cross-cutting architecture, route, language, configuration, and inventory rules                |
| Shared frontend test support   | `frontend/tests/support` or owner-local `*-test-support` modules            | Reusable fixtures without adding production state                                              |
| Browser tests                  | `frontend/e2e`                                                              | Real cross-service journeys                                                                    |
| Repository script tests        | `scripts/tests`                                                             | Packaging, release, orchestration, and verification scripts                                    |
| ML tests                       | `ml/tests`                                                                  | Deterministic datasets, evaluation, and recommendation experiments                             |

Use `.test.ts`, `.test.tsx`, or `.test.mjs` for Vitest and `.spec.ts` for Playwright.

Tests should describe behavior rather than preserve an implementation detail. A route test, for example, should verify the route's behavior instead of requiring a particular one-use wrapper component to exist.

## Frontend tests

Run a focused Vitest file while working:

```powershell
cd frontend
npm test -- --configLoader=runner path/to/owner.test.tsx
```

Run the complete frontend checks with:

```powershell
npm run lint
npm run typecheck
npm test -- --configLoader=runner
npm run architecture:check
npm run reachability:check
npm run styles:contracts:check
npm run build
npm run test:e2e:discover
```

The specialized checks have different purposes:

- `architecture:check` verifies frontend ownership and approved cross-feature dependencies.
- `reachability:check` makes sure maintained production modules remain reachable from real runtime entry points.
- `styles:contracts:check` verifies the stylesheet manifest, CSS layers, and shared ownership rules.
- `test:e2e:discover` validates the Playwright configurations without starting browsers or application servers.

Coverage is available for investigation:

```powershell
npm run test:coverage
```

Coverage is not a release percentage target. Prefer a useful regression test over assertions added only to increase a number.

## Backend tests

Backend tests cover several levels within the same suite:

- API behavior and HTTP error contracts;
- authentication, CSRF, and authorization;
- service workflows such as publication, moderation, and account deletion;
- repository queries, ownership rules, and locking;
- database constraints and indexes;
- migration upgrade/downgrade behavior;
- privacy, observability, and abuse controls.

Run a focused test from the repository root with Pytest, or use the `backend` quality suite for the complete PostgreSQL-backed run.

Changes to migrations should include migration-specific coverage and should be checked with:

```powershell
cd backend
python -m alembic upgrade head
python -m alembic check
```

Historical migrations and their frozen support data are part of the testable migration contract; do not rewrite them to use current application helpers.

## Browser tests

Playwright tests are divided into explicit execution modes. This prevents controlled fixtures, stateful acceptance environments, and release tests from being mixed accidentally.

| Mode                 | Command                        | Purpose                                                                               |
| -------------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| Smoke                | `npm run test:e2e:smoke`       | Short public journeys and basic routing/authentication plumbing                       |
| Acceptance           | `npm run test:e2e:acceptance`  | Product workflows against isolated PostgreSQL and synthetic sessions                  |
| Performance          | `npm run test:e2e:performance` | Public-route measurements against the reviewed performance budget                     |
| Release              | `npm run test:e2e:release`     | Stateful OIDC, staff roles, privacy, deletion, backup, and restore checks             |
| Sandbox              | `npm run test:e2e:sandbox`     | Isolated temporary-account and generation-bound behavior                              |
| Visual/accessibility | `npm run test:e2e:visual`      | Screenshots, responsive layout, overflow, keyboard behavior, and accessibility checks |

An unqualified Playwright run is intentionally not the normal entry point. Use the named mode for the environment you intend to exercise.

### Smoke tests

Smoke is the normal pull-request browser layer.

For Chromium only:

```powershell
cd frontend
npx playwright install chromium
npm run test:e2e:smoke -- --project=chromium
```

For the complete small cross-browser smoke selection:

```powershell
npx playwright install firefox webkit
npm run test:e2e:smoke
```

### Acceptance and release tests

Acceptance, release, performance, and sandbox runs require controlled service URLs, disposable databases, guard flags, and temporary fixture files.

Prefer the checked-in CI/rehearsal entry points instead of reconstructing those environments manually. A guard flag confirms that you intended to run the suite; it does not make an unsafe database or environment safe.

### Visual baselines

The visual suite builds the frontend before comparing screenshots:

```powershell
npm run test:e2e:visual
```

Update snapshots only for an intentional reviewed visual change:

```powershell
npm run test:e2e:visual -- --update-snapshots=all
```

Review every changed expected image. Do not approve an actual/diff artifact as the baseline, and never create a baseline from real member data.

The CI browser, operating system, fonts, locale, fixtures, and viewport settings define the authoritative visual result.

## Accessibility testing

Accessibility is tested at more than one layer.

Component tests cover behavior such as:

- keyboard navigation;
- focus trapping and restoration;
- Escape behavior;
- roving tabs;
- combobox highlight state;
- validation-summary focus; and
- session-recovery focus.

Browser tests add automated accessibility scans and verify responsive/interactive states in the built application.

Automated scans do not replace behavior tests. A page can pass an automated accessibility scan while still returning focus to the wrong element or handling keyboard navigation incorrectly.

## API contracts

The backend OpenAPI snapshot and generated frontend types are committed review artifacts.

Check them without modifying the files:

```powershell
cd backend
python -m app.openapi_contract check

cd ..\frontend
npm run api:contracts:check
```

After an intentional HTTP contract change:

```powershell
cd backend
python -m app.openapi_contract write

cd ..\frontend
npm run api:contracts:generate
npm run api:contracts:check
```

Review the generated diff. Keep existing `operationId` values stable unless the identifier itself is intentionally changing.

Generated TypeScript describes the wire contract at compile time. Feature-level parsers and domain models may still validate data at runtime where that boundary matters.

See [API contracts](api-contracts.md) for the full contract lifecycle.

## Seed and documentation checks

Validate seed data with:

```powershell
cd backend
python -m app.seeds validate
```

After moving or renaming documentation:

```powershell
python scripts/verify_doc_links.py
```

Also search for executable references to the old path when a document or command is part of CI, scripts, or generated metadata.

## ML and evaluation tests

The `ml` suite protects the offline research/evaluation system rather than the serving web application.

It covers areas such as:

- deterministic snapshot parsing;
- temporal splits;
- baseline, content-based, collaborative, and hybrid models;
- duplicate/substitution evaluation;
- reproducible reports; and
- stable evaluation contracts.

Run it through:

```powershell
python scripts/run_quality_gate.py ml
```

The deterministic behavior of these tests is part of the research contract; changing ordering, seeds, fixtures, or report serialization should be treated as a deliberate evaluation change.

## CI

Recipe Lab uses a faster pull-request tier and a broader full tier.

Pull requests run the checks needed for ordinary review, including:

- contracts;
- lint and types;
- security checks;
- PostgreSQL-backed backend tests;
- frontend tests and production build; and
- controlled browser smoke coverage.

Pushes to `main`, scheduled runs, and manual full runs add the heavier verification, including:

- offline evaluation;
- production-image verification;
- safe-source packaging;
- authenticated acceptance/sandbox journeys;
- release-gate coverage;
- performance baselines; and
- visual/accessibility baselines.

The stable aggregate repository check is `Repository quality`. Full-only jobs may be skipped when their tier is not active; failures and cancellations do not count as a successful skip.

The separate release-rehearsal workflow verifies deployment and recovery concerns that are intentionally outside ordinary pull-request testing. See [Recovery](reference/recovery.md) for those procedures.

## Test artifacts and privacy

Tests that exercise authenticated or private workflows must use disposable synthetic identities and controlled environments.

Do not retain or upload:

- raw session fixtures;
- database dumps;
- deletion ledgers;
- private server logs;
- browser traces or videos from private workflows;
- screenshots containing private recipe or account data;
- request/response bodies with private text;
- OIDC credentials or tokens;
- moderation report text or private notes.

Release and recovery automation keeps only the bounded summaries designed for review.

The full rules for logs, scans, and test evidence are documented in [Security](security.md).

## Choosing what to run

A useful default is:

1. Run the focused unit/component/API test while developing.
2. Run lint and type checking for the area you changed.
3. Run the relevant `contracts`, `backend`, `frontend`, or `ml` suite.
4. Add browser coverage when the behavior crosses real services or browser navigation.
5. Run visual tests for intentional layout or interaction changes.
6. Use performance, release, or recovery suites only when the change touches those contracts or when the normal release process requires them.

The goal is not to run every available test after every edit. It is to use the smallest layer that proves the change, then finish with the broader gates that protect the boundaries you touched.
