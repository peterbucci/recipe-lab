# Recovery and Rollback

This runbook covers recovery for Recipe Lab's persistent deployment profile.

The portfolio sandbox is different: it has no backups and recovers only by creating a clean generation. See [Operations](../operations.md#portfolio-sandbox).

Recovery must preserve the same guarantees as normal operation. Restoring a PostgreSQL backup is only the first step; a restored database is not safe to expose until migrations, account-deletion replay, integrity checks, and smoke tests have all passed.

## Recovery rules

Use these rules for every restore or rollback:

- Keep restored databases isolated from applications, health probes, background jobs, and user traffic until verification is complete.
- Migrate restored databases **forward** to the current schema.
- Roll back application code against the newer schema when it is compatible; do not use automatic Alembic downgrade as a production rollback strategy.
- Replay account-deletion evidence before exposing a backup that can predate those deletions.
- Treat published recipe history and audit evidence as protected data. Do not repair them with ad hoc `UPDATE` or `DELETE` statements.
- Bind releases to exact commit SHAs, source archive hashes, and image IDs/digests rather than branch names or mutable tags.
- Keep dumps, deletion ledgers, raw logs, scanner output, and other recovery artifacts private and temporary.
- Store only bounded, identifier-free summaries as reviewable recovery evidence.

Security and retention policy are defined in [Security](../security.md). Runtime probes, production images, and the portfolio sandbox are documented in [Operations](../operations.md).

---

## Automated release rehearsal

The repository includes a `Release rehearsal` workflow with the stable check:

```text
RCP-33G automated rehearsal
```

It runs in an isolated environment. It does not deploy Recipe Lab, push images, contact a hosted identity provider, or receive public traffic.

The rehearsal verifies that one exact release candidate and one reviewed older application revision can complete the expected release, restore, and compatible application-rollback paths.

The candidate is resolved to the exact event commit.

The rollback revision is resolved once to a reviewed ancestor commit, such as:

- the pull request base SHA;
- the previous `main` push SHA; or
- an explicitly supplied reviewed ancestor.

Candidate images are built once and identified by immutable local image IDs.

For the rollback test, the rehearsal uses the older application source with the candidate's reviewed hardened image recipes. This separates application/schema compatibility from vulnerabilities that may exist in historical base images.

A real deployment must make the equivalent decision using the actual last-known-good registry image digests.

### Rehearsal sequence

The automated rehearsal runs these phases in order:

1. **Verify source**
   - create the safe-source archive;
   - hash it;
   - scan locked Python and npm dependencies;
   - scan reviewed committed source for secrets and HIGH/CRITICAL vulnerabilities.

2. **Verify images**
   - scan candidate frontend/backend image IDs;
   - scan rollback frontend/backend image IDs;
   - reject HIGH/CRITICAL vulnerabilities or secret findings.

3. **Exercise migrations**
   - migrate an empty database to head;
   - migrate a seeded reviewed prior revision to head;
   - introduce a deliberate migration conflict;
   - verify that the conflict fails without advancing the database revision or mutating seeded state;
   - remove the conflict and verify that the migration then succeeds.

4. **Create an older backup**
   - run the production-build community journey;
   - take a backup while the synthetic deletion account still exists;
   - complete account deletion;
   - verify the live post-deletion state.

5. **Exercise deletion replay**
   - export the deletion ledger under exclusive lifecycle locking;
   - hash it independently;
   - restore the older backup into isolation;
   - migrate the restore to head;
   - verify that missing, malformed, unreadable, stale, or mismatched ledgers fail;
   - replay the valid ledger;
   - compare the restored identifier-free summary with the verified live state.

6. **Smoke the candidate**
   - start the exact candidate images only after recovery verification;
   - require backend liveness and readiness;
   - require frontend liveness;
   - read a known public recipe through both the API and rendered frontend.

7. **Smoke application rollback**
   - stop the candidate;
   - start the reviewed ancestor application against the unchanged newer schema;
   - repeat smoke checks;
   - verify that the database revision did not change.

8. **Write bounded evidence**
   - emit one canonical identifier-free report only after every phase passes.

The full repository quality gate and private credential review remain separate prerequisites. A successful rehearsal proves the tested recovery path; it is not deployment approval.

---

## Account-deletion ledger

An older backup can contain an account that has since been deleted.

Recipe Lab therefore keeps deletion evidence outside the database backup boundary so a restore cannot silently resurrect private account state.

### Export deletion evidence

From the backend environment:

```powershell
cd backend
python -m app.recovery export --output <PRIVATE_LEDGER_PATH>
```

The exporter:

- takes the exclusive account-lifecycle lock;
- verifies current deletion tombstones;
- writes canonical version-1 evidence;
- creates the file with private permissions; and
- prints only bounded metadata such as coverage time, entry count, hash, and version.

Independently preserve:

- the lowercase SHA-256 of the ledger; and
- the database time through which the ledger must provide deletion coverage.

Store the ledger in restricted encrypted storage for at least as long as a backup could predate the deletions it records.

Do not store the ledger inside the same backup boundary it is intended to correct.

### Replay deletion evidence

After restoring an older backup and migrating it to the current schema:

```powershell
python -m app.recovery replay `
  --ledger <PRIVATE_LEDGER_PATH> `
  --expected-sha256 <LOWERCASE_SHA256> `
  --required-covered-through <UTC_TIMESTAMP> `
  --expected-database-name <ISOLATED_DATABASE_NAME> `
  --confirm-isolated-restore
```

Replay is deliberately fail-closed.

The command rejects evidence that is:

- missing;
- unreadable;
- group/world-readable;
- oversized;
- malformed;
- non-canonical;
- duplicated;
- stale; or
- hash-mismatched.

The expected database name is also verified from inside PostgreSQL.

Valid replay:

- locks affected accounts in stable order;
- removes private state from restored active or suspended accounts that were later deleted;
- verifies tombstones that are already present;
- safely ignores ledger accounts that do not exist in the older backup; and
- commits atomically.

Command output contains only aggregate counts.

Do not point health checks or application traffic at the restored database until deletion replay and the independent restored-state checks have passed.

If the required ledger coverage cannot be established, the restore remains unusable.

---

## Restore procedure

The repository's checked-in community restore verifier is tied to the synthetic automated rehearsal environment. It is not a production restore verifier for an arbitrary deployment.

A persistent deployment needs an equivalent reviewed deployment-specific restored-state verifier.

Use this order for a persistent restore:

1. **Create an isolated restore**
   - restore the selected encrypted backup into a newly named database;
   - keep it network-isolated from applications and user traffic;
   - do not give normal application processes credentials to it.

2. **Record restore identity**
   - record the backup identity;
   - record the expected source/deployment revision;
   - keep this evidence in restricted incident storage.

3. **Migrate forward**
   - apply the current Alembic migration head.

4. **Replay account deletions**
   - replay every completed deletion that can be newer than the selected backup.

5. **Verify deleted-account state**
   - confirm the expected tombstones;
   - verify removal of sessions and provider mappings;
   - verify removal of staff grants;
   - verify removal of private drafts;
   - verify removal of private interactions;
   - verify removal/scrubbing of private report and moderation text;
   - verify removal of unbound private workflow evidence.

6. **Run account-data verification**
   - run the account-data metadata gate;
   - run the reviewed deployment-specific identifier-free restored-state verifier.

7. **Run recipe-history integrity checks**
   - run the read-only SQL checks in the next section.

8. **Smoke the exact candidate images**
   - start them without external traffic;
   - verify backend liveness and readiness;
   - verify frontend liveness;
   - verify correlation/redaction behavior;
   - load a known public recipe through the API and frontend.

9. **Admit traffic**
   - expose the recovered deployment only after every prior step passes.

10. **Destroy temporary recovery artifacts**
    - destroy failed or superseded restored databases;
    - delete temporary dump copies;
    - delete copied ledgers;
    - delete temporary logs and scanner artifacts according to retention rules.

A failed or superseded restore stays isolated and should be destroyed.

Recovery speed is never a reason to expose data that may predate an account deletion.

---

## Recipe-history integrity checks

Database constraints normally prevent invalid recipe/version relationships from being committed.

Run the following read-only checks after migration or restore and before admitting traffic.

Both queries must return **zero rows**.

### Current-version integrity

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

This detects a current-version pointer that:

- does not map to the recipe;
- points across recipes;
- lags the latest local version; or
- has ambiguous mapping.

A null `recipes.owner_user_id` after account deletion is valid.

The SQL uses `recipe_editions` and `edition_number` because those are implementation names in the database. In normal documentation, the product concept is a published recipe version.

### Published-version membership

```sql
SELECT publication.recipe_version_id
FROM recipe_version_publications AS publication
LEFT JOIN recipe_editions AS edition
    ON edition.recipe_version_id = publication.recipe_version_id
WHERE edition.recipe_version_id IS NULL
ORDER BY publication.recipe_version_id;
```

This detects a published immutable snapshot that is missing the expected stable-recipe membership row.

### Handling a nonzero result

Routine monitoring may publish only the **aggregate row count** from these checks.

Do not put returned recipe/version IDs in:

- logs;
- metrics;
- alerts; or
- CI artifacts.

A nonzero result is impossible state.

If one appears:

1. remove affected instances from traffic;
2. stop publication writers;
3. preserve the database and deployment revisions privately;
4. investigate in a restricted environment;
5. do **not** disable integrity triggers;
6. do **not** mutate affected rows in place.

If repair is required, use a separately reviewed migration after the failure is understood.

Some results that look unusual are still valid behavior and are **not** corruption:

- one of two concurrent revision publications may lose with `recipe_revision_source_stale`;
- an unavailable exact recipe version uses the same neutral response whether it is unknown or hidden; and
- a hidden current version does not fall back to an older readable version.

---

## Application rollback

Application rollback keeps the upgraded database schema in place.

Do **not** downgrade production schema automatically when reverting the application.

A rollback application must be proven compatible with the current schema and current invariants.

Against an isolated copy of the current schema containing at least one revision and one adaptation, verify that the rollback application can still:

- publish an original recipe atomically;
- publish an adaptation while retaining its exact source;
- publish a revision while appending the new local version and advancing current atomically;
- preserve idempotency fingerprints and publication receipts;
- read only the explicit current version for ordinary stable-recipe access;
- avoid fallback to an older version when current is hidden;
- preserve visibility and moderation rules;
- preserve account deletion behavior;
- preserve protected audit/evidence behavior.

Repeat smoke coverage for:

- current public recipe;
- hidden current recipe;
- original publication;
- adaptation publication;
- revision publication; and
- neutral unavailable exact-version behavior.

If the older application cannot preserve these rules, it is **not** a valid rollback target even if its health endpoints pass.

Keep the candidate closed to traffic and choose another compatible image or use the verified restore path.

---

## Migration downgrade policy

Alembic downgrade is a development/rehearsal tool, not Recipe Lab's production recovery mechanism.

Some schema changes are intentionally not losslessly representable by an older schema.

Examples include data introduced for:

- explicit draft intent;
- revision history;
- multiple published versions; or
- protected audit/evidence structures.

Do not delete drafts, published versions, or audit evidence simply to force a downgrade.

A reviewed downgrade/re-upgrade test may run against disposable data when the migration explicitly supports it.

Once a fail-closed downgrade guard applies, use one of these options instead:

- keep the newer schema and roll back only to a compatible application; or
- restore a verified older backup into isolation and migrate it forward through the supported path.

---

## Candidate smoke checks

Before shifting traffic to a recovered or newly released candidate:

1. Finish migrations as a separate successful step.
2. Call backend `GET /api/health`.
3. Verify a fresh valid correlation ID.
4. Call backend `GET /api/readiness`.
5. Verify a different fresh valid correlation ID.
6. Call frontend `GET /healthz`.
7. Exercise one safe synthetic failure and verify:
   - the response header/body correlation IDs match; and
   - the structured event contains only approved fields.
8. Read one known public recipe through the backend API.
9. Read the same known public recipe through the rendered frontend.
10. Confirm the approved authentication, publication, database, application, dependency, and latency telemetry is receiving only reviewed low-cardinality data.

Do not stop a shared production database just to test readiness failure. The production-image verifier owns that proof in an isolated environment.

If readiness, redaction, integrity, or telemetry checks fail, do not route traffic to the candidate.

Keep serving the last known-good revision only when it has already been shown to be compatible with the current schema.

---

## Recovery evidence

Successful release/recovery evidence may include:

- candidate commit SHA;
- rollback commit SHA;
- safe-source archive hash;
- immutable image IDs/digests;
- scanner version and bounded result status;
- database/migration revision;
- fixed phase pass/fail results; and
- identifier-free live/restored state summaries.

It must not include:

- database URLs;
- account IDs;
- recipe IDs;
- email addresses;
- provider or session material;
- private report/moderation text;
- filesystem paths containing sensitive information;
- mutable image tags as release identity;
- raw vulnerability/secret scanner output;
- deletion ledger contents;
- database dumps; or
- raw application logs.

A failed rehearsal or recovery step does not authorize bypassing it.

Keep traffic on the last known-good compatible deployment, investigate the failed phase using private temporary evidence, and fix the source, image, migration, deletion replay, or compatibility problem in a new reviewed change.

Do not publish raw dumps or deletion ledgers as CI diagnostics.

Before a real deployment, privately verify that:

- deployment credentials are still required;
- unused access has been removed;
- credentials that may have been exposed have been rotated;
- runtime secrets are stored only in the deployment secret system; and
- recovery ownership is known.

Record review dates and outcomes without copying secret values into GitHub, logs, or artifacts.

---

## Portfolio sandbox recovery

The public portfolio sandbox does not use this backup/restore procedure.

A sandbox generation has no durable database backup and no user-data recovery path.

When a generation expires or must be replaced:

1. close its ingress;
2. stop its writers;
3. remove only resources owned by that exact generation;
4. create a fresh generation with fresh secrets and empty storage.

See [Operations](../operations.md#portfolio-sandbox) for the generation lifecycle and rehearsal procedure.
