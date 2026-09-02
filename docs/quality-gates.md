# Repository quality gates

The stable `Repository quality` check is the ordinary pull-request and `main`
branch boundary. It fails closed unless every independently named gate succeeds:

| Gate | Evidence owner |
| --- | --- |
| `Contracts` | Python/npm locks, CI pin policy, workflow lint, OpenAPI, seed catalog, generated TypeScript API contracts |
| `Lint` | Backend and ML Ruff formatting/lint, repository-policy Ruff checks, frontend ESLint |
| `Types` | Strict backend and ML Mypy plus generated Next.js types and TypeScript |
| `Unit` | Backend, frontend, and ML package test jobs |
| `Integration` | PostgreSQL-backed backend tests and deterministic offline-evaluation checks |
| `Build` | Production frontend build and both verified production images |
| `E2E` | MVP browser acceptance, community release journey, and deterministic visual/accessibility baselines |
| `Security` | Locked runtime dependency vulnerabilities and committed-source vulnerability/secret scans |

Some established jobs produce more than one kind of evidence. The small Unit,
Integration, Build, and E2E jobs expose stable branch-protection names without
rerunning those expensive suites. The underlying failing step remains the
diagnostic source. `RCP-32 community release gate` keeps its established name
and deployable-product scope; `Repository quality` additionally requires the
offline research evidence.

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

Run the contract checks locally from PowerShell:

```powershell
python scripts/verify_repository_policy.py
docker compose config --quiet
docker run --rm `
  --volume "${PWD}:/repo:ro" `
  --workdir /repo `
  docker.io/rhysd/actionlint:1.7.7@sha256:887a259a5a534f3c4f36cb02dca341673c6089431057242cdc931e9f133147e9 `
  -color
```

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

All required checks must pass at the same candidate revision. Do not treat a
scheduled scan, a local run, or the RCP-33G rehearsal as a substitute for the
ordinary pull-request aggregate. No workflow in this boundary pushes images,
deploys, runs against production, or approves its own dependency update.

Docker Compose keeps `node_modules` and `.next` outside the frontend host bind
mount. To remove all disposable local database/dependency/build volumes after
you no longer need their contents:

```powershell
docker compose down --volumes --remove-orphans
```

That command deletes the local Compose database volume too; export any local
data you intend to keep before running it.
