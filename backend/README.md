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
[seed-data notes](../docs/seed-data.md). The curated unit vocabulary,
fail-closed legacy audit, and structured-measure migration are documented in
[measurement catalog and legacy migration](../docs/measurements.md).

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

Every stored recipe version has an explicit published-state receipt, including
seed versions backfilled without changing their IDs or topology. Each snapshot
is immutable, so every ingredient row must reference the curated catalog.
Recipe-writing APIs verify that each submitted stable ingredient ID exists and
that its display label is that ingredient's canonical name or a reviewed alias;
stale or mismatched selections fail atomically without creating catalog
metadata. The identity/display boundary and separate private draft workflow are
documented in [ingredient identity](../docs/ingredient-identity.md) and
[private recipe drafts](../docs/private-recipe-drafts.md).

`GET /api/ingredients` provides bounded, paginated canonical-and-alias search
for the editor. Signed-in members may submit missing-item requests without
making that text selectable; separately granted catalog curators own the
terminal review decision. The request states, duplicate controls, transactional
approval, audit evidence, and operator-managed curator grant are documented in
[catalog intake](../docs/catalog-intake.md).

Catalog-curator access is managed only by an operator with backend database
credentials. The target is always an active, onboarded member selected by
stable UUID; there is no browser or member-facing role-management endpoint.
From this directory, find eligible members, inspect current grants, or change
the narrow role idempotently with:

```powershell
python -m app.catalog_curators eligible --query <uuid-handle-or-display-name> --limit 20
python -m app.catalog_curators list --limit 100
python -m app.catalog_curators grant --user-id <member-uuid>
python -m app.catalog_curators grant --user-id <member-uuid> --granted-by-user-id <grantor-uuid>
python -m app.catalog_curators revoke --user-id <member-uuid>
```

The `eligible` query is optional and searches only stable UUID, handle, and
display name. Both reads enforce a 100-row maximum and emit deterministic JSON
containing only those safe profile fields, role/eligibility flags, and, for
current grants, `granted_at` and `granted_by_user_id`. Email, OIDC identity, and
session data are neither searched nor returned. The current-grant list retains
suspended or otherwise ineligible holders so an operator can revoke them.

The installed `recipe-lab-curator` entry point accepts the same subcommands.
`granted_by_user_id` is optional audit attribution, not authorization to run the
command; operator access to the configured database is the authorization
boundary. Repeating an already satisfied grant or revocation succeeds without
changing catalog decisions or audit evidence.

## Recipe diff API

`GET /api/recipes/{recipe_version_id}/diff` returns a deterministic,
machine-readable comparison whose path identifier is the target version. By
default the base is that target's direct parent. An optional
`base_version_id` selects another version in the same lineage, including the
target itself for an explicit no-change comparison.

The response reports title, description, and serving changes in a fixed order.
Ingredients are grouped as added, removed, replaced, or modified; paired rows
include complete before-and-after snapshots plus fixed-order changed fields for
canonical identity, authored display name, the atomic structured `measure`, and
preparation notes. Instruction additions, removals, and text modifications are
reported separately. Display order is presentation metadata, so moving
otherwise equal rows does not create a content change. Exact decimals remain
JSON strings.

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
- `POST /api/auth/logout` for server-side session revocation;
- `GET /api/auth/reauthenticate` for a provider-backed, session-bound recent
  authentication check; and
- `DELETE /api/auth/account` for atomic private-data erasure and account
  tombstoning.

Only a digest of each high-entropy session token is stored. The immutable
`authenticated_at` timestamp controls the short account-deletion assurance
window; request activity never extends it. The opaque session
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

## Legacy direct variant endpoint

`POST /api/recipes/{recipe_version_id}/variants` is intentionally disabled and
returns a write-free `409 recipe_variant_publication_requires_draft`. Account
mode never turns an edit payload directly into a public child. Members instead
copy the exact public source into a private draft, save and review that draft,
and publish it through the authenticated draft-publication transaction below.
This removes the former one-step path without discarding the reusable internal
copying and fingerprint contracts.

## Private recipe drafts

RCP-26 stores private authoring state outside `recipe_versions`. The endpoints
are:

- `POST /api/recipe-drafts` for a blank original or a server-side copy of one
  exact public source snapshot;
- `GET /api/recipe-drafts` and `GET /api/recipe-drafts/{draft_id}` for the
  current member's active drafts;
- `PUT /api/recipe-drafts/{draft_id}` for a complete atomic save whose body
  includes the expected optimistic revision; and
- `DELETE /api/recipe-drafts/{draft_id}?revision={expected}` for immediate,
  irreversible discard from the live database;
- `POST /api/recipe-drafts/{draft_id}/duplicate-preflights` for the required
  revision-bound structural review; and
- `POST /api/recipe-drafts/{draft_id}/publish` for the atomic original-or-fork
  publication transition.

The session supplies authorship. Another member receives `404`, stale saves or
discards return `409`, and all responses are private and non-cacheable. Catalog
slots use verified ingredient labels and structured measures. Request slots
retain only owner-scoped unresolved selection identity, never a fabricated
canonical ID, and cannot be structured-action inputs.

