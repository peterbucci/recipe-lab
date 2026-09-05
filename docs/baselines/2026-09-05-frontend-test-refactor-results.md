# Frontend test refactor results — 2026-09-05

This report closes the local implementation phase of RCP-48 on
`refactor/frontend-test-architecture`. The immutable starting point is
`c93b895b57e277cb495d578985f3c3237e269cc3`; implementation evidence was
measured through `0c61132`. The evidence commit that adds this report changes
documentation only. Nothing in this branch has been merged into `main`.

## Outcome

The hybrid structure from the refactor plan is now implemented. Focused tests
remain beside their production owner, shared contracts and configuration tests
live under `frontend/tests`, and Playwright journeys are selected by explicit
execution mode. No approved screenshot was regenerated or removed.

| Evidence | Before | After | Delta |
|---|---:|---:|---:|
| Vitest files | 125 | 152 | +27 |
| Vitest tests | 819 | 908 | +89 |
| Comparable Vitest wall time | 64.34 s | 48.44 s | -15.90 s (-24.7%) |
| Frontend test/spec source files | 141 | 177 | +36 |
| Frontend test/spec physical lines | 40,406 | 38,836 | -1,570 |
| Largest test/spec file | 2,841 lines | 984 lines | -1,857 |
| Frontend-root test files | 7 | 0 | -7 |
| Approved visual PNGs | 82 | 82 | unchanged |

The final Vitest distribution is:

| Owner | Files | Tests |
|---|---:|---:|
| `app` | 94 | 499 |
| `lib` | 41 | 295 |
| `scripts` | 5 | 44 |
| `server` | 3 | 31 |
| `performance` | 1 | 4 |
| `tests/config` and `tests/contracts` | 8 | 35 |
| Frontend root | 0 | 0 |
| **Total** | **152** | **908** |

Vitest now assigns 39 files / 252 tests to the Node project and 113 files /
656 tests to jsdom. Pure configuration, server, script, and library tests no
longer pay for a browser-like environment unless they explicitly need one.

## Browser organization

All browser modes pass fail-closed discovery:

| Mode | Project cases | Spec files | Local execution evidence |
|---|---:|---:|---|
| Smoke | 17 | 5 | 17 passed in 31.2 s |
| Acceptance | 23 | 12 | New cross-account community journey passed in 7.6 s against a disposable database |
| Performance | 1 | 1 | Discovery and guard validation passed |
| Release | 1 stateful journey | 1 | Discovery, 16-stage parity audit, and privacy-safe failure-location checks passed |
| Visual/accessibility | 170 | 6 | Discovery passed; 82 canonical PNGs are byte-for-byte unchanged |

Smoke runs all 15 controlled journeys in Chromium and one tagged public sanity
journey in Firefox and WebKit. The final local run had no retry or failure.
The old ordinary runner selected unrelated guarded tests and failed under an
unbounded 16-worker local default; every mode now owns its directory, guard,
worker count, reporter, and artifact policy.

Pull-request CI lists the smoke suite before running it, uses the pinned
Playwright image, and cleans browser diagnostics on success or failure.
Acceptance, performance, visual, and release remain heavier full-tier checks
with their isolated data requirements.

## Suite and helper refactors

- Draft editor, recipe library, publication, and recipe comparison component
  monoliths were split by behavior while retaining colocated support.
- The 2,841-line visual spec became six page-family specs plus one non-spec
  deterministic support module. All 85 logical tests, 170 projected cases, and
  82 snapshots were preserved.
- The 969-line smoke file became five behavior specs plus shared support.
- The 2,067-line release spec became a 111-line single-journey orchestrator
  with 16 named stages. Its 249 assertions, lifecycle cleanup, shared state,
  privacy canaries, role transitions, and backup/restore behavior were
  preserved.
- Ticket-numbered frontend paths were replaced with behavior names. Historical
  ticket identifiers remain only where they explain a contract or fixture.
