# Recipe Lab documentation

The root [README](../README.md) is the portfolio and project entrypoint. These
guides explain the current system by responsibility.

## Build and understand the application

- [Architecture](architecture.md) — components, dependency direction, data
  flow, and the boundaries that protect published recipe history.
- [Development](development.md) — local setup, configuration, migrations,
  seeds, authentication, and everyday commands.
- [Testing](testing.md) — check tiers, required environments, and the evidence
  each suite provides.
- [Frontend](frontend.md) — ownership, composition, state presentation,
  navigation, accessibility, and product language.
- [Recipe model](recipe-model.md) — drafts, publication, editions, lineage,
  attribution, visibility, and account lifecycle.
- [Security and data](security.md) — authentication, authorization, abuse
  controls, moderation, deletion, retention, and privacy limits.
- [Operations](operations.md) — production images, health and readiness,
  observability, source export, and the temporary portfolio sandbox.

## Precise references

- [Structured recipe data](reference/structured-data.md) — ingredients,
  measurements, catalog intake, instructions, and cooking actions.
- [Recipe similarity](reference/recipe-similarity.md) — fingerprints and
  duplicate-candidate review.
- [Recovery and rollback](reference/recovery.md) — release rehearsal,
  restoration, rollback, and exceptional operational procedures.

## Offline research

Research code is intentionally separate from the consumer application:

- [Research overview](../ml/README.md)
- [Models](../ml/docs/models.md)
- [Evaluation](../ml/docs/evaluation.md)

## Documentation policy

Each maintained concept has one authoritative owner above. Other documents
link to it instead of copying its route inventory, command list, policy, or
invariants. Generated contracts and executable inventories remain authoritative
for exact API and route coverage.

New documentation needs a durable audience and a responsibility not already
owned here. Delivery notes, branch maps, transient test totals, and completed
migration diaries belong in issues, pull requests, CI, and Git history. Update
the owning guide when behavior changes; do not add a second narrative.
