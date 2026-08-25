# Structural recipe fingerprints

## Purpose and boundary

Recipe Lab assigns every structurally complete immutable recipe version an exact,
versioned identity. `recipe-structure-v1` compares reviewed ingredients,
measurements, and ordered cooking actions without depending on titles or wording.
It supports exact duplicate-candidate discovery and stable data signals; it does
not decide whether publication is allowed or whether two recipes are culinarily,
legally, or creatively equivalent.

The result contains:

- the algorithm version `recipe-structure-v1`;
- the lowercase SHA-256 digest of the exact canonical JSON; and
- that exact canonical JSON for collision-safe equality confirmation.

The algorithm version is separate from the hash algorithm. A later canonical
contract must use a new algorithm version and may coexist with v1; it must never
reinterpret a stored v1 payload.

## Exact v1 payload

The root payload has exactly four fields:

```json
{
  "ingredients": [],
  "instructions": [],
  "schema": "recipe-lab.recipe-structure",
  "version": 1
}
```

The empty arrays above show only the root shape. They are not a fingerprintable
recipe. A complete payload contains at least one ingredient and one instruction,
and every instruction contains at least one action.

Canonical bytes are produced as UTF-8 JSON with recursively sorted object keys,
compact `,` and `:` separators, Unicode characters left unescaped, and non-finite
numbers rejected. The digest is SHA-256 over those exact bytes. Decimal values
never serialize as floating point. Each value is reduced to an exact rational:

```json
{"denominator": 2, "numerator": 1}
```

The whitespace in the examples in this document is for readability. Stored and
hashed JSON is compact.

## Ingredient multiset and occurrence tokens

Each ingredient is first reduced to a core containing only its stable curated
ingredient identity and canonical measure. Equal cores are grouped into one
entry with explicit multiplicity:

```json
{
  "ingredient": "10000000-0000-4000-8000-000000000001",
  "measure": {
    "mode": "exact",
    "unit": {
      "dimension": "mass",
      "family": "metric-mass",
      "key": "g",
      "normalization": "reviewed_base"
    },
    "value": {"denominator": 1, "numerator": 500}
  },
  "multiplicity": 2,
  "occurrences": ["ingredient:0000", "ingredient:0001"]
}
```

Ingredient groups sort by their compact canonical core JSON, not by authored row
position. Within a repeated group, occurrences sort by the complete ordered list
of every action-use path `(instruction index, action index, input index)`. Global
tokens are then assigned as `ingredient:0000`, `ingredient:0001`, and so on.
Database row UUIDs and ingredient display order never enter the payload.

This rule preserves multiplicity and meaningful occurrence references while
remaining stable when copied rows receive new UUIDs or the same ingredient rows
are displayed in another order. Two unreferenced occurrences with the same core
are indistinguishable; exchanging them therefore leaves the repeated core,
multiplicity, token sequence, and fingerprint unchanged.

## Canonical measures

Ingredient measures retain their mode:

- `exact` has one rational `value`;
- `range` has rational `minimum` and `maximum` values;
- `to_taste`, `as_needed`, and `unspecified` contain only `mode`.

Duration and temperature parameters accept only exact or range measures. Duration
uses time units and positive values. Temperature uses temperature units and may
contain signed values.

For a numeric measure, v1 applies a curated unit's reviewed affine rule only when
the rule's base dimension and conversion family agree with the source unit. The
exact calculation is:

```text
base value = (value + offset numerator / offset denominator)
             * scale numerator / scale denominator
```

The canonical unit then has `normalization: "reviewed_base"` and carries the
reviewed base key, dimension, and family. This makes, for example, `1 kg` equal to
`1000 g`, `1 minute` equal to `60 seconds`, and `356 °F` equal to `180 °C` without
rounding.

The reviewed relationship is part of v1's immutable interpretation. Making that
catalog rule inactive later does not change an existing v1 result; correcting the
meaning of a reviewed rule requires a new fingerprint algorithm version.

When no safe reviewed affine rule exists, the measure retains the selected unit's
key, dimension, and family with `normalization: "curated_unit"`. Unsupported
conversions remain distinct. V1 therefore does not guess that teaspoons,
tablespoons, cups, count units, or unrelated conversion families are equivalent.

