# Architecture

## Components

### Web application

The Next.js application owns rendering and user interactions. Recipe browse,
detail, and comparison routes are server components that call the API through
the private `RECIPE_API_URL`; Docker Compose points that value at the backend
service while host-direct development defaults to `http://localhost:8000`.

Catalog search and pagination live in the URL, so standard links and a GET form
work without shipping client-side state. Recipe reads use `no-store` because
catalog membership, lineage children, and rating aggregates may change even
though a single recipe-version snapshot is immutable. Client code is reserved
for retrying error boundaries, member actions, the private structured-draft
workspace, and an invisible detail-view tracker. Server components read through
`RECIPE_API_URL`; client actions write directly to FastAPI through the
same-origin Next.js `/api` proxy, which forwards to `RECIPE_API_URL`. Rating
writes refresh the server-rendered aggregate after success. Local CORS
configuration permits the exact `localhost` and `127.0.0.1` development origins.

RCP-34F introduces a staged application-specific transport under
`frontend/lib/api-transport`. Its browser entry point is an explicit client
boundary that accepts only relative `/api/...` targets, always uses the
same-origin proxy, and centralizes no-store requests, CSRF, session-expiry
signals, idempotency keys, safe public error envelopes, request deadlines, and
an error-on-redirect policy that prevents protected mutations from following a
response to another origin.
Its server entry point resolves the existing `RECIPE_API_URL`, then
`NEXT_PUBLIC_API_URL`, then local-development precedence at request time. It
accepts only an HTTP(S) origin and refuses browser cookies or CSRF headers.
Shared core code performs one request attempt and classifies a failed mutation
as either definitely rejected or outcome unknown; timeout, abort after dispatch,
network failure, upstream 5xx, and an unreadable success receipt are never
blindly retried.

Recipe reporting is the first bounded consumer. Its existing module remains the
compatibility facade and retains the strict receipt validator that rejects any
reporter identity or additive private field. A manual retry of an unknown result
reuses the same idempotency key for the same normalized intent, while changed
intent rotates the key. Other feature clients stay on their characterized paths
until later migration stories. The hardened streaming `/api` route remains a
separate security proxy; the shared JSON transport does not replace or wrap it.

Each event-producing browser action generates an opaque UUID and retains it
while retrying the same desired save state, rating value, or validated fork
draft. Changing the intended action rotates the key. The view tracker posts
once after a detail component mounts and renders no UI; failures never hide the
recipe. This makes browser navigation the view boundary instead of counting
server rendering, prefetching, or unrelated recipe reads.

The dedicated `/recipes/{recipeVersionId}/fork` server route verifies the public
source and presents a member-gated private-draft boundary. Once the gate
succeeds, the browser immediately posts one member-scoped creation action that
asks the backend to copy that exact immutable snapshot, then replaces the route
with `/account/recipe-drafts/{draftId}`. `/recipes/new` uses the same boundary
for a source-less draft. One bounded browser attempt survives retry, reload, and
a same-tab authentication return until a valid draft ID is known; the server's
member/action binding recovers an unknown outcome without duplicating the draft.
The unified editor keeps raw entered values in local state, validates them
without resetting the form, and saves one full
ordered snapshot under an optimistic revision. API validation and revision
errors leave browser values in place. Saving never creates a public version,
lineage, fingerprint, or event. A separate review-and-publish action can turn a
clean source-less revision into an original public root or a clean source-backed
revision into a separate immutable child of its exact public source. The fork
path displays the direct-parent no-change warning when appropriate and never
rewrites the source snapshot.

Recipe detail pages render the available parent, current version, and direct
children as an accessible semantic list. This intentionally communicates one
generation at a time; a full lineage graph, autosave, and ML-assisted editing
are outside the current workflow.

Variants expose a dedicated `/recipes/{recipeVersionId}/compare` server route.
It requests the API's direct-parent diff and passes that response to a pure
presentational viewer; the browser never attempts to infer changes from two
recipe snapshots. The viewer labels every paired value as before and after,
uses text and semantic `del`/`ins` markup in addition to visual treatment, and
keeps metadata, ingredient, and instruction changes in separate groups.
Original recipes receive a non-retryable no-parent state, missing versions use
the standard not-found route, and temporary API failures stay within a
comparison-specific retry boundary. Arbitrary base selection and full-lineage
visualization remain outside the frontend MVP.

#### Global styling foundation

The root layout imports `frontend/app/globals.css` once. That file is an ordered
manifest for `styles/tokens.css`, `styles/base.css`, shared primitives, and
feature-owned stylesheets. The first split preserved the former stylesheet byte
order when the imported files are concatenated; later moves between files must
still treat cascade order as an observable contract.

Shared styling primitives are low-specificity, opt-in classes for declarations
that are already identical in multiple features. A feature adopts a primitive
without removing its existing declarations; incremental cleanup happens only
after desktop and phone evidence confirms that the primitive preserves the
affected surfaces. A primitive may expand only when at least two consumers
share the same declarations and their relevant tests or visual baselines cover
the change.

