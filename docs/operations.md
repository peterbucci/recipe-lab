# Operations

This guide covers the runtime and operator-facing parts of Recipe Lab: production images, health and readiness, observability, the public portfolio sandbox, source packaging, and the release boundary.

Local setup belongs in [Development](development.md). Security and privacy rules are defined in [Security](security.md). Detailed backup, restore, rollback, and account-deletion recovery procedures belong in [Recovery](reference/recovery.md).

## Runtime profiles

Recipe Lab has three separate runtime profiles:

| Profile           | Purpose                                     | Storage                                                                 |
| ----------------- | ------------------------------------------- | ----------------------------------------------------------------------- |
| Local development | Persistent developer workflow               | Docker Compose or host processes with a normal PostgreSQL volume        |
| Production        | Hardened deployable frontend/backend images | Platform-owned database, secrets, and runtime infrastructure            |
| Portfolio sandbox | Temporary public demonstration              | Fresh generation-bound PostgreSQL on tmpfs with no durable user storage |

These profiles should not share cleanup procedures, credentials, or recovery assumptions.

`compose.yaml` is for local development. It is not a production deployment manifest.

## Production images

The backend and frontend Dockerfiles both have explicit production targets.

Build them from the repository root:

```powershell
docker build --pull --no-cache --target production `
  --file backend/Dockerfile `
  --tag recipe-lab-backend:local .

docker build --pull --no-cache --target production `
  --file frontend/Dockerfile `
  --tag recipe-lab-frontend:local frontend
```

The backend build uses the repository root because it depends on the shared Python workspace. The frontend uses `frontend/` as its build context.

Production images are expected to:

- run as non-root users;
- contain only production dependencies;
- omit tests, browser tooling, development dependencies, caches, coverage, and local environment files;
- exclude package managers and build tooling from the runtime stage where practical; and
- receive secrets from the runtime environment rather than Docker build arguments or committed configuration.

Verify the production boundary with:

```powershell
python scripts/verify_production_images.py `
  --backend-image recipe-lab-backend:local `
  --frontend-image recipe-lab-frontend:local `
  --backend-context . `
  --backend-dockerfile backend/Dockerfile `
  --frontend-context frontend `
  --frontend-dockerfile frontend/Dockerfile
```

The verifier builds clean production targets, inspects their runtime contents and users, starts an isolated PostgreSQL database, applies migrations, and exercises the runtime probes.

It also checks an important failure case: when PostgreSQL becomes unavailable, the backend process should remain live while readiness fails.

The verifier does not push or deploy images.

## Runtime configuration

Production configuration is injected by the deployment environment.

The backend requires validated settings for areas such as:

- PostgreSQL;
- trusted frontend/backend origins;
- OIDC;
- abuse protection;
- internal network signaling;
- request limits; and
- database operation timeouts.

The frontend requires its backend origin and the shared internal network-signal secret.

Invalid production configuration should fail startup rather than silently falling back to development defaults.

The full setting reference is documented in [Configuration](reference/configuration.md).

## Health and readiness

Recipe Lab exposes separate liveness and readiness checks.

| Probe                        | Meaning                                                                | Operator response when it fails                                               |
| ---------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Backend `GET /api/health`    | The API process can answer without querying PostgreSQL                 | Restart or replace the process                                                |
| Backend `GET /api/readiness` | The backend can complete its bounded PostgreSQL check                  | Remove the instance from traffic and investigate the database/dependency path |
| Frontend `GET /healthz`      | The frontend process is running and answering uncached health requests | Restart or replace the process                                                |

The backend probes are internal-only and are not exposed through the public
same-origin `/api/*` proxy. Operators and the frontend's `/readyz` probe reach
them on the private backend origin; public traffic receives `404` for the
exact `/api/health` and `/api/readiness` paths.

Do not use backend liveness as a traffic-admission check. A process can be healthy enough to answer `/api/health` while its database is unavailable.

Database operations are bounded by `DATABASE_OPERATION_TIMEOUT_SECONDS`. The current supported range is 1–30 seconds, with a default of 5 seconds.

## Correlation IDs

Backend responses and safe frontend proxy failures receive a new UUIDv4 `X-Correlation-ID`.

When an error response body includes a correlation ID, it should match the header.

