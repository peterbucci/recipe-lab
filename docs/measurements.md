# Measurement catalog and legacy migration

Recipe Lab stores recipe amounts as typed measurement snapshots. A new exact or
range amount must reference an active curated unit by UUID; historical snapshots
remain readable if that unit is later made inactive. Qualitative modes
(`to_taste` and `as_needed`) and `unspecified` have no numeric values or unit
identity. The stored `unit_display` value is only a preserved legacy/storage
snapshot and integrity aid; it is neither editable unit identity nor the source
for public rendering. Reads regenerate `display_unit` and the complete display
string from immutable curated unit metadata and the stored decimal values.

## Versioned catalog

The immutable v1 vocabulary is packaged in
`backend/app/seeds/data/measurements-v1.json`. Unit and alias UUIDv5 values use
the dedicated namespace URL
`https://github.com/peterbucci/recipe-lab/measurement-catalog/v1`, independent
of the demo recipe dataset version. Seed validation requires every recipe unit
key to resolve to one active mass, volume, count, or package unit.

Conversion rules are deliberately narrow. Metric mass, metric volume, time,
and Celsius/Fahrenheit rules use explicit rational scale and offset values.
Teaspoon, tablespoon, cup, count-like units, and package units are assigned
separate nonconvertible families. A density or package conversion exists only
when a reviewed ingredient-specific rule is stored; the service never guesses.
An exact or ranged package amount may retain `package_size_id` only when that
active reviewed record belongs to the selected ingredient and package unit.
Changing either identity clears or invalidates that metadata.

Structured cooking-action parameters reuse the same catalog and serialization
rules without being ingredient amounts. Duration accepts only active `time`
units and positive exact/range values; temperature accepts only active
`temperature` units and exact/range values. Action parameters do not accept
qualitative modes or package-size metadata. They store a reviewed display
snapshot but public reads serialize the referenced curated unit. See
[structured cooking actions](cooking-actions.md) for the instruction-graph
contract.

Exact structural fingerprints use a narrower, versioned conversion contract.
`recipe-structure-v1` converts only through the selected unit's reviewed affine
same-dimension, same-family rule and retains exact rational values without
rounding. A later catalog deactivation does not reinterpret that immutable v1
relationship. Units without such a rule, explicit package-size identities, and
all density/package-content semantics remain distinct instead of being guessed.
See [structural recipe fingerprints](recipe-fingerprints.md).

## Pre-migration audit

Before deploying the structured-measure migration, run the read-only audit
against the target database:

```powershell
cd backend
recipe-lab-measurements audit-legacy --format json --output measurement-audit.json
```

The command works against the legacy `quantity`/`unit` columns, emits stable
reason-coded JSON, and exits with status 2 when any row is unresolved. Its
report contains recipe, recipe-version, ingredient, and measurement evidence
needed for remediation; it never includes user email, identity-provider, or
session data. Repeating the command against unchanged data produces identical
bytes.

The migration runs this same classifier before making schema changes. Known
positive quantities map to `exact`; a row with both legacy fields null maps to
`unspecified`. Unknown, ambiguous, inactive, blank, or incomplete measurements
abort the transaction with a bounded summary and leave the legacy schema
unchanged. Time and temperature labels are also refused for legacy ingredient
rows, even though those dimensions remain available for later structured
action data. The original unit text is retained in `unit_display` as migration
evidence, but public rendering immediately uses the resolved curated unit's
immutable symbol or singular/plural labels.

Downgrade is also fail-closed. It refuses range, `to_taste`/`as_needed`, or
package-size rows because those states cannot be represented losslessly by the
legacy two-column shape. `unspecified` remains lossless as two null legacy
fields. It also refuses to discard any reviewed density or package-size
metadata, and requires the stored unit, alias, and conversion-rule catalog to
match the immutable bundled v1 catalog exactly. Resolve or export incompatible
rows and metadata explicitly before attempting a downgrade. For every exact
row, downgrade additionally requires the retained `unit_display` token to map
uniquely back to the same curated unit ID; it refuses mismatched text rather
than silently changing the legacy measurement's meaning.