Cascade layers are deliberately deferred. Introducing `@layer`, moving broad
selector groups, or changing cascade order requires a separate evidence-backed
story after the incremental migration, because those changes can alter pixels
outside the feature being edited.

### API

FastAPI owns validation, application rules, persistence boundaries, and the
public HTTP contract. Pydantic schemas should not double as SQLAlchemy models.

Environment variables retain their stable flat names, while application code
consumes immutable settings views grouped by database, HTTP, session, OIDC, and
abuse-control concerns. This keeps deployment compatibility at the environment
boundary without passing an undifferentiated configuration object through each
subsystem. Tests may still override the flat source fields; each grouped view is
recreated from the current validated values.

The deterministic OpenAPI rendering is committed at `backend/openapi.json` and
checked in CI. Every operation retains a stable, unique operation ID, one of the
four reviewed classifications (`active_consumer`, `staff_internal`,
`research_experimental`, or `retired`), and bounded in-repository consumer
evidence. External-consumer status remains the separate value
`unknown_pending`; repository evidence cannot prove that deployed callers do
not exist. The baseline adds no runtime path, database query, or migration. See
[backend API contract baseline](api-contracts.md) for regeneration and drift
review.

The frontend commits one generated TypeScript view of that OpenAPI snapshot.
Generated request and response types remove duplicate handwritten shapes, but
they do not make network requests or replace runtime validation. The recipe
report client is the first migrated consumer. The shared transport continues to
own routing, session and CSRF handling, idempotency, cancellation, and recovery.

Recipe reads expose immutable version snapshots. Browse uses bounded
page-based pagination, literal title/description search, and filters supported
directly by current relational data. Its deterministic title/version/ID order
prevents records from moving between unchanged pages. Ingredient membership is
tested with `EXISTS` so matching rows cannot duplicate recipes or inflate the
count.

Detail reads eager-load the scalar parent and select-load ordered ingredients,
their curated measurement units, instructions, nested structured actions,
action inputs and parameters, and direct children. This keeps the query count
bounded without creating a Cartesian product between collections. API schemas
preserve exact decimal values as JSON strings, expose
the authored ingredient name beside its canonical identity, and return one
discriminated `measure` union. Exact and range measures reference a curated unit
identity; qualitative measures contain neither numeric fields nor a unit. A
separate aggregate query returns only rating count and average, never individual
interaction records. Validation and not-found failures share one documented
error envelope while retaining their semantic HTTP status codes.

The read-only cooking-action catalog exposes active reviewed verbs for
authoring. Recipe instruction responses retain the human-readable prose and
return the ordered action graph with occurrence-level ingredient inputs plus
optional structured duration and temperature. Historical inactive action types
remain readable through their immutable recipe versions.

Recipe diffs use dedicated bounded snapshot queries rather than the broader
detail loader. A target compares to its direct parent by default, while an
explicit base may select any version in the same lineage. The pure diff engine
ignores display order as content, matches exact canonical ingredient
occurrences first, and classifies a replacement only when the catalog contains
the corresponding directed substitution edge. Instruction changes are kept in
a separate group and distinguish prose, action membership, occurrence inputs,
action order, duration, and temperature. Fresh child row IDs alone are ignored.
The response includes complete base/target ingredient context so every action
input UUID can be rendered even when its ingredient is otherwise unchanged.
Stable sorting and fixed changed-field order make equivalent stored comparisons
byte-for-byte repeatable, and the read never loads ratings, saves, or users.

Forked ingredient and instruction rows receive fresh identifiers, and the
schema deliberately does not persist edit events or copied-row ancestry. A
snapshot comparison therefore cannot always distinguish an authored
replacement from a removal followed by an addition, or an instruction update
from remove-and-add. The API exposes a documented deterministic inference, not
operation-history replay. Persisted row provenance would be a separate schema
and migration decision if exact edit-intent reconstruction becomes necessary.

Account authentication is a separate boundary from the recipe interaction
principal. A same-origin Next.js proxy carries browser requests to the API. The
API performs hosted OpenID Connect discovery, Authorization Code exchange with
PKCE, and strict ID-token validation, then resolves one local member by exact
provider issuer and subject. The browser receives only a high-entropy opaque
Recipe Lab session cookie; the database stores its digest. A separate
session-bound CSRF token plus exact Origin validation protects account
mutations. Provider tokens, provider subject, and private email do not cross the
public session boundary. See [account authentication and
sessions](authentication.md).

RCP-24 selects every recipe-action principal from the opaque application
session. Public browse, detail, and diff reads remain anonymous. A signed-out
detail has `viewer_state: null`; after the client resolves an authenticated,
onboarded session, it loads private state through the same-origin proxy and only
then enables actions. Private state is never embedded in an anonymous
server-rendered page.

RCP-31 adds a private reporting and moderation boundary. An active member can
submit one fixed-reason, bounded report per immutable public recipe version.
Reports aggregate into one case, while reporter identity and free-text details
stay out of every public serializer. A separately granted community moderator
can inspect the de-identified queue and create idempotent hide, restore, or
resolve actions. Each decision is retained in an append-only audit stream. The
moderation visibility axis remains independent from author withdrawal, so a
moderator restore cannot republish content its author withdrew. Publication now
requires literal community-rules and content-rights confirmations and stores
their server-side evidence in the immutable receipt. See
[community rules, reporting, and moderation](community-moderation.md).

