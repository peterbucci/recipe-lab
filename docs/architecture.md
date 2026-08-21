# Architecture

## Components

### Web application

The Next.js application owns rendering and user interactions. Recipe browse
and detail routes are server components that call the API through the private
`RECIPE_API_URL`; Docker Compose points that value at the backend service while
host-direct development defaults to `http://localhost:8000`.

Catalog search and pagination live in the URL, so standard links and a GET form
work without shipping client-side state. Recipe reads use `no-store` because
catalog membership, lineage children, and rating aggregates may change even
though a single recipe-version snapshot is immutable. Client code is reserved
for the retrying error boundary and a narrow save/rating panel on recipe detail
pages. Server components read through `RECIPE_API_URL`; the client panel writes
directly to FastAPI through `NEXT_PUBLIC_API_URL` and refreshes server-rendered
rating aggregates after a successful rating. Local CORS configuration permits
the exact `localhost` and `127.0.0.1` development origins.

### API

FastAPI owns validation, application rules, persistence boundaries, and the
public HTTP contract. Pydantic schemas should not double as SQLAlchemy models.

Recipe reads expose immutable version snapshots. Browse uses bounded
page-based pagination, literal title/description search, and filters supported
directly by current relational data. Its deterministic title/version/ID order
prevents records from moving between unchanged pages. Ingredient membership is
tested with `EXISTS` so matching rows cannot duplicate recipes or inflate the
count.

Detail reads eager-load the scalar parent and select-load ordered ingredients,
instructions, and direct children. This keeps the query count bounded without
creating a Cartesian product between collections. API schemas preserve exact
decimal values as JSON strings and expose the authored ingredient name beside
its canonical identity. A separate aggregate query returns only rating count
and average, never individual interaction records. Validation and not-found
failures share one documented error envelope while retaining their semantic
HTTP status codes.

The API, not the client, selects a deterministic interaction-only demo user.
Save and rating endpoints set current state with PostgreSQL conflict handling,
so retries and concurrent duplicate requests remain safe. Each mutation owns
one transaction and returns the authoritative state after the write. This
shared profile is explicitly identified as demo mode and is not presented as
authentication.

Recipe forking is an application service behind a single transactional route.
It locks the lineage row before assigning the next lineage-wide version number,
copies the source ingredients and instructions into draft values, validates and
applies structured edits, and then inserts a fresh child snapshot with new row
identifiers. The API controls lineage, direct parent, version number, display
order, and demo-user attribution. Forking is intentionally non-idempotent;
retry-safe creation would require a separate idempotency-key contract.

### Database

PostgreSQL is the system of record. SQLAlchemy 2.x provides persistence and
Alembic provides ordered, reviewable schema migrations.

Each `recipe_lineages` row groups an original recipe and all of its variants.
Every `recipe_versions` row is an append-oriented snapshot with a direct parent
or, for the original, no parent. A composite foreign key prevents a version
from naming a parent in another lineage, while a partial unique index permits
only one root per lineage. Ingredients and instructions belong to a specific
snapshot and have stable display positions.

Each recipe ingredient retains the cook-facing name from that snapshot and
also references one canonical ingredient. The catalog normalizes canonical
names and exact aliases for lookup, uses data-backed vocabularies for one broad
category plus dietary and allergen assignments, and avoids fixed database
enums. An absent dietary or allergen assignment means the metadata is unknown;
it is not a safety claim.

Ingredient substitutions are curated, directed relationships. They store a
replacement with a positive quantity ratio or written guidance and require
provenance or confidence. The lookup layer returns only explicitly recorded
outgoing edges and never invents reverse or transitive substitutions. The
packaged, versioned demo catalog provides original curated examples with a
documented content license and provenance. For compatible units, replacement
quantity equals source quantity multiplied by `quantity_ratio`; otherwise an
edge must communicate the conversion in its guidance.

Seed records use UUIDv5 identifiers derived from immutable dataset keys and a
fixed publication timestamp. Loading is an explicit operational step, not an
API-startup side effect. One transaction and a PostgreSQL advisory lock make a
load atomic and serialize concurrent attempts. Compatible natural-key catalog
rows are reused, while any changed immutable recipe snapshot fails loudly.

Application services must create a new version rather than edit an existing
snapshot. PostgreSQL prevents changes to a stored version's ID, lineage, or
parent, and a recursive constraint trigger rejects cyclic bulk inserts. These
guards keep lineage topology acyclic regardless of the write path. Restrictive
foreign keys also protect referenced history from deletion. Blanket database
triggers that reject every content update are deferred until the recipe
creation lifecycle is defined, so seed corrections and future migrations are
not made unnecessarily difficult.

The lineage-wide version number is allocated while holding a row lock on the
lineage itself. Locking only the selected parent would not serialize siblings
created concurrently from different branches. The existing unique constraint
on `(lineage_id, version_number)` remains a database backstop.

Saves and ratings reference exact versions rather than a mutable recipe record.
Their composite keys allow only one of each interaction per user and version,
and a rating constraint enforces the one-to-five scale. The bundled loader also
ensures a fixed interaction-only demo user exists without deleting or changing
that user's saves and ratings on a later seed run. Interaction rows remain
mutable current state; timestamped preference events are a later, separate
contract.

### ML workspace

The `ml` directory remains separate from request-serving code until preference
events and evaluation contracts are stable. The first recommender should expose
the same interface expected of later models so baseline comparisons remain
honest.

## Initial request path

```text
Server-rendered read: Browser -> Next.js -> FastAPI -> SQLAlchemy -> PostgreSQL
Demo interaction:     Browser ----------> FastAPI -> SQLAlchemy -> PostgreSQL
```

Future offline training reads versioned product data and writes versioned model
artifacts or recommendations through an explicit boundary; it does not become a
hidden dependency of core recipe creation.

## Early design decisions to record

- Unit normalization and display-unit preservation.
- Variant immutability and edit behavior.
- Rating scale and event semantics.
- Recipe and metadata provenance.
- Recommendation evaluation metrics and split strategy.
