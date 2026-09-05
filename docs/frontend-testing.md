# Frontend testing architecture

Recipe Lab uses a hybrid test layout. A focused test stays beside the code it
owns; a cross-cutting contract or shared helper lives under `frontend/tests`;
and browser journeys are grouped by execution mode under `frontend/e2e`.

This document is the current placement, execution, privacy, and ownership
contract for frontend tests. Historical ticket identifiers may explain why a
test exists, but test names and paths should describe the behavior they protect.

## RCP-48 starting baseline

The baseline was recorded on 2026-09-05 from merged `main` commit `c93b895`
before any RCP-48 file move or assertion change.

| Evidence | Result |
|---|---:|
| Vitest files discovered and executed | 125 |
| Vitest tests | 819 passed, 0 failed, 0 skipped |
| Vitest wall time | 64.34 seconds |
| Ordinary Playwright discovery | 39 tests in 15 files |
| Deterministic visual discovery | 170 project cases in 1 file |
| Approved visual baseline PNGs | 82 |
| Ordinary local Playwright run | 12 passed, 24 skipped, 3 failed in 34.9 seconds |
| The same 11 public-page tests with one worker | 11 passed in 29.0 seconds |
| Generated diagnostics from the failed run | 533,061 bytes, removed after measurement |

The ordinary Playwright failures were reproducible only under the current
16-worker local default and passed with one worker. That is baseline evidence
of unsafe shared-fixture concurrency, not an accepted product failure. RCP-48
must make every browser mode explicit and give each mode a deliberate worker
limit.

Source-file counts are navigation evidence, not authoritative discovery
counts. At the baseline there were 141 frontend test files: 125 Vitest files
and 16 Playwright specs. The Vitest files were distributed as follows:

| Location | Files | Placement decision |
|---|---:|---|
| `frontend/app` | 73 | Keep beside pages and components |
| `frontend/lib` | 38 | Keep beside shared logic |
| `frontend/scripts` | 4 | Keep beside maintenance scripts |
| `frontend/server` | 2 | Keep beside server modules |
| `frontend/performance` | 1 | Keep beside the performance model it tests |
| Frontend root | 7 | Move to config, contract, or server owners |
| `frontend/e2e` | 16 | Group by browser execution mode |

## Placement decision

Use the smallest layer that can prove the behavior:

| Test kind | Location | Use it for |
|---|---|---|
| Unit/component | Beside code in `app`, `lib`, `server`, `scripts`, or `performance` | One clear production owner |
| Config contract | `frontend/tests/config` | Next.js, Vitest, or Playwright configuration behavior |
| Cross-cutting contract | `frontend/tests/contracts` | Language, route, architecture, and inventory rules |
| Shared Vitest support | `frontend/tests/support` | Builders and helpers used by multiple owners |
| Browser smoke | `frontend/e2e/smoke` | Short pull-request journeys with controlled data |
| Browser acceptance | `frontend/e2e/acceptance` | Real isolated backend/database workflows |
| Visual/accessibility | `frontend/e2e/visual` | Deterministic screenshots and page-level accessibility |
| Performance | `frontend/e2e/performance` | Public-route measurements and budgets |
| Release | `frontend/e2e/release` | Stateful authentication, role, privacy, backup, and restore proof |

Do not create a generic `tests/integration` dumping ground. Add that directory
only when a real multi-module test has no stable production owner.

Use `.test.ts`, `.test.tsx`, or `.test.mjs` for Vitest and `.spec.ts` for
Playwright. Helpers use neither suffix. Pure Node tests must not inherit jsdom
merely because component tests need it.

## Browser execution modes

Every Playwright command selects exactly one owned directory. The unqualified
`npm run test:e2e` and `npx playwright test` commands intentionally fail;
they cannot guess a mode or silently mix guarded and controlled-data tests.

| Mode | Command | Selected directory | Required environment |
|---|---|---|---|
| Smoke | `npm run test:e2e:smoke` | `e2e/smoke` | Full Chromium suite plus one tagged public journey in Firefox and WebKit; no real account |
| Acceptance | `npm run test:e2e:acceptance` | `e2e/acceptance` | Isolated MVP database, session fixture, and explicit loopback services |
| Visual/accessibility | `npm run test:e2e:visual` | `e2e/visual` | Built frontend plus the dedicated sanitized fixture |
| Performance | `npm run test:e2e:performance` | `e2e/performance` | Isolated MVP database, explicit performance request, and loopback services |
| Release | `npm run test:e2e:release` | `e2e/release` | Exact disposable RCP-32 database, local OIDC, manifest, and loopback services |

