# Final refactor execution — 2026-09-10

This record closes the RF-13 through RF-26 implementation that began from the
audited commit `d4aa0ad584952a8f137bf21e13b8c3844126a3d3`. Every story was
committed on a topic branch and merged into
`refactor/recipe-lab-integration`. `main` remains at the audited commit and no
refactor commit has been pushed or merged to it.

## Integrated stories

| Story | Completed scope | Integration merge |
| --- | --- | --- |
| RF-13 | Recorded the starting baseline and made draft identity an explicit editor lifetime boundary. | `66b1734` |
| RF-14 | Scoped moderation completion, errors, cleanup, and delayed focus to the originating case and attempt. | `418ea86` |
| RF-15 | Made the Saved URL authoritative and made removal completion snapshot-, origin-, attempt-, and lifetime-aware. | `bc883ae`, `a962485` |
| RF-16 | Unified normal authentication loading while retaining separate, non-destructive recovery and current-route instructions. | `60933af` |
| RF-17 | Removed the extinct ingredient-history selection workflow and its fixed route wrapper. | `55a7b7c` |
| RF-18 | Removed dead authoring presentations and aligned similarity assertions with the live language contract. | `ea0c500`, `79699bd` |
| RF-19 | Removed fixed frontend leaf wrappers, dead exports and variants, and corrected follow-stats evidence without deleting its backend endpoint. | `7237410` |
| RF-20 | Moved active-draft lookup, inline preparation, editor ownership, and return revalidation into `RecipeDetailExperience`. | `48c72d6` |
| RF-21 | Moved interaction and category clients to recipe-shared ownership and introduced one narrow draft-summary parser while preserving Library projection. | `d29756a` |
| RF-22 | Separated public Community profile parsing/errors from private Library page and failure semantics. | `13a3a35` |
| RF-23 | Reused the editor's local loader and gave Followers one controller-owned initial, paging, and retry path. | `0b5594d` |
| RF-24 | Consolidated public recipe child response mapping, preserved deterministic instruction order and privacy, and removed the named dead backend symbols. | `8d446ba` |
| RF-25 | Restored shell and primitive CSS ownership, reconciled responsive precedence, and added a reserved-selector ownership check. | `dd2691e` |
| RF-26 | Made the Python quality runner the single frontend suite authority, fixed the Windows Vitest argument, provisioned Python in frontend CI, and corrected current guidance. | `5de8fe1` |

The separate merge commits preserve review and rollback boundaries. The final
diff before this evidence record comprised 146 files, 5,285 insertions, and
4,201 deletions; the size reflects new race, parser, architecture, and
ownership regressions as well as production simplification.

## Final local verification

At integration commit `1193dcc`, the combined non-database command
`python scripts/run_quality_gate.py contracts lint types frontend ml`
completed successfully. The constituent evidence is recorded below.

| Area | Result |
| --- | --- |
| Frontend canonical entry | `npm run ci:verify` delegated to the Python-owned frontend suite and passed on Windows. |
| Frontend unit and component tests | 174 files and 965 tests passed. |
| Frontend structure | Architecture passed across 397 production source files; reachability covered 231 modules from 57 runtime entries. |
| Frontend production and browser inventory | Next.js 16.3.4 production build passed with 19 of 19 static pages and 27 app routes; discovery found 17 smoke, 23 acceptance, 1 performance, 1 release, and 170 visual cases. |
| CSS | The CSS ownership contract and its 10 focused checker regressions passed. Computed styles for the affected desktop, intermediate, and phone layouts matched the RF-25 parent. |
| Backend static and contracts | Ruff passed with 291 files formatted; mypy passed across 289 source files; OpenAPI and seed validation passed. |
| Backend tests and migration graph | 438 tests passed and 387 database-dependent tests skipped; one dependency deprecation warning was reported. The graph has the single head `20260902_0030`. |
| ML | Ruff and mypy passed across 60 source files; 322 tests passed and 1 declared skip remained. |
| Repository support | 124 script tests passed, including quality-runner and workflow-tier coverage. Repository policy, architecture, documentation links, generated API contracts, seed validation, and CSS contracts passed. |
| Packaging and workflow inputs | The source-package audit matched all 88 reviewed opaque entries and tracked PNGs. The dependency lock and package compatibility checks passed, and all 5 workflow/action YAML files parsed. |
| Diff hygiene | `git diff --check main...HEAD` passed and the worktree was clean after verification. |

Seed validation covered 34 recipe versions, 9 variants, 99 ingredients, 12
substitutions, 19 measurement units, and 54 cooking action types.

## Provisioned and hosted evidence still required

The local machine had no PostgreSQL server listening on `localhost:5432`.
With `PGCONNECT_TIMEOUT=5`, the repository backend gate stopped at `alembic
upgrade head` after both IPv6 and IPv4 connection attempts timed out. As a
result, migration upgrade/drift verification and the 387 database-backed tests
still require the disposable PostgreSQL environment before merge to `main`.

The canonical visual baseline is the pinned Linux/Chromium environment, not
this Windows host. The RF-25 parent and candidate `home-normal` actual images
were byte-identical locally, while both differed from the stored Linux image by
5,494 text-edge pixels. No baseline was changed. The affected computed-style
comparisons passed, but the 170-case canonical visual run remains a hosted
gate. Browser acceptance, performance, and release cases were discovered but
were not executed without the provisioned service and database stack.

Native `actionlint` was unavailable locally. Workflow ownership was instead
checked by the repository's workflow-tier tests and by parsing all workflow and
local-action YAML; hosted CI remains authoritative for `actionlint`.

## Review boundary

Review the complete candidate as
`main...refactor/recipe-lab-integration`. Do not merge it to `main` until the
live PostgreSQL migration/test gate, canonical Linux visual gate, and hosted CI
checks supply the remaining environment-specific evidence.