Protected authentication and recipe-write seams also pass through durable
fixed-window abuse controls. Network, account, and verified OIDC identity
subjects are HMAC-pseudonymized; counters commit before endpoint work so a
rejected request still consumes capacity. Oversized declared or streamed bodies
are rejected before routing. Neither layer logs user-authored bodies or secret
identity/session material.

View, save, rating, and fork actions require an active onboarded member, an
exact trusted Origin, the session-bound CSRF token, and an opaque UUID action
key. They never accept a user ID, author ID, event type, or timestamp from the
browser. The API locks the member row before resolving the key, making
concurrent exact retries serialize. Exact replays skip both state mutation and
event insertion; conflicting reuse within the same member and operation
returns 409. Another member or operation has an independent key namespace.
Anonymous/expired writes return 401 and invalid CSRF/Origin or incomplete
onboarding returns 403 without creating state.

Recipe forking is an application service behind a single transactional route.
It locks the lineage row before assigning the next lineage-wide version number,
copies the source ingredients and instructions into draft values, validates and
applies structured edits, copies each instruction's ordered action graph, remaps
its inputs to fresh child ingredient occurrences, and then inserts a fresh child
snapshot with new row identifiers. Same-request ingredient additions use a
request-scoped edit reference until their child row IDs exist. Amount changes
use only the atomic `set_measure` operation; the
service validates the complete exact, range, or qualitative shape and any
curated unit before changing the draft row. The API controls lineage, direct
parent, version number, display order, and session-member attribution. The fork
action fingerprints the canonical validated request, then creates the child and
its event in one transaction. The fingerprint includes action type, order,
inputs, duration, and temperature, with equivalent decimal spellings
canonicalized.
An exact action-key retry returns that child; a changed source or payload with
the same key is rejected. Different action keys remain distinct authored forks.

The API-only recommendation research preview is a separate, read-only
application service exposed by `GET /api/recommendations`. The `baseline-v1`
service aggregates current ratings and saves with distinct-user view and fork
support, applies the documented Bayesian and candidate-wide normalization rules,
and optionally adds a bounded canonical-ingredient Jaccard match against positive
history belonging only to the signed-in member. Both request types use aggregate
activity for publicly readable recipes; signed-out requests load no
account-specific history and use the deterministic global ranking. It excludes
the current member's exact interacted
versions, rounds scores to six decimal places, and
uses fixed component/title/version/ID tie-breaks. The response exposes a recipe
summary, score, components, and short reason, never raw events or user
identifiers. The full formula is recorded in
[baseline recommendation research preview](recommendations.md).

### Database

PostgreSQL is the system of record. SQLAlchemy 2.x provides persistence and
Alembic provides ordered, reviewable schema migrations.

The user record distinguishes member, system, and demo accounts and tracks
active, suspended, and deleted status. OIDC identities store the private exact
issuer/subject binding separately from the public account fields. Login
transactions hold one-time state/nonce/PKCE material with short expirations;
session rows hold only session and CSRF digests, an immutable provider-auth
assurance time, other lifecycle timestamps, and the member foreign key. A
deleted member is retained only as a constrained `Deleted cook` topology
tombstone with no email or handle. Catalog Author and Demo Cook are seeded as non-login
identities, and no migration transfers their existing activity to a member.

Each `recipe_lineages` row groups an original recipe and all of its variants.
Every `recipe_versions` row is an append-oriented snapshot with a direct parent
or, for the original, no parent. A composite foreign key prevents a version
from naming a parent in another lineage, while a partial unique index permits
only one root per lineage. Ingredients and instructions belong to a specific
snapshot and have stable display positions.

`recipe_version_publications` is the explicit public-state and immutable-receipt
boundary. Every seeded version is backfilled with supported `published` state
without changing its stable UUID or topology. An RCP-27 receipt additionally
binds one version to its retained source draft, author, idempotency action,
request fingerprint, saved revision, duplicate preflight, policy, result
digest, optional continue decision, and publication time. Public browse,
detail, diff, profile, duplicate, and recommendation-candidate repositories
begin with this shared state predicate rather than treating every arbitrary
version row as readable.

RCP-30 extends that boundary with effective `published`, `author_withdrawn`, and
`moderation_hidden` states plus independent author and moderation timestamps.
Database triggers permit changes only to the narrow lifecycle metadata and
append every transition to `recipe_version_visibility_events`; publication
evidence and snapshot content remain immutable. Independent axes prevent a
future moderator restore from erasing an author's earlier withdrawal.

RCP-31 stores separate `recipe_reports`, aggregate
`recipe_moderation_cases`, append-only `recipe_moderation_audit_events`, and
operator-managed `community_moderators`. Publication receipts add the rules
version and rights-confirmation timestamp for new member publications. Durable
`abuse_rate_limit_buckets` use keyed subject digests and fixed expiry windows;
they contain no request bodies, report text, raw addresses, OIDC subjects, or
tokens.

