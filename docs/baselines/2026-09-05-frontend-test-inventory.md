# Frontend test inventory — 2026-09-05

This is the immutable pre-RCP-48 baseline for commit
`c93b895b57e277cb495d578985f3c3237e269cc3`. It records runner discovery and
observed execution before files, configuration, assertions, or CI paths move.
The current policy lives in [Frontend testing architecture](../frontend-testing.md).

## Authoritative discovery

| Mode | Command | Result |
|---|---|---:|
| Vitest files | `npx --no-install vitest list --filesOnly` | 125 files |
| Vitest execution | `npm test -- --reporter=verbose` | 819 passed in 64.34 seconds |
| Functional Playwright | `npx --no-install playwright test --list` | 39 tests in 15 files |
| Deterministic visual | `npx --no-install playwright test --config=playwright.baseline.config.ts --list` | 170 project cases in 1 file |
| Public performance | `npx --no-install playwright test e2e/public-performance-baseline.spec.ts --list` | 1 test |
| Stateful release | `npx --no-install playwright test e2e/rcp32-community-release-gate.spec.ts --list` | 1 test |

The visual count is 85 logical tests projected across desktop and phone. The
repository contains 82 approved PNGs; six non-screenshot browser checks and
viewport-specific skips explain why pass counts and PNG counts are not equal.

## Vitest distribution

| Location | Files | Tests |
|---|---:|---:|
| `app` | 73 | 439 |
| `lib` | 38 | 289 |
| `scripts` | 4 | 40 |
| Frontend root | 7 | 29 |
| `server` | 2 | 18 |
| `performance` | 1 | 4 |
| **Total** | **125** | **819** |

No Vitest `skip` or `todo` declaration was present at this baseline.

## Browser selection before RCP-48

The ordinary Playwright config discovers every browser spec except the
deterministic visual file. Mode flags inside the specs decide which tests skip:

- Ordinary environment: 15 active mock-backed tests (`auth.spec.ts` and
  `home.spec.ts`) and 24 runtime skips.
- Guarded MVP environment: 37 active tests; performance and RCP-32 remain
  skipped and are selected separately by flags and exact file paths.
- Visual environment: 170 project cases under the dedicated deterministic
  config; the documented stable result is 88 passes and 82 viewport skips.

An ordinary local run used 16 workers and produced 12 passes, 24 skips, and
three failures in 34.9 seconds. All 11 `home.spec.ts` tests passed in 29.0
seconds when rerun with one worker. The failures therefore record unsafe
shared-fixture concurrency in the old default, not an accepted application
failure. The failed run generated 533,061 bytes of reports/results, which were
measured and removed.

## Oversized suites

| File | Physical lines | Discovered tests |
|---|---:|---:|
| `e2e/rcp34b-baseline.spec.ts` | 2,841 | 170 project cases / 85 logical |
| `e2e/rcp32-community-release-gate.spec.ts` | 2,067 | 1 stateful journey |
| `app/components/recipe-draft-editor.test.tsx` | 1,562 | 33 |
| `app/components/recipe-library-views.test.tsx` | 1,485 | 26 |
| `e2e/ingredient-request-history-acceptance.spec.ts` | 991 | 2 |
| `e2e/home.spec.ts` | 969 | 11 |
| `app/components/recipe-draft-publication.test.tsx` | 930 | 16 |
| `app/components/recipe-diff-view.test.tsx` | 768 | Review during split phase |
| `content-language-policy.test.ts` | 741 | 9 |

The release journey intentionally shares account, publication, deletion, and
backup/restore state. It must gain named stages rather than be divided into
independent tests.

## Helper ownership before RCP-48

- Shared Vitest: `frontend/test/builders/recipe.ts` and
  `frontend/test/deferred.ts`, imported 15 times across 14 test files.
- Acceptance: `e2e/acceptance-session.ts` and
  `e2e/acceptance-draft-isolation.ts`.
- Release: `e2e/rcp32-oidc.ts` and `e2e/rcp32-operator.ts`.
- Visual: the RCP-34B fixture, reporter, and RCP-46F staff matrix.

## Unmeasured baseline fields

Coverage by production file, repeated-run flake rates, isolated-mode artifact
size, and per-mode hosted duration were not available before RCP-48. Stories
RCP-48F and RCP-48J must record them before proposing thresholds, retry changes,
or visual matrix reductions.
