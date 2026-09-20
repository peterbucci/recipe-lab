# Architecture

Recipe Lab is a web application for publishing immutable recipe editions,
making adaptations from exact published sources, and keeping unfinished work
private. The architecture is organized around those trust and lifecycle
boundaries rather than around a generic collection of pages and CRUD routes.

This guide explains the major components and dependency direction. See
[Recipe lifecycle](recipe-model.md) for the data model,
[Frontend](frontend.md) for UI ownership and interaction conventions,
[Security](security.md) for authentication and authorization, and the
[operations guide](operations.md) for runtime procedures.

## System view

```text
                         OpenID Connect provider
                                  ^
                                  |
Browser ---- pages ----> Next.js application ---- public reads ----+
   |                         |                                     |
   +-- same-origin /api -----+-- authenticated proxy requests -----+--> FastAPI
                                                                       |
                                                                       v
                                                                   PostgreSQL

Versioned snapshot files ----------------------------------------> Offline ML
                                                                  evaluation
```

The request-serving system has three runtime components:

- **Next.js** owns rendering, route composition, browser interactions, and the
  same-origin API proxy.
- **FastAPI** owns the public HTTP contract, validation, authentication,
  authorization, application policy, and transaction orchestration.
- **PostgreSQL** is the system of record and enforces the relationships that
  must remain true regardless of which application path writes data.

The `ml` workspace is deliberately outside the request path. It consumes
versioned snapshots and produces aggregate research reports; the ordinary web
application does not import or serve its offline models.

## Frontend boundary

The frontend is split by ownership:

- `app` owns Next.js entry points and composition between features;
- `features` owns domain UI, state, parsing, and API adapters;
- `shared` owns only domain-neutral UI, navigation, and transport mechanics;
- `shell` owns feature-neutral site framing; and
- `server` owns the streaming proxy and standalone Node runtime code.

This direction is intentional. The application boundary may compose a recipe
workflow and an account gate, but the shell does not learn what a recipe or an
account is. A reusable recipe card remains recipe-owned rather than becoming
global shared code. Cross-feature imports are narrow reviewed seams; route
composition is preferred when two workflows otherwise would depend on each
other. The complete placement and interaction rules are in
[Frontend](frontend.md).

### Two API access paths

Public server-rendered reads and authenticated browser requests use different
paths:

1. A Next.js server component calls FastAPI through the private
   `RECIPE_API_URL`. The server transport accepts an HTTP(S) origin, sends no
   browser cookie or CSRF token, and uses non-cacheable reads for data whose
   membership or aggregates may change.
2. Browser code calls only relative `/api/...` URLs. The Next.js proxy forwards
   the request to FastAPI after filtering hop-by-hop and untrusted forwarding
   headers. Browser mutations include the application session cookie, the
   session-bound CSRF token, and an idempotency key when the operation supports
   durable replay.

This is not two authorization systems. FastAPI remains authoritative in both
cases. Hiding or disabling a browser control improves the experience but never
grants or denies access.

The shared JSON transport centralizes deadlines, cancellation, safe public
errors, session-expiry signaling, and the rule that an uncertain mutation
outcome is not blindly retried. Feature adapters still own their request and
response models and runtime parsing. Generated OpenAPI types anchor the wire
shape but do not replace validation or create a universal domain SDK.

## Backend boundary

The backend flows inward from transport to domain behavior:

```text
API routes -> services/policies -> repositories -> SQLAlchemy models -> PostgreSQL
```

Routes translate HTTP concerns such as sessions, CSRF, headers, and response
codes. Services coordinate application behavior. Policies centralize decisions
that must be identical across workflows, most notably public recipe
visibility. Repositories own persistence queries and staging. Models and
database constraints protect durable structure.

Core, model, policy, repository, and service modules are transport-independent;
they do not import FastAPI or API route modules. Domain outcomes are mapped to
the public error envelope at the API boundary. The committed OpenAPI document
is generated deterministically from that boundary and checked against the
implementation.

### Transactions and retries

Repositories do not commit. The API route or an explicitly designated
application workflow owns commit and rollback for the whole operation.
Repositories and services may flush to allocate identifiers or validate a
staged graph, but they cannot make part of a workflow durable independently.

That ownership matters for publication, moderation, account deletion, and
catalog review: each either commits all of its state and audit evidence or
leaves none of it. Services re-read and lock authoritative rows before a
decision that could have become stale. Database constraints remain the final
backstop for concurrency and topology.

Retryable actions use opaque caller-generated UUIDs. The backend scopes each
key to the authenticated member and operation and stores a canonical request
fingerprint. An exact replay returns the recorded result; reuse for changed
intent returns a conflict. A timeout after dispatch is treated as an unknown
outcome and is recovered with the same identity, not with a new write.

## Data and publication boundary