`npm run test:e2e:discover` runs Playwright list discovery for all five modes
with inert, allowlisted declarations. It fails if a config cannot load or a
mode selects zero tests; it never starts a server or browser. Acceptance,
performance, and release commands separately validate their real guard flags,
database names, service URLs, and required fixture paths before discovery.

The smoke mode keeps failure screenshots and first-retry traces because it uses
controlled data. Acceptance, performance, and release modes always disable
traces, screenshots, and video. Release also retains its single-worker,
zero-retry behavior and, on CI, its GitHub-only reporter and privacy-safe
file/line failure annotation.
The visual config remains independent, deterministic, and limited to its
reviewed aggregate plus expected/actual/diff image allowlist.
Its 85 logical checks are grouped into six behavior/page-family
`*-baseline.spec.ts` files. Shared fixture reset, frozen browser, privacy,
accessibility, overflow, and capture behavior lives in the non-spec
`frontend/e2e/visual/visual-baseline-support.ts` module.
All five modes currently use one worker: guarded modes own state, while the
starting baseline proved the controlled smoke fixtures were unsafe at the old
unbounded local default. Any increase belongs to measured scheduling work.

Pull-request CI first lists the smoke mode so an empty selection fails, then
runs all 15 controlled-data checks in Chromium plus one tagged signed-out
catalog journey in Firefox and WebKit. The 17 cases share one worker and at
most two retries; the secondary engines do not multiply the entire suite. The
job uses the pinned Playwright image, never receives database, session, or OIDC
inputs, uploads no browser report, and deletes local diagnostics even after
failure. The heavier acceptance, visual, performance, and release modes remain
outside the pull-request tier.

## Coverage

`npm run test:coverage` measures production modules in `app`, `lib`,
`server`, and `server.mjs`. It excludes tests, declarations, generated API
contracts, and colocated `*-test-support` modules. The command writes text,
JSON summary, and LCOV output to the ignored `frontend/coverage` directory.
Coverage output is temporary evidence and should be deleted after its results
are recorded.

The first measured baseline intentionally has no percentage gate. A threshold
should be introduced only after several comparable runs establish a stable
floor, and it should protect meaningful production ownership rather than reward
low-value line execution. Current measured results and the completed RCP-48
deltas are recorded in the
[frontend test refactor results](baselines/2026-09-05-frontend-test-refactor-results.md).

## Behavior ownership map

This map prevents a coverage percentage or a screenshot from being mistaken
for behavioral protection. Update it when ownership changes.

| Behavior | Primary owner | Complementary evidence |
|---|---|---|
| Draft editing, save races, stale revisions, and recovery | Draft editor component/domain tests | Isolated draft acceptance |
| Original/version publication and idempotency | Publication component/domain tests | Publication acceptance and release journey |
| Save/rating isolation and duplicate submissions | Interaction/API tests | MVP acceptance |
| Sign-in, callback, session expiry, and account switching | Auth/session component and API tests | Smoke and release journeys |
| Public recipe browse/detail/compare | Route and component tests | Smoke, visual, and performance modes |
| Private recipe libraries | Library state/component tests | Recipe-libraries acceptance |
| Community follow, feed, followers, and account activity | Follow/activity component and API tests | Cross-account acceptance |
| Ingredient request and curation | Picker/history/staff component tests | Member and curator acceptance |
| Recipe reporting and moderation | Report/moderation component and API tests | Moderator acceptance |
| Permission loss and role separation | Route gates and staff-workspace tests | Staff acceptance and release journey |
| Transport, proxy headers, and safe errors | API transport/proxy tests | Security and acceptance gates |
| Shared appearance and responsive states | Shared-component tests | Deterministic visual/accessibility baselines |
| Public performance budgets | Performance model tests | Isolated Playwright measurements |
| Backup/restore and deleted-account privacy | Backend governance tests | One stateful RCP-32 release journey |

## Refactor guardrails

- Preserve discovered tests and approved screenshots through mechanical moves.
- Separate file moves from assertion changes in commits.
- Remove an assertion only after naming its owning replacement or explaining why
  it tested an implementation detail rather than behavior.
- Do not use coverage percentage alone to remove or add tests.
- Retain permission, privacy, accessibility, security, race, retry, cleanup,
  duplicate-submission, and recovery assertions.
- Keep the RCP-32 release journey stateful; use named stages to improve failure
  reporting without breaking intentional shared state.
- Keep deterministic visual comparisons and their double-run until measured
  stability supports a reviewed reduction.
- Keep raw authenticated diagnostics private and temporary.

## Branch and completion contract

RCP-48 work is integrated on `refactor/frontend-test-architecture`. Focused
commits must pass their affected checks before the next phase. The final commit
must run the complete repository CI and release matrix, publish discovery,
coverage, runtime, retry, and artifact-size deltas, and remain outside `main`
until reviewed.
