# Community release gate

RCP-32 is the deployment handoff for Recipe Lab's account-backed community
workflow. It does not add another product feature. It proves that the features
from RCP-23 through RCP-31 work together through the production frontend,
FastAPI, and a freshly migrated PostgreSQL database.

The stable GitHub check is named `RCP-32 community release gate`. It succeeds
only when backend quality, frontend quality, the broad MVP browser regression,
and the dedicated RCP-32 journey all succeed. Offline recommendation and
substitution evaluation remains an independent engineering signal and is not a
deployment prerequisite.

## Canonical journey

The dedicated job creates four accounts through a guarded local OpenID Connect
provider:

- Alice and Bob are ordinary members.
- The catalog curator receives and later loses only the curator grant.
- The community moderator receives and later loses only the moderator grant.

The browser journey then proves the following sequence against one disposable
database:

1. Alice starts a private original draft, requests a missing ingredient, and
   retains the rest of her draft while that request is unresolved.
2. An ordinary member cannot open the curator workspace. The operator command
   grants the curator role, the curator approves the request, and Alice can use
   the newly canonical ingredient with curated units and cooking actions.
3. Alice resumes and publishes an immutable root after a distinct structural
   review that needs no override decision.
4. Bob cannot see Alice's private state, but can discover, save, rate, and fork
   the root. He records an explicit continue for one exact unchanged sibling,
   then edits and publishes the probable-match child used by the release
   manifest. Public attribution, direct-parent provenance, and the structured
   diff remain exact.
5. Alice cannot mutate Bob's draft or publication. Signed-out, cross-account,
   stale-session, CSRF, direct-identifier, and role-boundary requests fail
   without mutation.
6. Bob reports content; only the separately granted moderator can review the
   de-identified case and hide or restore the parent. The published child stays
   available when its parent is unavailable.
7. Alice's author withdrawal remains independent of moderation. Bob's account
   deletion erases private account data while retaining the public child under
   the `Deleted cook` tombstone.

The journey includes real exact, probable, and unchanged structural checks.
Exact or probable advice never blocks publication, but an explicit continue
decision must be durably bound to the resulting immutable version.

## Identity and role safety

`app.testing.local_oidc_provider` exists only for this acceptance run. It:

- refuses startup without `RCP32_ACCEPTANCE=1` and
  `ACCEPTANCE_DATABASE_ISOLATED=1`;
- accepts only loopback HTTP issuer, redirect, and bind addresses;
- generates an ephemeral RS256 key in memory;
- supports only Authorization Code with PKCE S256 and exact client/redirect
  matching;
- keeps authorization requests and short-lived, single-use codes in memory;
- disables HTTP access logs.

The provider is never mounted in the product API and has no production mode.
The browser creates all four accounts through the real Recipe Lab OIDC callback
and onboarding flow. Role grants and revocation use the existing bounded
operator commands, never direct fixture inserts. Curator and moderator grants
remain independent, and revocation takes effect on the next authorization
check.

## Evidence and privacy

The browser writes a mode-`0600` manifest containing only the UUIDs needed by a
read-only database verifier. The verifier accepts an exact, versioned manifest
shape and only the four allowlisted disposable database names. Its output is a
deterministic JSON list of check names and aggregate counts; it contains no user
IDs, handles, emails, recipe IDs, report text, OIDC subjects, or credentials.

Before account creation, a guarded command stages one deterministic legacy Demo
Cook save, rating, and view on a seeded recipe. The final verifier requires all
three rows to remain on the non-login Demo Cook and requires that none moved to
Alice, Bob, the curator, or the moderator. This makes the legacy-attribution
check real instead of passing vacuously on an empty history.

CI performs a real custom-format `pg_dump`, restores it into a separately
allowlisted empty database, and runs the same verifier again. The dump is
deleted and is never uploaded. A final scanner rejects the synthetic private
canaries, cookie names with values, CSRF or authorization headers, and OIDC
callback code/state markers in retained logs and summaries. Traces,
screenshots, videos, browser reports, server access logs, the UUID manifest,
and the database dump are not retained. Only the two privacy-safe verifier
summaries and scanner summary may be uploaded after success.

Migration upgrade, one-revision downgrade, re-upgrade, drift checking, backup,
restore, and the end-state verifier run in the dedicated job. The prerequisite
backend and frontend jobs remain the authoritative evidence for bounded-body
handling, rate limits, idempotency, concurrency, transaction rollback, unit
tests, linting, typing, and the production build.

## Guarded local reproduction

Use a new PostgreSQL database named exactly
`recipe_lab_rcp32_acceptance_local`; do not point this run at a development or
shared database. Use dedicated loopback ports, for example provider `8200`, API
`8201`, and frontend `3200`, and set the following in all three process shells:

```powershell
$env:RCP32_ACCEPTANCE = "1"
$env:ACCEPTANCE_DATABASE_ISOLATED = "1"
$env:APP_ENVIRONMENT = "local"
$env:DATABASE_URL = "postgresql+psycopg://recipe_lab:recipe_lab@127.0.0.1:5432/recipe_lab_rcp32_acceptance_local"
$env:CORS_ORIGINS = "http://127.0.0.1:3200"
$env:AUTH_ALLOWED_ORIGINS = "http://127.0.0.1:3200"
$env:RECIPE_API_URL = "http://127.0.0.1:8201"
$env:NEXT_PUBLIC_API_URL = "http://127.0.0.1:8201"
$env:PLAYWRIGHT_BASE_URL = "http://127.0.0.1:3200"
$env:PLAYWRIGHT_WEB_SERVER_COMMAND = "npm run start -- --hostname 127.0.0.1 --port 3200"
$env:OIDC_ISSUER = "http://127.0.0.1:8200"
$env:OIDC_CLIENT_ID = "recipe-lab-rcp32"
$env:OIDC_REDIRECT_URI = "http://127.0.0.1:3200/api/auth/callback"
$env:OIDC_SCOPES = "openid email profile"
$env:OIDC_ALLOWED_SIGNING_ALGORITHMS = "RS256"
$env:INTERNAL_NETWORK_SIGNAL_SECRET = "recipe-lab-local-internal-network-signal-secret"
$env:RCP32_MANIFEST_PATH = Join-Path ([System.IO.Path]::GetTempPath()) "recipe-lab-rcp32-manifest.json"
$env:RCP32_PROVIDER_LOG = Join-Path ([System.IO.Path]::GetTempPath()) "recipe-lab-rcp32-provider.log"
$env:RCP32_BACKEND_LOG = Join-Path ([System.IO.Path]::GetTempPath()) "recipe-lab-rcp32-backend.log"
$env:RCP32_BROWSER_LOG = Join-Path ([System.IO.Path]::GetTempPath()) "recipe-lab-rcp32-browser.log"
```

Rehearse the migration history and stage the deterministic legacy activity
before any account is created:

```powershell
cd backend
python -m alembic upgrade head
python -m alembic downgrade -1
python -m alembic upgrade head
python -m alembic check
python -m app.seeds load
python -m app.testing.community_release_gate stage-demo-activity
```

Build the production frontend, start the provider with
`python -m app.testing.local_oidc_provider --port 8200`, and start FastAPI on
port `8201` with `--no-access-log`. Redirect provider, backend, and browser
output to private temporary log files. From `frontend`, run
`npm run test:e2e:release-gate`; it starts the configured production frontend
and writes the exclusive UUID manifest.

Then verify both the live database and a real restored copy. These commands
require the PostgreSQL 17 client tools:

```powershell
cd backend
$rcp32Temp = [System.IO.Path]::GetTempPath()
$liveSummary = Join-Path $rcp32Temp "recipe-lab-rcp32-live.json"
$restoredSummary = Join-Path $rcp32Temp "recipe-lab-rcp32-restored.json"
$privacySummary = Join-Path $rcp32Temp "recipe-lab-rcp32-privacy.json"
$backup = Join-Path $rcp32Temp "recipe-lab-rcp32.dump"

python -m app.testing.community_release_gate verify --manifest $env:RCP32_MANIFEST_PATH > $liveSummary

$env:PGPASSWORD = "recipe_lab"
pg_dump --host 127.0.0.1 --port 5432 --username recipe_lab `
  --dbname recipe_lab_rcp32_acceptance_local --format custom `
  --no-owner --no-privileges --file $backup
dropdb --host 127.0.0.1 --port 5432 --username recipe_lab --if-exists `
  recipe_lab_rcp32_acceptance_local_restore
createdb --host 127.0.0.1 --port 5432 --username recipe_lab `
  recipe_lab_rcp32_acceptance_local_restore
pg_restore --host 127.0.0.1 --port 5432 --username recipe_lab `
  --dbname recipe_lab_rcp32_acceptance_local_restore --exit-on-error `
  --no-owner --no-privileges $backup

$primaryDatabaseUrl = $env:DATABASE_URL
$env:DATABASE_URL = "postgresql+psycopg://recipe_lab:recipe_lab@127.0.0.1:5432/recipe_lab_rcp32_acceptance_local_restore"
python -m alembic check
python -m app.testing.community_release_gate verify --manifest $env:RCP32_MANIFEST_PATH > $restoredSummary
$env:DATABASE_URL = $primaryDatabaseUrl

if ((Get-FileHash $liveSummary).Hash -ne (Get-FileHash $restoredSummary).Hash) {
  throw "The restored RCP-32 evidence differs from the live evidence."
}

python -m app.testing.community_release_gate scan-artifacts `
  $env:RCP32_MANIFEST_PATH $liveSummary $restoredSummary `
  $env:RCP32_PROVIDER_LOG $env:RCP32_BACKEND_LOG $env:RCP32_BROWSER_LOG `
  > $privacySummary
```

The three `RCP32_*_LOG` values above are the private temporary paths used when
starting the processes. Stop those processes, delete the manifest, logs,
summaries, and dump, and drop both exact disposable databases after the run.
Never scan or retain the database dump: it intentionally contains the private
database. The guard flags and allowlisted name checks confirm that the caller
already created an isolated target; they do not create or clean one.

RCP-21 deployment work may start only after the stable aggregate check passes.
The gate does not deploy Recipe Lab, contact a live identity provider, perform
automated moderation, or make product-quality claims about offline models.