Caller-supplied correlation IDs are discarded. A correlation ID is only a way to match an approved operational event to a request outcome; it does not identify a member, recipe, route, network, or error category and grants no authority.

## Observability

Recipe Lab intentionally keeps production telemetry small.

The detailed privacy and retention rules are defined in [Security](security.md). Operationally, operators work from a fixed set of approved events and low-cardinality aggregate metrics rather than raw request logs.

Approved backend failure events are:

- `authentication_failure`
- `publication_failure`
- `database_failure`
- `application_failure`

Approved frontend proxy events are:

- `recipe_lab.frontend.authentication_failed`
- `recipe_lab.frontend.recipe_api_unavailable`

Do not add fields or new event types as an operational convenience. Changes to the telemetry contract require the same privacy review as other account-linked data changes.

### Initial alert thresholds

The current starting thresholds are:

| Signal                  | Review threshold                                       | First check                                                                |
| ----------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------- |
| Authentication failures | More than 15% over 5 minutes with at least 20 attempts | Compare frontend/backend failure events and identity-provider availability |
| Publication failures    | More than 5% over 5 minutes with at least 10 attempts  | Check database readiness and deployment revision                           |
| Database availability   | Two consecutive unavailable readiness checks           | Page and remove the instance from traffic                                  |
| Application failures    | More than 2% over 5 minutes with at least 50 outcomes  | Inspect the approved failure evidence                                      |
| Latency                 | Reviewed fixed operation/outcome buckets               | Look for a deployment or dependency change                                 |

These are operating thresholds, not service-level objectives. They should be tuned only from de-identified aggregate data.

Before connecting an APM, analytics product, CDN log sink, crash reporter, or similar service, verify that it can enforce Recipe Lab's event, field, and retention restrictions before data leaves the application boundary.

## Portfolio sandbox

The portfolio sandbox is a temporary public demonstration environment, not a long-lived production account system.

It runs previously verified production image IDs inside isolated generations. Each generation receives fresh resources and expires permanently.

Resolve the exact local image IDs after the production-image gate:

```powershell
$backendImage = docker image inspect --format '{{.Id}}' recipe-lab-backend:local
$frontendImage = docker image inspect --format '{{.Id}}' recipe-lab-frontend:local
```

Then start the supervisor:

```powershell
python -m scripts.run_portfolio_sandbox `
  --backend-image $backendImage `
  --frontend-image $frontendImage `
  --origin https://<portfolio-demo-origin> `
  --contact-url mailto:me@peterbucci.com `
  --port 3100
```

The public origin must use HTTPS. The frontend binds to loopback by default. A reviewed host deployment may instead bind it to one explicit private Docker host-gateway IPv4 address and require a narrow trusted-proxy CIDR plus the matching private proxy proof. PostgreSQL and the backend never expose host ports. The EC2 firewall must not expose the frontend's host port publicly.

### Generation lifecycle

Each sandbox generation has:

- an immutable UUID;
- a start time and absolute deadline;
- fresh random secrets;
- generation-owned containers and networks;
- a dedicated internal service network;
- a separate frontend ingress bridge; and
- a new PostgreSQL database stored entirely on size-bounded tmpfs.

The sandbox has no database volume, backup, replica, archive, or dump.

Startup is fail-closed:

1. create empty storage;
2. apply migrations;
3. bind the generation identity/deadline;
4. load demo data;
5. verify the binding;
6. wait for backend readiness;
7. expose the frontend listener.

Cleanup runs in the opposite direction:

1. stop ingress;
2. stop writers;
3. remove the database;
4. remove only resources whose exact names and ownership labels match the generation.

If cleanup fails, the supervisor stops instead of opening another generation.

Never replace this with a broad Docker cleanup command.

`--once` runs a single generation. `--lifetime-seconds` accepts 60–86400 seconds for isolated supervisor use.

Replacing a sandbox means ending the current generation and creating a new one. Do not extend an existing generation's deadline or bind an old database to a new generation.

### Sandbox rehearsal

Exercise expiry and replacement locally with:

```powershell
python -m scripts.rehearse_portfolio_sandbox `
  --backend-image $backendImage `
  --frontend-image $frontendImage
```

