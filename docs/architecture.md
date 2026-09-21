# Architecture

This document is a high-level map of the system: the major runtime components, how requests move through them, and where responsibilities belong.

For deeper detail, see:

- [Recipe model](recipe-model.md) for drafts, published versions, adaptations, revisions, and recipe history.
- [Frontend](frontend.md) for frontend organization, state ownership, accessibility, and UI conventions.
- [Security](security.md) for authentication, authorization, privacy, moderation, abuse controls, and account lifecycle.
- [API contracts](api-contracts.md) for OpenAPI generation and frontend wire contracts.
- [Operations](operations.md) for runtime operation, observability, backup, and recovery.

## System overview

The request-serving application has three main runtime components:

- **Next.js** renders the web application, composes product features, handles browser interaction, and exposes the same-origin API proxy used by authenticated client requests.
- **FastAPI** owns the public HTTP API and coordinates validation, authentication, authorization, application rules, and transactional workflows.
- **PostgreSQL** is the system of record. Database constraints protect relationships and invariants that must remain true regardless of which application path writes the data.

## Repository boundaries

At a high level, the repository is organized into three application areas:

```text
frontend/   Next.js application and browser-facing behavior
backend/    FastAPI application, domain workflows, persistence, migrations
```

Supporting code under `scripts/` and `.github/` handles verification, packaging, CI, release checks, and development workflows.

## Frontend architecture

The frontend is organized by ownership rather than by page alone:

```text
frontend/
├── app/       Next.js routes and cross-feature composition
├── features/  Product/domain behavior
├── shared/    Domain-neutral UI, navigation, and API mechanics
├── shell/     Feature-neutral site framing
└── server/    Proxy and standalone server/runtime code
```

### `app`

`app` is the composition layer. Route files decide which features appear together and pass route-derived state into them. It is the right place for behavior that spans multiple product areas, such as combining authentication state with a recipe or account workflow.

### `features`

`features` owns product behavior. Examples include authentication, accounts, recipe browsing, recipe authoring, recipe libraries, community activity, ingredient requests, and moderation.

A feature should own its domain-specific API adapters, parsing, state.

### `shared`

`shared` contains application-neutral building blocks such as transport mechanics, loading states, navigation blocking, pagination presentation, and overlay primitives.

### `shell`

`shell` owns the site frame, such as the header and footer. It receives feature-owned content through composition.

### `server`

`server` contains frontend code that belongs only to the server/runtime boundary, including the hardened API proxy and production launcher support.

See [Frontend](frontend.md) for the detailed dependency rules and UI conventions.

## Two transport paths

Recipe Lab uses one FastAPI backend, but Next.js reaches it through two different transport paths depending on where a request originates.

### Public server-rendered reads

```text
Next.js Server Component
        |
        v
server-only API client
        |
        v
FastAPI
        |
        v
PostgreSQL
```

Public pages such as the recipe catalog and recipe detail load their public data during server rendering. Because the request already originates on the Next.js server, it calls FastAPI directly through the private backend origin rather than routing through the browser-facing `/api` proxy.

This transport is intentionally anonymous. It does not accept or forward the visitor's session cookie or CSRF token, so public rendering has the same data boundary whether or not the visitor is signed in.

Member-specific state is loaded separately through authenticated browser requests.

### Authenticated browser requests

```text
React client component
        |
        v
relative /api request
        |
        v
Next.js same-origin proxy
        |
        v
FastAPI
        |
        v
PostgreSQL
```

Authenticated reads and mutations begin in the browser and use relative `/api/...` requests. The Next.js proxy forwards those requests to FastAPI while keeping authentication same-origin.

The proxy also centralizes browser-facing transport rules such as cookie forwarding, CSRF handling, header filtering, upstream timeouts, and authentication redirect validation.

FastAPI remains authoritative in both paths. Next.js controls rendering and transport, but authentication, authorization, validation, and domain rules are enforced by the backend.

## Backend architecture

A typical workflow looks like:

```text
API route
   |
   v
service / policy
   |
   v
repository
   |
   v
SQLAlchemy models
   |
   v
PostgreSQL
```

