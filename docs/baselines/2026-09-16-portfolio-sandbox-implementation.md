# RCP-59 portfolio sandbox implementation evidence

Evidence window: 2026-09-16 through 2026-09-17 UTC.

Candidate branch: `codex/public-portfolio-sandbox`.

This is an implementation record, **not public-launch certification**. The
interactive journey passed; individual check results and limitations are below.
Docker Desktop recovered after the initial startup failure, and the real Docker
replacement/expiry rehearsal now passes. No public deployment, registry
publication, GitHub CI dispatch, or merge is recorded here.
The [final pinned verification follow-up](2026-09-17-portfolio-sandbox-verification.md)
supersedes the earlier local test limitations below.

## Scope and story coverage

The approved scope is a publicly accessible, U.S.-focused employer portfolio
demonstration, not a persistent public community. Worldwide access is possible.
RCP-54 / #254 stays open; this record does not claim legal non-applicability or
exceptional erasure support.

| Story | Implemented candidate | Remaining evidence |
| --- | --- | --- |
| #277 / RCP-59A | Independent generated temporary members, no provider login or email collection, same-browser retry/concurrency protection, real backend permissions, entry notice and contact link | Pinned release/hosting checks |
| #278 / RCP-59B | Immutable database generation binding, maximum 24-hour lifetime, session cap, expiry admission, isolated whole-environment supervisor, clean reseeding, passive-view/research-export exclusions; real local reset/deadline and interruption checks pass | Platform-specific retention and interruption evidence on the eventual host |
| #279 / RCP-59C | Two-visitor browser acceptance, focused security/lifecycle tests, CI integration, operating instructions, local production-image/reset evidence | Exact candidate CI and platform retention certification |

#21 still owns hosting, real contact/origin configuration, HTTPS routing,
platform logging/cache/snapshot controls, monitoring, and deployment approval.
The operational requirements are in the [sandbox runbook](../portfolio-sandbox.md).

## Preserved owners

| Responsibility | Existing owner extended |
| --- | --- |
| Temporary member allocation, session resolution, expiry and sensitive-operation authorization | Backend auth service and auth API; the auth workflow retains transaction commit/rollback |
| Retry binding and session persistence | Auth repository and auth models; repositories still do not commit |
| One-time disposable environment identity/lifetime | Concrete sandbox model, repository and service; private initialization workflow owns its transaction |
| Environment admission | API composition dependency with a separate read transaction; recipe/workflow transactions are unchanged |
| Frontend session authority and demo entry | `features/auth`, using the existing provider, request identity, cancellation, same-origin transport and navigation primitives |
| Page/global composition | `app/sign-in` and `app/layout`; shell remains feature-neutral and shared remains domain-neutral |
| Temporary account presentation and safe profile completion | `features/account`; late completion may update only the initiating authenticated member |
| Drafts, publication, revisions, forks, comparison, interactions, visibility, moderation and account lifecycle | Their existing domain owners, without a parallel demo implementation or publication deletion shortcut |
| Passive-view exclusion and research exclusion | Existing interaction boundary and research API/export owners, respectively |
| Full environment replacement | Concrete operational supervisor, outside account deletion and recipe repositories |

The only new public operations are demo availability/entry under auth. Existing
session responses gain additive temporary/expiry metadata. Reviewed OpenAPI and
generated frontend types are updated together. Database migrations are additive;
ordinary persistent deployments keep sandbox mode disabled.

## Verification

| Check | Result |
| --- | --- |
| Complete frontend unit suite | Passed: 193 files, 1,079 tests |
| Complete backend suite | Final pinned follow-up passed: 915 tests; initial-run history below |
| Complete offline evaluation suite | Passed: 341 tests, with integration against an empty isolated migrated database |
| Repository tooling suite | Passed after the reset follow-up: 156 tests and 75 subtests, including 23 supervisor/rehearsal tests |
| Final focused auth/lifecycle/migration suite | Passed: 37 tests; includes lossy-rollback refusal and the corrected migration-head assertion |
| Migrated database/model drift | Passed: no new upgrade operations detected |
| Backend, evaluation and frontend type checks | Passed |
| Lint/format gate | Passed; one existing ESLint warning in ignored generated coverage output, no errors |
| Backend/frontend architecture, reachability and CSS checks | Passed; no dependency rule relaxed |
| Repository policy, documentation links, seeds and API contracts | Passed |
| Frontend production build and browser-mode discovery | Passed |
| Final real two-visitor sandbox browser journey | Passed with the production frontend and real backend/PostgreSQL; accessibility assertions passed |
| Ordinary account/private-library responsive and accessibility journey | Passed at reviewed desktop, intermediate and phone widths |
| Ordinary sign-in exact screenshot comparison | Final pinned Linux comparison passed unchanged; initial Windows limitation below |
| Docker production-image verifier | Passed for the exact candidate images; pinned Python/Node/PostgreSQL, production startup and database-outage probes |
| Real local Docker reset/expiry lifecycle | Passed; details below |
| Exact pinned GitHub CI | Not dispatched for this candidate |

