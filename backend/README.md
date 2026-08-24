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
- one save and one rating per user and recipe version;
- append-only, typed preference events for explicit views, save-state actions,
  ratings, and forks.

PostgreSQL constraints keep a parent in the same lineage, permit only one root
per lineage, preserve display order, and restrict ratings to the supported
one-to-five scale. Foreign-key deletion rules protect recipe history; deleting
an interaction-only user removes that user's saves, ratings, and event history.

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

Every stored recipe version is a published immutable snapshot, so each of its
ingredient rows must reference the curated catalog. Recipe APIs resolve exact
canonical names and aliases without creating catalog metadata; unknown names
fail atomically. The identity/display boundary and future draft workflow are
documented in [ingredient identity](../docs/ingredient-identity.md).

## Recipe diff API

`GET /api/recipes/{recipe_version_id}/diff` returns a deterministic,
machine-readable comparison whose path identifier is the target version. By
default the base is that target's direct parent. An optional
`base_version_id` selects another version in the same lineage, including the
target itself for an explicit no-change comparison.

The response reports title, description, and serving changes in a fixed order.
Ingredients are grouped as added, removed, replaced, or modified; paired rows
include complete before-and-after snapshots plus fixed-order changed fields for
canonical identity, authored display name, quantity, unit, and preparation
notes. Instruction additions, removals, and text modifications are reported
separately. Display order is presentation metadata, so moving otherwise equal
rows does not create a content change. Exact decimals remain JSON strings.

Recipe snapshots do not persist the edit operation or copied-row ancestry.
The engine therefore documents a canonical snapshot comparison rather than
claiming to replay author intent: it matches equal canonical ingredient
occurrences first, recognizes replacements only through curated directed
substitution edges, and uses stable occurrence matching for remaining rows.
It never infers reverse or transitive substitutions. A root without an
implicit base and a cross-lineage explicit comparison return documented 422
errors; a missing version returns 404. Diff reads do not depend on the shared
demo identity or interaction state.

## Accounts and server-managed sessions

RCP-23 adds configurable hosted OpenID Connect sign-in using Authorization Code
with PKCE. The backend owns discovery, code exchange, ID-token verification,
local identity resolution, and the opaque Recipe Lab session. The browser sees
neither provider tokens nor the private provider issuer, subject, or verified
email. A member is resolved only by the exact OIDC issuer-and-subject pair;
email is never an identity merge key.

The account routes are:

- `GET /api/auth/login` and `GET /api/auth/callback` for the protected OIDC
  round trip;
- `GET /api/auth/session` for anonymous, onboarding-required, or authenticated
  state;
- `PATCH /api/auth/session/profile` for handle/display-name onboarding; and
- `POST /api/auth/logout` for server-side session revocation.

Only a digest of each high-entropy session token is stored. The opaque session
cookie is HttpOnly, SameSite Lax, application-scoped, and Secure outside local
development. Account mutations additionally require a trusted exact `Origin`
and the session-bound CSRF token sent in `X-CSRF-Token`. Expired or revoked
sessions and sessions belonging to suspended/deleted members do not
authenticate.

Catalog Author and Demo Cook are explicitly non-login system/demo users.
RCP-24 binds recipe activity and personalized recommendation history to the
active, fully onboarded member selected by this session. It does not transfer
or claim any legacy Demo Cook activity. See
[account authentication and sessions](../docs/authentication.md) for setup,
privacy, failure, and testing details.

## Member-scoped interactions

Recipe browsing, details, and comparisons remain public. A signed-out recipe
detail contains `viewer_state: null`. With a valid member session, the same
detail contains only the exact version ID, that member's saved state, and that
member's rating; it never includes account identity fields.

Interaction writes require a valid onboarded member session, the bound CSRF
token and trusted `Origin`, plus an opaque UUID `Idempotency-Key` header:

- `POST /api/recipes/{recipe_version_id}/view` records an explicit detail-page
  view without changing recipe state;
