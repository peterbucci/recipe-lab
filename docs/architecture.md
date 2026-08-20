# Architecture

## Components

### Web application

The Next.js application owns browser rendering and user interactions. It calls
the API through the configured `NEXT_PUBLIC_API_URL`. Server and client
components should be chosen per feature rather than making the whole app
client-rendered.

### API

FastAPI owns validation, application rules, persistence boundaries, and the
public HTTP contract. Pydantic schemas should not double as SQLAlchemy models.

### Database

PostgreSQL is the system of record. SQLAlchemy 2.x provides persistence and
Alembic provides ordered, reviewable schema migrations.

Each `recipe_lineages` row groups an original recipe and all of its variants.
Every `recipe_versions` row is an append-oriented snapshot with a direct parent
or, for the original, no parent. A composite foreign key prevents a version
from naming a parent in another lineage, while a partial unique index permits
only one root per lineage. Ingredients and instructions belong to a specific
snapshot and have stable display positions.

Application services must create a new version rather than edit an existing
snapshot. PostgreSQL prevents changes to a stored version's ID, lineage, or
parent, and a recursive constraint trigger rejects cyclic bulk inserts. These
guards keep lineage topology acyclic regardless of the write path. Restrictive
foreign keys also protect referenced history from deletion. Blanket database
triggers that reject every content update are deferred until the recipe
creation lifecycle is defined, so seed corrections and future migrations are
not made unnecessarily difficult.

Saves and ratings reference exact versions rather than a mutable recipe record.
Their composite keys allow only one of each interaction per user and version,
and a rating constraint enforces the one-to-five scale.

### ML workspace

The `ml` directory remains separate from request-serving code until preference
events and evaluation contracts are stable. The first recommender should expose
the same interface expected of later models so baseline comparisons remain
honest.

## Initial request path

```text
Browser -> Next.js -> FastAPI -> SQLAlchemy -> PostgreSQL
```

Future offline training reads versioned product data and writes versioned model
artifacts or recommendations through an explicit boundary; it does not become a
hidden dependency of core recipe creation.

## Early design decisions to record

- Unit normalization and display-unit preservation.
- Ingredient identity versus free-form preparation notes.
- Variant immutability and edit behavior.
- Rating scale and event semantics.
- Recipe and metadata provenance.
- Recommendation evaluation metrics and split strategy.
