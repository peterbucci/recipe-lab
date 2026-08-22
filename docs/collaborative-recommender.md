# Offline collaborative recommender

## Purpose and boundary

`collaborative-v1` is a deterministic, user-neighborhood recommender that Recipe
Lab fits and evaluates offline. It tests whether signed interaction patterns add
value beyond both the production `baseline-v1` scorer and the offline
`content-v1` model. It is not imported by FastAPI, is not exposed in the
frontend, does not change the product database, and is never trained or served
in a product request.

The collaborative experiment is opt-in:

```powershell
recipe-lab-eval run `
  --snapshot snapshots/readiness-simulated-v1.json `
  --collaborative `
  --k 1 --k 3 `
  --seed 20260822 `
  --output reports/collaborative-v1.json `
  --strict
```

Without `--collaborative`, `run` retains its existing behavior and evaluates
`content-v1` beside the automatically included `baseline-v1`. With the flag,
the CLI first applies the complete
[collaborative-readiness gate](collaborative-readiness.md). A snapshot that does
not pass is rejected with exit status 3 before any collaborative model is fit
and no evaluation report is written. The separate `readiness` command produces
the aggregate threshold report and failure reasons.

A passing gate authorizes only this offline experiment. It is not a serving,
deployment, or product-quality decision.

## Signed interaction matrix

The model receives only recipe versions available strictly before the snapshot
cutoff and preference events in the training prefix. It uses the same event
state reconstruction and weights as `content-v1`:

| Training signal | Weight |
| --- | ---: |
| Latest save is active | `+3` |
| Latest save is inactive | `-3` |
| Rating `r` | `(r - 3) * 2` |
| Distinct view of a version | `+1` |
| Distinct fork source | `+4` |
| Distinct fork child | `+4` |

Training events are ordered by UTC occurrence time and then event UUID. The
latest save and rating for each profile and exact recipe version wins. Repeated
views collapse by profile and recipe; repeated forks collapse by profile,
source, and child, with one retained fork contributing to both source and child.
Contributions are summed for each profile-version pair and a zero aggregate is
removed. An unobserved version is not treated as negative evidence.

The resulting matrix therefore contains signed, nonzero integer signals. The
readiness report keeps its raw typed-event and observed-pair counts and also
gates this post-aggregation matrix's nonzero pairs and supported profiles/items,
then requires usable nonzero candidate scores for temporal evaluation profiles.
Neither cancellation nor a matrix with no qualifying neighbor overlap can
authorize a content-fallback-only collaborative run.

## User-neighborhood scoring

Let `w(u, i)` be profile `u`'s aggregate signal for recipe version `i`. Two
profiles are eligible neighbors only when they share at least two nonzero
profile-version cells. For target profile `u`, neighbor `v`, and their overlap
`O(u, v)`:

```text
similarity(u, v) =
  sum(w(u, i) * w(v, i) for i in O(u, v))
  / sum(abs(w(u, i) * w(v, i)) for i in O(u, v))
```

The similarity is ignored when the overlap contains fewer than two items, the
signed numerator is zero, or the denominator is zero. Exact rational arithmetic
preserves both positive agreement and negative opposition without floating-point
or input-order drift.

A candidate must have a nonzero aggregate signal from at least three distinct
profiles before it can receive collaborative evidence. For candidate `c`, the
eligible candidate neighbors `N(u, c)`, and neighbor similarity `s(u, v)`:

```text
score(u, c) =
  sum(s(u, v) * w(v, c) for v in N(u, c))
  / sum(abs(s(u, v)) for v in N(u, c))
```

A zero numerator or denominator produces a zero collaborative score. Candidates
are ordered by descending collaborative score and then by their complete
`content-v1` fallback position. The model is closed form: it records the derived
model seed for provenance but does not use randomness.

## Sparse data and fallback