Package amounts additionally retain the exact curated `package_size` identity.
V1 never expands package contents and never consults ingredient-density rules.
Those records can evolve independently and must not silently reinterpret a stored
fingerprint. Supporting either kind of equivalence requires a later versioned
contract.

## Ordered action graph

Instructions remain in authored instruction order. Their prose is absent from the
payload. Each instruction contains its ordered action instances:

```json
{
  "actions": [
    {
      "action": "mix",
      "inputs": ["ingredient:0001", "ingredient:0000"],
      "parameters": [
        {
          "measure": {
            "mode": "exact",
            "unit": {
              "dimension": "time",
              "family": "elapsed-time",
              "key": "second",
              "normalization": "reviewed_base"
            },
            "value": {"denominator": 1, "numerator": 60}
          },
          "semantic": "duration"
        }
      ]
    }
  ]
}
```

`action` is the stable curated action-type key. `inputs` preserves ordered
ingredient-occurrence references through the canonical tokens above. `parameters`
has a fixed semantic order: duration, then temperature when present. Instruction,
action, and input order are structural; changing any meaningful order changes the
payload. Fresh instruction, action, input, and ingredient row UUIDs do not.

## Included and excluded fields

The following changes affect v1 identity:

- curated ingredient identity or multiplicity;
- quantity mode, exact/range value, non-equivalent unit semantics, or package
  size identity;
- instruction order, action type, action order, or ordered action inputs; and
- duration or temperature mode, value, or safely normalized unit semantics.

The following fields never enter v1:

- recipe title, description, servings, author, lineage, timestamps, or row IDs;
- curated ingredient names and aliases, authored ingredient display labels,
  preparation notes, and ingredient display order;
- instruction prose;
- action verbs used only for display, unit labels and aliases, and catalog
  provenance; and
- equipment, technique intensity, geometry, doneness, or other information that
  exists only in prose.

Consequently, paraphrased prose and reordered ingredient display rows do not
change structural identity. This is deliberate, but it also means an equal v1
fingerprint is not a claim that every human-significant cooking detail is equal.

## Completeness and persistence

The canonicalizer returns no result for an incomplete or inconsistent graph. That
includes a missing ingredient or instruction collection, an instruction without
an action, a missing catalog or measure identity, a missing action input target,
a duplicate input inside one action, or a measure whose shape or dimension does
not match its semantic role. It never creates a partial fingerprint.

Stored results live in `recipe_structural_fingerprints`, keyed by
`(recipe_version_id, algorithm_version)`. The table stores the lowercase digest
and exact canonical JSON. Its `(algorithm_version, digest)` index is deliberately
non-unique: exact duplicates are candidates, not rejected writes, until the
duplicate-policy story defines publication behavior.

An exact retry reuses the stored result. Attempting to store different canonical
data for the same recipe version and algorithm version is a conflict. A digest
candidate is declared equal only after the stored canonical JSON also matches;
the digest alone is never sufficient because hash collisions must remain safe.

Migration `20260825_0011` creates the versioned table and scans existing recipe
versions in bounded UUID order. Every complete version receives the same v1
result it would receive during normal publication. Incomplete legacy snapshots
receive no row and their immutable recipe content is not changed. The reusable
backfill is cursor-bounded and idempotent, so retries and independent runs over
unchanged data produce the same payloads and digests.

New complete forked versions and post-migration seed versions persist their v1
result in the same transaction as the immutable recipe snapshot. A failure cannot
leave a published version and fingerprint disagreeing. An incomplete historical
snapshot is not repaired in place; a reviewed mapping must be published as a new
complete immutable version.

## Scope guardrail

V1 provides exact structural candidates only. It does not:

- rank approximate similarity or use a learned model;
- merge recipe lineages or choose a canonical recipe;
- reject or withdraw publication;
- delete or rewrite existing duplicates; or
- make copyright, originality, authorship, or culinary-equivalence claims.

Those policy and approximate-similarity decisions remain separate from the exact,
collision-confirmed fingerprint contract.