Every instruction may own an ordered set of structured action instances. Each
action references one curated cooking-action type, zero or more ordered
ingredient occurrences from the same recipe version, and at most one duration
and one temperature measure. Composite foreign keys enforce same-version graph
integrity; unique constraints enforce stable action/input positions and prevent
the same occurrence from being referenced twice by one action. Curated action
types are deactivated rather than deleted or reinterpreted. The full contract is
documented in [structured cooking actions](cooking-actions.md).

Every complete immutable version also receives a `recipe-structure-v1`
fingerprint over canonical ingredient identities, typed measures, multiplicity,
and the ordered instruction-action-input graph. Ingredient display order and
database occurrence UUIDs are replaced with deterministic multiset groups and
use-path-derived local tokens. Titles, authorship, display wording, preparation
notes, and instruction prose remain outside exact structural identity. Reviewed
same-family affine measurement rules normalize to exact rational base values;
unsupported conversions and explicit package-size identities remain distinct.
The byte-level contract is documented in [structural recipe
fingerprints](recipe-fingerprints.md).

Each recipe ingredient retains the cook-facing name from that snapshot and
also references one canonical ingredient. The catalog normalizes canonical
names and exact aliases for lookup, uses data-backed vocabularies for one broad
category plus dietary and allergen assignments, and avoids fixed database
enums. An absent dietary or allergen assignment means the metadata is unknown;
it is not a safety claim.

Ingredient amounts are stored as one constrained shape. Exact measures have one
positive value and a curated unit; ranges have positive, strictly increasing
minimum and maximum values plus one curated unit; `to_taste`, `as_needed`, and
`unspecified` contain no numeric value or unit. Curated measurement units and
aliases use deterministic identities, immutable display metadata, and explicit
conversion families. The stored `unit_display` column is a legacy/storage
integrity snapshot, not the rendering source: reads regenerate display text
from the referenced curated unit metadata and stored decimal values.

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
foreign keys also protect referenced history from deletion. Once a version has
a publication receipt, database triggers reject changes to its lineage or
version and insert, update, delete, or truncate attempts against its ordered
ingredients, instructions, actions, action inputs, and measures. Existing
fingerprint rows cannot be updated or deleted, while a new algorithm-version
fingerprint may be appended and is immutable from that point forward.
Publication evidence itself remains immutable; only the separately enumerated
visibility metadata can transition, with append-only audit evidence. Corrections
must create a new immutable version through an authorized lifecycle rather than
rewrite the published snapshot.

`recipe_structural_fingerprints` stores one immutable result per recipe version
and algorithm version. It retains both a lowercase SHA-256 digest and the exact
compact canonical JSON. The non-unique algorithm/digest index finds candidates;
payload equality is confirmed before structural equality is declared. This
permits exact duplicates and hash-collision safety while allowing later
algorithms to coexist. Migration `20260825_0011` backfills complete versions in
bounded UUID order without updating recipe content; incomplete legacy versions
receive no row. New forks and seeded snapshots write their fingerprint in the
same transaction as the immutable version.

RCP-25E consumes those fingerprints through a separate public-only advisory
preflight. A source-optional structural core accepts a completed fingerprint;
the maintained publication adapter loads one saved original or source-backed
draft revision. No temporary recipe row is inserted. Fork publication takes the
lineage lock only inside the final transaction and
verifies that the stored fingerprint is byte-identical to the prepared draft
fingerprint before commit. `recipe-duplicate-preflight-policy-v2` pins candidate
selection, public visibility, ordering, work limits, direct-parent semantics,
and the exact `duplicate-candidate-similarity-v1` scorer parameters. Exact
digest candidates are retrieved first and confirmed against canonical JSON.
Remaining fixed comparison capacity comes from a deterministic public shortlist
ordered by distinct shared canonical ingredient IDs and recipe UUID; those
candidates are scored from curated ingredient multisets, one-scale normalized
quantities, and ordered structured actions. The response is capped at five
candidates and three fixed reasons per candidate. Current browse, detail,
replay, publication, and candidate reads share an explicit public-read
predicate so future draft visibility cannot be filtered only after scoring.

`recipe_duplicate_preflights`, `recipe_duplicate_candidates`, and
`recipe_duplicate_decisions` retain only bounded versioned evidence and the
author's publication-bound `continue` choice. Historical `revise` choices from
the removed adapter remain readable. Database triggers reject
mutation; composite foreign keys bind candidate policy/fingerprint versions and
decision actor/policy/digest to their preflight; and bounded JSON checks enforce
the explanation families. No prose or canonical payload is copied into the
audit trail. These records are intentionally outside `preference_events`;
duplicate review is not a recommendation signal. Draft publication recomputes
and validates the revision, fingerprint, optional exact source, result digest,
candidate visibility, and optional continue decision inside the same
transaction that exposes the immutable root or child. See
[recipe duplicate-candidate preflight](duplicate-detection.md).

