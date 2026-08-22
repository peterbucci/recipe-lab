# Offline substitution rules engine

## Purpose and boundary

`substitution-rules-v1` is a deterministic offline rules engine for testing
practical ingredient replacements before any learned ranking is attempted. It
starts from curated, directed substitution relationships, applies requested
dietary and allergen tag checks as hard filters, and then orders the surviving
candidates using relationship evidence, recipe context, and optional preference
weights.

This implementation lives in the `ml` package. It is not imported by FastAPI,
has no API endpoint or frontend surface, does not edit a recipe, and does not
train or persist a model. The existing product catalog and directed
substitution rows are inputs to the offline rules adapter; RCP-20 does not put
automatic substitution suggestions into the MVP request path.

## Curated catalog contract

Version one generates candidates only from explicitly recorded outgoing edges
for the requested source ingredient. Relationships are directional: an edge
from A to B does not imply B to A. The engine never invents a reverse edge,
walks a transitive path, or generates a candidate from ingredient similarity.

The catalog validator requires:

- unique ingredient, taxonomy, relationship, and recipe-context identifiers;
- known ingredient and taxonomy references;
- one unique directed source/replacement pair with no self-replacement;
- either a positive quantity ratio or nonblank written guidance;
- either provenance or a relationship-confidence value; and
- confidence values between zero and one when present.

Relationship confidence records confidence in the curated replacement edge. It
is not medical, allergen, label, cross-contact, nutrition, or food-safety
confidence.

A result carries the recorded ratio or guidance, optional notes and provenance,
the component values used for ordering, and a deterministic explanation. A
query returns at most 20 results. The engine preserves ratios and guidance
verbatim; it does not calculate a converted amount because the catalog has no
unit-compatibility ontology.

## Hard constraint filtering

A query may require dietary flags and exclude allergens. These checks run
before recipe context or preferences can affect order:

```text
required dietary flags must be a subset of the replacement's declared flags
excluded allergens must not intersect the replacement's declared allergens
```

A candidate that fails either check is removed. A favorable recipe-context or
preference value cannot restore it. Unknown constraint IDs and unknown recipe
ingredient IDs are rejected rather than ignored. The source ingredient must be
present in the query recipe context, and every preference-weight ID must be one
of that source's direct curated replacements. The versioned benchmark also
rejects expected-result IDs outside those direct candidates.

These are declared-tag checks, not safety checks. Ingredient metadata contains
positive demo declarations only. A missing allergen or dietary assignment means
unknown, not absent, suitable, or free from cross-contact. In particular, an
excluded-allergen check can reject a declared conflict but cannot prove an
undeclared ingredient safe. Every result therefore carries this caution:

> Ingredient metadata records positive demo declarations only. Missing data is
> unknown; verify current product labels and cross-contact information, and
> seek qualified advice when needed.

The engine must not be presented as medical, allergy, nutrition, or food-safety
advice.

## Deterministic context and preference components

For a replacement candidate, the recipe-context component removes the source
from the query recipe. It compares the remaining ingredient set with every
catalog recipe context containing the replacement, after removing the
replacement from that context. The component is the largest exact Jaccard
similarity:

```text
target_context = query_ingredients - {source}
known_context  = recorded_recipe_ingredients - {replacement}
context_score  = max(Jaccard(target_context, known_context))
```

The score is zero when no recorded replacement context matches or either set
for a comparison is empty.

Optional signed preference weights are normalized by the largest absolute
weight in the query:

```text
preference_affinity(replacement) =
    replacement_weight / max(abs(all supplied weights))
```

The result lies from `-1` through `1`; missing, empty, or fully zero preference
input produces zero. Positive values favor a replacement and negative values
weigh against it. These weights are explicit offline inputs, not learned user
embeddings or a claim that the shared demo identity represents one person.

Eligible candidates use this stable lexicographic order:

1. relationships with explicit confidence before provenance-only confidence;
2. descending relationship confidence;
3. descending recipe-context similarity;
4. descending preference affinity;
5. ascending trimmed, case-folded replacement name; and
6. ascending replacement-ingredient UUID.

A provenance-only edge uses an internal confidence fallback of `1/2`, while its
missing-confidence status remains an earlier ordering key. The scorer uses
exact rational arithmetic for context and preference components. It uses no
seed or random sampling.

Explanations state whether explicit confidence or provenance supports the
curated edge, whether context or preferences affected its position, and whether
requested declared-tag checks passed. They do not claim that a replacement is
equivalent, successful, healthy, or safe.

## Rules benchmark and report

The substitution benchmark is separate from the recipe-recommendation snapshot
and its temporal split. Its schema is
`recipe-lab-substitution-benchmark-v1`; it contains one immutable synthetic
catalog, declared limitations, and cases with a source, recipe context,
constraints, optional preference weights, limit, and expected direct-edge
ranking.

Run it without a database:

```powershell
cd ml
recipe-lab-eval substitution-run `
  --benchmark tests/fixtures/substitution_benchmark_v1.json `
  --output reports/substitution-rules-v1.json `
  --strict
```

The `curated-direct-rules-benchmark-v1` protocol reports:

- exact-ranking and top-one accuracy;
- expected-candidate recall and empty-result accuracy;
- direct-edge precision and declared-constraint compliance;
- ratio-or-guidance, provenance-or-confidence, and explanation coverage;
- exact caution-text compliance; and
- aggregate direct, eligible, filtered, missing-field, and violation counts.

Metric values use six decimal places. `engineering_validated` requires a
nonempty benchmark with at least one expected result, exact expected rankings,
complete expected-candidate retrieval, only direct outputs, no declared-tag
violations, complete ratio-or-guidance and provenance-or-confidence fields,
complete explanations, exact caution text, and correct expected empty results.
Other evaluated outcomes are `invalid` or `insufficient_data`, with stable
reason codes. The aggregate counts include caution mismatches, and the metrics
publish separate caution compliance.

The CLI writes the canonical report before applying `--strict`. Strict mode
returns exit status 3 unless the status is `engineering_validated`; invalid
benchmark syntax or configuration returns 2. The input benchmark cannot also
be the output path.

The committed fixture has six synthetic cases, including dietary/allergen
filtering, preference tie-breaking, constraint precedence, direct-only routing,
and an expected empty result. Its perfect engineering metrics verify the rules,
reporting, and reproducibility contracts only. They do not measure taste,
texture, cooking success, real preference quality, cross-contact, or medical
suitability.

Reports contain the benchmark fingerprint, deterministic run ID, aggregate
counts and metrics, strategy version, fixed evaluator limitations, and
`learned_ranking_attempted: false`. They omit ingredient, relationship,
recipe-context, and case identifiers and names. Caller-supplied benchmark IDs
and limitation text affect the canonical benchmark fingerprint but are not
copied into the aggregate report. Semantically identical benchmark content and
rules produce byte-identical canonical JSON reports, even when set-like input
collections are reordered.

## Interpretation and next steps

RCP-20 establishes the transparent rules baseline required before evaluating a
learned substitution ranker. It does not justify a learned model, production
serving, or a user-facing suggestion workflow. Any later approach must use a
separately versioned evaluation contract and compare against these rules while
retaining hard constraints, explanations, provenance, and the unknown-metadata
caution. Suitable evidence would also need real substitution impressions,
selections, rejection reasons, and cooking outcomes; none are currently
recorded.
