# RCP-49 frontend architecture certification

Date: 2026-09-05

This record closes the RCP-49 frontend ownership refactor. It compares the
immutable RCP-49A inventory with the completed structure and records the
verification evidence for the integration branch. It does not replace or edit
the starting inventory.

## Inventory delta

| Evidence | RCP-49A baseline | RCP-49I certification | Delta |
|---|---:|---:|---:|
| Source files in `frontend/app/components` | 169 | 0 | -169 |
| Source files in `frontend/lib` | 85 | 0 | -85 |
| Total files in retired source locations | 254 | 0 | -254 |
| Files audited by the architecture checker | 342 | 393 | +51 |
| Reachable runtime modules | 199 | 232 | +33 |
| Runtime entries | 57 | 57 | 0 |
| Next route convention entries | 56 | 56 | 0 |
| Stylesheets | 32 | 32 | 0 |
| Approved visual PNGs | 82 | 82 | 0 |
| Vitest files | 153 | 169 | +16 |
| Vitest tests | 912 | 925 | +13 |

The source-count increase in the architecture audit reflects the completed
feature owners and their colocated tests/support. It is not a growth of route,
stylesheet, or visual-baseline surface.

## Coverage delta

| Metric | RCP-49A | RCP-49I |
|---|---:|---:|
| Statements | 84.70% | 84.86% |
| Branches | 79.58% | 79.68% |
| Functions | 89.97% | 90.20% |
| Lines | 86.99% | 87.06% |

The final coverage run passed all 169 files and 925 tests. Coverage includes the
performance model in its final `e2e/performance` owner and excludes the retired
`lib` location.

## Final enforced boundaries

- `app/components` and `lib` are retired; any source file there fails the
  architecture audit.
- Routes compose features, shared infrastructure, and the domain-neutral shell.
- Shared and shell modules cannot import feature code.
- Cross-feature and cross-recipe-workflow imports are limited to reviewed
  public modules. The checker explicitly rejects recipe shared-to-authoring,
  community-to-private-library, and authoring-to-private-detail dependencies.
- The runtime import graph must be cycle-free.
- A client module cannot directly or indirectly reach a server-only module.
- Feature-root and shared-root barrel files remain forbidden.

## Recorded verification

| Check | Result |
|---|---|
| Focused architecture, performance-model, and Vitest-config tests | 3 files, 12 tests passed |
| Full Vitest coverage run | 169 files, 925 tests passed |
| Architecture audit | 393 source files, 0 retired-location files |
| Reachability audit | 232 modules from 57 runtime entries |
| Browser-mode discovery | smoke 17, acceptance 23, performance 1, release 1, visual 170 |
| Controlled-data browser smoke | 17 of 17 passed across Chromium plus the Firefox and WebKit sanity journeys |
| Public performance budget | 1 of 1 passed with pinned Node 22.23.2 and Chromium 151 against the isolated MVP database |
| Database-backed MVP acceptance | 23 of 23 passed against the isolated MVP database |
| Stateful community release journey | 1 of 1 passed against the isolated RCP-32 database and local OIDC provider |
| Release recovery and privacy checks | Live/restored evidence matched; three generated artifacts scanned with zero privacy findings |
| Pinned visual/accessibility double-run | 340 scheduled cases: 176 applicable checks passed and 164 deliberate project/viewport skips |
| Next route entries | 56 retained |
| Stylesheet inventory | 32 retained; cascade and file bytes unchanged |
| Approved visual artifacts | 82 retained; PNG bytes unchanged |

The RCP-49 stories changed ownership and enforcement, not application behavior
or styling. The integration branch remains separate from `main` pending
review.

The browser runs used fresh servers from the integration branch. Performance
ran before the state-mutating acceptance suite. The visual double-run used the
exact pinned Linux Playwright image from CI and did not update any golden. The
release journey used a separate allowlisted database, verified the same logical
evidence after backup and restore, and scanned its manifest and browser output
before all disposable databases, private fixtures, reports, coverage output,
build output, and temporary runtimes were removed.
