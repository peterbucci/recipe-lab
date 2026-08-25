# Offline recommendation evaluation

## Purpose and boundary

Recipe Lab evaluates recommendation approaches against the deterministic
`baseline-v1` before treating a more complex approach as an improvement. The
evaluator is an offline package under `ml/`; it is not imported by FastAPI,
does not run in the request path, and does not persist or deploy a model.

Every run consumes one immutable, versioned JSON snapshot. Local snapshots are
ignored by Git because they contain stable opaque activity IDs. Reports are
also ignored as generated artifacts and can carry caller-supplied dataset
labels and limitation text. Only deliberately synthetic fixtures under
`ml/tests/fixtures/` are committed. One verifies the baseline/content evaluator,
while the event-free readiness catalog drives the deterministic RCP-18A
simulator and gated collaborative and hybrid experiments. These fixtures verify
engineering contracts; their status and scores are not evidence about product
quality or real people. See
[collaborative-filtering data readiness](collaborative-readiness.md) for the
simulator and gate, and the
[offline collaborative recommender](collaborative-recommender.md) for the
neighborhood model contract, and the
[offline hybrid recommender](hybrid-recommender.md) for rank fusion and the
adoption scorecard. A separate synthetic benchmark exercises the offline
substitution rules; it does not use this snapshot or recommendation protocol.
See the [offline substitution rules engine](substitution-engine.md).

## Snapshot contract

The `recipe-lab-evaluation-snapshot-v2` format contains:

- a dataset ID, one explicit UTC cutoff, and stated limitations;
- recipe-version IDs, creation times, titles, version numbers, and one structured
  record per authored ingredient occurrence; each record carries its canonical
  ingredient identity, exact/range/qualitative kind, decimal bounds, curated
  measurement-unit identity, optional reviewed package-size identity, and any
  qualitative value; and
- typed view, save, rating, and fork events with opaque event and profile IDs.

The extractor reads a repeatable PostgreSQL snapshot and omits names, email
addresses, IP addresses, user agents, referrers, search text, fork request
fingerprints, and free-form event context. Recipe and event arrays are
canonicalized before hashing; ingredient occurrences retain authored order.
Equivalent recipe/event ordering and JSON formatting yield the same snapshot
fingerprint, while any measure-only change changes it.

Snapshot v2 deliberately does not export instruction prose or structured
cooking actions. Adding action types, occurrence inputs, order, duration, or
temperature would change the identifying input and therefore requires a new
snapshot schema and fingerprint contract. Existing v2 snapshots and reports
must not be reinterpreted. No current offline model consumes action data; see
[structured cooking actions](cooking-actions.md) for the future-version
boundary.

The reader deliberately accepts v1 snapshots for historical evaluation. Their
distinct ingredient IDs remain available only through an explicit legacy-ID
fallback; they do not become fabricated qualitative measures. New exports and
programmatically created snapshots are always v2, and creating v2 data from
legacy ID-only recipes is refused with a recapture instruction.

The evaluator never reads the mutable `recipe_saves` or `recipe_ratings` tables
for a historical run. Their present state cannot describe what was known at an
older cutoff. Instead, it reconstructs save and rating state from the
append-only preference events that existed before the cutoff.

## Leakage-safe split

The protocol is `fixed-cutoff-full-catalog-v1`:

1. Recipe versions with `created_at < cutoff` are available.
2. Events with `occurred_at < cutoff` are training data.
3. Events with `occurred_at >= cutoff` are held-out labels or context.
4. A model receives only the available catalog and training events. Held-out
   events and relevance labels remain inside the evaluator.
5. Each profile's candidates are all available versions minus every exact
   version it interacted with before the cutoff, including a fork's source and
   child. There is no negative sampling.

The strict inequalities keep a recipe or event exactly at the cutoff out of
training. Event order is deterministic by UTC timestamp and event UUID, which
also defines the latest save or rating when timestamps tie.

## Relevance

Relevance is binary at the exact recipe-version level. A held-out version is
relevant when the final held-out save state is true, the final held-out rating
is at least four, or a fork event names it as the source. Views provide training
context but are not positive labels. Save false and ratings below four do not
create relevance.

Repeated signals collapse to one profile/version label. Labels for recipes
unavailable at the cutoff or already interacted with during training are
filtered and counted in the report rather than silently treated as misses.
Unobserved recipes are not asserted to be negative.

## Metrics