- `PUT /api/recipes/{recipe_version_id}/save` saves a version;
- `DELETE /api/recipes/{recipe_version_id}/save` removes that save;
- `PUT /api/recipes/{recipe_version_id}/rating` creates or replaces the
  profile's one-to-five rating.

The API selects the actor exclusively from the session and never accepts a user
or author ID from the browser. PostgreSQL upserts plus the existing composite
primary keys keep each member's current state unique. Action keys are scoped by
member and operation: an exact replay returns the current authoritative state
without writing a second event, while conflicting reuse inside that scope
returns HTTP 409. The same raw UUID may be used independently by another
member or another operation. Anonymous or expired sessions return 401, invalid
Origin/CSRF evidence or incomplete onboarding returns 403, a missing recipe
returns 404, and invalid input returns 422; every rejected write leaves state
and event history unchanged.

## Preference events

Successful first-seen product actions append one server-timestamped event in
the same database transaction as their state change or child recipe. Events
store only the server-selected user ID, acted-on recipe version, one of the
four supported event types, and narrowly typed context: the resulting saved
boolean, rating value, or forked child ID. A fork also stores a SHA-256
fingerprint of the normalized validated request so an identical retry can
return the original child without retaining the recipe title, instructions,
or edit body.

The event table deliberately has no JSON or free-form context, client
timestamp, email, display name, IP address, user agent, referrer, or search
query. There is no public generic event-ingestion or event-history endpoint.
The detail page records a view through the dedicated action endpoint after it
loads in the browser, so server rendering, link prefetching, and API reads do
not silently count as views. A new action UUID represents a distinct action;
an exact retry must reuse the original UUID.

## Baseline recommendation API

`GET /api/recommendations?limit=10` returns deterministic recommendations for
the current request. The response names the strategy `baseline-v1`; each
item includes a recipe-version summary, six-decimal score and components, and a
short reason. The response also publishes the weights and whether positive
member history personalized the ranking. Signed-out requests have no personal
history and use the deterministic global cold-start order. Signed-in requests
read only that member's saves, ratings, and events, and exact interacted
versions are not returned. The limit defaults to 10, accepts 1 through 50, and
uses the standard 422 response when invalid.

The global component gives 55% weight to Bayesian-smoothed rating quality, 20%
to normalized distinct active savers, 15% to normalized distinct users who
forked the version, and 10% to normalized distinct viewers. Support counts are
normalized independently by the candidate-wide maximum. Rating quality uses a
mean-3, strength-5 prior before mapping the one-to-five result onto zero through
one.

When positive member history exists, the final score gives 60% to that global
component and 40% to the strongest canonical-ingredient Jaccard match. History
strength is 1.0 for an active save, rating of 5, fork source, or fork child; 0.5
for a rating of 4; and 0.25 for a view. Cold-start requests use the global score
alone. Decimal `ROUND_HALF_UP` rounding and fixed component, title, version, and
UUID tie-breaks make an unchanged database snapshot reproducible.

This is a read-only, request-time baseline. It adds no table, model artifact,
training job, personal telemetry, or frontend feature. Its SQL adapter calls a
database-free scorer that is also used by the separate point-in-time evaluator,
so production and offline formulas share one implementation. See
[baseline recommendations](../docs/recommendations.md) for the complete formula
and [offline recommendation evaluation](../docs/evaluation.md) for the split,
metrics, reproducibility, and data-limitations contract.

## Recipe variant creation

`POST /api/recipes/{recipe_version_id}/variants` creates a new child of an
existing recipe version for the signed-in, onboarded member. It requires the
same session, Origin, CSRF, and UUID `Idempotency-Key` evidence used by other
product actions. The request supplies
the new title, nullable description, exact serving yield, and zero or more
structured edits. A successful request returns the complete child snapshot
with HTTP 201 and a `Location` header for its detail resource.

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

Repeating a fork with the same action key, source, and normalized request
returns the original child and `Location` rather than creating a sibling.
Reusing that key with a different source or payload returns HTTP 409. Different
action keys intentionally create distinct sibling versions. Client interfaces
still disable duplicate submission, but the server-side contract protects
network retries. Automatic substitutions, unit conversion, edit-operation
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