Private recipe authoring uses a separate `recipe_drafts` aggregate rather than
a status on `recipe_versions`. Draft children store ordered ingredient slots,
instructions, actions, inputs, and measures with same-draft composite foreign
keys. A catalog ingredient slot has a curated identity and typed measure; an
unresolved slot instead has an owner-scoped ingredient-request reference and no
canonical identity. This permits incomplete private work without weakening any
published-snapshot constraint.

Creation evidence is stored on the draft row. A unique member/action binding
and server-computed fingerprint distinguish a blank intent from each exact
source intent. Replay resolves that binding before source visibility is read,
so a lost response can recover the already-created active draft after later
source withdrawal. Reusing the action for changed input, a discarded shell, or
a published shell is a terminal conflict rather than permission to create a
second draft.

Draft reads are scoped by both stable ID and the session-selected active member;
another member and a nonexistent draft both return `404`. Full saves and
discards require the expected optimistic revision. A successful save replaces
the aggregate atomically and increments its revision once, while a stale write
returns `409` without merging or partially persisting fields. Discard hard
deletes every private content child and erases the row's authored fields, then
retains a hidden, content-free `discarded` shell solely to keep its creation
binding terminal. There is no product trash or restore surface, and account
deletion removes that unpublished shell.

Because drafts never occupy `recipe_versions`, they are absent by construction
from public browse, detail, lineage, diff, profile, fingerprint, duplicate,
interaction, recommendation, and evaluation-export queries. Draft lifecycle
operations create no preference event. Publication reloads and locks an active
owner draft, validates its complete curated document and revision-bound review,
then selects one of two topology-preserving transitions. A source-less draft
creates a new lineage and parentless version-1 root. A source-backed draft
rechecks the exact source through the shared public predicate, locks its
lineage, allocates the next lineage-wide version number, and creates a direct
child without changing the source or lineage creator.

The transaction also creates fresh ordered child rows, a fresh fingerprint, the
publication receipt, and terminal draft status. A fork additionally creates
exactly one preference event from its direct source to the child. The child
version, receipt, and event all attribute the operation to the authenticated
publisher; lineage creation does not grant rights over another author's
descendants. RCP-29 presents the exact version author and, when publicly
readable, the direct parent and its author through bounded public references.
Failure, including loss of source visibility, leaves the draft active with no
partial public state. Success retains it as `published`, excludes it from
active draft reads, and makes edit or discard return `404`; exact idempotent replay returns
the same public version and location. Original publication creates no fork or
other preference event. See [private recipe drafts](private-recipe-drafts.md).

The publication advisory lock serializes duplicate-evidence recomputation with
changes to public visibility. It is not the lineage numbering contract. A
fork's lineage-wide version number is allocated while holding a row lock on the
lineage itself. Locking only the selected parent would not serialize siblings
created concurrently from different branches. The existing unique constraint
on `(lineage_id, version_number)` remains a database backstop.

Public identity is a deliberately narrow projection of `users`: stable ID,
normalized unique handle, and display name. Deleted-cook topology uses that same
shape with a null handle and fixed display text, producing no profile route.
Public browse, detail, and profile
queries share the publication predicate and eager-load the exact version author
plus at most one publicly readable direct parent and author. Keeping the bare
`parent_version_id` while omitting a non-public nested parent preserves graph
truth without leaking private metadata.

Private recipe libraries are session-derived read models rather than ownership
parameters. My Recipes separates active drafts, published recipes (including
moderation-hidden recipes), and author-withdrawn recipes into explicit,
independently paginated server views. Each view hydrates only the item kind it
can contain. The Published and Withdrawn views are the author
withdraw/restore control surface. Saved Recipes joins the current member's
saves to public versions. Both use bounded queries, private non-cacheable
responses, and accept no user ID. See
[cook profiles and recipe libraries](cook-profiles-and-libraries.md).

Account deletion is one transaction after a short provider-backed recent-auth
check. It tombstones the user, deletes every OIDC mapping and application
session, removes saves, ratings, events, active drafts, and unreferenced private
workflow evidence, and scrubs publication-bound draft shells. Restrictive
topology and audit foreign keys remain valid through the stable tombstone UUID.
Public visibility is unchanged: public snapshots stay public under `Deleted
cook`, while author-withdrawn snapshots become permanently unrestorable. See
[recipe visibility and account lifecycle](recipe-visibility-and-account-lifecycle.md)
and the schema-enforced
[account-data governance manifest](account-data-governance.md).

Saves and ratings reference exact versions rather than a mutable recipe record.
Their composite keys allow only one of each interaction per user and version,
and a rating constraint enforces the one-to-five scale. The bundled loader also
preserves the fixed, non-login Demo Cook identity and its historical activity
for compatibility, but the runtime no longer selects it as an action principal
or personal recommendation profile.

`preference_events` is separate append-only history. Its UUID primary key is an
internal event identity, while `action_id` is the caller's idempotency key.
PostgreSQL uniquely scopes that key by member and operation. Checks restrict
types to view, save, rating, and fork and require the exact typed context shape
for each. Ratings
remain one to five, fork events identify a distinct related child and require a
lowercase SHA-256 fingerprint, and a child can belong to only one fork event.
The server supplies timezone-aware timestamps. User deletion cascades event
history, while restrictive recipe references protect acted-on and forked
versions. Focused user/type/time and recipe/type/time indexes support later
offline aggregation. No generic JSON or personal request metadata is stored,
and the initial migration performs no dishonest historical backfill.

