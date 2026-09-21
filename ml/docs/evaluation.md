# Offline evaluation contract

## Scope and evidence boundary

Recipe Lab uses this package to test deterministic ranking and scoring behavior
against immutable inputs. It is an offline engineering harness, not a training
or deployment system. It is not imported by FastAPI, does not run in product
requests, does not create a frontend surface, and does not persist a serving
model.

Synthetic fixtures can prove leakage isolation, formula implementation,
reporting, and reproducibility. They cannot prove real-user relevance, causal
lift, culinary value, safety, or production readiness. A `ready`, `complete`,
`engineering_validated`, or `adopt_hybrid` label has only the versioned meaning
defined here; none authorizes shipping.

Model formulas are documented in [Models and deterministic scorers](models.md).

## Evaluation surfaces

| Command | Input | Result |
| --- | --- | --- |
| `snapshot` | Intentionally selected PostgreSQL database | Privacy-minimized, point-in-time recommendation snapshot |
| `simulate` | Event-free catalog snapshot | Deterministic synthetic preference cohort |
| `readiness` | Recommendation snapshot | Aggregate collaborative-support gate |
| `run` | Recommendation snapshot | Fixed-cutoff ranking comparison |
| `substitution-run` | Synthetic substitution benchmark | Aggregate rules-engine validation |
| `duplicate-run` | Synthetic labeled recipe-pair benchmark | Aggregate production-scorer validation |

The substitution and duplicate benchmarks are independent of the recommendation
snapshot, temporal split, relevance labels, and hybrid-adoption policy.

## Snapshot and privacy contract

The governed PostgreSQL exporter writes
`recipe-lab-evaluation-snapshot-v3` inside one repeatable-read transaction. It
records:

- a dataset ID, one explicit UTC cutoff, and stated limitations;
- opaque stable-recipe and exact-version IDs, edition and direct-base identity,
  derived original/adaptation/revision topology, optional weak author-declared
  revision reason, creation/publication time, title, and structural-fingerprint
  version/digest metadata;
- occurrence-preserving canonical ingredient identity with
  exact/range/qualitative measure shape, decimal bounds, curated unit identity,
  and optional reviewed package identity; and
- typed view, save, rating, and fork events with opaque event/profile IDs.

Only currently published versions are exported. A version published by the
cutoff must also have been published under its latest audited visibility at
that boundary. Later versions may remain as referential or holdout context but
cannot enter the frozen training catalog. Fork events remain adaptation signals
only when the exact child is an eligible adaptation of the exact source;
same-recipe revisions are never recast as forks.

The export omits names, email addresses, IP addresses, user agents, referrers,
search text, request fingerprints, canonical fingerprint payloads, instruction
prose, cooking-action graphs, and free-form event context. Authored ingredient
display text is also omitted. Opaque IDs are retained only where needed to
reconstruct event state and exact-version topology.

The reader still accepts snapshot v1 and v2 for historical runs. Legacy IDs do
not become fabricated measures, and old files are never reinterpreted as v3.
Creating a structured snapshot from ID-only legacy recipes is refused with a
recapture instruction.