For profile `u`, let `C_u` be its complete candidate set, `R_u` its eligible
relevant set, `k_u = min(K, |C_u|)`, `L_u` the first `k_u` recommendations, and
`H_u = |L_u intersection R_u|`.

```text
Precision@K_u = H_u / k_u
Recall@K_u    = H_u / |R_u|
DCG@K_u       = sum(rel_j / log2(j + 1)) for j = 1..k_u
NDCG@K_u      = DCG@K_u / ideal_DCG@K_u
```

Precision, recall, and binary NDCG are macro-averaged across profiles with at
least one candidate and one eligible relevant item. Coverage is the union of
recommended recipe IDs divided by the union of candidate IDs.

Popularity uses training data only. An item's support is the number of distinct
profiles with any typed training interaction that references it, normalized by
the largest support count. The report includes the macro mean popularity of
recommended items, the macro mean popularity of each profile's candidate pool,
and:

```text
popularity_bias = recommended_popularity - candidate_popularity
```

A positive value means the recommendations skew more popular than the catalog
available to those profiles. Reports include both the signed delta from
`baseline-v1` and the improvement in absolute bias; neither direction is
described as universally better without product context.

All published metric values use six decimal places with `ROUND_HALF_UP`.

## Baseline and model protocol

`baseline-v1` is mandatory and is added automatically to every evaluation. Its
offline adapter reconstructs point-in-time saves, ratings, views, and forks,
then calls the same database-free scorer used by the production recommendation
API. A model adapter receives only training data, a derived seed, a profile ID,
and the complete ordered candidate IDs. It must return unique candidate IDs and
cannot see held-out labels.

Each non-baseline result reports raw metrics and deltas from the baseline at the
same K. Model IDs are unique, and `baseline-v1` is reserved so a comparison
cannot replace the reference implementation accidentally.

The `recipe-lab-eval run` command supplies the built-in `content-v1` model on
every run, while the evaluator adds `baseline-v1`; default CLI reports therefore
contain both in stable model-ID order. `run --collaborative` first requires the
snapshot to pass the complete collaborative-readiness gate, then also supplies
`collaborative-v1`. A failed gate exits 3 before fitting and does not write an
evaluation report. A successful report contains `baseline-v1`,
`collaborative-v1`, and `content-v1` in model-ID order.

`run --hybrid` is mutually exclusive with `run --collaborative`. It applies the
same readiness gate, then supplies the collaborative, content, and hybrid
adapters together; the runner adds the baseline. The resulting stable order is
`baseline-v1`, `collaborative-v1`, `content-v1`, and `hybrid-v1`. All four use
one split and metric implementation. A failed gate exits 3 before fitting and
does not create or replace the requested report.

The generic Python `evaluate()` API adds only the baseline automatically, so
callers must explicitly pass `ContentBasedV1Model()`, `CollaborativeV1Model()`,
`HybridV1Model()`, or another comparison adapter. The evaluator applies the same
complete readiness gate whenever `collaborative-v1` or `hybrid-v1` is present.
When hybrid is present, content and collaborative must also be present; a
hybrid-only call is rejected rather than publishing an incomplete comparison.
Directly fitting an adapter remains
useful only for focused model tests and is not a qualifying RCP-18 experiment;
the full gate requires holdout data that the leakage-safe `fit()` protocol does
not receive. The content model is documented
in [offline content recommender](content-recommender.md), and the signed
user-neighborhood and sparse fallback are documented in
[offline collaborative recommender](collaborative-recommender.md). Rank fusion,
explanation routes, and adoption are documented in
[offline hybrid recommender](hybrid-recommender.md).

## Reproducibility and reports

The default run seed is `20260821`. Each model receives an independent seed
derived with SHA-256 from that run seed and model ID, so adding or reordering a
model cannot change another model's random stream. `content-v1` is closed-form
and accepts but does not consume its derived seed; exact rational arithmetic and
fixed tie-breaks make its fit and ranking independent of input order and seed.
`collaborative-v1` is also closed-form and records but does not consume its
derived seed. It uses exact rational similarity and scoring, sorted state, and
the content fallback order. `hybrid-v1` is closed-form exact-rational rank
fusion. It derives isolated component seeds from its independent model seed;
the current closed-form components record or accept those seeds without random
sampling.

Reports contain the protocol and schema versions, deterministic run ID,
snapshot fingerprint and cutoff, seed, K values, split/filter counts, model
versions and parameter hashes, metrics, baseline deltas, warnings, and dataset
limitations. Canonical JSON uses sorted keys, stable ordering, and a trailing
newline. It intentionally omits wall-clock generation times, durations, host
paths, and raw event/profile IDs; identical inputs produce byte-identical
reports.