The browser journey checks keyboard entry, separate member identities without
staff privileges, mutual private-draft denial, real draft creation and
publication preflight, original publication, adaptation, revision, unchanged
original snapshot, comparison, save/rating/follow, temporary-account explanation,
accessibility, logout, and continued access for the other visitor. Existing
focused suites retain the broader policy and transaction matrices.

The full backend run collected 915 tests and reached completion. Its single
failure was an old test that hardcoded the previous latest migration revision;
that module was already loaded before the assertion was corrected. A fresh
run of its three tests passed. After the final rollback guard was added, all
37 focused auth/lifecycle/migration tests passed, including the two new real
database rollback tests. The entire broad suite was not rerun after those final
changes; an all-green final aggregate is therefore not claimed here.

The local sign-in screenshot comparison differed by 3,030 pixels, concentrated
in text including unchanged header, illustration copy and footer areas. The
layout, accessibility, responsive checks and fixture privacy audit passed.
The fixture now explicitly returns disabled demo availability for ordinary
account scenarios, and the screenshot waits for the real sign-in option.
Keep the committed Linux baseline unchanged and run its pinned comparison in CI.

Additional focused tests cover ambiguous entry retries, same-browser entry/logout
ordering, revoked-token non-resurrection, generation capacity and expiry,
origin/CSRF enforcement, stale frontend completion, immutable generation binding,
unavailable restored/expired environments, content/readiness shutdown, passive
view exclusion, research export refusal, and exact-owner operational cleanup.

Local runtime was Windows, Node.js 22.13.0, Python 3.12.14 and PostgreSQL 18.6.
This is not a substitute for the repository's pinned Linux/Node/Python/
PostgreSQL 17.11 image checks. An initial evaluation run against an existing
seeded development database was unsuitable for the empty-database fixture;
the complete evaluation suite passed after rerunning against an independently
created empty test database. No existing development database was reset.

After verification, the separately started backend on port 8100 was stopped and
both task-created databases (`recipe_lab_sandbox_acceptance` and
`recipe_lab_evaluation_sandbox_test`) were dropped after checking their exact
database identities and confirming no remaining connections. This disposable
synthetic test data has no recovery copy. The user's development services and
database were left in place.

The added CI step uses the existing full MVP-acceptance job and its PostgreSQL
service. It creates a separate database, verifies its own backend process and
generation identity, disables raw browser artifacts, and removes only its own
process groups, database identity and temporary outputs. Its unit/workflow tests
pass; the step has not been dispatched on GitHub for this branch.

## Implementation adjustments and unresolved gate

- Reset discards an entire isolated environment. It does not delete immutable
  published versions, reinterpret seed loading as reset, or change ordinary
  account-deletion semantics.
- Visitors are generated ordinary members, not shared seeded demonstration
  accounts. There is no provider-backed recovery or sensitive-account proof;
  temporary identities cannot pretend to complete those workflows.
- Passive view tracking and research recommendations/exports are disabled in
  the sandbox. Explicit product actions retain their normal transactional
  records until the generation is discarded.
- The supervisor requires preverified exact local image IDs and a separately
  verified HTTPS proxy. It neither provisions hosting nor alters the user's
  development Compose deployment.

Docker Desktop's startup log reported failure accessing its local inference
runtime endpoint, followed by backend shutdown. The daemon was initially
unavailable; no sandbox containers were launched or production lifecycle pass
claimed during that implementation run.

### Docker recovery follow-up: 2026-09-17 UTC

With Docker Desktop stopped, the inaccessible `dockerInference` endpoint could
not be renamed individually. Its verified runtime directory contained only that
zero-byte endpoint and `userAnalyticsOtlpHttp.sock`. The directory was preserved
as `Docker/run.quarantine-20260916-2118`, and an empty `Docker/run` was created.
Relaunching Desktop succeeded without a reboot, settings change, factory reset,
data purge, software reinstall, or global WSL shutdown.

