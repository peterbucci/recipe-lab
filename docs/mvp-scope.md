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
- A clearly scoped shared demo identity for user actions; real authentication
  only when distinct accounts become necessary.

## Explicitly deferred

- Learned, authenticated-account, and frontend recommendation experiences.
- Automated substitution suggestions.
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

## Post-MVP signal baseline

RCP-15 adds a read-only, explainable recommendation API after the M1 boundary.
It ranks recipe versions with deterministic Bayesian quality and normalized
support signals, then applies a bounded canonical-ingredient match when the
shared demo profile has positive history. It does not change the M1 browser
journey or add a frontend recommendation surface, authentication, training,
or a learned model. RCP-16 adds a separate offline evaluator with a fixed-cutoff
split, full-catalog metrics, mandatory baseline comparison, and reproducible
reports. Neither addition belongs to or blocks the deployed M1 request path. See
[baseline recommendations](recommendations.md) for the exact contract.

## Exit criteria before ML work

- Core recipe and variant flows are deployed and usable.
- Preference events have stable semantics and timestamps.
- Seed and ingredient metadata provenance is documented.
- A simple non-ML recommendation baseline exists.
- Offline evaluation data and metrics are defined.

Those prerequisites are now represented by the privacy-bounded preference
events, `baseline-v1`, and the [offline evaluation protocol](evaluation.md).
They enable measured experimentation after the MVP; they do not move learned
recommendations or an ML runtime into MVP scope.
