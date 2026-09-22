# Recipe Lab documentation

The root [README](../README.md) is the portfolio and project entry point. These guides document the current system by responsibility so each major concept has one clear owner.

## Understand the application

- [Architecture](architecture.md) — system components, dependency direction, request paths, and major frontend/backend boundaries.
- [Recipe model](recipe-model.md) — recipes, published versions, revisions, adaptations, drafts, publication, history, and visibility.
- [Frontend](frontend.md) — frontend organization, state ownership, server/client boundaries, navigation, accessibility, styling, and product language.
- [Security](security.md) — authentication, sessions, CSRF, authorization, staff grants, abuse controls, privacy, and account deletion.
- [API contracts](api-contracts.md) — FastAPI/OpenAPI ownership, generated frontend types, runtime validation, compatibility, and API consumer tracking.

## Develop and operate the project

- [Development](development.md) — local setup, migrations, seed data, dependencies, common commands, and contributor workflow.
- [Testing](testing.md) — test layers, quality gates, browser suites, accessibility, contract checks, and when to run each level of verification.
- [Operations](operations.md) — production images, runtime configuration, health and readiness, observability, source packaging, the portfolio sandbox, and release boundaries.
- [Portfolio sandbox deployment](portfolio-sandbox-deployment.md) — reviewed image publication, EC2 host service, protected Coolify routing, hosted certification, rollback, and fail-stop recovery.

## Recommendations and evaluation

- [Recommendations and offline evaluation](recommendations.md) — the online recommendation research preview, offline content-based, collaborative, and hybrid models, evaluation methodology, reproducibility, and privacy boundaries.

## Reference

- [Data model](reference/data-model.md) — persistent entities, important relationships, and database constraints.
- [Configuration](reference/configuration.md) — environment variables, service ownership, defaults, validation, and production requirements.
- [Recovery and rollback](reference/recovery.md) — backup restoration, deletion replay, migration recovery, application rollback, and release-rehearsal procedures.