The layers have different responsibilities:

- **API routes** own HTTP concerns: request/response schemas, headers, cookies, dependencies, and status codes.
- **Services** coordinate workflows that involve multiple decisions or writes, such as publication, authentication, moderation, or account lifecycle operations.
- **Policies** centralize rules that must be interpreted consistently across multiple workflows.
- **Repositories** own persistence queries, locking, and staging database changes.
- **Models and database constraints** protect durable structure and relationships.

Simple reads do not need a pass-through service merely to preserve a diagram. A route may call a repository directly when no additional workflow logic is needed.

The important dependency rule is that the domain and persistence layers do not depend upward on FastAPI transport code.

## Transaction ownership

Repositories do not commit transactions.

For ordinary application requests, the API route owns the final commit or rollback. A service may coordinate many database operations inside that transaction, but the workflow becomes durable as a whole.

```text
request
  |
  v
route opens request-scoped session
  |
  v
service/repository stages changes
  |
  +---- failure ----> rollback
  |
  +---- success ----> commit
```

This matters most for workflows where partial success would produce misleading or invalid state, such as publishing a recipe, reviewing a catalog request, or moderating a recipe.

A small number of workflows intentionally own their transaction boundary themselves when the security behavior requires it. Those exceptions are documented with the workflow rather than treated as the normal repository pattern.

## Recipe data boundary

Recipe Lab separates **private drafts** from **published recipe history**.

```text
Private draft
    |
    | publish
    v
Immutable published version
```

A draft is private, mutable working state. It can be incomplete while the author is editing it.

Publishing validates the draft and creates a complete published snapshot. Later changes create another published version instead of overwriting the earlier one.

When someone makes their own recipe from another cook's recipe, the relationship points to the specific published version they started from. That relationship remains stable even if the source recipe changes later.

The detailed rules for revisions, adaptations, current versions, visibility, saved versions, and recipe history belong in [Recipe model](recipe-model.md).

Structured ingredients, measurements, instructions, and cooking actions are described in the data-model/reference documentation rather than repeated here.

## Authentication and authorization boundary

Authentication is based on OpenID Connect. After the external login flow succeeds, Recipe Lab issues its own application session for normal member requests.

At a high level:

```text
Browser
  |
  | sign in
  v
OIDC provider
  |
  | verified callback
  v
FastAPI
  |
  | local application session
  v
Browser
```

The frontend keeps enough session state to present the right UI and recover interrupted work, but the backend rechecks authorization for protected actions.

Staff access is also server-authoritative. Curator and moderator permissions are separate database-backed grants rather than frontend roles inferred from a route, email address, or handle.

Detailed session, CSRF, account deletion, privacy, moderation, and abuse-control rules are owned by [Security](security.md).

## API contracts

FastAPI is the source of the HTTP contract. The repository stores a deterministic OpenAPI snapshot and generates TypeScript wire types for the frontend.

```text
FastAPI routes + schemas
          |
          v
      OpenAPI
          |
          v
generated TypeScript types
          |
          v
feature API adapters / domain parsing
```

Generated types describe the wire contract at compile time. Feature code may still validate or adapt runtime data before exposing it as a domain model to the UI.

See [API contracts](api-contracts.md) for the generation process and compatibility rules.

## Architectural rules to preserve

The architecture is intentionally flexible in implementation details, but a few boundaries are important:

1. **The backend is authoritative for protected actions.** Authentication, authorization, publication, moderation, and account lifecycle rules are not enforced only by the UI.
2. **Public SSR stays anonymous.** Public server-side reads do not inherit browser session credentials.
3. **Browser member traffic uses the same-origin proxy.** The browser does not call the private FastAPI origin directly.
4. **Private drafts and published history remain separate.** Editing does not mutate an existing published version.
5. **Published relationships refer to the version actually used.** Later changes do not rewrite earlier recipe history.
6. **Transactions have clear owners.** Repositories stage database work; they do not independently commit ordinary workflows.
7. **Frontend ownership remains visible.** `app` composes, `features` own product behavior, `shared` stays domain-neutral, and `shell` stays feature-neutral.