PostgreSQL stores three related but distinct recipe concepts:

- a **lineage** groups an original recipe and adaptations descended from it;
- a stable **recipe** groups one author's successive editions and points to
  its explicitly selected current edition; and
- a **recipe version** is one immutable published snapshot.

An adaptation records the exact published version it copied. A same-recipe
revision records the immediately previous edition. These are separate
relationships: later publication by the source author cannot rewrite what
another cook actually adapted.

Private drafts occupy their own aggregate and tables. They may be incomplete
and mutable, and they do not appear in public browse, history, profiles,
interactions, similarity candidates, recommendations, or research exports.
Publication validates and materializes a new complete snapshot in one
transaction. The transaction also writes its stable-recipe or lineage
topology, structural fingerprint, visibility state, publication receipt, and
any required adaptation event before the result becomes public.

Published content is append-only. Ordinary corrections create another exact
version and may change which edition is current; they do not update the earlier
snapshot. PostgreSQL triggers and restrictive foreign keys protect published
ingredients, instructions, structured actions, topology, fingerprints, and
publication evidence from ordinary mutation or deletion.

The detailed model, including draft kinds, visibility, attribution, pinned
saves, and account deletion, is in [Recipe lifecycle](recipe-model.md).
Ingredient identity, typed measures, and the instruction action graph are in
[Structured recipe data](reference/structured-data.md). Fingerprints and the
advisory pre-publication review are in
[Recipe similarity](reference/recipe-similarity.md).

## Visibility, moderation, and identity

Public consumers begin from one shared effective-visibility predicate rather
than loading every version and filtering afterward. A published snapshot can
be publicly readable, author-withdrawn, or moderation-hidden. Author and
moderation axes remain independent so a moderator restore cannot override an
author's withdrawal.

Public authorship is a narrow projection: stable Recipe Lab ID, handle when an
active public profile exists, and display name. Private email, OIDC identity,
sessions, drafts, saves, ratings, and member activity never enter that
projection. A deleted account retains only the constrained `Deleted cook`
tombstone needed by published authorship and recipe topology.

Authentication uses OpenID Connect Authorization Code with PKCE. FastAPI
validates the provider response and resolves the immutable issuer/subject
binding. The browser receives an opaque Recipe Lab session; PostgreSQL stores
only its digest. Mutations additionally require exact trusted-Origin and CSRF
evidence. Staff capabilities are separate database grants and are never
inferred from a handle, email address, or frontend route.

Account deletion, reporting, moderation, and abuse controls are described in
[Security](security.md). They surround immutable publication rather than
quietly weakening it.

## Read models and derived evidence

Public browse, exact detail, current detail, recipe history, and comparison are
purpose-built read models. Exact URLs keep addressing the requested immutable
version. A stable current URL resolves only the explicit current pointer and
does not silently fall back when that edition is unavailable. Collection views
select readable current editions, while a saved recipe stays pinned to the
exact version the member saved.

Comparisons are computed by the backend from two immutable snapshots. The
frontend renders the returned deterministic difference rather than trying to
infer changes from independently loaded pages. Public aggregates expose counts
and averages, not another member's individual interactions.

Structural fingerprints and duplicate-preflight records are versioned derived
evidence. They support collision-safe exact matching and bounded advisory
similarity review, but they do not establish authorship, originality,
copyright, safety, or cooking success.

## Research boundary

The request-serving API includes a deterministic, API-only recommendation
baseline for research compatibility. It is not a consumer recommendation
surface and it persists no online model or recommendation result.

Offline content, collaborative, hybrid, and substitution experiments live in
the separate `ml` distribution. They operate on explicit snapshots, retain
only aggregate reproducible reports, and have no import path into FastAPI or
Next.js. Adding online inference would require a new serving adapter, privacy
review, product behavior, and failure contract; it cannot become an implicit
dependency of recipe reads or publication. See the
[research workspace](../ml/README.md).

## Architectural invariants

Changes should preserve these properties:

1. FastAPI and PostgreSQL, not the UI, are authoritative for identity,
   authorization, visibility, publication, moderation, and deletion.
2. Public server reads never acquire browser credentials, and browser traffic
   reaches the private API through the same-origin proxy.
3. Private drafts and immutable published versions remain different
   aggregates.
4. An adaptation keeps its exact source; a revision appends an edition instead
   of rewriting history.
5. Public reads start from the shared visibility policy.
6. Transaction owners commit complete workflows; repositories never commit.
7. Idempotent recovery reuses the identity of the initiating action and never
   applies a late result to whichever resource is currently rendered.
8. `app` composes features, `shell` stays feature-neutral, and `shared` stays
   domain-neutral.
9. Offline research remains outside the production request path and is not
   presented as a shipped personalization feature.

Verification and release evidence for these boundaries are described in
[Testing](testing.md), not duplicated here.
