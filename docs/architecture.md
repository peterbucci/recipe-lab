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
for retrying error boundaries, a narrow save/rating panel, the structured
variant editor, and an invisible detail-view tracker. Server components read
through `RECIPE_API_URL`; client actions write directly to FastAPI through
the same-origin Next.js `/api` proxy, which forwards to `RECIPE_API_URL`.
Rating writes refresh the server-rendered aggregate after success. Local CORS
configuration permits the exact `localhost` and `127.0.0.1` development
origins.

Each event-producing browser action generates an opaque UUID and retains it
while retrying the same desired save state, rating value, or validated fork
draft. Changing the intended action rotates the key. The view tracker posts
once after a detail component mounts and renders no UI; failures never hide the
recipe. This makes browser navigation the view boundary instead of counting
server rendering, prefetching, or unrelated recipe reads.

The dedicated `/recipes/{recipeVersionId}/fork` server route loads the immutable
source snapshot and passes it to a controlled client form. The editor keeps raw
entered values in local state, validates them without resetting the draft, and
derives typed quantity, unit, replacement, addition, removal, and instruction
operations only at submission. API validation errors leave those values in
place. A `201 Created` response supplies the child identifier, which the router
uses to replace the editor route with the new recipe detail page. The source
snapshot remains unchanged, while the API retains control of lineage, version
number, display order, and demo-author attribution.

Recipe detail pages render the available parent, current version, and direct
children as an accessible semantic list. This intentionally communicates one
generation at a time; a full graph, row reordering, autosave, and ML-assisted
editing are outside the current workflow.

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

Recipe diffs use dedicated bounded snapshot queries rather than the broader
detail loader. A target compares to its direct parent by default, while an
explicit base may select any version in the same lineage. The pure diff engine
ignores display order as content, matches exact canonical ingredient
occurrences first, and classifies a replacement only when the catalog contains
the corresponding directed substitution edge. Instruction changes are kept in
a separate group. Stable sorting and fixed changed-field order make equivalent
stored comparisons byte-for-byte repeatable, and the read never loads ratings,
saves, or users.

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
applies structured edits, and then inserts a fresh child snapshot with new row
identifiers. The API controls lineage, direct parent, version number, display
order, and session-member attribution. The fork action fingerprints the
canonical validated request, then creates the child and its event in one
transaction.
An exact action-key retry returns that child; a changed source or payload with
the same key is rejected. Different action keys remain distinct authored forks.

Recommendation reads are a separate, read-only application service exposed by
`GET /api/recommendations`. The `baseline-v1` service aggregates current ratings
and saves with distinct-user view and fork support, applies the documented
Bayesian and candidate-wide normalization rules, and optionally adds a bounded
canonical-ingredient Jaccard match against positive history belonging only to
the signed-in member. Signed-out requests have no private history and use the
deterministic global ranking. It excludes the current member's exact interacted
versions, rounds scores to six decimal places, and
uses fixed component/title/version/ID tie-breaks. The response exposes a recipe
summary, score, components, and short reason, never raw events or user
identifiers. The full formula is recorded in
[baseline recommendations](recommendations.md).

### Database

PostgreSQL is the system of record. SQLAlchemy 2.x provides persistence and
Alembic provides ordered, reviewable schema migrations.

The user record distinguishes member, system, and demo accounts and tracks
active, suspended, and deleted status. OIDC identities store the private exact
issuer/subject binding separately from the public account fields. Login
transactions hold one-time state/nonce/PKCE material with short expirations;
session rows hold only session and CSRF digests, lifecycle timestamps, and the
member foreign key. Catalog Author and Demo Cook are seeded as non-login
identities, and no migration transfers their existing activity to a member.

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
The guarded job provisions two synthetic onboarded members and stores only
session/CSRF digests in PostgreSQL. Raw acceptance tokens live in a private
temporary file, Playwright traces are disabled for the guarded run, and the
file is deleted before diagnostics are uploaded. Playwright runs with one
worker because real member activity and fork writes are intentionally stateful
within that disposable run.

The canonical tests prove anonymous read-only access, isolated Alice/Bob save
and rating state, and one uninterrupted authenticated browse, save, fork,
structured edit, and parent-comparison journey. They never intercept the real
write path and therefore verify the session, CSRF, browser-to-database path,
member attribution, lineage persistence, and diff result together. Keyboard
activation and automated WCAG A/AA checks cover the basic accessibility gate.
The test is disabled unless both
`MVP_ACCEPTANCE=1` and `ACCEPTANCE_DATABASE_ISOLATED=1` are explicitly set, and
guarded local runs require explicit frontend and backend URLs on ports other
than the normal 3000 and 8000. The flags attest that the caller provisioned an
isolated database; they do not create one. Acceptance runs also refuse to reuse
an existing frontend server. CI owns and discards its database service after
the job instead of attempting fragile row-by-row cleanup of immutable history.

### ML workspace

The `ml` directory is a separate Python distribution and is never imported by
the request-serving application. Its offline evaluator consumes a versioned
catalog-and-event snapshot, applies one strict UTC cutoff, reconstructs
point-in-time preference state, and compares every registered approach with
`baseline-v1`. The production recommendation adapter and evaluator share the
same database-free baseline scorer; SQL loading remains outside that core.

The built-in `content-v1` adapter fits only in memory from the catalog and
training prefix. It represents each version with canonical ingredient IDs,
case-folded title tokens, and version metadata, then combines exact content
similarity with signed save, rating, view, and fork signals. A signed global
prior and fixed metadata/UUID tie-breaks define cold start. The CLI supplies
this adapter on every run and the evaluator adds `baseline-v1`, so their
metrics and deltas share one snapshot and protocol. See
[offline content recommender](content-recommender.md) for the exact formulas.

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

- Unit normalization and display-unit preservation.
- Original-recipe creation and content-update enforcement.
- Preference-event retention and migration from demo to authenticated users.
- Recipe and metadata provenance.
- Authenticated-profile and impression semantics for later evaluation data.
