# Release, recovery, and rollback rehearsal

RCP-33G is the last automated release rehearsal before Recipe Lab is connected
to deployment infrastructure. It does not deploy the application, push an
image, contact the hosted identity provider, or receive public traffic. It
proves, on an isolated runner, that one exact source revision and its exact
local images can pass the release, recovery, and compatible rollback paths.

The separate GitHub check is named `RCP-33G automated rehearsal`. It runs when
the rehearsal boundary changes and can be started manually for a chosen release
candidate. It does not replace or expand the stable RCP-32 community gate.
RCP-33G is complete only when both checks pass and the private credential review
described below has also been completed by the owner.

## What the rehearsal binds

The job starts from the exact GitHub event commit. It creates the reviewed safe
source archive, records its SHA-256, and builds the candidate backend and
frontend production images once. Docker's immutable `sha256:` image IDs are
recorded before any release phase runs and are rechecked after verification.

The representative ancestor is selected without silently following a branch:

- for a pull request, it is the event's exact base SHA; and
- for a push to `main`, it is the event's exact `before` SHA; and
- for a manual rehearsal, the operator supplies a reviewed ancestor ref that is
  resolved once to an exact SHA.

The selected SHA must be a real ancestor of the candidate. Before a deployment
exists, it is a representative compatibility target—not a claim about a
previous deployment. Its backend and frontend application source is built in a
detached temporary worktree with the candidate's reviewed, hardened production
image recipes. This isolates the compatibility question—whether the prior
application can run against the newer schema—from known-vulnerable historical
base-image packages. The builds are verified with the current production-image
verifier, and their local immutable image IDs are recorded alongside the
resolved application SHA. Neither image set is pushed or uploaded, so RCP-21
must later scan and bind both the candidate and an actual prior deployment by
registry manifest digest before allowing production rollback.

## Fixed fail-closed sequence

The isolated rehearsal job runs these phases in order:

1. **Source and dependency scan.** The safe archive is scanned for secrets and
   HIGH or CRITICAL vulnerabilities. The backend's locked runtime requirements
   are exported with the pinned `uv` resolver because Trivy cannot interpret
   this repository's multi-package workspace lock directly. The committed npm
   lock is scanned in the same private source tree.
2. **Image scan.** Candidate and rollback backend and frontend image IDs are
   each scanned for secrets and HIGH or CRITICAL vulnerabilities.
3. **Migration rehearsal.** A new empty database is upgraded from base to
   current head. A second database is migrated to a reviewed prior revision,
   seeded, upgraded to head, and checked for preserved catalog
   counts. A third database deliberately creates the same column that the next
   migration needs; the upgrade must fail without advancing the Alembic
   revision or changing seeded state. After the conflict is removed, the same
   database must upgrade cleanly.
4. **Community journey and older backup.** The production-build RCP-32 journey
   pauses immediately before the member deletion. CI takes the backup while
   that member is still active, then allows the deletion to complete and
   verifies the live final state.
5. **Deletion-ledger recovery.** The live database exclusively exports a
   private, canonical deletion ledger. CI independently hashes it and records
   an independent database time that the ledger must cover. The older backup is
   restored into a database that remains isolated from both applications and
   is migrated to the candidate head before any replay attempt.
   Missing, malformed, unreadable, and stale ledgers must all be rejected before
   a valid replay is accepted. Only after replay does the restored database
   have to match the live, privacy-safe RCP-32 summary.
6. **Candidate smoke.** Traffic remains closed until migration, replay, and the
   restored-state verifier pass. The exact candidate images are then started
   against the restored database and must pass backend liveness and readiness,
   frontend liveness, and one known-public-recipe read through both the API and
   rendered frontend route.
7. **Compatible application rollback.** The current restored-database revision
   is recorded, the candidate is stopped, and images containing the reviewed
   ancestor application source plus the candidate's hardened image recipes are
   started against that unchanged newer schema. The same smoke checks must pass
   and the database revision must remain byte-for-byte unchanged. The ancestor
   may package an older migration head; compatibility is proved by running it,
   not by requiring identical packaged migration histories. The rehearsal never
   downgrades a production-shaped database. RCP-21 separately verifies the exact
   registry artifact that would be used for a real rollback.
8. **Evidence compilation.** Only after every prior phase passes does the
   reviewed compiler produce one bounded, canonical report.

Every command is fail-fast. The ordinary CI workflow continues to own the
stable RCP-32 community gate, application, accessibility, safe-source, and
baseline checks; they remain independent evidence reviewed alongside this
release-candidate rehearsal.

## Durable deletion evidence

