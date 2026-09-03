# Repository quality gates

The stable `Repository quality` check remains the aggregate pull-request and
`main` branch boundary. One workflow retains every established check name so
branch-protection rules do not depend on event-specific aliases. It runs two
explicit tiers:

| Event | Tier | Required evidence |
| --- | --- | --- |
| Pull request | Fast | Contracts, lint, types, security, backend PostgreSQL tests, frontend tests/build |
| Push to `main`, nightly schedule, manual dispatch | Full | Every fast check plus evaluation, images, safe source, browser journeys, and deterministic baselines |

Full-only jobs are intentionally skipped on pull requests. The checked-in
`scripts/require_ci_results.py` command accepts those skips only in the fast
tier; failures and cancellations still fail closed. In the full tier, every
listed prerequisite must succeed. This keeps `Repository quality` useful as
the single required aggregate while avoiding repeated image and browser work
on each pull-request update.

| Gate | Evidence owner |
| --- | --- |
| `Contracts` | Python/npm locks, CI pin policy, architecture boundaries, documentation links, workflow lint, OpenAPI, seed catalog, generated TypeScript API contracts |
| `Lint` | Backend and ML Ruff formatting/lint, repository-policy Ruff checks, frontend ESLint |
| `Types` | Strict backend and ML Mypy plus generated Next.js types and TypeScript |
| `Unit` | Backend and frontend package tests; ML evaluation in the full tier |
| `Integration` | PostgreSQL-backed backend tests; deterministic evaluation in the full tier |
| `Build` | Production frontend build; both verified images in the full tier |
| `E2E` | Full-tier MVP/community browser journeys and deterministic visual/accessibility baselines |
| `Security` | Locked runtime dependency vulnerabilities and committed-source vulnerability/secret scans |

Some established jobs produce more than one kind of evidence. The small Unit,
Integration, Build, and E2E jobs expose stable branch-protection names without
rerunning those expensive suites. The underlying failing step remains the
diagnostic source. `RCP-32 community release gate` keeps its established name
and deployable-product scope. A successful fast-tier instance is prerequisite
confidence, not release evidence. Release decisions require the successful
full-tier instance for the same candidate revision; `Repository quality` then
also requires the offline research evidence.

## Immutable automation inputs

External GitHub Actions are pinned to full commit SHAs, language runtimes to
patch releases, runner images to Ubuntu 24.04, and workflow/container bases to
reviewed SHA-256 digests. Checkouts do not persist Git credentials. The local
composite actions under `.github/actions/` centralize the exact Python/uv and
Node.js setup so the versions cannot drift between jobs.

`python scripts/verify_repository_policy.py` is a read-only audit. It reports
mutable workflow references, undocumented Compose inputs, unpinned Docker
bases, time-dependent Alpine upgrades, and missing build-context exclusions.
It never updates a pin or allowlist. Dependency and base-image updates remain
manual review decisions; Dependabot only opens grouped proposals.

Acceptance jobs use `scripts/wait_for_services.py` as their shared readiness
latch. The check observes every health endpoint, fails immediately when a
managed process exits, applies one explicit deadline, and never relies on a
fixed startup sleep or copies service logs into ordinary output.

Run the contract checks locally from PowerShell:

```powershell
python scripts/run_quality_gate.py contracts
docker compose config --quiet
docker run --rm `
  --volume "${PWD}:/repo:ro" `
  --workdir /repo `
  docker.io/rhysd/actionlint:1.7.7@sha256:887a259a5a534f3c4f36cb02dca341673c6089431057242cdc931e9f133147e9 `
  -color
```

The same fail-fast runner owns the stable `lint`, `types`, `backend`, `frontend`,
and `ml` command groups used by CI. Multiple groups can be run in one process,
for example `python scripts/run_quality_gate.py contracts lint types`. It only
orchestrates checked-in package commands; dependency installation and the
external actionlint container remain explicit workflow steps. On Windows the
frontend unit-test command selects Vitest's portable runner loader, while CI
keeps the package's normal invocation.

The repository fixes shell and workflow line endings through `.gitattributes`,
so the Linux-only release helper remains executable after a Windows checkout.
Local developer entry points remain PowerShell, Python, npm, uv, and Docker
Compose; no Bash shell is required for ordinary Windows development.

## Security scans

The reusable `Security rescan` workflow runs inside ordinary CI and on a weekly
schedule. It uses exact Trivy 0.74.0 installed by a SHA-pinned setup action. The
job first creates the reviewed safe-source archive, which applies its own two
secret-scan passes and opaque-object policy. It then exports the frozen backend
and evaluation runtime graphs from `uv.lock`, combines them with the committed
npm lock, and blocks HIGH or CRITICAL dependency findings. A second Trivy pass
scans the reviewed committed-source tree for vulnerabilities and secrets.

Raw source/secret scan JSON, exported requirements, archives, and scanner cache
remain in a permission-restricted runner-temporary directory. Raw secret
findings are never printed or uploaded, and cleanup runs even after failure.
The weekly scan is intentionally time-sensitive: a newly disclosed
vulnerability can fail without a repository change and requires a reviewed
lock/base update, not a bypass. The longer RCP-33G rehearsal still binds its
scanner database and scans exact candidate/rollback image IDs; the ordinary
security gate does not replace that release evidence.

Passing scans cannot prove that no credential ever existed in Git history or
outside the repository. Rotate any possibly exposed value through its private
provider workflow. Do not paste secret findings into issues, pull requests, or
CI logs.

## Release and cleanup

All full-tier checks must pass at the same candidate revision before release.
Do not treat a fast pull-request run, a scheduled security scan, a local run,
or the RCP-33G rehearsal as a substitute. No workflow in this boundary pushes
images, deploys, runs against production, or approves its own dependency update.

Docker Compose keeps `node_modules` and `.next` outside the frontend host bind
mount. To remove all disposable local database/dependency/build volumes after
you no longer need their contents:

```powershell
docker compose down --volumes --remove-orphans
```

That command deletes the local Compose database volume too; export any local
data you intend to keep before running it.