Report schema `recipe-lab-offline-evaluation-report-v3` retains the per-model
`artifact` value introduced in v2 without changing the
`fixed-cutoff-full-catalog-v1` evaluation protocol. The value is null for
baseline, content, and hybrid models. The collaborative
object is flat and records its artifact/model versions, training cutoff,
`derived_seed`, canonical training-data digest, and aggregate fitted-prefix and
support counts. The runner validates the artifact's model ID, model version, and
derived seed.
Only a digest of the identifying fitted input is published; the report contains
no raw recipe, event, or profile IDs. See the
[collaborative artifact contract](collaborative-recommender.md#artifact-metadata)
for the complete field list.

Schema v3 adds top-level `hybrid_adoption`, which is null unless the complete
hybrid suite is present. A non-null decision records the policy version, status,
hybrid candidate and simpler reference IDs, primary K, evaluated-profile count,
primary NDCG lift, worst all-K NDCG/recall/coverage deltas, stable reason codes,
policy thresholds, and per-K aggregate comparisons. It contains no candidate,
recipe, event, profile, or neighbor identifiers. The policy requires at least
40 evaluated profiles, primary-K NDCG lift of at least `0.010000`, no NDCG or
recall regression at any K, and no coverage regression below `-0.050000` at any
K. Incomplete, missing-metric, and identified synthetic runs retain the simpler
model. A `retain_simpler` decision is a successful complete evaluation and does
not change the CLI exit status or deploy anything.

When no profile has an eligible held-out label and candidate, the command still
writes a valid `insufficient_data` report with null metrics and diagnostic
reason codes. That is more honest than a zero score. Insufficient data exits
successfully by default so the offline package cannot block the product; the
explicit `--strict` option is available for evaluation-only automation.

This evaluation insufficiency status is narrower than the collaborative-data
readiness gate. `recipe-lab-eval readiness` additionally checks aggregate
profile, item, typed-event, distinct matrix-cell, effective signed-signal
support, usable candidate-level collaborative evidence, and temporal counts
before the collaborative or hybrid experiment runs. It uses the same cutoff and
eligible-label semantics. It does not fit a model, rank recommendations, or
compute quality metrics; it only verifies that nonzero collaborative candidate
evidence exists.
Its aggregate report
intentionally omits caller-controlled dataset labels, snapshot limitation text,
recipe titles, and raw IDs. `run --collaborative` and `run --hybrid` apply this
gate regardless of the run command's `--strict` setting; `--strict` retains its
separate meaning for an evaluation report that is insufficient under the core
split.

## Separate substitution-rules benchmark

`recipe-lab-eval substitution-run` evaluates `substitution-rules-v1` under the
separate `curated-direct-rules-benchmark-v1` protocol. A substitution benchmark
contains a versioned synthetic ingredient catalog, curated directed edges,
recipe contexts, stated limitations, and cases with constraints, explicit
preference weights, and expected rankings. It contains no profile events,
temporal cutoff, train/holdout split, recommendation impressions, or model
adoption decision.

The rules engine applies required dietary flags and excluded declared allergens
as hard filters before ordering eligible direct edges. Its benchmark reports
exact-ranking/top-one accuracy, expected-candidate recall, empty-result
accuracy, direct-edge precision, declared-constraint compliance, and coverage
for ratio-or-guidance, provenance-or-confidence, explanations, and exact
caution text. These metrics verify the stated synthetic cases; they do not
measure culinary quality, exposure, user preference, nutrition, cross-contact,
or medical suitability. Relationship confidence describes curation of an edge,
not medical, allergen, or food-safety confidence.

The canonical substitution report uses schema
`recipe-lab-substitution-evaluation-report-v1`. It records the benchmark digest,
deterministic run ID, aggregate counts and metrics, rules strategy, status,
reason codes, limitations, and `learned_ranking_attempted: false`. It omits
ingredient, relationship, recipe-context, and case IDs and names. Like the
aggregate collaborative-readiness report, it does not copy caller-supplied
benchmark IDs or limitation text into the report; those values remain covered
by the benchmark fingerprint. Published limitations are fixed by the evaluator.

Status `engineering_validated` means the deterministic rules exactly satisfied
the committed engineering cases and completeness checks. It is not a model
quality or production-readiness result. Status is `invalid` for a completed
benchmark that violates the contract and `insufficient_data` when no meaningful
nonempty case exists. The default command writes any valid report and exits
zero; `--strict` writes the same report and exits 3 unless engineering validation
passes. Invalid benchmark syntax or configuration exits 2.

The full candidate, ordering, caution, and metric definitions are documented in
[offline substitution rules engine](substitution-engine.md).

## Separate recipe-duplicate benchmark

`recipe-lab-eval duplicate-run` evaluates the production
`duplicate-candidate-similarity-v1` scorer against a separate labeled
synthetic recipe-pair fixture. It does not reuse the recommendation snapshot,
temporal split, substitution catalog, member events, or model-adoption policy.
Each synthetic record keeps instruction prose and authored ingredient source
labels outside its canonical `RecipeStructure`. The paraphrase case uses
different prose and identical structure; the alias case uses different source
labels for the same canonical ingredient identities. Category-specific fixture
validation rejects pairs that do not actually contain their claimed unit,
ingredient-order, proportional-quantity, action-type, action-order, duration,
temperature, or adversarial perturbation. Cases carry expected
`exact_duplicate`, `probable_duplicate`, or `distinct` labels plus explicit
scorer-component relations and ordered reason codes.

The canonical `recipe-lab-duplicate-evaluation-report-v1` report identifies the
`labeled-structural-pair-evaluation-v1` protocol, benchmark SHA-256, scorer and
fingerprint versions, parameter SHA, fixed work limits, threshold, weights and
subweights, three-class confusion counts, positive precision and recall,
three-class accuracy, evaluated/category/component-expectation/explanation coverage, and
sorted classification, component, explanation, false-positive, and
false-negative categories. It declares `advisory_only: true` and
`learned_classifier_attempted: false`. Raw recipe IDs, user IDs, prose, and
caller-supplied labels are absent from the aggregate report.

Status `engineering_validated` requires every expected classification,
component relation, and ordered explanation contract to match, with every
required fixture category semantically exercised. The fixed limitations state
that this is a small hand-authored synthetic fixture without human adjudication,
confidence intervals, user outcomes, or a learned classifier. Even perfect
metrics cannot justify a publication block, plagiarism claim, or
culinary-identity claim. See
[recipe duplicate-candidate preflight](duplicate-detection.md) for the product
contract and scoring formula.

## Known limitations

- The bundled product seed has no preference events, so it cannot establish
  recommendation quality by itself.
- Historical Demo Cook activity can combine multiple visitors and is not a
  coherent account-level profile. It must remain labeled legacy/demo evidence
  rather than being transferred to or interpreted as a member's history.
- Persistent browser and developer activity can pollute a live demo database;
  capture from an intentionally selected database and preserve the resulting
  snapshot as an immutable run input.
- There are no recommendation impressions or randomized exposures, so
  unobserved recipes are not reliable negatives and offline scores are not
  causal estimates.
- Pre-RCP-14 activity has no event backfill, and mutable current-state tables
  cannot reconstruct it.
- The catalog and synthetic fixture are small. Results do not support
  statistical significance, generalization, or deployment claims.
- The RCP-18A generated cohort uses balanced exposure and deliberately positive
  holdout actions. A ready result for it validates only the offline engineering
  data contract; it does not show that observed Recipe Lab activity is ready or
  that collaborative or hybrid ranking will improve recommendations. The hybrid
  adoption policy explicitly forces this synthetic evidence to retain the
  simpler model.
- Exact-version relevance does not yet measure lineage quality, substitution
  usefulness, nutrition, safety, or cooking outcomes.
- The substitution benchmark is synthetic, and the live demo catalog currently
  has only one outgoing candidate per substitution source; its perfect fixture
  metrics do not establish ranking quality or usefulness.
- Substitution dietary/allergen tags are positive declarations only. Missing
  metadata remains unknown, and declared-tag compliance is not evidence of
  product-label accuracy, cross-contact safety, or medical suitability.

The recommendation limitations must travel with every snapshot and report. The
substitution report instead publishes its fixed evaluator limitations and keeps
caller-supplied benchmark text fingerprint-only. The offline `content-v1`,
`collaborative-v1`, and `hybrid-v1` implementations are comparison experiments,
not deployment decisions. Their quality must be read from the same report. Even
an `adopt_hybrid` offline scorecard result only says that one snapshot cleared
the documented guardrails; serving remains a separate milestone requiring
reproducible observed-data and online evidence.
