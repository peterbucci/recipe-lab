# Refactor execution record

This document records the safety boundary and verification baseline for the
repository-wide refactor tracked in the private **Recipe Lab Refactor** GitHub
project.

## Integration boundary

- The shared integration branch is `refactor/recipe-lab-integration`.
- Topic branches are created from that branch and merged back only after their
  focused checks pass.
- The shared integration branch is updated from `main` with merge commits at
  explicit checkpoints; it is never rebased after collaboration begins.
- No refactor commit or topic branch is merged directly into `main`.
- The final integration-to-`main` pull request is created only after the full
  verification matrix passes and a maintainer explicitly approves the merge.

The refactor began from commit `a727faf`, which includes the reviewed homepage,
community, account, authoring, and navigation refinements from
`test/homepage-mockup-alignment`.

## Preserved contracts

Every work package must preserve the invariants documented on the project board,
including immutable published snapshots, atomic and idempotent publication,
private-data isolation, distinct curator and moderator permissions, OIDC and
session protections, migration reproducibility, generated-contract ownership,
and deterministic release evidence.

## Initial verification baseline

The following checks were run on Windows before the first refactor topic branch
was merged:

| Area | Result |
| --- | --- |
| Backend formatting | 237 files already formatted |
| Backend lint | Passed |
| Backend strict typing | 235 source files passed |
| Backend unit tests | 345 passed, 365 skipped |
| Frontend API contract drift | Passed |
| Frontend lint | Passed |
| Frontend type generation and strict typecheck | Passed |
| Frontend unit/component tests | 112 files and 738 tests passed |
| ML formatting | 46 files already formatted |
| ML lint | Passed |
| ML strict typing | 46 source files passed |
| ML tests | 305 passed, 1 skipped |

The backend and ML test commands use a repository-owned temporary directory in
the managed Windows environment because the default per-user pytest temporary
directory is not readable there. Vitest uses Vite's `runner` config loader in
that environment because esbuild cannot enumerate the drive root. These are
execution-environment accommodations; they do not change product behavior or
weaken the checks.

## Backend test architecture

Database-backed API fixtures use `backend/tests/application.py` for the
request-session override and application cleanup. Authentication, role grants,
domain records, and specialized dependency overrides stay in the feature
fixture so setup remains readable. Fixtures that require non-expiring ORM state
request it explicitly instead of changing the shared default.

`backend/tests/database.py` owns only the repeated connection transaction,
session close, and outer rollback lifecycle. It is not used around tests that
exercise or assert savepoints, so transaction behavior remains visible at the
call site.

The broad migration and recipe-publication conformance modules keep their
established file paths and pytest node identities. Their cases share ordered
migration state or one dense publication fixture, so moving tests solely to
reduce line counts would duplicate setup and invalidate stable collection
references. New independent concerns should continue to use focused modules.

## Completed work packages

Implementation is complete for every work package tracked on the private
**Recipe Lab Refactor** project. The final package remains in review rather
than being merged to `main`.

| Package | Scope completed | Verification evidence |
| --- | --- | --- |
| RF-00 | Recorded invariants, the starting baseline, integration rules, and rollback expectations before changing behavior. | Baseline checks and the branch boundary are preserved in this record. |
| RF-01 | Repaired repository-health issues, removed reviewed unreachable source, and made reachability and compatibility inventories fail closed. | Repository policy, source reachability, architecture, and documentation-link checks pass. |
| RF-02 | Grouped configuration by concern, isolated authentication workflow orchestration, and hardened OIDC cache, session, throttle, and immediate-consumption ordering. | Focused authentication tests pass, including deterministic database/application timestamp-ordering coverage. |
| RF-03 | Established OpenAPI ownership, deterministic generated frontend types, shared browser/server transports, explicit mutation policy, and complete feature adoption of the transport boundary. | OpenAPI and generated-client drift checks pass; the transport-boundary audit has no violations. |
| RF-04 | Kept domain outcomes transport-neutral, unified idempotency contracts, preserved atomic transactions and visibility rules, and added reproducible PostgreSQL migrations and policy checks. | The live PostgreSQL suite, migration upgrade/check, security-boundary audit, and isolation tests pass. |
| RF-05 | Bounded activity, homepage, recommendation, duplicate-detection, search, and catalog reads; added covering indexes and shared link pagination where policies match. | Large-catalog and shortlist regressions pass; migration indexes and bounded-query behavior are covered. |
| RF-06 | Unified draft and publication state transitions, separated publication phases, preserved atomic/idempotent publication, and centralized recipe-document materialization. | Draft, publication, snapshot, and recipe-materialization tests pass against PostgreSQL. |
| RF-07 | Introduced accessible overlay, loading, access-gate, staff-workspace, and card primitives; corrected icon semantics and approved accessibility baselines. | Focused component tests and the accessibility/visual suite pass. |
| RF-08 | Consolidated feature state with discriminated reducers, made saved reads and request cleanup effect-safe, narrowed client boundaries, isolated recipe-family APIs, and reused compatible pagination mechanics. | The complete frontend unit/component suite and production build pass. |
| RF-09 | Established explicit CSS cascade ownership, modularized feature styles, enforced style contracts, and completed strict backend, frontend, ML, and scripts typing/lint cleanup. | CSS contracts, Ruff, ESLint, mypy, Next type generation, and TypeScript checks pass. |
| RF-10 | Decomposed and hardened the ML/recommendation pipeline, bounded candidate shortlists, and preserved deterministic evaluation and generated wire contracts. | The full ML suite and recommendation contract/shortlist regressions pass. |
| RF-11 | Consolidated test builders and harnesses, checked in stable quality commands, tiered fast and full CI gates, and hardened documentation, source packaging, security, Docker, and release checks. | Scripts tests, workflow-tier tests, source-package audit, Compose validation, and documentation gates pass. |
| RF-12 | Integrated all reviewed topic branches, aligned approved visual baselines, limited Vitest worker contention, removed generated comparison artifacts, and reran the complete verification matrix. | Final static, backend, frontend, ML, scripts, migration, visual/accessibility, image, lockfile, and Compose checks pass. |

