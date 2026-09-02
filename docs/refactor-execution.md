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

## Evidence required from each work package

Each topic branch records:

1. the invariant and behavior it preserves;
2. the focused tests and static checks it ran;
3. before/after measurements for any performance claim;
4. migration, generated-contract, accessibility, visual, or deterministic
   evidence when that surface changes; and
5. rollback notes for changes that alter persistence, caching, security, or
   deployment behavior.

