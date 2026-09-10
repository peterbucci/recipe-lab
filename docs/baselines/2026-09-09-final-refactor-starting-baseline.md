# Final refactor starting baseline — 2026-09-09

This record establishes the starting point for RF-13 through RF-26, based on
the final refactor audit for commit `d4aa0ad584952a8f137bf21e13b8c3844126a3d3`.
The work is integrated on `refactor/recipe-lab-integration`; `main` remains the
review base and receives no story commits.

## Starting verification

The repository and integration branch both began at the audited commit with a
clean worktree. The following frontend checks were run before the first
behavioral story was integrated:

| Check | Starting result |
| --- | --- |
| Moderation, Saved, and authentication state suites | 3 files and 22 tests passed |
| Frontend architecture check | Passed across 393 production files |
| Complete frontend unit/component suite | 168 files passed; 1 ESLint contract file exceeded its 5-second cold-start timeout after all other 924 tests passed |
| Timed-out ESLint contract file rerun | 1 file and 2 tests passed in 2.05 seconds |

The complete-suite timeout is recorded as an existing runner constraint rather
than a product failure. RF-26 owns the final quality-entry repair and must rerun
the complete suite after changing its orchestration.

The Windows quality runner also still passes `--configLoader runner` through
`npm test`. Vitest 4.1.11 treats `runner` as a test-file filter, so that command
selects no tests. RF-26 must correct the delegation and cover the Windows and CI
paths with the repository's runner tests.

## Draft resource lifetime decision

The audited C1 concern was confirmed at the component boundary. The draft
editor initializes reducer and local state once; if the same React instance is
reconciled from draft A to draft B, A's dirty fields and transient state remain
visible until B loads, and some non-domain state can survive the load.

Cache Components are not enabled in `next.config.ts`, so the current router is
expected to remount this page during ordinary navigation. The route now also
keys the editor by `draftId`, making the private resource boundary explicit and
safe if routing behavior or cache configuration changes. The regression
changes the rendered page from a dirty A resource to B and verifies that B gets
a fresh editor instance. A same-account session recovery retains the same draft
ID and therefore preserves editor work.

No visual baseline changed for this resource-lifetime correction.
