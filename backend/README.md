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

## Recipe read API

The read-only recipe API exposes every immutable version rather than collapsing
a lineage to one "latest" row:

- `GET /api/recipes` returns a paginated list of version summaries.
- `GET /api/recipes/{recipe_version_id}` returns one complete snapshot with
  ordered ingredients and instructions plus its direct parent and children.

Browse requests support `page`, `page_size`, a literal case-insensitive `q`
search over titles and descriptions, exact canonical-or-alias `ingredient`
matching, `lineage_id`, and the optional `is_variant` filter. Filters combine
with AND semantics. Results use a fixed title/version/ID order, and pages after
the final page return an empty `items` list while preserving the total count.

Ingredient responses preserve the authored display name alongside the
canonical ingredient name and ID. Decimal quantities and servings serialize as
JSON strings so PostgreSQL precision is not lost. Parent and child summaries
are immediate relationships, not a recursively expanded lineage tree. Detail
responses also include a read-only rating count and average. An unrated recipe
returns a count of zero and a null average; individual users and ratings are not
exposed.

Malformed identifiers and invalid query values return HTTP 422; a valid UUID
that is not present returns HTTP 404. Both use the documented `ErrorResponse`
envelope. The response schemas and query constraints are available through
OpenAPI at `/docs` and `/openapi.json`.

## Shared demo interactions

The MVP uses one fixed, clearly identified shared demo profile rather than
pretending to provide account authentication. `GET /api/me` returns its public
ID, display name, and `shared_demo` identity mode; its internal seed email is
never exposed. Recipe detail responses include that profile's current saved
state and rating for the exact version.

Interaction writes are state-setting and safe to retry:

- `PUT /api/recipes/{recipe_version_id}/save` saves a version;
- `DELETE /api/recipes/{recipe_version_id}/save` removes that save;
- `PUT /api/recipes/{recipe_version_id}/rating` creates or replaces the
  profile's one-to-five rating.

The API selects the demo identity on the server and never accepts a user ID
from the browser. PostgreSQL upserts plus the existing composite primary keys
keep repeated or concurrent requests from creating duplicates. These rows are
current product state only; they are not a preference-event history or an ML
pipeline. A missing recipe returns 404, invalid input returns 422, and a
database without the bundled demo identity returns a documented 503 response.

## Recipe variant creation

`POST /api/recipes/{recipe_version_id}/variants` creates a new child of an
existing recipe version for the shared demo user. The request supplies the new
title, nullable description, exact serving yield, and zero or more structured
edits. A successful request returns the complete child snapshot with HTTP 201
and a `Location` header for its detail resource.

Ingredient edits target row IDs from the direct source snapshot so recipes may
use the same canonical ingredient more than once. Supported operations set a
quantity, set or clear a unit, replace an ingredient through exact
canonical-or-alias lookup, append an ingredient, or remove an ingredient.
Instruction edits update, append, or remove a source instruction. Replacements
preserve the source amount, unit, and preparation notes unless companion edits
change them; they do not infer a conversion or require a curated substitution
edge. Retained rows keep their relative order, additions append in request
order, and the final positions are compact.

The service copies every retained ingredient and instruction into fresh rows
and never updates the source snapshot. It rejects unknown or cross-recipe row
IDs, conflicting edits, unknown catalog ingredients, no-op replacements, and a
result with no ingredients or instructions. PostgreSQL serializes version
allocation on the lineage row, so simultaneous forks receive distinct,
lineage-wide version numbers. The route owns one transaction containing the
copy, edits, parent link, and server-selected author; any failure rolls it all
back.

Fork requests are deliberately non-idempotent: two successful requests create
two sibling versions. Client interfaces should disable duplicate submission.
Idempotency-key storage, automatic substitutions, unit conversion, diff-event
storage, and original-recipe creation remain outside this MVP endpoint.

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
