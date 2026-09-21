# Recipe Lab

Recipe Lab is a version-controlled cooking platform built around a simple idea: **recipes change, but their history should not disappear when they do.**

Instead of overwriting a published recipe, Recipe Lab keeps each published version. A cook can revise their own recipe, make a new recipe based on someone else's version, compare what changed, and trace where a recipe came from.

Ingredients, quantities, instructions, and cooking actions are also stored in a structured form rather than as free text alone. That makes the recipe history useful for more than display: the same data can support comparison, search, duplicate detection, and recommendation experiments.

![Recipe Lab home and recipe catalog](frontend/baselines/baseline-desktop-chromium/home-normal.png)

## The idea

Imagine Alice publishes a pasta recipe. Bob makes his own version of it. Later, Alice changes her original recipe.

Most recipe sites can tell you that Bob's recipe was "inspired by" Alice's. Recipe Lab keeps the more useful detail: **Bob's recipe was based on the exact version Alice had published at the time.** Alice can continue improving her recipe without changing Bob's history.

That gives the app a few useful behaviors:

- authors can publish new versions of their own recipes without rewriting older ones;
- other cooks can make their own recipe from a specific published version;
- recipe pages can show history and relationships between recipes;
- two versions can be compared to see what actually changed;
- saved recipes stay tied to the version the member saved;

![Recipe comparison](frontend/baselines/baseline-desktop-chromium/recipe-comparison-normal.png)

## What the application includes

The current implementation includes:

- public recipe browsing, search, categories, sorting, and recipe pages;
- private recipe drafts with autosave-safe revision handling;
- recipe history, adaptations, revisions, and version comparison;
- structured ingredients, measurements, instructions, and cooking actions;
- saved recipes, ratings, views, cook profiles, follows, and activity feeds;
- ingredient requests and a separate curator review workflow;
- recipe reporting and a separate moderator workflow;
- OpenID Connect authentication with local application sessions;
- account deletion and recovery-aware data lifecycle handling;
- duplicate-recipe review based on structured recipe fingerprints;

## Stack

| Area           | Technology                                                             |
| -------------- | ---------------------------------------------------------------------- |
| Frontend       | Next.js, React, TypeScript, CSS                                        |
| Backend        | FastAPI, Pydantic, SQLAlchemy, Alembic                                 |
| Database       | PostgreSQL                                                             |
| Authentication | OpenID Connect Authorization Code + PKCE, opaque application sessions  |
| Testing        | Vitest, pytest, Playwright, accessibility and visual regression checks |
| Research       | Python, NumPy/pandas/scikit-learn-based evaluation tooling             |
| Runtime        | Docker / Docker Compose                                                |

## Running it locally

The easiest local setup uses Docker Desktop with Docker Compose.

```powershell
Copy-Item .env.example .env
docker compose build
docker compose up -d db

docker compose run --rm backend python -m alembic upgrade head
docker compose run --rm backend python -m app.seeds load

docker compose up -d backend frontend
```

Then open:

- Web app: `http://localhost:3000`
- API health: `http://localhost:8000/api/health`
- FastAPI documentation: `http://localhost:8000/docs`

Authentication requires an OIDC provider. Without one configured, the public recipe experience can still run, but member workflows that require sign-in will not be available.

For environment variables, authentication setup, database migration guidance, and non-Docker workflows, see [Development](docs/development.md).

## Verification

The main repository checks are exposed through:

```powershell
python scripts/run_quality_gate.py contracts lint types
python scripts/run_quality_gate.py backend frontend ml
```

Additional browser, visual, performance, production-image, recovery, and release checks require their documented environments. See [Testing](docs/testing.md) for what each tier verifies.

## Documentation

- [Architecture](docs/architecture.md) — system boundaries and major data flows
- [Recipe model](docs/recipe-model.md) — drafts, published versions, adaptations, revisions, and history
- [Frontend](docs/frontend.md) — frontend organization, state ownership, accessibility, and UI conventions
- [Security](docs/security.md) — authentication, authorization, privacy, abuse controls, and account lifecycle
- [Development](docs/development.md) — local setup, configuration, migrations, seeds, and development workflows
- [Testing](docs/testing.md) — test tiers and what each one is intended to prove
- [Operations](docs/operations.md) — runtime operation, observability, backup/recovery, and production tooling
- [API contracts](docs/api-contracts.md) — OpenAPI and generated frontend contracts
- [Recommendations](docs/recommendations.md) — offline recommendation and evaluation work
- [Data model reference](docs/reference/data-model.md) — database-level entities, relationships, and constraints
- [Recovery reference](docs/reference/recovery.md) — detailed recovery and rollback procedures
- [Configuration reference](docs/reference/configuration.md) — complete runtime configuration reference

## Current scope

Recipe Lab is primarily a portfolio project, but the goal is for the implementation to behave like a real application: published history should remain trustworthy, private work should stay private, and the code should make those rules understandable rather than hiding them behind the UI.
