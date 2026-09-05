# Recipe Lab documentation

This index groups the repository's documentation by responsibility. Document
paths remain stable so operational runbooks, CI evidence, issue links, and
historical references do not break merely to create folders.

## Start here

- [Architecture](architecture.md) — application boundaries and dependency
  direction.
- [MVP scope](mvp-scope.md) — shipped product boundary and acceptance criteria.
- [Product language](product-language.md) — member-facing terminology and the
  boundary between product and research features.
- [API contracts](api-contracts.md) — deterministic OpenAPI ownership,
  classifications, and generated frontend wire types.
- [Reachability and compatibility](reachability-and-compatibility.md) — exhaustive
  page/API lifecycle inventory, redirects, evidence, and safe-removal rules.

## Product and domain behavior

- [Authentication and sessions](authentication.md)
- [Private recipe drafts](private-recipe-drafts.md)
- [Cook profiles and libraries](cook-profiles-and-libraries.md)
- [Homepage dashboard](homepage-dashboard.md)
- [Ingredient identity](ingredient-identity.md)
- [Catalog intake](catalog-intake.md)
- [Measurements](measurements.md)
- [Structured cooking actions](cooking-actions.md)
- [Recipe fingerprints](recipe-fingerprints.md)
- [Duplicate detection](duplicate-detection.md)
- [Recipe visibility and account lifecycle](recipe-visibility-and-account-lifecycle.md)
- [Community moderation](community-moderation.md)
- [Abuse controls](abuse-controls.md)
- [Account data governance](account-data-governance.md)
- [Seed data](seed-data.md)

## Operations, security, and release evidence

- [Operations and observability](operations-observability.md)
- [Repository quality gates](quality-gates.md)
- [Frontend testing architecture](frontend-testing.md)
- [Production images](production-images.md)
- [Safe source packaging](source-packaging.md)
- [Regression baselines](regression-baselines.md)
- [Community release gate](community-release-gate.md)
- [Release rehearsal](release-rehearsal.md)

## Research and offline evaluation

These documents describe research-preview or offline capabilities, not shipped
consumer surfaces.

- [Recommendation preview](recommendations.md)
- [Offline evaluation](evaluation.md)
- [Content recommender](content-recommender.md)
- [Collaborative readiness](collaborative-readiness.md)
- [Collaborative recommender](collaborative-recommender.md)
- [Hybrid recommender](hybrid-recommender.md)
- [Substitution engine](substitution-engine.md)

## Decisions and historical delivery records

The current architecture and domain documents above are authoritative. These
records explain why major boundaries or visual contracts exist and preserve
review evidence for completed work.

- [RCP-13A redesign record](rcp-13a-redesign.md)
- [RCP-46 visual contract](rcp-46-visual-contract.md)
- [Refactor execution record](refactor-execution.md)

When a future decision changes an architectural invariant, add a short,
immutable decision record and link it from this section. Routine implementation
details belong in the relevant current document instead.