Creating, saving, resuming, resolving, or discarding a draft creates no
lineage, immutable version, fingerprint, duplicate evidence, save, rating, or
preference event. Drafts are structurally absent from browse, detail, diff,
profile, recommendation, duplicate-candidate, and evaluation-export queries.
The explicit publication action below is the only route from this private
aggregate into the public recipe graph. See
[private recipe drafts](../docs/private-recipe-drafts.md) for retention,
request-resolution, editor, and publication boundaries.

## Recipe draft publication

RCP-27 introduced source-less original publication and RCP-28 extends the same
transaction to source-backed fork drafts. Both require a saved, active draft
owned by the current onboarded member. The two author-only endpoints are:

- `POST /api/recipe-drafts/{draft_id}/duplicate-preflights` with body
  `{ "revision": <saved_revision> }`; and
- `POST /api/recipe-drafts/{draft_id}/publish` with body
  `{ "revision": <saved_revision>, "duplicate_review": { "preflight_id":
  "<uuid>", "policy_version": "<version>", "result_digest": "<sha256>",
  "decision": null | "continue" } }`.

Both mutations require the session-bound CSRF token, trusted exact Origin, and
a UUID `Idempotency-Key`. Similarity review is required before publication but
remains advisory: a distinct result uses `decision: null`; an exact or probable
result requires the author to submit `decision: "continue"`. Revising means
changing and saving the draft, which invalidates the prior revision-bound
review. There is no publish-without-review path.

Publication reloads and locks the draft, then atomically revalidates ownership,
active state, revision, complete curated structure, current duplicate policy,
result digest, bounded public candidates, exact optional source, and any
required continue decision. A source-less draft creates one lineage and its
parentless version-1 root. A source-backed draft rechecks that its exact source
is still public, locks the source lineage, allocates the next lineage-wide
version number, and retains that source as the direct parent. Concurrent
siblings therefore receive distinct version numbers even when they start from
different versions in the lineage.

In either case, the transaction copies fresh ordered ingredient, measure,
instruction, action, and input rows, stores a fresh structural fingerprint,
adds the immutable publication receipt, and marks the retained draft
`published`. The session member is the version author and receipt actor. For a
fork, the same member is also the actor on exactly one preference event whose
source is the direct parent and whose related version is the new child. The
lineage creator retains no edit, publication, withdrawal, or moderation rights
over another member's child. RCP-29 presents that persisted attribution through
an explicit public reference containing only stable ID, handle, and display
name. Original publication appends no fork or other preference event.

Any validation or database failure rolls back the entire transition and leaves
the draft active and editable. An exact retry by the same member with the same
idempotency key and request returns `201`, the original
`{ "recipe_version_id": "<uuid>", "location": "/recipes/<uuid>" }` body,
and the same `Location` header. Reusing the key for a different intent returns
`409`; retrying the same completed draft with a new key and unchanged intent
also returns the same child. If a fork's source is no longer publicly readable,
publication returns `409 recipe_fork_source_unavailable`, writes no partial
child or event, and preserves the active draft. After success, active-list,
read, edit, and discard draft operations no longer expose that draft; the
retained completed row and receipt prevent a second root or child from being
created.

Every seeded recipe version is backfilled with published state without changing
its stable ID or lineage topology. Database guards reject update, delete, and
truncate attempts against a published snapshot and its ordered child content.
Corrections therefore require a new immutable version. Fork publication never
rewrites its source or moves a child into a new lineage.

## Cook profiles and member libraries

Recipe browse and detail responses identify the author of the exact immutable
version. Forks additionally expose a bounded direct-parent reference with that
parent's author when the parent is still public. If the immutable parent ID is
known but its snapshot is not public, `parent_version_id` remains present while
the nested `parent` is `null`; private parent metadata never leaks through a
public child.

`GET /api/cooks/{handle}` returns one normalized-handle public identity and a
database-paginated list of that cook's currently public versions. Known cooks
may have an empty profile. `GET /api/my/recipes` returns the active session
member's current drafts and every authored publication as a unified,
discriminated activity page, with a private `visibility_state` on publication
entries. `GET /api/my/saved-recipes` returns only that member's currently saved
public versions. The private routes take no user ID, are marked `private,
no-store`, and vary on the session cookie.

All card paths eagerly load bounded author and public-parent context. Query
counts therefore stay fixed as a page grows rather than issuing requests or
database queries for each card. The full identity, privacy, pagination, and
verification contract is documented in
[cook profiles and recipe libraries](../docs/cook-profiles-and-libraries.md).

## Recipe visibility and account lifecycle

`PUT /api/recipes/{recipe_version_id}/visibility` lets only the exact version
author choose `published` or `author_withdrawn`. The transaction holds the same
publication guard used by duplicate review and fork publication, locks the
publication row, records the state actor and time, and relies on a database
trigger for append-only visibility evidence. The snapshot, publication receipt,
lineage, version number, and descendants never change. `moderation_hidden` is a
separate effective state reserved for RCP-31; an author cannot restore it, and
its independent timestamp preserves any earlier author withdrawal.

