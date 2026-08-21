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

Starting from a seeded carrot cake, a user creates a child variant, changes
180 g of sugar to 140 g, replaces walnuts with pecans, and saves it. The detail
screen identifies the parent, the diff shows both changes, and the lineage view
shows the original and its child.

## Exit criteria before ML work

- Core recipe and variant flows are deployed and usable.
- Preference events have stable semantics and timestamps.
- Seed and ingredient metadata provenance is documented.
- A simple non-ML recommendation baseline exists.
- Offline evaluation data and metrics are defined.
