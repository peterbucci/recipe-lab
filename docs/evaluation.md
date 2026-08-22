# Offline recommendation evaluation

## Purpose and boundary

Recipe Lab evaluates recommendation approaches against the deterministic
`baseline-v1` before treating a more complex approach as an improvement. The
evaluator is an offline package under `ml/`; it is not imported by FastAPI,
does not run in the request path, and does not persist or deploy a model.

Every run consumes one immutable, versioned JSON snapshot. Local snapshots are
ignored by Git because they contain stable opaque activity IDs. Reports are
also ignored as generated artifacts and can carry caller-supplied dataset
labels and limitation text. Only the deliberately synthetic fixture under
`ml/tests/fixtures/` is committed. That fixture verifies the harness; its scores
are not evidence about product quality or real people.

## Snapshot contract

The `recipe-lab-evaluation-snapshot-v1` format contains:

- a dataset ID, one explicit UTC cutoff, and stated limitations;
- recipe-version IDs, creation times, titles, version numbers, and distinct
  canonical ingredient IDs; and
- typed view, save, rating, and fork events with opaque event and profile IDs.

The extractor reads a repeatable PostgreSQL snapshot and omits names, email
addresses, IP addresses, user agents, referrers, search text, fork request
fingerprints, and free-form event context. Recipe and event arrays are
canonicalized before hashing, so equivalent ordering and JSON formatting yield
the same snapshot fingerprint.

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
every run, while the evaluator adds `baseline-v1`; CLI reports therefore always
contain both in stable model-ID order. The generic Python `evaluate()` API adds
only the baseline automatically, so callers must explicitly pass
`ContentBasedV1Model()` or another comparison adapter. The exact structured
features, signed preference profile, similarity formula, and cold-start order
for `content-v1` are documented in
[offline content recommender](content-recommender.md).

## Reproducibility and reports

The default run seed is `20260821`. Each model receives an independent seed
derived with SHA-256 from that run seed and model ID, so adding or reordering a
model cannot change another model's random stream. `content-v1` is closed-form
and accepts but does not consume its derived seed; exact rational arithmetic and
fixed tie-breaks make its fit and ranking independent of input order and seed.

Reports contain the protocol and schema versions, deterministic run ID,
snapshot fingerprint and cutoff, seed, K values, split/filter counts, model
versions and parameter hashes, metrics, baseline deltas, warnings, and dataset
limitations. Canonical JSON uses sorted keys, stable ordering, and a trailing
newline. It intentionally omits wall-clock generation times, durations, host
paths, and raw event/profile IDs; identical inputs produce byte-identical
reports.

When no profile has an eligible held-out label and candidate, the command still
writes a valid `insufficient_data` report with null metrics and diagnostic
reason codes. That is more honest than a zero score. Insufficient data exits
successfully by default so the offline package cannot block the product; the
explicit `--strict` option is available for evaluation-only automation.

## Known limitations

- The bundled product seed has no preference events, so it cannot establish
  recommendation quality by itself.
- The current shared demo identity can combine multiple visitors and is not a
  coherent account-level profile.
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
- Exact-version relevance does not yet measure lineage quality, substitution
  usefulness, nutrition, safety, or cooking outcomes.

These limitations must travel with every snapshot and report. The offline
`content-v1` implementation is a comparison experiment, not a deployment
decision. It should be considered for a separate serving milestone only after
reproducible reports on suitable data show a useful improvement over the
baseline under this protocol.