All public recipe repositories begin with the same publication-state predicate.
Unavailable direct reads use one opaque not-found contract. A readable child
whose parent is unavailable retains `parent_version_id` but has `parent: null`,
and a public diff never loads the unavailable parent. Interaction replays,
duplicate candidates, profiles, libraries, recommendations, fork-draft
creation, and fork publication rechecks use the same rule.

Account deletion requires recent authentication, exact Origin, and the
session-bound CSRF token. The JSON body must also carry the member's exact
current handle as `confirmation`, or `DELETE` before a handle is chosen; the
backend validates it under the locked member row. A stale session receives
`recent_authentication_required` and must complete a one-time OIDC flow with
`prompt=login`, `max_age=0`, exact issuer/subject binding, and fresh `auth_time`.
Missing provider `auth_time` is unknown rather than recent, and future values
beyond the configured clock skew are rejected. Members can delete before
choosing a handle; the browser uses `DELETE` as that confirmation phrase.
Deletion removes the identity mapping, private email and handle, every session,
saves, ratings, preference events, private draft content, and unreferenced
private workflow evidence in one transaction. Immutable public versions remain
under a constrained `Deleted cook` tombstone with a null handle; already
withdrawn versions remain unavailable. The complete policy is documented in
[recipe visibility and account lifecycle](../docs/recipe-visibility-and-account-lifecycle.md).
The exhaustive table, field, log, backup, and derived-artifact decisions are in
[account-data governance](../docs/account-data-governance.md).

## Recipe duplicate preflight

`POST /api/recipes/{recipe_version_id}/duplicate-preflights` retains the legacy
in-memory variant adapter without inserting a child. The publication adapter is
`POST /api/recipe-drafts/{draft_id}/duplicate-preflights` with the saved
revision and supports both original and source-backed drafts. Both require an
onboarded member, Origin/CSRF evidence, and a UUID `Idempotency-Key`. The service
builds the proposed `recipe-structure-v1` fingerprint and compares it only with
publicly readable stored fingerprints. A source-backed review binds the exact
direct parent, excludes it from ordinary candidate results, and separately
reports an explainable no-change warning when its canonical structure matches.
It returns `exact_duplicate`, `probable_duplicate`, or `distinct`, at most five
public candidates, at most three fixed explanation reasons per candidate, and
a stable acknowledgement.

Exact candidates require both the digest and canonical payload to match.
Probable candidates use the versioned deterministic ingredient, normalized
quantity, and structured-action scorer. A proposed child that is structurally
identical to its direct source also receives `same_lineage_no_change`. Titles,
descriptions, instruction prose, display aliases, authors, and lineage metadata
do not affect either classification.

The separately versioned preflight policy pins the scorer parameters,
public-only candidate selection and ordering, direct-parent warning semantics,
and fixed work budgets: 500 public comparisons, 200 ingredient occurrences,
500 actions, 2,000 flattened inputs, and 10,000,000 conservative aggregate
non-exact work units. Budget overflow fails closed with one generic `503`
response; the service never returns partial candidate evidence.

`POST /api/recipe-duplicate-preflights/{preflight_id}/decision` records a
standalone legacy-variant-flow `continue` or `revise` choice. Draft publication
instead binds the revision, optional source, policy, result digest, and optional
`continue` directly inside its atomic transaction. Preflights, bounded
candidate evidence, and decisions are append-only, actor-scoped, and
idempotent; they are not recommendation events. Publication receipts are also
append-only and bind an exact publish retry to its original result. Replays and
publication recheck public candidate and source availability. Candidate drift
returns one generic stale conflict; loss of a fork's direct source returns the
specific source-unavailable conflict while retaining the private draft. See
[recipe duplicate-candidate preflight](../docs/duplicate-detection.md) for the
formula, privacy boundary, publication binding, and evaluation limitations.

## Migrations

Before upgrading an existing database that still has legacy `quantity` and
`unit` columns, run the fail-closed read-only audit and resolve every reported
row. Then apply all migrations and confirm that the SQLAlchemy metadata matches
the migration history:

```powershell
recipe-lab-measurements audit-legacy --format json
python -m alembic upgrade head
python -m alembic check
```

The audit is for an existing schema; a fresh empty database can proceed
directly to `alembic upgrade head`. Start application processes only after the
migration succeeds.

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
uv lock --check
uv sync --frozen --package recipe-lab-api --extra dev
uv pip check
..\.venv\Scripts\Activate.ps1
$env:TEST_DATABASE_URL = "postgresql+psycopg://recipe_lab:recipe_lab@localhost:5432/recipe_lab"
python -m ruff format --check .
python -m ruff check .
python -m mypy app migrations tests
python -m pytest
```

Schema tests use real PostgreSQL behavior and create a random isolated schema
that is dropped after the run. Use a local or disposable test database only.
The root `uv.lock` is the only Python lock; update and production-image
procedures are documented in
[locked dependencies and production images](../docs/production-images.md).
