# Stable recipe edition operations

This runbook covers the `recipes` and append-only `recipe_editions` topology
introduced by migrations `20260914_0032` and `20260914_0033`. It supplements
the general [release rehearsal](release-rehearsal.md); it does not create a
manual repair path around the recipe publication, visibility, moderation, or
account-lifecycle owners.

## Traffic-admission integrity checks

PostgreSQL normally makes the states below uncommittable through deferred
foreign keys, uniqueness constraints, and constraint triggers. Run these
read-only checks after migration or restore and before admitting traffic. Both
must return zero rows.

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

The first query detects a missing, cross-recipe, lagging, or otherwise
ambiguous current selection. A nullable `recipes.owner_user_id` is valid after
account deletion and is not an integrity failure. The second query detects a
published immutable snapshot with no stable-recipe membership.

For routine monitoring, export only the aggregate row count from each check.
Never send the detailed recipe/version identifiers to logs, metrics, alerts,
or CI artifacts. Any nonzero count is impossible application state: remove the
database-backed instances from traffic, stop publication writers, preserve the
database and deployment revisions in restricted incident evidence, and inspect
the detailed rows only in the private operational session.

## Monitoring expected and impossible outcomes

Continue to use the existing fixed, low-cardinality signals in
[Operations and observability](operations-observability.md). Readiness failure
removes an instance from traffic, and the existing publication-failure
threshold starts investigation. A sustained change in fixed publication
operation/outcome or status-class aggregates can justify a private integrity
check, but recipe IDs, exact version IDs, titles, declared reasons, and request
bodies are never metric labels.

These outcomes are expected and do not authorize repair:

- one of two concurrent revision publications can return
  `409 recipe_revision_source_stale`; the losing private draft remains active;
- an author-withdrawn or moderation-hidden exact version returns the same
  neutral not-found response as an unknown version; and
- a stable recipe with a hidden current version is unavailable rather than
  falling back to an older readable edition.

A committed non-latest current pointer, a publication without an edition, or
more than one successful successor for the same recipe-local predecessor is
not expected concurrency. Treat it as database corruption or an unreviewed
writer bypass.

## Application rollback compatibility

An application process starting successfully against the newer schema is not
enough to establish rollback compatibility. A rollback image used after these
migrations must preserve all of the following behavior:

- every original or adaptation publication atomically writes its stable
  `Recipe`, first `RecipeEdition`, current pointer, and publication receipt;
- draft creation binds the explicit `original`, `adaptation`, or `revision`
  kind and exact source in its version-2 creation fingerprint;
- revision publication appends a same-recipe edition and advances current in
  one transaction while leaving `RecipeVersion.parent_version_id` null;
- discovery and stable reads select only the explicit current edition and
  never fall back when it is hidden; and
- visibility, moderation, account deletion, idempotency, and audit ownership
  remain with their existing backend transactions.

Images predating the stable-identity writer fail the 0032 publication-
membership guard. Images that omit explicit draft kind cannot safely create
source-backed drafts under 0033, and images with legacy discovery semantics can
expose superseded editions after revisions exist. Those images are therefore
not compatible rollback targets even if liveness and readiness pass.

Choose and rehearse a rollback image against an isolated copy of the upgraded
database containing at least one revision and one adaptation. Repeat the
stable-current, hidden-current, original publication, adaptation publication,
and neutral-unavailability smoke checks. Application rollback keeps the schema
unchanged; never run Alembic downgrade as an automatic or in-place production
rollback.

## Restore, re-upgrade, and fail-closed downgrade

Restore an older backup only into an isolated database. Apply the current
migration head, replay externally retained account-deletion evidence when the
backup can predate a completed deletion, run the two integrity checks above,
and only then run application smoke tests. Traffic remains closed until the
restored-state privacy verifier and stable-recipe checks both pass. This is the
same ordering required by [account data governance](account-data-governance.md).

Migration 0032 backfills only the new stable recipe and edition mapping tables;
it does not rewrite legacy recipe versions, content, timestamps, lineage, or
interactions. Re-running upgrade from the reviewed prior revision must produce
the same mapping. Migration 0033 deterministically classifies legacy null-
source drafts as originals and source-backed drafts as adaptations, then
rebinds their creation fingerprints.

Downgrade is a disposable rehearsal path, not a recovery mechanism:

- 0033 refuses to downgrade while any revision draft exists because the older
  schema cannot represent that intent faithfully; and
- 0032 refuses to downgrade after recipe-local revision history or multiple
  parent-null versions make the legacy one-root-per-lineage model lossy.

A successful pre-revision downgrade/re-upgrade rehearsal must preserve every
legacy row and reproduce the same stable mapping. Once either fail-closed guard
applies, keep the newer schema or restore a verified pre-upgrade backup in
isolation and re-upgrade it. Do not delete revision drafts, editions, or
versions merely to make a downgrade command pass.

## Why ordinary repair never mutates snapshots

`recipe_versions` and their structured children are immutable public
snapshots. `recipe_editions` is append-only topology, and publication,
visibility, and moderation evidence is retained for audit and idempotent
replay. Updating a title, adaptation parent, predecessor, edition number, or
declared reason in place would destroy the exact object that existing links,
comparisons, interactions, moderation decisions, and adaptations reference.

The normal correction path is therefore a newly published immutable version
and edition. When required for safety, the publication transaction can also
author-withdraw its exact predecessor atomically. It must never restore a
moderation-hidden source. The only ordinary mutable stable-recipe fields are
the constrained current pointer, advanced by publication, and owner authority,
cleared by account lifecycle. Neither is a general-purpose repair switch.

If an integrity check fails, do not disable triggers or issue corrective
`UPDATE` or `DELETE` statements. Block traffic, determine how an invariant was
bypassed, and restore/re-upgrade from verified evidence. A separately reviewed
migration may reconstruct impossible topology, but it is not authority to erase
published content. RCP-54 exceptional privacy or security erasure remains an
unimplemented launch gate requiring the legal/DPO and privacy-authority
controls, downstream propagation, audit, rollback, and idempotency rules in
[account-data governance](account-data-governance.md#exceptional-privacy-or-security-erasure).