The aggregate RCP-18A readiness gate and prediction-time support rules have
different jobs. The gate decides whether the complete snapshot can support an
experiment; local rules decide whether collaborative evidence is defensible for
one profile or candidate.

- A target profile with fewer than five nonzero signal items uses the complete
  `content-v1` order.
- A candidate supported by fewer than three nonzero-signal profiles receives a
  neutral zero collaborative score and uses `content-v1` within that score group.
- A profile pair with fewer than two overlapping nonzero items is not treated as
  a neighbor.
- A candidate with no effective neighbor evidence receives a zero collaborative
  score.
- Equal collaborative scores, including the neutral fallback group, retain the
  deterministic `content-v1` order.

This keeps every evaluator candidate rankable without inventing collaborative
evidence. `content-v1` in turn provides its documented signed global prior and
stable metadata/UUID ordering for cold start. The mandatory `baseline-v1`
remains a separate report comparator rather than an internal fallback.

## Artifact metadata

Every fitted collaborative model exposes aggregate-only artifact provenance.
The evaluator copies it into the collaborative model's flat `artifact` object
in the canonical report. `baseline-v1` and `content-v1` report `artifact: null`.
The report schema is `recipe-lab-offline-evaluation-report-v2`; the evaluation
protocol remains `fixed-cutoff-full-catalog-v1`.

| Artifact field | Meaning |
| --- | --- |
| `artifact_schema_version` | `recipe-lab-collaborative-artifact-v1` |
| `artifact_version` | Version of the fitted artifact representation |
| `model_id` / `model_version` | Must match the enclosing model result |
| `training_cutoff` | Canonical UTC cutoff for the fitted prefix |
| `derived_seed` | Model-specific seed derived by the evaluator |
| `training_data_sha256` | SHA-256 of the canonical cutoff, available catalog, and training events |
| `recipe_count` / `event_count` / `profile_count` | Aggregate fitted-prefix counts |
| `observed_event_pair_count` | Distinct profile/source-version pairs in typed training events |
| `nonzero_signal_pair_count` | Profile/version cells remaining after signed aggregation |
| `supported_profile_count` | Profiles with at least five nonzero signal items |
| `supported_item_count` | Items with nonzero signals from at least three profiles |

The training fingerprint is computed from identifiers and fitted data, but only
the digest is published. The artifact object contains no recipe titles or raw
recipe, event, or profile IDs. The runner accepts this collaborative-specific
property only, enforces the exact field allowlist and schema version, validates
scalar types, hashes, timestamps, nonnegative/count relationships, and requires
the model ID, model version, cutoff, and `derived_seed` to match the evaluation.
No artifact is loaded by the API or persisted as a serving dependency; the
report is an offline evaluation artifact only.

## Evaluation and interpretation

With `--collaborative`, one canonical report contains `baseline-v1`,
`collaborative-v1`, and `content-v1` in stable model-ID order. Each result
includes Precision@K, Recall@K, NDCG@K, recommendation coverage, and popularity
bias, plus deltas from `baseline-v1`. The content and collaborative raw metrics
share the same snapshot, cutoff, candidate sets, relevance labels, K values, and
metric implementation, so they can be compared directly to test whether
interaction neighborhoods add value beyond structured content.

The RCP-18A fixture has eight available versions and five training items per
profile, leaving three candidates. K values 1 and 3 therefore exercise both top
ranking quality and complete-pool coverage. Repeated runs with equivalent
snapshots, seeds, and K values produce byte-identical reports.

The generated cohort is deliberately balanced and its holdout actions are
deliberately positive. Scores on it verify readiness enforcement, leakage
isolation, ranking, fallback, metrics, metadata, and reproducibility only. They
do not establish real-user lift, statistical significance, generalization,
causality, culinary suitability, or safety. A quality claim about observed
Recipe Lab behavior requires an intentionally captured, privacy-safe snapshot
to pass readiness and produce a reproducible comparison; serving would still
require a separate product and architecture decision.