Local snapshots and generated reports are ignored by Git, but ignored does not
mean retained indefinitely. The `snapshot` command is a disposable local tool,
not a production export path. Capturing production or real-member data is
prohibited until an artifact registry can bind every derived artifact to
account deletion and bounded expiry. Delete local observed-data snapshots and
reports after use; only deliberately synthetic fixtures may be committed. See
[account deletion and retained history](../../docs/security.md#account-deletion-and-retained-history).

Snapshot JSON is limited to 512 MiB, 32 nesting levels, and 16 million nodes.
Substitution and duplicate benchmarks are each limited to 32 MiB, 32 levels,
and one million nodes. The shared codec rejects duplicate keys before domain
validation.

## Leakage-safe temporal split

The recommendation protocol is `fixed-cutoff-full-catalog-v1`:

1. A recipe must have `created_at < cutoff`; snapshots carrying publication
   time also require `published_at < cutoff`.
2. Events with `occurred_at < cutoff` are training data.
3. Events with `occurred_at >= cutoff` are holdout labels or context.
4. Models receive only the available catalog and training events.
5. A profile's candidate set is every available exact version minus every
   exact version it touched before the cutoff, including both sides of a fork.
6. There is no negative sampling.

The inequalities are strict. A recipe or event exactly at the cutoff stays out
of training. Timestamp and event UUID define deterministic event order and the
latest save/rating state when timestamps tie.

### Relevance

Relevance is binary at the exact-version level. A held-out version is relevant
when its final held-out save state is true, its final held-out rating is at
least four, or a fork names it as the source. Views are context rather than
positive labels; save false and ratings below four do not create relevance.

Repeated signals collapse to one profile/version label. Labels unavailable at
the cutoff or already used in training are filtered and counted instead of
silently becoming misses. Unobserved versions are not asserted to be negative.

## Recommendation metrics

For profile `u`, let `C_u` be the complete candidate set, `R_u` its eligible
relevant set, `k_u = min(K, |C_u|)`, `L_u` the first `k_u` ranked items, and
`H_u = |L_u intersection R_u|`.

```text
Precision@K_u = H_u / k_u
Recall@K_u    = H_u / |R_u|
DCG@K_u       = sum(rel_j / log2(j + 1)) for j = 1..k_u
NDCG@K_u      = DCG@K_u / ideal_DCG@K_u
```

Precision, recall, and binary NDCG are macro-averaged over profiles having at
least one candidate and one eligible relevant item. Coverage is the union of
recommended exact-version IDs divided by the union of candidate IDs.

Training popularity for an item is its number of distinct interacting
profiles, divided by the maximum such count in the training prefix. The report
publishes mean recommended popularity, mean candidate-pool popularity, and:

```text
popularity_bias = recommended_popularity - candidate_popularity
```

A positive value means the recommendation list is more popular than the pool
available to those profiles. Reports include signed deltas from `baseline-v1`
and improvement in absolute popularity bias; neither direction is universally
better without product context. Published metric values use six decimal places
and `ROUND_HALF_UP`.

No eligible profile produces an `insufficient_data` report with null metrics,
not invented zero scores.

## Recommendation suites

The CLI and Python API deliberately differ:

- `recipe-lab-eval run` compares `baseline-v1` with `content-v1`.
- `run --collaborative` evaluates `baseline-v1`, `collaborative-v1`, and
  `content-v1` after the complete readiness gate.
- `run --hybrid` evaluates `baseline-v1`, `collaborative-v1`, `content-v1`, and
  `hybrid-v1` after the same gate. It is mutually exclusive with
  `--collaborative`.
- The Python `evaluate()` function adds only `baseline-v1`; callers explicitly
  provide other adapters. A hybrid call must also include content and
  collaborative comparators.

Every model in one report uses the same snapshot, split, cases, K values, and
metric implementation. Models appear in stable model-ID order. A failed
collaborative gate exits 3 before fitting and does not create or replace an
evaluation report, regardless of `run --strict`.

## Collaborative-data readiness

Readiness protocol `fixed-cutoff-collaborative-readiness-v2` asks whether a
snapshot has enough effective structure to run a collaborative-dependent
experiment. It does not fit or score a model and does not measure quality.

| Check | Minimum | Definition |
| --- | ---: | --- |
| Training profiles | 50 | Profiles with a pre-cutoff event |
| Available items | 8 | Exact versions available before the cutoff |
| Training events | 500 | Typed pre-cutoff event rows |
| Supported profiles | 40 | Profiles with at least 5 distinct training items |
| Supported items | 8 | Items observed from at least 3 training profiles |
| Observed training pairs | 200 | Distinct training profile/source-version cells |
| Nonzero signal pairs | 200 | Cells remaining after signed aggregation |
| Signal-supported profiles | 40 | Profiles with at least 5 nonzero signal items |
| Signal-supported items | 8 | Items with nonzero signals from at least 3 profiles |
| Temporal evaluation profiles | 20 | Profiles with usable collaborative candidate evidence |
| Temporal relevant items | 20 | Eligible unseen positives for those profiles |

Usable candidate evidence also applies the model's local minimums: five target
signal items, three supporting profiles per item, and two shared items per
neighbor. This prevents raw event volume, duplicated rows, cancelled signals,
or a dense but non-overlapping matrix from passing while every prediction falls
back to content.

Every check records actual value, minimum, pass state, and a stable failure
reason. The overall status is `ready` only when all checks pass. The aggregate
report contains snapshot schema, digest, cutoff, thresholds, counts, density,
sparsity, and fixed limitations; it excludes caller-controlled dataset labels,
snapshot limitation prose, titles, and raw IDs.

By default an insufficient readiness report is written and exits zero. With
`--strict`, the same report is written and exits 3.

### Synthetic readiness cohort

The committed `readiness_catalog_v2.json` fixture has eight invented recipe
versions and no events. The simulator refuses catalogs that already contain
events. Its defaults create 64 opaque profiles, five distinct training items
and two unseen holdout items per profile, a view plus save or rating for every
selected item, a 28-day training window, and a seven-day holdout window.

The result contains 640 training events, 256 holdout events, 320 distinct
training pairs, and 128 eligible relevant holdout items. Exposure is balanced
and holdout actions are deliberately positive. The seed, canonical catalog
fingerprint, and configuration determine all generated IDs, timestamps,
ordering, and dataset identity. This cohort verifies engineering paths; it does
not imitate people.

## Hybrid adoption guard

Report v3 adds `hybrid_adoption` for the complete hybrid suite. The primary K
is the largest requested cutoff. At each K, the reference is the simpler model
with the highest NDCG; exact ties prefer baseline, then content, then
collaborative.

`hybrid-v1` can receive `adopt_hybrid` only when:

- the report is complete and the primary K evaluates at least 40 profiles;
- primary-K NDCG lift is at least `0.010000`;
- NDCG and recall do not regress at any K; and
- coverage is no worse than `-0.050000` at any K.

Missing metrics, incomplete model sets, or mismatched support retain the simpler
model. A snapshot containing the complete simulator-assumption set is also
forced to `retain_simpler`, independent of its scores.

On the fixed cohort, hybrid NDCG is `0.718750` at K=1 and `0.887435` at K=3.
The primary-K gain over `content-v1` is `0.001028`, below the minimum, so the
policy retains content; synthetic provenance independently bars adoption. This
result must not be tuned into an artificial win. Adoption status neither
changes the CLI exit code nor deploys anything.

## Substitution benchmark

`substitution-run` uses schema `recipe-lab-substitution-benchmark-v1` and
protocol `curated-direct-rules-benchmark-v1`. It has no temporal split, profile
events, impression data, or model-adoption decision.

The aggregate report publishes exact-ranking and top-one accuracy,
expected-candidate recall, empty-result accuracy, direct-edge precision,
declared-constraint compliance, and coverage for ratio-or-guidance,
provenance-or-confidence, explanations, and exact caution text.

`engineering_validated` requires meaningful nonempty cases, exact expected
ordering, complete retrieval, direct outputs only, no declared-tag violations,
complete required fields and explanations, exact caution text, and correct
empty results. Other valid outcomes are `invalid` or `insufficient_data` with
stable reason codes. The report declares `learned_ranking_attempted: false` and
omits ingredient, relationship, recipe-context, and case IDs/names.

The committed six-case fixture validates deterministic rule execution and
reporting only. It does not measure taste, texture, conversion correctness,
cooking success, nutrition, cross-contact, or medical suitability.

## Duplicate-candidate benchmark

`duplicate-run` uses protocol `labeled-structural-pair-evaluation-v1` and
imports the production structural fingerprint builder and scorer. Cases have
expected `exact_duplicate`, `probable_duplicate`, or `distinct` labels plus
component relations and ordered reason codes. Category validation verifies the
claimed unit, reorder, quantity-scale, action, duration, temperature, or
adversarial perturbation rather than trusting a label.

The report publishes three-class confusion counts and accuracy, positive-class
precision and recall (exact and probable are positive), evaluated/category/
component/explanation coverage, scorer and fingerprint versions, parameter
hash, threshold, weights, work limits, and aggregate error categories. It
declares `advisory_only: true` and `learned_classifier_attempted: false`; raw
recipe IDs, profile IDs, prose, and caller-supplied labels are absent.

`engineering_validated` requires every classification, component relation,
ordered explanation, and required category to match. The benchmark is small,
synthetic, and lacks independent human adjudication or confidence intervals.
Perfect metrics cannot justify blocking publication, merging recipes,
plagiarism claims, or claims of culinary identity.

## Reproducibility and artifacts

The default recommendation run seed is `20260821`; the simulator default is
`20260822`. For root seed `s` and model ID `m`, the runner derives an isolated
unsigned 64-bit seed from the first eight bytes of:

```text
SHA-256(str(s) + NUL + m)
```

Adding or reordering one model therefore cannot change another model's random
stream. The current built-ins are closed form: content and collaborative record
or accept their seed without sampling, and hybrid derives isolated component
seeds. Exact rational arithmetic, deterministic decimal quantization, canonical
event state, sorted set-like inputs, and stable tie-breaks prevent input-order
and Python-hash drift.

Recommendation reports use schema
`recipe-lab-offline-evaluation-report-v3`. They include protocol/schema
versions, deterministic run ID, snapshot digest and cutoff, seed and K values,
split/filter counts, model versions and parameter hashes, metrics, baseline
deltas, warnings, limitations, aggregate collaborative artifact metadata, and
the optional hybrid decision.

Readiness, recommendation, substitution, and duplicate reports use the same
sorted, newline-terminated canonical JSON envelope. Wall-clock generation time,
durations, host paths, and raw event/profile identifiers are excluded. With
equivalent normalized inputs, configuration, and code versions, report bytes
are identical.

## Status and exit behavior

| Situation | Default | `--strict` |
| --- | --- | --- |
| Recommendation split has no evaluable profiles | Write `insufficient_data`, exit 0 | Write the same report, exit 3 |
| Readiness gate is insufficient | Write `insufficient_data`, exit 0 | Write the same report, exit 3 |
| `run --collaborative` or `run --hybrid` gate fails | Exit 3 before fitting; no report written | Same |
| Substitution or duplicate benchmark is valid but not `engineering_validated` | Write report, exit 0 | Write the same report, exit 3 |
| Invalid input/configuration | Exit 2 | Exit 2 |
| Read/write or snapshot-export failure | Exit 1 | Exit 1 |

Retaining a simpler hybrid model is a successful completed evaluation and does
not fail strict mode.

## Limitations that travel with interpretation

- The bundled product seed has no preference events and cannot establish
  recommendation quality.
- Shared Demo Cook history may combine unrelated visitors and is not a coherent
  account-level profile.
- Persistent local browser/developer activity can contaminate a database; use
  an intentionally selected source and immutable snapshot.
- No recommendation-impression or randomized-exposure log exists. Unseen items
  are not reliable negatives, and results are not causal estimates.
- Mutable current save/rating tables cannot reconstruct historical state;
  append-only events begin only after their feature introduction.
- Exact-version relevance does not measure lineage quality, substitution
  usefulness, nutrition, safety, or cooking outcomes.
- The catalog, fixtures, and observed cohort are too small for significance,
  generalization, or deployment claims.
- The simulated cohort is intentionally balanced with positive holdout actions;
  readiness and scores on it are engineering evidence only.
- Substitution metadata is incomplete positive declaration, not proof of
  suitability or cross-contact safety; its benchmark has only synthetic cases
  and the live demo catalog has one outgoing candidate per source.
- The duplicate fixture is hand-authored and advisory, with no prevalence
  estimate, human adjudication, user outcome, or learned-classifier evidence.

Every result must be read beside its snapshot or fixed evaluator limitations.
Observed-data reproducibility and an online experiment would still precede any
serving decision; privacy review, artifact lifecycle, monitoring, API design,
and frontend presentation remain separate product work.
