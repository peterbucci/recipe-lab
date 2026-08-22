# Offline content recommender

## Purpose and boundary

`content-v1` is a deterministic content-based recommender that Recipe Lab fits
and evaluates offline. It represents recipe versions with structured catalog
features, derives signed profiles from the training prefix of preference
events, and ranks the evaluator's complete candidate set. It is not used by
FastAPI, is not exposed in the frontend, and does not produce or deploy a model
artifact. The production recommendation endpoint continues to use
[`baseline-v1`](recommendations.md).

The command-line evaluator always runs `content-v1` and automatically includes
`baseline-v1`, so every CLI report contains the content result, the reference
result, and metric deltas at the same K values. The lower-level Python
`evaluate()` function remains generic: callers must pass `ContentBasedV1Model()`
when they want that comparison. The opt-in `run --collaborative` experiment also
includes `content-v1` as both a direct comparator and the deterministic fallback
for sparse collaborative evidence.

## Recipe features and similarity

The model uses only recipe versions available before the snapshot cutoff. Each
version has three feature groups:

- the set of distinct canonical ingredient UUIDs;
- the set of unique Unicode-alphanumeric title tokens after Unicode
  case-folding; and
- the positive integer version number.

Ingredient and title similarity are separate Jaccard coefficients. A Jaccard
term is zero if either corresponding set is empty. Version proximity decreases
with the absolute difference between version numbers:

```text
ingredient(c, h) = Jaccard(ingredient_ids(c), ingredient_ids(h))
title(c, h)      = Jaccard(title_tokens(c), title_tokens(h))
version(c, h)    = 1 / (1 + abs(version_number(c) - version_number(h)))

similarity(c, h) = (6 * ingredient(c, h)
                   + 3 * title(c, h)
                   + 1 * version(c, h)) / 10
```

Canonical ingredient identity is the strongest signal. Title tokens provide
bounded recipe metadata, while version proximity is a small deterministic
metadata term. The model does not inspect held-out events, relevance labels,
descriptions, instructions, quantities, dietary flags, allergens, or
substitution edges.

## Signed preference profiles

Training events are ordered by UTC occurrence time and then event UUID. The
latest save and rating for each profile and exact recipe version wins, so an
append-only state transition is not counted as several independent opinions.
Views and forks use distinct interaction-target semantics rather than frequency
counts.

| Training signal | Weight |
| --- | ---: |
| Latest save is active | `+3` |
| Latest save is inactive | `-3` |
| Rating `r` | `(r - 3) * 2` |
| Distinct view of a version | `+1` |
| Distinct fork source | `+4` |
| Distinct fork child | `+4` |

Ratings one through five therefore contribute `-4`, `-2`, `0`, `+2`, and
`+4`. Repeated views collapse by profile and recipe. Repeated fork records
collapse by profile, source, and child, and one retained fork contributes to
both versions. All contributions for one profile and version are summed; a
fully cancelled aggregate is omitted. An unobserved recipe is not treated as a
negative preference.

For candidate `c`, profile recipes `h`, and signed aggregate weights `w_h`, the
personal affinity is:

```text
affinity(c) = sum(w_h * similarity(c, h)) / sum(abs(w_h))
```

The absolute-weight denominator keeps positive and negative evidence on one
bounded scale without allowing opposite signals to shrink the normalization
term. Positive history raises similar candidates; negative history lowers
them. All similarity and affinity arithmetic uses exact rational values.

## Cold start and deterministic ranking

The model also computes a signed global prior for each recipe by summing its
nonzero aggregate weights across profiles. A profile with no training signal,
or whose signals fully cancel, has zero affinity for every candidate and falls
back to this prior. A zero-affinity tie for any profile uses the same fallback.
Recipes with no interaction history remain rankable through the zero prior and
stable metadata; their content can still match another recipe in a nonempty
profile.

Candidates are ordered by:

1. descending content affinity;
2. descending signed global prior;
3. ascending trimmed, case-folded title;
4. ascending trimmed original title;
5. ascending version number; and
6. ascending recipe-version UUID.

The evaluator supplies a derived model seed, but `content-v1` is a closed-form
model and deliberately does not use randomness. Exact arithmetic, sorted event
state, distinct-event policies, and fixed tie-breaks make fitting and inference
invariant to input ordering and seed choice. The model version and every
behavior-affecting parameter are recorded in the canonical evaluation report.

## Evaluation and limitations

`content-v1` is evaluated only through the leakage-safe fixed-cutoff protocol
described in [offline recommendation evaluation](evaluation.md). A report must
show its raw Precision@K, Recall@K, NDCG@K, coverage, and popularity-bias
metrics beside the mandatory `baseline-v1` and the corresponding baseline
deltas. The synthetic fixture verifies the implementation and reproducibility;
it is not evidence that the content model improves recommendation quality.

Important limitations include:

- the shared demo identity can combine unrelated visitors into one profile;
- an inactive save may mean list cleanup rather than dislike, and a view is
  only a weak positive proxy without impression data;
- exact ingredient overlap and title tokens do not capture culinary semantics,
  quantities, preparation, dietary suitability, safety, or cooking outcomes;
- version-number proximity is a transparent heuristic, not semantic lineage
  similarity; and
- the current catalog and event history are too small for significance,
  generalization, or deployment claims.

No offline result promotes `content-v1` into the request path automatically.
Online serving, authenticated profiles, a frontend recommendation surface, and
model-artifact lifecycle remain separate product and architecture decisions.
Its additional role as the
[`collaborative-v1` sparse fallback](collaborative-recommender.md#sparse-data-and-fallback)
is likewise evaluator-only and adds no serving dependency.