Desktop reported running and Engine 28.3.0 answered API requests. An isolated,
network-disabled, read-only disposable container ran from an existing local
image and automatically removed itself successfully. The existing three
containers, 27 images and 64 volumes remained visible. Existing stopped Compose
containers were not manually restarted; the separate local development services
on ports 3000 and 8000 remained running. The quarantined runtime files were not
deleted. This verifies Docker recovery, not sandbox replacement or retention.

### Real container rehearsal follow-up: 2026-09-17 UTC

Built fresh production images from the candidate without reusing build layers,
then passed the existing production-image verifier against pinned PostgreSQL
17.11. These exact local image IDs were used for the rehearsal:

- Backend: `sha256:69c8472ba8f5f31f2a9de7c0e56eea5c007e005c13f0dd629753a60086d9da00`.
- Frontend: `sha256:6a60a4a70c8f90ad5d13a5f848cf8235635979dff3c0b9efa4657c938276af85`.

The identifier-free verifier receipt is retained locally at
`artifacts/sandbox-reset-20260917/production-images.json` (ignored build evidence,
not a tracked visitor artifact). Images remain local and were not published.

The first startup attempt correctly failed its host-listener readiness check:
Docker Engine 28.3.0 did not publish the frontend port from the internal-only
network, although container-local health and browsing worked. The operational
supervisor now gives only the frontend a separate generation-owned ingress
bridge. Its listener stays loopback-only; backend/database remain solely on the
internal network without published ports. Cleanup validates and removes both
networks. This changes deployment wiring, not domain ownership or API contracts.

The real two-generation rehearsal uses a temporary loopback HTTPS proxy and
client-only certificate trust, Secure cookies, the production frontend API
proxy, backend, and memory-backed PostgreSQL. Both the initial 240-second run and
the final current-code 120-second run exited successfully. They passed:

- Independent temporary members, private-draft isolation, profile updates, actual
  publication, saves, ratings, follows, reports, and ingredient requests.
- Generation verification refuses a changed UUID or extended expiry; the original
  binding still verifies. The final run checks the exact application's refusal,
  so an unrelated Docker failure cannot count as a passing rejection.
- Container inspection confirms memory-only mounts, automatic removal, no Docker
  log store or restart policy, bounded memory with no additional container swap,
  read-only application filesystems, no backend/database host ports, and
  frontend-only ingress with the actual loopback listener published.
- The database's own deadline removes its container/storage without a running
  supervisor main loop. Content and readiness return 503; liveness remains 200.
- Explicit replay of pre-expiry cookies cannot authenticate in the new generation.
  Old private drafts, public recipes, handles, and ingredient requests are absent.
  Counts across the checked account/session/content/interaction/moderation/request
  tables return to the clean baseline. The seed fingerprint compares published
  version identities, not full document bytes; rendered seed browsing also passes.
- Fresh generated-member entry succeeds after replacement. Exact-owner cleanup
  leaves no containers or networks belonging to either generation.

A separate 90-second smoke also passed host-listener startup and independent
database self-removal. Deliberate fault injection against real containers tested
an interrupt after backend readiness but before frontend startup: the supervisor
removed its resources without opening the listener. Another run reached its
normal deadline, removed the real frontend, then injected a cleanup failure. The
supervisor returned failure, kept access closed, and did not start another
generation. The remaining owned resources were explicitly cleaned and absence
verified. These are real-resource fault-injection checks, not an operating-system
hard-kill test or evidence about an eventual hosting scheduler.

The repeatable command is documented in the [runbook](../portfolio-sandbox.md).
It introduces no public reset API, draft/publication deletion shortcut, or new
transaction owner. Temporary test certificates, containers, networks, and
synthetic visitor data are discarded; that synthetic data has no recovery copy.
The existing development app/database are not reset.

Final follow-up checks passed: all 156 repository tooling tests and 75 subtests,
Python tooling lint/format, repository policy, backend/frontend architecture,
frontend reachability, documentation links, seed validation, OpenAPI/generated
API contracts, CSS architecture, and whitespace checks. The final sandbox label
inventory is empty; development frontend/backend probes on 3000/8000 return 200.

The final local pinned CI-equivalent and browser results are recorded in the
[verification follow-up](2026-09-17-portfolio-sandbox-verification.md). A GitHub
Actions run remains distinct from those local checks. Before public routing,
complete #21's platform-specific
retention, logging/cache/snapshot, TLS and monitoring evidence. Local memory-only
container configuration does not attest to host/VM swap or snapshots. Keep #279
open until its outstanding evidence is available.