### MVP acceptance boundary

The `MVP acceptance` CI job is a full-stack completion gate rather than a
mocked frontend test. Each run receives a new PostgreSQL service database,
applies the complete migration history, and loads the deterministic catalog
before starting a non-reloading API process and a production Next.js build.
The guarded job provisions four synthetic onboarded members, including one
narrow catalog curator and one deletion-only member, and stores only
session/CSRF digests in PostgreSQL.
Raw acceptance tokens live in a private
temporary file, Playwright traces are disabled for the guarded run, and the
file is deleted before diagnostics are uploaded. Playwright runs with one
worker because real member activity and fork writes are intentionally stateful
within that disposable run.

The canonical tests prove anonymous read-only access, isolated Alice/Bob save
and rating state, curator-only ingredient review, original publication, and an
uninterrupted cross-user private-fork, source-aware review, publication, and
direct-parent comparison journey. They never intercept the real
write path and therefore verify the session, CSRF, browser-to-database path,
member attribution, lineage persistence, no-change acknowledgement, and the
complete diff result. The lifecycle journey also proves author-only withdrawal and restore,
an independently public child with an unavailable source, irreversible private
account cleanup, and retained public authorship under `Deleted cook`.
Backend integration separately verifies exactly-one event,
retry, rollback, source-loss, and concurrent-sibling behavior. Keyboard
activation and automated WCAG A/AA checks cover the basic accessibility gate.
The test is disabled unless both
`MVP_ACCEPTANCE=1` and `ACCEPTANCE_DATABASE_ISOLATED=1` are explicitly set, and
guarded local runs require explicit frontend and backend URLs on ports other
than the normal 3000 and 8000. The flags attest that the caller provisioned an
isolated database; they do not create one. Acceptance runs also refuse to reuse
an existing frontend server. CI owns and discards its database service after
the job instead of attempting fragile row-by-row cleanup of immutable history.

### Production artifact boundary

The root Python workspace and `uv.lock` define one frozen dependency graph for
the API and the offline evaluator; the evaluator's API dependency resolves to
the local workspace package. `frontend/package-lock.json` independently defines
the browser application's npm graph. CI checks both locks before use and never
performs an unbounded dependency upgrade as part of a build.

Backend and frontend Dockerfiles expose explicit `development` and
`production` targets. Local Compose selects development; the stable
`Production images` check builds only the non-root production targets from
locked inputs. Final images omit acceptance harnesses, tests, environment files,
caches, reports, development dependencies, package managers, and build tools.
Production settings are validated before binding a port and invalid values are
never echoed. Backend `/api/health` and frontend `/healthz` are independent
process-liveness checks. Backend `/api/readiness` is the separate fail-closed
PostgreSQL traffic-admission check; it returns only fixed ready or generic
dependency-unavailable shapes.

The verifier builds and inspects the local application images, creates a
disposable PostgreSQL database, applies the current migrations, and proves
liveness plus readiness on a private Docker network. It then stops the database
and proves the API remains live while readiness becomes unavailable before it
removes every container and the network. It has no registry credentials or
push/upload/deploy path. See
[locked dependencies and production images](production-images.md) for the
complete lock, runtime-content, smoke-test, and no-deploy contract.

The backend and same-origin frontend proxy issue opaque per-request UUIDv4
correlation IDs and ignore or strip inbound IDs. Only six fixed failure event
names and their exact low-cardinality fields may reach the short-lived
structured-event sink. Raw access targets, bodies, account-derived identifiers,
exception text, and user-controlled labels remain prohibited; longer-lived
metrics must be de-identified aggregates. The complete sink, alert, retention,
smoke, and rollback contract is in
[privacy-safe operations and observability](operations-observability.md).

### Regression evidence boundary

RCP-34B separates safe public regression evidence from authenticated release
evidence. The visual/accessibility runner never starts FastAPI, PostgreSQL, or
OIDC. A local fixture server supplies reviewed invented recipes, accounts,
drafts, failures, loading states, and staff states to two fixed Chromium
projects. Its clock, UUID/random sources, locale, time zone, fonts, motion,
viewports, screen sizes, and device scale factor are fixed. CI runs it twice in
an immutable Playwright 1.62.1 Ubuntu 24.04 image and fails on either mismatch,
accessibility violation, keyboard-path failure, or horizontal overflow.

The fixture is intentionally incapable of proving authentication,
authorization, persistence, or account isolation. In return, its only
retainable output is safe for public review: a fixed-schema aggregate JSON and,
on failure, synthetic actual/diff PNGs. The runner disables traces, videos,
automatic screenshots, HTML output, and network logging; CI uploads exact files
rather than its output directory. Expected PNGs are reviewed source objects,
and the source exporter binds each opaque image to its Git object ID.