`python -m app.recovery export --output <private-path>` takes the exclusive
account-lifecycle lock, verifies every current deleted-member tombstone, and
writes a bounded canonical version-1 ledger with mode `0600`. Its console
result contains only the coverage time, count, hash, and version.

`python -m app.recovery replay` requires all of these controls:

- the private ledger path;
- an expected lowercase SHA-256 calculated separately from the exporter; and
- a required `covered_through` UTC time obtained independently from the source
  database;
- the exact name of the isolated restored database, which is verified against
  PostgreSQL before mutation; and
- an explicit isolated-restore confirmation flag.

The complete file is parsed and validated before a replay transaction opens.
Missing, group/world-readable, unreadable, oversized, malformed,
non-canonical, duplicated, stale, or hash-mismatched evidence fails generically.
A valid replay locks affected
accounts in stable order, removes private state for a restored active or
suspended member, verifies an already-deleted tombstone, and safely ignores an
account absent from the older backup. The transaction is atomic and its result
exposes only counts. A restored database must never receive health checks or
traffic before this replay and the community-state verifier both succeed.

The ledger is operational recovery material, not a CI artifact. A real
deployment must store it outside the database backup boundary in encrypted,
access-controlled durable storage, bind its integrity independently, and retain
it for at least as long as any backup that might predate those deletions. RCP-21
must add an atomic durable refresh handoff after deletion or block every restore
until independently verified evidence covers the latest completed deletion.

## Security scan and evidence boundary

CI installs the reviewed Trivy version through an action pinned to an exact
commit. The scanner database is downloaded into runner-temporary storage and
its local database bytes are SHA-256-bound in the final evidence. A scan error,
an unreadable result, a secret finding, or one HIGH/CRITICAL vulnerability
blocks the rehearsal.

Raw source, requirements, scanner JSON, image metadata, database dumps,
deletion ledgers, UUID manifests, browser output, service logs, marker files,
and temporary worktrees stay only in restricted temporary storage on the
disposable runner. They are removed in an unconditional cleanup step, including
after failure. The workflow never uploads a whole temporary directory. A
general failure retains only a fixed phase name and `failed` status. An image
scan failure additionally retains the fixed image role, failure class, scanner
version and database hash, aggregate High/Critical and secret counts, and at
most 20 sanitized vulnerability IDs, package names, severities, and fix-available
flags. It never retains secret matches, paths, titles, raw reports, or image
contents.

The retained outputs are the canonical release evidence, the two established
identifier-free RCP-32 live/restored summaries, and one privacy-scan summary
covering all three. The release evidence contains:

- candidate commit, rollback commit, and safe-source archive SHA-256;
- candidate and rollback backend/frontend immutable image IDs;
- pinned scanner version and scanner-database SHA-256;
- start and end migration revisions; and
- fixed pass states for source, all images, migration, the authoritative
  community journey, candidate smoke, recovery, and rollback.

It contains no database URL, user or recipe identifier, email, OIDC value,
session material, report text, free-form error, file path, image tag, raw scan,
ledger entry, dump, or service log. The existing RCP-32 artifact scanner checks
the retained files before upload.

## Private credential-review prerequisite

The repository can prove that committed source, images, logs, and retained CI
evidence do not contain credentials. It cannot prove what live credentials
exist in AWS, Cognito, DNS, a registry, GitHub environments, or an operator's
password manager, and CI must not ask for or upload that inventory.

Before RCP-33G or its epic is marked complete, the repository owner must
privately:

1. inventory every credential that could reach the deployment;
2. remove unused credentials and rotate any value that may have been exposed;
3. confirm least-privilege ownership and a recovery contact;
4. place runtime values only in the eventual deployment secret store; and
5. record a private completion date and next review date without copying secret
   values into GitHub issues, pull requests, Actions logs, or artifacts.

This is an explicit owner confirmation, not an automated checkbox. A passing
GitHub check does not substitute for it. If confirmation is unknown, deployment
remains blocked.

## Failure and handoff

A failed rehearsal does not authorize a manual bypass. Keep traffic on the
last known-good revision, use the fixed failing phase shown by GitHub, inspect
only private runner diagnostics during their run, and fix the underlying
source, image, migration, recovery, or compatibility problem in a new review.
Do not preserve a raw dump or ledger to debug a public CI failure.

After both the stable check and the private credential review pass, RCP-21 may
bind the already-reviewed process to AWS/Cognito, a registry digest, managed
database backups, secret storage, probes, and traffic controls. That later work
must repeat the smoke and rollback decisions against the real platform; this
rehearsal does not claim that a cloud deployment exists.
