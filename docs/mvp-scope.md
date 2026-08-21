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
- A lineage view for related variants.
- A clearly scoped shared demo identity for user actions; real authentication
  only when distinct accounts become necessary.

## Explicitly deferred

- Personalized recommendations.
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

## Exit criteria before ML work

- Core recipe and variant flows are deployed and usable.
- Preference events have stable semantics and timestamps.
- Seed and ingredient metadata provenance is documented.
- A simple non-ML recommendation baseline exists.
- Offline evaluation data and metrics are defined.
