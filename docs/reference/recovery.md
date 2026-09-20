# Recovery and rollback

Recovery never weakens Recipe Lab's account-deletion, immutable-public-recipe,
stable-edition, visibility, moderation, idempotency, or audit boundaries. A
backup is not safe merely because PostgreSQL can restore it, and an older
application is not safe merely because it starts against the current schema.

This runbook covers the persistent deployment profile. The disposable portfolio
sandbox has no backups and recovers only by creating a clean generation; see
[Operations](../operations.md#portfolio-sandbox).

## Core rules

- Keep restored databases isolated from applications, probes, jobs, and user
  traffic until migration, deletion replay, integrity checks, and smoke tests
  all pass.
- Apply migrations forward. Application rollback keeps the newer schema in
  place; never use an automatic Alembic downgrade against production.
- Replay externally retained account-deletion evidence before a backup that can
  predate those deletions is exposed.
- Treat immutable recipe versions and append-only edition/audit topology as
  evidence. Do not repair them with direct `UPDATE` or `DELETE` statements.
- Bind source revisions and images by exact commit SHA, archive hash, and image
  digest/ID. Tags and branch names are not release evidence.
- Retain only bounded, identifier-free reports. Dumps, ledgers, logs, browser
  artifacts, and scanner output stay private and temporary.

Security and data-retention authority is described in
[Security](../security.md#account-data-governance). Probe, image, and signal
behavior is described in [Operations](../operations.md).

## Automated release rehearsal

The `Release rehearsal` workflow exposes the check
`RCP-33G automated rehearsal`. It runs on an isolated runner and does not deploy,
push an image, contact a hosted identity provider, or receive public traffic.
It proves that one exact candidate and one reviewed representative ancestor can
complete the release, restore, and compatible application-rollback paths.

The candidate is the exact event commit. The representative ancestor is the
exact pull-request base SHA, the previous `main` push SHA, or a manually supplied
reviewed ref resolved once to an ancestor commit. The workflow builds candidate
images once and records their immutable local IDs. For rollback testing it
combines the ancestor's application source with the candidate's reviewed
hardened image recipes; this isolates application/schema compatibility from
known-vulnerable historical base layers. A real deployment must repeat the
decision using the actual last-known-good registry manifest digests.

The rehearsal runs a fixed fail-closed sequence:

1. Create and hash the safe-source archive; scan locked Python/npm dependencies
   and reviewed committed source for secrets and HIGH/CRITICAL vulnerabilities.
2. Scan each candidate and rollback backend/frontend image ID for secrets and
   HIGH/CRITICAL vulnerabilities.
3. Upgrade an empty database to head; separately upgrade a seeded reviewed
   prior revision; prove a deliberate migration conflict fails without
   advancing revision or mutating seeded state, then succeeds after removal.
4. Run the production-build community journey and take an older backup while
   the synthetic deletion account is still active; complete deletion and verify
   the live final state.
5. Exclusively export and independently hash the deletion ledger. Restore the
   older backup in isolation, migrate it to head, require missing/malformed/
   unreadable/stale ledgers to fail, replay the valid ledger, and compare the
   privacy-safe restored summary with live state.
6. Start the exact candidate images only after recovery verification. Require
   backend liveness/readiness, frontend liveness, and a known public recipe
   through both API and rendered frontend.
7. Stop the candidate and start the reviewed ancestor application images against
   the unchanged newer schema. Repeat smoke checks and require the database
   revision to remain byte-for-byte unchanged.
8. Produce one bounded canonical evidence report only after every phase passes.

The stable `Repository quality` full tier and private credential review remain
independent prerequisites. A successful rehearsal is not deployment approval.

## Deletion-ledger evidence

An ordinary live account deletion changes current state, but an older backup can
still contain the deleted account. The canonical ledger is the external bridge
that prevents restore from resurrecting it.

From the backend environment, export current deletion evidence to restricted
storage outside the database backup boundary:

```powershell
cd backend
python -m app.recovery export --output <PRIVATE_LEDGER_PATH>
```

The exporter takes the exclusive account-lifecycle lock, verifies current
tombstones, writes canonical version-1 evidence with private permissions, and
prints only coverage time, count, hash, and version. Independently preserve the
lowercase SHA-256 and a database time that the ledger must cover. Keep the
ledger encrypted, access-controlled, and durable for at least as long as any
backup that might predate its deletions.

After restoring and migrating an isolated database, replay with every guard:

```powershell
python -m app.recovery replay `
  --ledger <PRIVATE_LEDGER_PATH> `
  --expected-sha256 <LOWERCASE_SHA256> `
  --required-covered-through <UTC_TIMESTAMP> `
  --expected-database-name <ISOLATED_DATABASE_NAME> `
  --confirm-isolated-restore
```

The complete file is parsed before the replay transaction opens. Missing,
unreadable, group/world-readable, oversized, malformed, non-canonical,
duplicated, stale, or hash-mismatched evidence fails generically. The database
name is checked inside PostgreSQL. Valid replay locks accounts in stable order,
removes private state from restored active/suspended members, verifies existing
tombstones, safely ignores accounts absent from the old backup, and commits
atomically. Output contains only aggregate counts.

Do not send health checks or traffic to the restored database before replay and
the independent state verifier succeed. If ledger coverage is unavailable or
stale, recovery fails closed.

## Restore order

The checked-in identifier-free community verifier is bound to the automated
rehearsal's fixed synthetic manifest and guarded acceptance environment; it is
not a verifier for an arbitrary production restore. A persistent deployment
must provide and review an equivalent deployment-specific restored-state
verifier before this procedure can be used.

For a persistent deployment, use this order:

1. Restore the selected encrypted backup into a newly named, network-isolated
   database with no application credentials or traffic.
2. Record the backup identity and expected source/deployment revision in
   restricted incident evidence.
3. Apply the current migration head.
4. Replay every completed account deletion that can be newer than the backup.
5. Verify tombstones and absence of sessions, provider mappings, roles, private
   drafts, interactions, private report text, moderator notes, and unbound
   workflow evidence.
6. Run the account-data metadata gate and the reviewed deployment-specific
   identifier-free restored-state verifier. The synthetic community verifier
   runs only as part of the automated rehearsal.
7. Run the stable-recipe integrity checks below.
8. Start exact candidate images without external traffic and pass liveness,
   readiness, correlation/redaction, and known-public-recipe smoke checks.
9. Admit traffic only after all prior steps pass. Destroy superseded databases,
   dumps, ledgers copied for the operation, logs, and temporary artifacts under
   their retention rules.

A failed or superseded restore remains isolated and must be destroyed. Speed of
recovery is never authority to expose pre-deletion private data.

## Stable recipe integrity checks

PostgreSQL constraints normally make invalid edition topology uncommittable.
Run these read-only checks after migration or restore and before admitting
traffic. Both must return zero rows.

```sql
WITH current_integrity AS (
    SELECT
        recipe.id AS recipe_id,
        recipe.current_recipe_version_id,
        current_edition.recipe_version_id AS mapped_current_version_id,
        current_edition.edition_number AS current_edition_number,
        max(all_editions.edition_number) AS latest_edition_number
    FROM recipes AS recipe
    LEFT JOIN recipe_editions AS current_edition
        ON current_edition.recipe_id = recipe.id
        AND current_edition.recipe_version_id = recipe.current_recipe_version_id
    LEFT JOIN recipe_editions AS all_editions
        ON all_editions.recipe_id = recipe.id
    GROUP BY
        recipe.id,
        recipe.current_recipe_version_id,
        current_edition.recipe_version_id,
        current_edition.edition_number
)
SELECT *
FROM current_integrity
WHERE mapped_current_version_id IS NULL
    OR current_edition_number IS DISTINCT FROM latest_edition_number
ORDER BY recipe_id;
```

```sql
SELECT publication.recipe_version_id
FROM recipe_version_publications AS publication
LEFT JOIN recipe_editions AS edition
    ON edition.recipe_version_id = publication.recipe_version_id
WHERE edition.recipe_version_id IS NULL
ORDER BY publication.recipe_version_id;
```

The first query detects missing, cross-recipe, lagging, or ambiguous current
selection. A null `recipes.owner_user_id` after account deletion is valid. The
second detects a published immutable snapshot without stable-recipe membership.

Routine monitoring may export only each aggregate row count. Never put returned
recipe/version IDs in logs, metrics, alerts, or CI artifacts. A nonzero count is
impossible state: remove affected instances from traffic, stop publication
writers, preserve database/deployment revisions privately, and investigate in a
restricted session. Do not disable triggers or mutate the rows in place. A
separately reviewed migration may reconstruct topology only after the invariant
failure is understood.

Expected outcomes are not corruption: one concurrent revision publication may
lose with `recipe_revision_source_stale`; an unavailable exact version uses the
same neutral response whether unknown or hidden; and a hidden current edition
does not fall back to an older readable edition.

## Application rollback compatibility

Application rollback leaves the upgraded database unchanged. A candidate
rollback image must do more than boot. Against an isolated current-schema copy
containing at least one revision and one adaptation, prove that it:

- atomically writes the stable recipe, first edition, current pointer, and
  publication receipt for original/adaptation publication;
- preserves explicit original/adaptation/revision draft kind and exact source in
  idempotency fingerprints;
- appends revision editions and advances current atomically without rewriting
  cross-recipe lineage;
- reads only the explicit current edition and never falls back when hidden; and
- retains backend-owned visibility, moderation, deletion, idempotency, and audit
  policy.

Repeat stable-current, hidden-current, original publication, adaptation,
revision, and neutral-unavailability smoke checks. If the older application
cannot preserve those rules, it is not a rollback target even when health probes
pass. Keep the candidate closed to traffic and choose a compatible image or use
the verified restore path.

## Migration downgrade policy

Downgrade is a disposable rehearsal path, not a production recovery mechanism.
Some migrations intentionally refuse lossy downgrade—for example, when revision
draft intent or multi-edition topology cannot be represented by the older
schema. Do not delete drafts, editions, versions, or audit evidence to force a
downgrade.

A reviewed pre-lossy downgrade/re-upgrade test may run against disposable data
and must preserve every legacy row and reproduce deterministic mappings. Once a
fail-closed guard applies, keep the newer schema or restore a verified older
backup in isolation and upgrade it forward.

## Smoke and traffic admission

Before shifting traffic to a candidate:

1. Complete migrations as a separate successful step.
2. Require backend `/api/health` and a fresh valid correlation ID.
3. Require backend `/api/readiness` and a different fresh correlation ID.
4. Require frontend `/healthz`.
5. Exercise one safe synthetic error and prove response header/body correlation
   IDs match while the structured event contains only allowlisted fields.
6. Read one known public recipe through the backend and rendered frontend.
7. Confirm authentication, publication, database, dependency, application, and
   latency panels receive only reviewed low-cardinality data.

Do not stop a shared production database to test readiness failure; the image
verifier owns that isolated proof. If readiness, redaction, integrity, or signal
checks fail, route no traffic to the candidate. Keep the last known-good revision
serving only if it is schema-compatible.

## Evidence and failure handling

Successful rehearsal evidence may contain only candidate/rollback commits,
safe-source archive hash, immutable image IDs, scanner version/database hash,
migration revisions, and fixed phase results, plus identifier-free live/restored
summaries. It must not contain database URLs, account/recipe IDs, emails,
provider or session material, private text, file paths, image tags, raw scans,
ledger entries, dumps, or logs.

A scan or rehearsal failure does not authorize bypass. Keep traffic on the last
known-good compatible revision, use the fixed failing phase to investigate
within private temporary storage, and fix the underlying source, image,
migration, deletion replay, or compatibility problem in a new review. Never
preserve raw dumps or ledgers as public CI diagnostics.

Before any real deployment, the owner must privately inventory deployment
credentials, remove unused access, rotate anything possibly exposed, verify
least privilege and recovery ownership, store runtime values only in the secret
store, and record private review dates without copying values into GitHub,
logs, or artifacts.