## Pre-merge local verification

The integration branch produced the following local evidence before hosted
merge-readiness verification. These results do not attest the complete browser
journeys, canonical Linux rendering, production images, or release rehearsal:

| Area | Final result |
| --- | --- |
| Backend with live PostgreSQL | 813 collected; 812 passed and 1 expected skip |
| PostgreSQL migrations | Single head `20260902_0030`; upgrade and drift check passed with no pending operations |
| Frontend unit/component tests | 124 files and 785 tests passed |
| Frontend production build | Passed; all 19 static pages generated |
| Playwright functional discovery | 39 tests across 15 files discovered successfully |
| Visual and accessibility baselines | 170 cases completed: 88 passed, 82 expected viewport skips, and 0 failures |
| Tracked visual assets | 82 opaque PNG baselines reviewed; the 88 passing browser cases included 6 non-screenshot checks; 0 stale, missing, or mismatched files |
| ML tests | 323 collected; 322 passed and 1 expected skip |
| Repository scripts | 112 tests passed, including 71 subprocess cases |
| Static and contract gates | Repository policy, architecture, documentation links, OpenAPI, seed data, generated frontend contracts, CSS contracts, lint, and strict typing passed |
| Packaging and deployment inputs | Deterministic source-package audit, `uv` lock check, and Docker Compose configuration validation passed |

Seed validation covered 34 recipe versions, 9 variants, 99 ingredients, 12
substitutions, 19 units, and 54 action types. Generated visual comparison
artifacts were not retained; only the approved tracked baselines remain.

## Deliberate boundaries

The refactor shares mechanics only when their contracts are actually the same.
Several apparent opportunities were intentionally not generalized:

- Route handlers keep small `ApiError` translations for simple reads and wire
  validation. Domain and service code remains transport-neutral, while HTTP
  concerns stay at the boundary.
- The shared backend application/database harness owns repeated connection,
  session, cleanup, and outer-rollback mechanics. Tests that exercise or assert
  savepoints keep transaction setup visible at the call site.
- The broad migration and publication conformance modules retain their file
  paths and pytest node identities because their cases depend on ordered
  migration state or one dense publication fixture.
- Frontend primitives share identical interaction, accessibility, transport,
  and pagination policies. Feature-specific reducers and orchestration remain
  local when their transitions or invariants differ.

These decisions avoid abstractions that would hide important behavior or couple
features that only look similar at the presentation layer.

## Local environment limitations

The managed Windows environment could validate Docker Compose configuration but
could not access a Docker daemon. Production image builds, `actionlint`, hosted
CI status attestation, and the complete deployment/release rehearsal therefore
remain hosted-CI checks. Repository-owned temporary directories, Vite's
`runner` config loader, and bounded Vitest workers were used for reliable local
execution; none changes application behavior or weakens the asserted contracts.

## Review and merge status

The refactor integration branch began from `a727faf`; the pre-merge `main`
revision was `2149c43`. Topic branches were integrated into
`refactor/recipe-lab-integration`, not directly into `main`.

On 2026-09-04 the user authorized merging the current integration branch.
[PR #174](https://github.com/peterbucci/recipe-lab/pull/174) records the exact
merge candidate, narrow readiness repairs, hosted check results, and final
merge status. Its hosted checks remain required despite the local results
above. The [canonical visual review](baselines/2026-09-04-canonical-visual-review.md)
explains the platform-dependent reference repair without treating its failed
capture run as acceptance evidence.

The separate frontend test-refactor plan, RCP-48A through RCP-48J, is tracked by
the [RCP-48 epic](https://github.com/peterbucci/recipe-lab/issues/178) on the
[refactor project Backlog](https://github.com/users/peterbucci/projects/6/views/1).
It is implemented on its own integration branch and requires a separate final
review before a future merge to `main`.