Performance remains a separate real-stack measurement. Before the broad MVP
browser journey mutates state, the fixed Ubuntu 24.04 acceptance job measures
only reviewed public service and page routes against a freshly migrated and
seeded PostgreSQL 17 database and a production frontend build. The committed
JSON records aggregate medians, tails, query counts, selected bundle sizes,
responsiveness, and explicit budgets. Check mode emits an ignored public
observation; capture mode emits an ignored candidate and never changes the
committed baseline. See
[deterministic regression baselines](regression-baselines.md) for the exact
matrix, environment, privacy contract, budgets, update review, and retention.

### Community release boundary

RCP-32 adds a separate fresh-database acceptance job rather than replacing the
broad `MVP acceptance` regression. Its single stateful journey creates Alice,
Bob, a catalog curator, and a community moderator through the real application
OIDC callback and onboarding paths using a guarded loopback-only provider. Role
grants use the operator commands, and the journey crosses catalog intake,
private drafts, original publication, a cross-user child, duplicate advice,
moderation, visibility, and account deletion without fixture sessions or role
inserts.

A guarded pre-journey command stages three deterministic legacy Demo Cook
interactions; the end-state verifier requires them to remain on that non-login
identity. The read-only verifier consumes an exact UUID-only manifest and emits
identifier-free counts. CI runs it on both the live disposable database and a
real `pg_dump`/restore copy. Private canaries and credential markers are scanned
before only the safe summaries are retained; browser captures, request logs,
manifests, and database dumps are never artifacts. The
stable `RCP-32 community release gate` check aggregates backend quality,
frontend quality, `MVP acceptance`, production-image verification, safe source
packaging, the independent RCP-34B visual/accessibility check, and this
canonical journey. The public performance comparison is required inside MVP
acceptance before its stateful flow. RCP-32's destruction of private browser
captures, request logs, manifests, and database dumps is unchanged; the
synthetic RCP-34B artifact allowlist never applies to that job. Offline model
evaluation remains independent. See
[community release gate](community-release-gate.md) for the complete evidence,
privacy, and local-run contract.

### ML workspace

The `ml` directory is a separate Python distribution and is never imported by
the request-serving application. Its offline engineering research evaluator
consumes a versioned catalog-and-event snapshot, applies one strict UTC cutoff,
reconstructs point-in-time preference state, and compares every registered
approach with `baseline-v1`. The API-only research-preview recommendation
endpoint and evaluator share the same database-free baseline scorer; SQL loading
remains outside that core.

The built-in `content-v1` adapter fits only in memory from the catalog and
training prefix. It represents each version with canonical ingredient IDs,
case-folded title tokens, and version metadata, then combines exact content
similarity with signed save, rating, view, and fork signals. A signed global
prior and fixed metadata/UUID tie-breaks define cold start. The CLI supplies
this adapter on every run and the evaluator adds `baseline-v1`, so their
metrics and deltas share one snapshot and protocol. See
[offline content recommender](content-recommender.md) for the exact formulas.

Structured actions are not present in evaluation snapshot v2 and are not
consumed by `baseline-v1`, `content-v1`, `collaborative-v1`, or `hybrid-v1`.
Adding them as recommendation features requires a new snapshot/model version so
existing fingerprints, metrics, and published model meanings remain stable.

The same distribution owns the RCP-18A data-readiness boundary. A versioned
simulator accepts only an event-free catalog snapshot, retains its recipes
unchanged, and creates deterministic opaque profiles with pre-cutoff view plus
save/rating signals and unseen positive holdout signals. It never fabricates
forks because the evaluation snapshot has no lineage contract. A separate pure
readiness check counts training profiles, available items, typed events,
distinct raw profile-item cells, nonzero signed cells, raw/effective item and
profile support, usable candidate-level neighbor evidence, and leakage-safe
holdout cases against fixed versioned minimums. This prevents state cancellation
or a non-overlapping matrix from passing on row volume alone.

The opt-in `run --collaborative` path applies that complete gate before fitting
`collaborative-v1`. The model builds signed user/version signals with the same
state and weight rules as `content-v1`, scores candidates from exact signed
user-neighborhood overlap, and uses the content order when a profile, item,
neighbor, or score lacks collaborative support. A qualifying run reports it
beside both `baseline-v1` and `content-v1`. See the
[offline collaborative recommender](collaborative-recommender.md) for the exact
formula and fallback thresholds.

The mutually exclusive `run --hybrid` suite applies the same gate and evaluates
baseline, collaborative, content, and `hybrid-v1` on exactly one split. The
hybrid converts each component's first 50-or-fewer ranks to exact normalized
scores and selects baseline-only, content-plus-baseline, or full three-component
routes per candidate. Its fitted details retain non-identifying reasons for
focused tests; only aggregate metrics and an adoption scorecard reach the
report. The scorecard retains the simpler model unless fixed support, NDCG,
recall, coverage, and non-synthetic-evidence guardrails all pass. See the
[offline hybrid recommender](hybrid-recommender.md) for the formula and policy.