- Legacy `frontend/test` helpers moved to `frontend/tests/support`; empty
  legacy directories and all root-level test files were removed.

No `skip`, `todo`, or `only` declaration remains in the frontend suites.

## Assertion ownership

Duplicated or brittle checks were changed only after a clearer owner was in
place:

- Route inventories assert completeness from the current route set instead of
  pinning an easily stale total.
- Staff certification asserts role, state, and responsive invariants instead
  of duplicating exact arrays.
- Baseline configuration asserts the installed deterministic runtime contract
  instead of mirroring incidental literals.
- The content-language scanner is one reusable contract with focused
  positioning tests.
- Shared empty-state presentation is owned by the shared component and visual
  suite rather than repeated CSS assertions in consumers.
- Ordinary API errors separate transport-core behavior from facade behavior.

Accessibility, permission, privacy, security, race, retry, duplicate-submit,
cleanup, and recovery assertions were retained.

## Behavioral coverage added

The refactor exposed and covered concrete gaps:

- Latest-request-wins auth session refresh and prior-session revocation after
  sign-out.
- Cross-account community activity visibility.
- Public route boundaries for catalog, detail, compare, and cook pages.
- Trusted-network signal and safe proxy boundaries.
- Curator decision validation, stale decisions, races, and retries.
- Moderator workspace races, permission loss, and retries.
- Malformed timestamp presentation.
- Keyboard, pointer, dismissal, and focus behavior through realistic
  `user-event` interactions.

Tests found real production race and presentation issues. Their fixes are
included and protected; no user-facing behavior was rolled back to satisfy an
old assertion.

## Coverage baseline

The final production-source coverage run passed 152 files / 908 tests in
64.80 seconds:

| Metric | Covered / total | Result |
|---|---:|---:|
| Statements | 6,158 / 7,270 | 84.70% |
| Branches | 6,095 / 7,658 | 79.58% |
| Functions | 1,598 / 1,776 | 89.97% |
| Lines | 5,847 / 6,721 | 86.99% |

This is the first production-file baseline, so no threshold was invented from
one observation. The generated report contained 239 files / 5,834,163 bytes
and was deleted after measurement.

## Final validation

- Frontend unit/component: 152 files, 908 tests passed.
- Frontend lint: passed with no warnings.
- Frontend types and generated route types: passed.
- Production build: passed; all 19 static pages generated.
- Production-source reachability: 199 modules from 57 runtime entries, passed.
- Browser mode discovery: 17 / 23 / 1 / 1 / 170, passed.
- Browser smoke: 17 passed across Chromium, Firefox, and WebKit in 31.2 s.
- Repository CI/release tooling: 120 tests plus 71 subtests passed in 27.27 s.
- Backend: full suite passed; its existing Starlette/httpx deprecation warning
  remains unrelated to this branch.

The successful smoke run generated 516,316 bytes of temporary report data,
compared with 533,061 bytes from the failed starting-baseline run. Both were
deleted. The isolated community acceptance fixture, its database, all coverage
output, and all interrupted visual differences were also deleted. The normal
local Docker frontend, backend, and database remained running and healthy.

## Environment-bound evidence

The canonical screenshots were created in the pinned Linux Playwright image.
A direct Windows run was stopped after ten comparisons because the documented
Linux-versus-Windows font, icon, and control-edge rasterization difference
changed about 1% of pixels. It produced no evidence of a layout, accessibility,
or application-state regression, and its 4,159,470 bytes of local diffs were
deleted. The authoritative double visual run belongs in the pinned Linux CI
job.

The complete acceptance, performance, and release journeys require their
guarded disposable databases, session fixtures, local OIDC provider, and
backup/restore environment. Local evidence covers discovery and guard
contracts, the newly added cross-account acceptance journey, exact release
stage/assertion parity, and privacy-safe diagnostics. The hosted full-tier
matrix remains the final review gate after this branch is pushed; this report
does not claim that environment-bound work ran on an unsuitable local setup.
