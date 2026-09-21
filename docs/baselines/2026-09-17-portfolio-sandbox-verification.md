# Portfolio sandbox: final local verification

Verified on 2026-09-17 UTC from `codex/public-portfolio-sandbox`.
This supplements the [implementation record](2026-09-16-portfolio-sandbox-implementation.md).
These are local reproductions of the checked-in CI gates using isolated Docker
environments, not a GitHub Actions run or public-host certification. No images,
source, or test records were uploaded. Hosting approval remains #21 work.

## Results

| Gate | Final result |
| --- | --- |
| Backend unit/integration | 915 passed; fresh migration through 0035 and no schema drift |
| Offline evaluation | 341 passed; all six checked-in reproducibility command blocks passed |
| Frontend unit tests | 193 files, 1,079 tests passed with the final dependency lock |
| Tooling | 157 tests and 75 subtests passed |
| Types | Strict backend/ML checks passed for 308/60 files; frontend type check passed |
| Static checks | Lint, format, architecture, reachability, CSS, API contracts, seeds, documentation links and workflow validation passed |
| Deterministic visual/accessibility comparison, repeated twice | 200 passed, 184 intentional viewport/project skips, zero failures |
| Cross-engine controlled authentication journeys | 12 passed across Chromium, Firefox and WebKit |
| Public performance baseline | Passed without changing budgets |
| Full MVP browser acceptance | 24 passed against real backend/PostgreSQL |
| Sandbox CI entry script | Passed its real two-visitor browser journey and guarded database/process cleanup |
| Community release journey | Passed, including migration reversal, real local identity provider, moderation, publication and account lifecycle evidence |
| Community recovery | Restored database evidence byte-identical to live evidence; zero findings in the checked privacy-artifact scan |
| Production images | Final image verifier passed, including startup, redacted configuration failures and database-outage readiness |
| Final-image sandbox expiry/reset | Two real generations passed; independent expiry removed storage, old sessions/content were rejected, fresh entry worked, and all owned rehearsal resources were removed |
| Dependency security | Full npm audit: zero advisories; Trivy HIGH/CRITICAL gate: zero findings |

Toolchain versions were Python 3.13.15, uv 0.12.6, Node.js 22.23.2,
Playwright 1.62.1, Chromium 151.0.7922.34 and PostgreSQL 17.11. Browser work used
the repository's pinned Ubuntu Noble Playwright image; backend/ML aggregates
used the pinned Alpine development image. This is not a claim to reproduce every
property of a GitHub-hosted runner. The backend run reported one existing
Starlette/httpx deprecation warning, with no failing tests.

The previously unresolved Windows sign-in screenshot difference did not reproduce
on pinned Linux. Both comparisons passed with the committed screenshots intact.
No visual baseline, performance budget, architecture rule or application test
expectation was relaxed.

## Verification fixes

The security scan exposed two existing problems, addressed in their current owners:

- `.github/workflows/security.yml` now exports each Python runtime dependency set
  to its own canonical `requirements.txt`. The former custom filenames were not
  detected by Trivy's pip analyzer. Actual coverage was verified: 35 API packages,
  35 evaluation packages and 541 npm packages. Development dependencies are now
  included in the dependency scan, with regression coverage in the existing
  workflow tests.
- `frontend/package-lock.json` updates only the compatible transitive
  `@redocly/openapi-core` patch from 1.34.19 to 1.34.20 and its `js-yaml` dependency
  from 4.3.1 to 4.3.2. Top-level versions/ranges and production dependencies are
  unchanged. This addresses the development-tooling denial-of-service advisory
  [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh).

Trivy 0.74.0 scanned the reviewed candidate for HIGH/CRITICAL vulnerabilities and
secrets with zero findings; this is not an all-severity attestation. Actionlint
1.7.7 passed against every checked-in workflow. The final lock received a fresh
install, full frontend unit/static/build checks and full npm audit. The visual,
MVP and community runs used identical application code before the parser-only
development dependency patch. The final production frontend was rebuilt afterward.

No feature ownership, app composition, shell/shared boundary, backend authority,
transaction ownership, publication invariant or API contract changed in this
verification follow-up.

## Final images and retained evidence

- Backend: `sha256:69c8472ba8f5f31f2a9de7c0e56eea5c007e005c13f0dd629753a60086d9da00`.
- Frontend: `sha256:109d9f91d40c22ae269ec5720bfde11da7004c40f7c9bb29c17795c24c8b40fc`.

Identifier-free local evidence is retained under `artifacts/ci-final-20260917`
and `artifacts/sandbox-browser-20260917`. These ignored verification artifacts
are not visitor records or tracked source. Commit-bound source packaging and its
security scan are checked after recording this document, before the local merge.

Test databases were isolated from development and held only synthetic data.
The community recovery test copied its synthetic persistent-profile database
through process memory, not a retained backup file; it did not back up sandbox
visitor data. Removing the owned test containers discards this synthetic data
without a recovery copy. Development services on 3000/8000 were not restarted or
reset.

One cleanup operation was policy-blocked: the browser verification container
`recipe-lab-pinned-browser-20260917` was stopped instead. It has no published ports
or mounted host directories. Its non-sensitive source copy remains at
`C:/Users/sb128/AppData/Local/Temp/recipe-lab-pinned-browser-20260917`; both are
recoverable verification leftovers, not a running demo.

## Release boundary

The local implementation may be merged after the final checks above. GitHub
Actions has not been dispatched and no remote push is recorded here. Before
public routing, #21 still requires the actual origin/contact, HTTPS proxy,
platform retention/log/cache/snapshot controls and monitoring evidence.
#254/RCP-54 remains required before persistent community operation or an
exceptional erasure claim. Keep #279 open for its remaining deployment evidence.
