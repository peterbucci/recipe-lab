# MVP scope

## Goal

Validate that a recipe can be represented as structured data, forked into a
variant, and compared with its parent in a way that is useful to a cook.

## In scope

- A small curated seed catalog.
- Structured recipe, step, ingredient, quantity, and unit data.
- Recipe detail and catalog screens.
- Parent-child variant relationships.
- A diff that explains ingredient and instruction changes.
- Save and rating actions.
- Timestamped view, save, rating, and fork events with typed context and no
  unnecessary personal or free-form tracking data.
- A lineage view for related variants.
- Anonymous public recipe browsing, plus authenticated member ownership for
  save, rating, recorded-view, and fork actions.

## Explicitly deferred

- Online learned serving, original recipe publishing, public cook profiles,
  and frontend recommendation experiences.
- Automated substitution suggestions in the API or frontend. An offline rules
  benchmark may be developed after the MVP without joining its request path.
- Social feeds, comments, and following.
- Grocery lists and meal planning.
- Nutrition or medical claims.
- Image generation.
- Large-scale recipe ingestion.

## MVP acceptance scenario

Starting from the catalog, a user opens and saves the seeded carrot cake,
creates a child variant, changes 180 g of sugar to 140 g, and replaces walnuts
with pecans. The child detail identifies the parent, and the comparison shows
both changes with explicit before and after values.

The `MVP acceptance` CI job is the M1 completion gate. It runs this journey
through the browser, frontend, API, and PostgreSQL against a freshly migrated
and seeded disposable database. It also checks keyboard activation and WCAG
A/AA rules. The milestone is not complete unless that job passes; ML work is
not part of the gate.

## Post-MVP account foundation

RCP-23 adds hosted OIDC sign-in, local member onboarding, server-managed opaque
sessions, and CSRF-protected account mutations after the original demo
milestone. Anonymous recipe reads remain available. Catalog Author and Demo
Cook become explicit non-login identities, and no shared demo activity is
claimed by a registering member.

RCP-24 completes the account-principal cutover for current actions. Recipe
views, saves, ratings, and forks require an active onboarded member session,
trusted Origin, and bound CSRF token; public recipe reads remain anonymous.
Recommendation requests use only the current member's private history when
signed in and a deterministic global cold start when signed out. No legacy Demo
Cook activity is transferred to a member, and the shared-demo runtime identity
route is removed. RCP-23 and RCP-24 add no original recipe publishing, public
cook profile, password database, social linking, or deployment gate. See
[account authentication and sessions](authentication.md).

RCP-26 adds private persistent original and fork drafts after the account and
curated-authoring foundations. Draft ownership comes only from the active
member session; revisions reject stale saves, unresolved ingredient requests
remain outside canonical selections, and discard removes the aggregate from
the live database. Drafts are absent from public reads, recommendations,
events, and evaluation exports.

RCP-27 adds the explicit source-less original-publication transition. A current
saved revision must complete public-only structural similarity review; a match
is advisory but requires an explicit continue. One idempotent transaction
creates the lineage and immutable root snapshot, binds review and publication
evidence, and seals the retained draft. Failure leaves the draft active and
creates no partial public state. Seed versions are backfilled as published
without changing their identifiers or topology. RCP-28 remains responsible for
fork-draft publication, source revalidation, lineage version allocation, and
the fork event. See
[private recipe drafts](private-recipe-drafts.md).

## Post-MVP signal baseline

RCP-15 adds a read-only, explainable recommendation API after the M1 boundary.
It ranks recipe versions with deterministic Bayesian quality and normalized
support signals, then applies a bounded canonical-ingredient match when the
signed-in member has positive history. Signed-out requests use the global
cold-start ranking. It does not add a frontend recommendation surface,
training, or a learned model. RCP-16 adds a separate offline evaluator with a
fixed-cutoff split, full-catalog metrics, mandatory baseline comparison, and
reproducible reports. RCP-17 adds the evaluator-only `content-v1` model, which
uses structured recipe features and signed preference profiles with
deterministic cold-start behavior. RCP-18A adds an event-free catalog fixture, a deterministic synthetic
preference cohort, and an aggregate structural-readiness gate. RCP-18 adds the
opt-in, evaluator-only `collaborative-v1` user-neighborhood model, which refuses
to fit through the CLI until that gate passes and uses `content-v1` when local
evidence is sparse. RCP-19 adds evaluator-only `hybrid-v1` rank fusion, tested
human-readable cold-start reasons, and a conservative aggregate scorecard that
retains a simpler model unless same-split results clear every guardrail. Its
generated `ready` result and model scores are engineering evidence only, not
claims about real users or model quality. RCP-20 adds the separate offline
`substitution-rules-v1` baseline: it evaluates curated direct edges, hard
declared dietary/allergen constraints, recipe context, and explicit preference
weights against a synthetic benchmark before learned ranking. It adds no API,
frontend, recipe-editing behavior, or medical-safety claim. None of these
additions belongs to or blocks the deployed M1 request path. See
[baseline recommendations](recommendations.md),
[offline content recommender](content-recommender.md),
[offline recommendation evaluation](evaluation.md),
[collaborative-filtering data readiness](collaborative-readiness.md),
[offline collaborative recommender](collaborative-recommender.md), and
[offline hybrid recommender](hybrid-recommender.md) for the recommendation
contracts, and [offline substitution rules engine](substitution-engine.md) for
the candidate, hard-constraint, caution, and rules-benchmark contract.

## Exit criteria before ML work

- Core recipe and variant flows are deployed and usable.
- Preference events have stable semantics and timestamps.
- Seed and ingredient metadata provenance is documented.
- A simple non-ML recommendation baseline exists.
- Offline evaluation data and metrics are defined.

Those prerequisites are now represented by the privacy-bounded preference
events, `baseline-v1`, and the [offline evaluation protocol](evaluation.md).
The [collaborative-readiness gate](collaborative-readiness.md) makes the minimum
structural support for the offline RCP-18 experiment explicit. A passing
simulated fixture permits only engineering evaluation against that contract;
conclusions about real interaction data require a separately captured,
privacy-safe snapshot to pass and produce a reproducible baseline/content/model
comparison. The same gate applies to RCP-19, and even an observed-data
`adopt_hybrid` scorecard would remain an offline recommendation rather than a
deployment. Likewise, an `engineering_validated` RCP-20 report only confirms
the synthetic rules contract; it does not authorize learned substitution
ranking or serving. These additions do not move an ML runtime, online learned
recommendations, automated substitutions, or a recommendation surface into MVP
scope.
