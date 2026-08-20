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
Alembic migrations should be introduced with the first schema milestone.

Recipe versioning should use immutable or append-oriented records where
practical. A saved variant points to its direct parent, allowing full lineage to
be reconstructed without duplicating an opaque JSON document as the only source
of truth.

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
