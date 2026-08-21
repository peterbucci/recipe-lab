# Recipe Lab API

FastAPI service for Recipe Lab. It exposes the API health check and owns the
SQLAlchemy domain model and Alembic migration history.

## Core schema

The first schema milestone intentionally covers only the MVP foundation:

- users who create or interact with recipes;
- recipe lineages that group an original recipe with all of its variants;
- append-only recipe-version snapshots with one optional parent;
- ordered ingredient and instruction rows stored with each snapshot, with the
  ingredient's authored display text preserved alongside its canonical ID;
- one save and one rating per user and recipe version.

PostgreSQL constraints keep a parent in the same lineage, permit only one root
per lineage, preserve display order, and restrict ratings to the supported
one-to-five scale. Foreign-key deletion rules protect recipe history; deleting
an interaction-only user removes that user's saves and ratings.

## Ingredient catalog

Canonical ingredients can have exact aliases, one broad category, and
positive dietary-flag and allergen assignments. Missing assignments mean
"unknown," not that an ingredient is safe for a diet or allergy. Exact lookup
gives a canonical name precedence if another ingredient has a colliding alias.

Substitutions are explicit directed edges. Each edge identifies its source and
replacement and includes a positive quantity ratio or written guidance, plus
provenance or a confidence value. Lookups do not infer reverse or transitive
substitutions. When units are compatible, replacement quantity equals source
quantity multiplied by `quantity_ratio`; substitutions without compatible
units use written guidance instead. The packaged demo catalog supplies curated
examples for local development and tests. It is intentionally small and is not
a production food database.

## Demo seed catalog

Validate the packaged catalog without a database:

```powershell
python -m app.seeds validate
```

After applying migrations, load it in one transaction:

```powershell
python -m app.seeds load
```

The command is idempotent: an exact rerun reuses the same UUIDv5 rows. It does
not run during API startup, delete user data, or repair a changed immutable
recipe snapshot. Conflicting data causes the transaction to fail. Catalog
provenance and license notes are documented in the
[packaged provenance](app/seeds/data/PROVENANCE.md) and repository-level
[seed-data notes](../docs/seed-data.md).

## Migrations

From this directory, apply all migrations and confirm that the SQLAlchemy
metadata matches the migration history:

```powershell
python -m alembic upgrade head
python -m alembic check
```

Create future revisions only after importing the affected models through
`app.models`:

```powershell
python -m alembic revision --autogenerate -m "describe the schema change"
```

Review every generated migration before applying it. A migration is the
deployable source of truth; `Base.metadata.create_all()` is not used to manage
the application schema.

## Tests and quality checks

Start the local Compose database, install the development dependencies, and
run the backend gate:

```powershell
$env:TEST_DATABASE_URL = "postgresql+psycopg://recipe_lab:recipe_lab@localhost:5432/recipe_lab"
python -m ruff format --check .
python -m ruff check .
python -m mypy app migrations tests
python -m pytest
```

Schema tests use real PostgreSQL behavior and create a random isolated schema
that is dropped after the run. Use a local or disposable test database only.
