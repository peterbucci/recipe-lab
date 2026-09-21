# Research models and deterministic scorers

## Boundary

This document describes Recipe Lab's ranking experiments and the deterministic
scorers evaluated beside them. Except for the existing `baseline-v1` API-only
research preview and the production advisory duplicate preflight, everything
here runs only in the offline `ml` package.

The offline recommenders are not imported by FastAPI, are not exposed in the
frontend, do not update product data, and do not produce a deployed model.
Passing an offline benchmark does not make an approach safe, useful, causal, or
ready to ship. The shared evaluation rules and evidence limits are defined in
[Evaluation](evaluation.md).

## Recommendation model protocol

Every comparison model declares a stable model ID, version, and JSON-safe
parameter document. `fit()` receives only the catalog and events before one UTC
cutoff plus a model-specific seed. The fitted model receives a profile ID, the
complete ordered candidate IDs, and a limit; it must return unique known IDs.
Held-out events and relevance labels never cross that interface.

The runner always adds `baseline-v1` and rejects attempts to replace it.
Additional Python adapters can implement the same protocol, but the CLI exposes
only the fixed built-in suites. A behavior or feature change requires a model
version change when it alters scores, ordering, explanations, or artifacts.

## Shared signed interaction state

`content-v1` and `collaborative-v1` derive the same signed training matrix.
Events are ordered by UTC timestamp and event UUID. The latest save and rating
for an exact profile/version pair wins; views and forks are deduplicated rather
than counted repeatedly.

| Training signal | Weight |
| --- | ---: |
| Latest save is active | `+3` |
| Latest save is inactive | `-3` |
| Rating `r` | `(r - 3) * 2` |
| Distinct view of a version | `+1` |
| Distinct fork source | `+4` |
| Distinct fork child | `+4` |

Contributions are summed per profile and exact recipe version; a fully
cancelled cell is removed. An unobserved item is unknown, not negative.

## `baseline-v1`