The same distribution separately owns `substitution-rules-v1`. It constructs
candidates only from curated outgoing substitution edges, removes replacements
that fail requested declared dietary/allergen tag checks, and orders survivors
by relationship evidence, exact recipe-context similarity, explicit preference
affinity, and stable ingredient metadata. The substitution benchmark is a
separate versioned catalog-and-case contract; it does not reuse the temporal
recommendation snapshot. Queries require the source in their recipe context and
restrict preference keys to that source's direct replacements. Relationship
confidence describes the curated edge, never medical, allergen, or food-safety
confidence. See the
[offline substitution rules engine](substitution-engine.md) for the hard
constraints, formulas, caution, and evaluation protocol.

Simulation, readiness, the recommendation models, and the substitution rules
have no serving adapter. A ready generated cohort or validated substitution
fixture permits only offline fitting and test work; neither is evidence about
real users, model quality, cooking outcomes, safety, or deployment. See
[collaborative-filtering data readiness](collaborative-readiness.md) for the
assumptions, thresholds, privacy contract, and proceed rule.

Snapshots are explicit artifacts rather than live database reads during a run.
The PostgreSQL exporter uses a repeatable-read transaction and retains only
opaque IDs plus typed event context. Local snapshots and reports are ignored;
the committed synthetic fixtures exist only to test split, metric, simulation,
readiness, privacy, and reproducibility behavior. Canonical reports contain no
raw profile or event IDs and omit wall-clock or host-dependent fields. The
aggregate readiness report also omits caller-controlled dataset labels and
snapshot limitation text. Collaborative model results contain a flat artifact
object with model/artifact versions, a canonical training-prefix digest, the
derived seed, cutoff, and aggregate fitted/support counts. Only the digest—not
the identifying training rows—is published. The hybrid has no separately
persisted artifact; its report entry is null. Report schema v3 adds only
aggregate hybrid-adoption policy, comparison, status, and reason fields, never
candidate details or raw IDs.

Substitution reports are separate canonical aggregate artifacts. They contain a
benchmark fingerprint, deterministic run ID, rule strategy, aggregate counts,
metrics, status, reason codes, and limitations, but omit ingredient,
relationship, recipe-context, and case IDs and names. Caller-supplied benchmark
IDs and limitation text stay out of the report but remain covered by its input
fingerprint; published limitations are evaluator controlled. The report
explicitly records that learned ranking was not attempted and separately counts
and measures exact caution-text compliance.

The offline CI job checks formatting, types, tests, and byte-for-byte report
reproducibility for `content-v1` and `baseline-v1`. It separately verifies
same-seed simulated snapshots and readiness reports, a distinct changed-seed
cohort, and a strict ready fixture. The ready snapshots then drive two
byte-identical `collaborative-v1` reports at K values 1 and 3; CI checks stable
model membership, quality, coverage, and artifact metadata. It also generates
two byte-identical four-model hybrid reports, asserts exact fixture metrics and
the expected `retain_simpler` decision, and treats non-adoption as a successful
experiment. Finally, it executes the substitution benchmark twice, compares
the canonical bytes, and asserts the exact engineering-validation report. The
job remains
independent of the backend/frontend/MVP acceptance chain. Neither FastAPI
startup nor a product request installs or runs evaluation code. See
[offline recommendation evaluation](evaluation.md) for the evaluation protocol
and limitations.

## Initial request path

```text
Server-rendered read: Browser -> Next.js ---------> FastAPI -> PostgreSQL
Browser API action:   Browser -> Next.js /api ----> FastAPI -> PostgreSQL
Private draft action: Browser -> Next.js /api ----> FastAPI -> draft tables
Original publication: Browser -> Next.js /api ----> FastAPI -> one transaction
                                                     |        draft + public tables
Account login:        Browser -> Next.js /api ----> FastAPI <-> OIDC provider
                                                    |
                                                    +-------> PostgreSQL
Offline evaluation:  Snapshot file --------------> Evaluator -> JSON report
Data readiness:      Catalog fixture -> Simulator -> Snapshot -> Readiness report
Collaborative run:   Ready snapshot -> Gate -> CF/content/baseline report
Hybrid run:          Ready snapshot -> Gate -> Hybrid/CF/content/baseline report
Substitution rules:  Benchmark file -> Direct-edge rules -> Aggregate report
```

`content-v1`, `collaborative-v1`, `hybrid-v1`, `substitution-rules-v1`, the
simulator, and the readiness gate create no persisted serving model and have no
serving path. The
collaborative evaluation report carries aggregate fitted-artifact provenance,
not weights or a runtime payload; the hybrid and substitution rules carry no
model artifact. Future artifact persistence, learned substitution ranking, or
online inference would require an explicit adapter and a separate product
decision; it must not become a hidden dependency of core recipe creation or
recommendation reads.

## Early design decisions to record

- Measurement-catalog evolution, unit deactivation, and storage-snapshot retention.
- Fork-draft publication and subsequent immutable-version correction workflow.
- Preference-event retention and migration from demo to authenticated users.
- Recipe and metadata provenance.
- Authenticated-profile and impression semantics for later evaluation data.