The rehearsal creates temporary TLS used only by its own client, exercises two independent visitors and normal product workflows, waits for expiration, and then verifies that a clean second generation cannot recover the previous generation's cookies or content.

Before routing real public traffic, separately verify host/platform behavior such as:

- no swap or snapshot spill for sandbox data;
- no database backups or replication;
- no crash dumps or durable request/body logs;
- no durable browser/session replay artifacts;
- supervised restart;
- traffic closing on failure; and
- correct HTTPS, Origin, cookie, and CSRF behavior through the real proxy.

Container-level rehearsal cannot prove those platform controls.

The exact GHCR publication, EC2 systemd service, Coolify dynamic route, staged certification, rollback, and fail-stop procedures are defined in [Portfolio sandbox deployment](portfolio-sandbox-deployment.md).

Sandbox recovery is always a fresh generation. It does not restore visitor data.

## Source packaging

Use the repository's source exporter when creating a shareable source snapshot.

The working tree must be clean, and the output should be outside the checkout:

```powershell
$revision = git rev-parse --verify 'HEAD^{commit}'
$shortRevision = $revision.Substring(0, 12)
$exportDirectory = Join-Path ([System.IO.Path]::GetTempPath()) `
  ("recipe-lab-source-" + [System.Guid]::NewGuid())

New-Item -ItemType Directory -Path $exportDirectory | Out-Null

$archive = Join-Path $exportDirectory "recipe-lab-source-$shortRevision.zip"
python scripts/package_source.py --ref $revision --output $archive
```

The exporter reads committed Git objects rather than copying the working directory.

It verifies:

- the reviewed path/type/size policy;
- the absence of disallowed environment, credential, cache, build, report, and browser-output files;
- committed text blobs before packaging;
- deterministic ZIP structure;
- the resulting archive contents; and
- per-file and archive hashes recorded in the generated manifest.

The command never overwrites an existing output file.

### Opaque images

Committed PNG files cannot be meaningfully text-scanned. Approved PNGs are therefore tied to exact reviewed Git object IDs.

Audit the current policy with:

```powershell
python scripts/package_source.py --ref HEAD --audit-opaque-policy
```

When an intentional PNG changes, visually review it and update its object ID in the export policy as part of the same review.

Do not allowlist transient actual/diff screenshots, traces, browser diagnostics, or other test artifacts.

A passing source scan does not prove that a credential never existed in Git history. Rotate any credential that may have been exposed.

## Backup, restore, and recovery

Ordinary operators should not improvise restore procedures from a database dump.

Recipe Lab's recovery paths include additional requirements around:

- schema migrations;
- account-deletion evidence;
- privacy verification;
- publication/history integrity;
- restored-data isolation; and
- rollback compatibility.

The exact procedures are documented in [Recovery](reference/recovery.md).

A database restored from a point before an account deletion is not safe to expose merely because the restore itself succeeded. Current migrations and retained deletion evidence must be applied and verified before it can become eligible for use.

The portfolio sandbox is different: it has no restore path and always starts from a clean generation.

## Release boundary

The normal repository commands do **not** deploy Recipe Lab.

The following actions remain outside ordinary quality, image, source, and sandbox commands:

- pushing images to a registry;
- selecting immutable registry manifests for deployment;
- configuring DNS, domains, or TLS;
- configuring the production OIDC tenant;
- injecting production secrets;
- applying production migrations;
- admitting public traffic; and
- approving dependency or base-image changes.

A release should bind reviewed source to immutable image artifacts, apply migrations as a separate controlled step, verify production credentials/configuration, and complete the smoke/restore/rollback checks documented in [Recovery](reference/recovery.md).

## Operator checklist

For a normal production candidate:

1. Confirm the reviewed source revision.
2. Run the normal repository quality gates.
3. Build the production frontend and backend images.
4. Run `verify_production_images.py`.
5. Verify runtime configuration and secret injection.
6. Apply database migrations as a controlled release step.
7. Verify backend liveness and readiness separately.
8. Verify frontend health.
9. Confirm approved telemetry is present without unapproved fields.
10. Complete the required release/recovery checks before admitting traffic.

For the public portfolio sandbox, use the sandbox supervisor and rehearsal instead of the persistent-production backup/restore process.
