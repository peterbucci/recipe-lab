# Seed data

Recipe Lab ships a small deterministic catalog so the MVP can demonstrate
structured recipes and meaningful version trees before user-created content
exists. Version 1 contains 25 original recipe lineages and 34 complete recipe
snapshots across breakfasts, soups, salads, bowls, mains, snacks, and baking.

The catalog deliberately includes:

- simple parent/child variants;
- a three-version lineage for deeper navigation;
- a branched carrot-cake lineage, including a child with less sugar and pecans
  in place of walnuts;
- authored ingredient aliases that still reference canonical ingredient IDs;
- directed substitutions with ratios or written guidance and provenance;
- a separately versioned curated measurement vocabulary with deterministic
  unit and alias identities; and
- a separately versioned catalog of 54 curated cooking-action types plus explicit,
  reviewed structured-action mappings for all 116 bundled instructions.

## Reproducibility

Every seed-owned row uses a UUIDv5 derived from the dataset ID, entity type,
and an immutable stable key. The catalog also uses one fixed UTC publication
timestamp. As a result, loading the same version into independent empty
databases produces the same IDs and content.

Action-type UUIDs use their own versioned namespace. Action instance and input
UUIDs derive from the recipe, instruction, action, and ingredient stable keys.
The action asset maps seed keys directly; validation and loading never infer
verbs, inputs, durations, or temperatures from prose. A missing mapping or an
unknown/cross-recipe reference fails before the database is written.

The loader runs inside one database transaction and is safe to rerun. It
reuses compatible catalog rows, adds only missing seed metadata, and never
deletes user data. If a deterministic recipe snapshot or substitution already
exists with different content, the loader stops instead of silently changing
history. The caller's transaction then rolls back the attempted load.

Loading also preserves the legacy application-level `Demo Cook` profile used by
the original shared MVP interactions. That identity is separate from the
catalog author, has a fixed application-owned ID, and is not part of the CC0
recipe assets. Rerunning the loader preserves its saves, ratings, and events,
but the current runtime does not select Demo Cook for member actions or
personal recommendation history.

RCP-23 classifies Catalog Author as a non-login `system` account and Demo Cook
as a non-login `demo` account. Neither can be linked to an OIDC identity or
claimed by a member. Seed reruns preserve their existing recipe and interaction
history and verify their application-owned classification and display metadata
rather than transferring or silently rewriting either identity.

The loader can reuse a canonical ingredient that predates this catalog, even
when that row has a different UUID. Recipe rows reference the actual canonical
ingredient ID, which keeps migration-created and user-created catalog entries
compatible with the demo data.

## Commands

Validate the packaged data without a database:

```powershell
cd backend
python -m app.seeds validate
```

After applying the migrations, load it explicitly:

```powershell
python -m app.seeds load
```

Seeding is never run automatically during API startup. The packaged
provenance, licensing, interpretation, and food-safety notes live alongside
the data in the [catalog provenance](../backend/app/seeds/data/PROVENANCE.md).
Measurement identity, conversion limits, and deployment audit behavior are
documented in [measurement catalog and legacy migration](measurements.md).
The complete action vocabulary, instruction-graph, fork, and diff contract is
documented in [structured cooking actions](cooking-actions.md).