`baseline-v1` is the mandatory reference. The offline adapter reconstructs
point-in-time state from snapshot events and calls the same database-free
scorer used by `GET /api/recommendations`. The endpoint is an API-only research
preview with no consumer recommendation surface; it remains inside the
[research boundary](../../docs/recommendations.md#current-product-status).

### Global score

For rating count `n` and rating sum `R`, rating quality uses a mean-three,
strength-five Bayesian prior:

```text
posterior_rating = (5 * 3 + R) / (5 + n)
Q = (posterior_rating - 1) / 4
```

An unrated item therefore has `Q = 0.5`. Active-save, fork-source-user, and
view-user support are distinct-profile counts, each divided by its maximum over
the complete eligible pool. A zero maximum produces zero normalized support.

```text
G = 0.55 * Q
  + 0.20 * normalized_active_saves
  + 0.15 * normalized_fork_source_users
  + 0.10 * normalized_view_users
```

### Personal score

Positive history anchors have strengths `1.00` for an active save, rating five,
fork source, or fork child; `0.50` for rating four; and `0.25` for a view.
Ratings one through three and inactive saves are not positive anchors. For
distinct canonical ingredient sets:

```text
J(c, h) = |ingredients(c) intersection ingredients(h)|
          / |ingredients(c) union ingredients(h)|

P(c) = max over anchors h of strength(h) * J(c, h)
```

The final score is `0.60 * G + 0.40 * P` when positive history exists and `G`
otherwise. Decimal scores are rounded to six places with `ROUND_HALF_UP` before
ranking. Ties use ingredient similarity, global score, normalized title,
original title, version number, then recipe-version UUID. The score has no
random, clock, or decay term.

Structured measures are loaded but projected to canonical ingredient IDs.
Instructions and structured cooking actions are not features. Adding either
would require a separately versioned strategy.

## `content-v1`

`content-v1` is a closed-form offline recommender. Each available version has
three feature groups: distinct canonical ingredient IDs, unique
Unicode-alphanumeric case-folded title tokens, and its positive version number.

```text
ingredient(c, h) = Jaccard(ingredient_ids(c), ingredient_ids(h))
title(c, h)      = Jaccard(title_tokens(c), title_tokens(h))
version(c, h)    = 1 / (1 + abs(version_number(c) - version_number(h)))

similarity(c, h) = (6 * ingredient(c, h)
                   + 3 * title(c, h)
                   + 1 * version(c, h)) / 10
```

A Jaccard term is zero when either set is empty. For signed profile weights
`w_h`:

```text
affinity(c) = sum(w_h * similarity(c, h)) / sum(abs(w_h))
```

A zero numerator or denominator produces zero affinity. The global prior is the
sum of each item's nonzero signed aggregate across profiles. Candidates sort by
descending affinity, descending global prior, normalized title, original
title, version number, then UUID. Empty or cancelling profiles therefore use a
deterministic signed-global-prior cold start.

The model does not use descriptions, instruction prose, actions, quantities,
dietary flags, allergens, substitution edges, or held-out data. It accepts its
derived seed for protocol consistency but does not consume randomness.

## `collaborative-v1`

`collaborative-v1` is a deterministic signed user-neighborhood experiment. It
may be evaluated only after the complete collaborative-readiness gate passes.

For profile signal `w(u, i)` and the shared nonzero overlap `O(u, v)`:

```text
similarity(u, v) =
  sum(w(u, i) * w(v, i) for i in O(u, v))
  / sum(abs(w(u, i) * w(v, i)) for i in O(u, v))
```

The pair must share at least two nonzero items. A zero numerator or denominator
is not usable neighbor evidence. For candidate neighbors `N(u, c)`:

```text
score(u, c) =
  sum(similarity(u, v) * w(v, c) for v in N(u, c))
  / sum(abs(similarity(u, v)) for v in N(u, c))
```

Local support rules are deliberately conservative:

- the target needs at least five nonzero signal items;
- the candidate needs nonzero signals from at least three profiles;
- each neighbor needs at least two shared nonzero items; and
- the final numerator and denominator must be nonzero.

Unsupported profiles use the complete `content-v1` order. Unsupported
candidates receive a neutral collaborative score and keep their content order;
content order also breaks all collaborative ties. Negative nonzero scores
remain evidence.

The fitted model publishes aggregate-only artifact metadata: model/artifact
versions, cutoff, derived seed, a SHA-256 of canonical training data, and
recipe, event, profile, observed-pair, nonzero-pair, and supported-profile/item
counts. It contains no raw profile, event, or recipe IDs and is not a serving
artifact.

## `hybrid-v1`

`hybrid-v1` is exact-rational rank fusion, not a learned ensemble. It requires
`baseline-v1`, `content-v1`, and `collaborative-v1` on the same split and shares
the collaborative readiness gate.

For `N` candidates, let `W = min(N, 50)`. A component rank `r` inside the first
`W` positions receives:

```text
component_score(r) = (W - r + 1) / W
```

An item outside the component window receives zero. With normalized baseline
`B`, content `C`, and collaborative `CF` ranks, each candidate takes one route:

| Route | Evidence | Final score |
| --- | --- | --- |
| `fallback` | No nonzero signed target profile | `B` |
| `content_fallback` | A target profile exists, but the candidate has no usable collaborative score | `(2C + B) / 3` |
| `hybrid` | The candidate has usable collaborative evidence | `(2C + 2CF + B) / 5` |

Each route has a fixed, non-identifying explanation. A negative nonzero
collaborative score qualifies for the full route; zero does not. Ties use final
score, content rank, baseline rank, normalized title, original title, version,
then UUID. The model has no persisted artifact; its report metadata and
parameter hash bind the component versions, weights, routes, tie-breaks, and
reason policy. The separate adoption guard is described in
[Evaluation](evaluation.md#hybrid-adoption-guard).

## `substitution-rules-v1`

This offline rules baseline considers only curated outgoing edges from the
source ingredient. Direction is not inferred, transitive paths are not walked,
and ingredient similarity does not create candidates. Each edge must carry a
positive quantity ratio or nonblank guidance and either provenance or a
confidence value in `[0, 1]`.

Required dietary flags and excluded declared allergens are hard filters:

```text
required dietary flags subset-of replacement declared flags
excluded allergens disjoint-from replacement declared allergens
```

Missing tags are unknown, never proof of suitability. Constraint failures
cannot be rescued by later scoring.

For the query context and a known recipe containing the replacement:

```text
target_context = query_ingredients - {source}
known_context  = recorded_recipe_ingredients - {replacement}
context_score  = max(Jaccard(target_context, known_context))

preference_affinity(replacement) =
  replacement_weight / max(abs(all supplied weights))
```

Empty context comparisons and absent or all-zero preferences produce zero.
Eligible candidates sort lexicographically by explicit-confidence presence,
descending confidence, descending context score, descending preference
affinity, normalized name, then UUID. Provenance-only edges use `1/2` as an
internal confidence fallback while remaining behind explicitly confident
edges.

The output preserves ratio or guidance, provenance or confidence, component
values, and a deterministic explanation. It does not convert quantities or
claim equivalence, success, nutrition, allergy safety, cross-contact safety, or
medical suitability. Every result carries the unknown-metadata and label-check
caution. There is no FastAPI route or frontend consumer.

## Structural duplicate scorer

The duplicate benchmark imports the production fingerprint builder and
`duplicate-candidate-similarity-v1` scorer. This is a deterministic advisory
scorer, not a learned classifier.

An exact duplicate requires the same fingerprint algorithm, the same lowercase
SHA-256 digest, and byte-identical canonical JSON. Non-exact pairs use:

```text
score = 9/20 * ingredient multiset Dice
      + 1/4  * normalized quantity similarity
      + 3/10 * structured action similarity

structured action similarity =
    1/2  * ordered action-type LCS Dice
  + 3/10 * ordered (action, input ingredient) LCS Dice
  + 1/5  * ordered (action, duration, temperature) LCS Dice
```

Quantity similarity chooses the one positive rational global scale that
maximizes exact same-ingredient measure matches; ties prefer scale one and then
the smallest positive fraction. Ingredient occurrences, exact/range/qualitative
shape, unit semantics, and reviewed package identities remain explicit. A
non-exact score of at least `4/5` is `probable_duplicate`; lower is `distinct`.

Each structure is capped at 200 ingredient occurrences, 500 actions, and 2,000
flattened action inputs, with at most 10,000,000 estimated work units per pair.
The product returns at most three fixed reasons for at most five candidates.
Titles, prose, display labels, authors, and lineage metadata do not affect the
score. A match cannot establish authorship, plagiarism, culinary equivalence,
or a publication prohibition. The maintained product preflight therefore keeps
the result advisory and requires an explicit author decision before continuing.

## Shared limitations

- The catalog and committed fixtures are small and synthetic; they do not
  establish statistical significance or generalization.
- There is no recommendation-impression or randomized-exposure log, so unseen
  items are not reliable negatives and offline scores are not causal.
- Shared demo activity may combine unrelated visitors and is not a coherent
  member profile.
- Recipe structure omits technique nuance, equipment, geometry, doneness,
  product-label changes, and cooking outcomes.
- Dietary and allergen metadata are positive declarations only; missing data is
  unknown.
- Offline comparison, `engineering_validated`, and even a passing adoption
  scorecard are evidence labels, not deployment authorization.
