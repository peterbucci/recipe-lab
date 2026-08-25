# Recipe Lab offline evaluation

This Python package fits and evaluates Recipe Lab's deterministic offline
`content-v1`, readiness-gated `collaborative-v1`, and explicit rank-fusion
`hybrid-v1` recommenders against the mandatory `baseline-v1`. It also provides
a versioned synthetic cohort, a structural readiness gate, and a conservative
hybrid-adoption scorecard. The package separately evaluates the deterministic
`substitution-rules-v1` engine against a versioned direct-edge benchmark before
any learned substitution ranking is attempted. It also evaluates the production,
explainable duplicate-candidate scorer without training a classifier. The package
is deliberately separate from the FastAPI request path, persists no serving model,
and has no serving responsibility. Canonical reports carry aggregate evaluation
and provenance only.

## Install

Install the local backend package so the evaluator and production API share the
same pure baseline scorer:

```powershell
cd ml
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ../backend -e ".[dev]"
```

## Verify collaborative-filtering data readiness

Generate the fixed engineering cohort from the committed, event-free catalog
and assess it without touching a live database:

```powershell
recipe-lab-eval simulate `
  --catalog tests/fixtures/readiness_catalog_v2.json `
  --profiles 64 --seed 20260822 `
  --output snapshots/readiness-simulated-v1.json

recipe-lab-eval readiness `
  --snapshot snapshots/readiness-simulated-v1.json `
  --output reports/readiness-v2.json `
  --strict
```

The simulator emits only opaque profile/event IDs and typed view, save, and
rating context. It refuses catalogs with recorded activity and omits fork events
because the snapshot has no lineage contract. The default cohort deterministically
produces 640 training events across 64 profiles and 320 distinct profile-item
pairs, plus 64 supported temporal profiles and 128 eligible holdout items.

The readiness report checks fixed minimums for profile, item, interaction,
raw matrix support, effective nonzero signed support, sparsity, usable
candidate-level neighbor evidence, and temporal-evaluation counts. `ready` for
this synthetic cohort authorizes only fitting and testing the offline
collaborative and hybrid experiments; it is not evidence about real users,
recommendation quality, or production readiness. For an insufficient snapshot,
the default command still writes an `insufficient_data` report and exits zero;
`--strict` exits 3 after writing that same report. See
[collaborative-filtering data readiness](../docs/collaborative-readiness.md) for
the exact thresholds, assumptions, privacy rules, and proceed condition.

## Run the synthetic verification snapshot

```powershell
recipe-lab-eval run `
  --snapshot tests/fixtures/synthetic_snapshot_v2.json `
  --k 5 --k 10 `
  --seed 20260821 `
  --output reports/synthetic-report.json
```

The fixture contains only invented recipes, opaque UUIDs, and synthetic typed
events. The command always evaluates `content-v1`; the runner automatically
adds `baseline-v1` and records metrics and deltas for both. The fixture verifies
temporal isolation, metric arithmetic, baseline comparison, and byte-for-byte
reproducibility. It is not a benchmark or evidence about real users.

## Run the gated collaborative experiment

Use the ready simulated snapshot from above:

```powershell
recipe-lab-eval run `
  --snapshot snapshots/readiness-simulated-v1.json `
  --collaborative `
  --k 1 --k 3 `
  --seed 20260822 `
  --output reports/collaborative-v1.json `
  --strict
```

`--collaborative` applies the complete RCP-18A readiness gate before any model
is fit. An insufficient snapshot exits 3 regardless of `--strict`, writes no
evaluation report, and directs the caller to the `readiness` command for the
aggregate failure report. A ready run evaluates `baseline-v1`,
`collaborative-v1`, and `content-v1` in stable model-ID order. Their shared
report includes quality, recommendation coverage, popularity bias, baseline
deltas, and flat aggregate artifact metadata for the collaborative fit.

The eight-item cohort leaves three candidates per profile after five training
items, so K values 1 and 3 show top-rank behavior and full-pool coverage. Its
results verify only engineering behavior and cannot establish real-user lift.
See the [offline collaborative recommender](../docs/collaborative-recommender.md)
for the signed-neighborhood formula, sparse fallback, artifact contract, and
interpretation rules.

## Run the hybrid experiment

Use the same ready snapshot to evaluate every built-in candidate on one split:

```powershell
recipe-lab-eval run `
  --snapshot snapshots/readiness-simulated-v1.json `
  --hybrid `
  --k 1 --k 3 `
  --seed 20260822 `
  --output reports/hybrid-v1.json `
  --strict
```

`--hybrid` and `--collaborative` are mutually exclusive. The hybrid suite
contains `baseline-v1`, `collaborative-v1`, `content-v1`, and `hybrid-v1` in
stable model-ID order and applies the complete collaborative-readiness gate
before fitting. Report schema v3 adds an aggregate `hybrid_adoption` decision.
Retaining a simpler model is a successful evaluation and returns zero; it does
not make `--strict` fail.

The generated cohort deterministically retains `content-v1`. Its hybrid NDCG
is `0.718750` at K=1 and `0.887435` at K=3; the primary-K gain over content is
only `0.001028`, below the policy's `0.010000` minimum. Synthetic evidence is
independently barred from adoption. See the
[offline hybrid recommender](../docs/hybrid-recommender.md) for the exact
component formula, cold-start routes, reasons, metrics, and policy.

## Run the substitution rules benchmark

Evaluate the committed deterministic rules fixture without a database:

```powershell
recipe-lab-eval substitution-run `
  --benchmark tests/fixtures/substitution_benchmark_v1.json `
  --output reports/substitution-rules-v1.json `
  --strict
```

This command uses a separate `recipe-lab-substitution-benchmark-v1` contract;
it does not consume a recommendation snapshot or run a temporal split. Cases
exercise curated direct edges, dietary and allergen tag filters, recipe-context
ordering, signed preference ordering, constraint precedence, and an expected
empty result. The canonical aggregate report records deterministic counts and
coverage/accuracy metrics, including exact caution compliance, and always states
`learned_ranking_attempted: false`.

The fixture reaches `engineering_validated` with six synthetic cases. That
status verifies rule execution and report reproducibility, not taste, cooking
outcomes, cross-contact, medical suitability, or user demand. Ingredient tags
are positive declarations only; missing metadata remains unknown. `--strict`
writes the report and exits 3 for `invalid` or `insufficient_data`, while a
validated report exits zero. See the
[offline substitution rules engine](../docs/substitution-engine.md) for hard
constraints, exact ordering, output explanations, caution text, metrics, and
scope.

## Run the duplicate-candidate benchmark

Evaluate the production structural scorer against the committed labeled pair
fixture without a database:

```powershell
recipe-lab-eval duplicate-run `
  --benchmark tests/fixtures/duplicate_candidates_v1.json `
  --output reports/duplicate-candidates-v1.json `
  --strict
```

The `recipe-lab-duplicate-evaluation-fixture-v1` contract keeps synthetic
instruction prose and authored ingredient source labels outside each recipe's
fingerprint structure. Its paraphrase case uses two different recipe records with
genuinely different instructions but identical curated structure. Its alias case
uses different source labels that map to the same canonical ingredient identities.
Category-specific validation rejects label-only coverage: the unit, reorder,
proportional quantity, action-type, action-order, duration, temperature, and
adversarial cases must each contain their claimed source perturbation. Every case
also declares its expected scorer-component relations and ordered reason codes,
which are checked against fingerprints and results produced by the production
builder and scorer. Prose, source labels, and recipe, user, or profile identifiers
are absent from the aggregate report.

The byte-deterministic `recipe-lab-duplicate-evaluation-report-v1` records the
production algorithm version, parameter SHA-256, capacity/work budget, threshold,
feature weights,
three-class confusion matrix, positive-class precision and recall (where exact
and probable are positive), accuracy,
category, component-expectation, and explanation coverage, plus aggregate
classification, component, explanation, false-positive, and false-negative error
categories. Its fixed
limitations make clear that `engineering_validated` is small synthetic contract
evidence only. Duplicate suggestions remain advisory: the report does not authorize
blocking publication, merging or deleting recipes, plagiarism claims, or a learned
classifier. `--strict` writes the report and exits 3 unless engineering validation
passes.

## Capture an evaluation snapshot

Use an intentionally selected database. Persistent developer and browser
activity is valid product history and is not erased by seeding.

```powershell
recipe-lab-eval snapshot `
  --database-url $env:DATABASE_URL `
  --dataset-id recipe-lab-local-2026-08-21 `
  --cutoff 2026-08-21T00:00:00Z `
  --limitation "Shared demo activity may combine multiple visitors." `
  --limitation "No recommendation-impression log is available." `
  --output snapshots/local-2026-08-21.json
```

The exporter reads recipe versions, occurrence-preserving structured ingredient
measures, and typed preference events in one repeatable-read transaction. Each
measure retains canonical ingredient identity, exact/range/qualitative shape,
decimal bounds, curated unit identity, and optional reviewed package-size
identity; display text is omitted. It also excludes user names and emails,
request fingerprints, network/device metadata, and free-form context. Opaque
activity IDs remain necessary for state reconstruction, so local snapshots are
ignored by Git. Reports contain aggregate metrics rather than those raw IDs,
but are also ignored as generated run artifacts and can include caller-supplied
dataset labels and limitation text.

The snapshot embeds one UTC cutoff. Training uses only recipes and events
strictly before it; events at or after it are held out. Changing the file after
capture changes its canonical SHA-256 fingerprint.

## Built-in content model

`content-v1` combines canonical ingredient overlap, normalized title tokens,
version proximity, and signed profile signals. It reconstructs the latest save
and rating state, deduplicates views and forks, uses exact rational arithmetic,
and defines a signed-global-prior cold start with stable metadata and UUID
tie-breaks. See [offline content recommender](../docs/content-recommender.md) for
the exact formulas, signal weights, and limitations.

The command-line `run` path always supplies `ContentBasedV1Model()` to the
evaluator. The generic Python `evaluate(snapshot, models=())` call remains
baseline-only unless the caller explicitly supplies the content model or
another comparison adapter.

## Built-in collaborative model

`collaborative-v1` reuses the documented signed save, rating, view, and fork
signals to build a user-version matrix. It requires five nonzero items for a
target profile, three nonzero-signal profiles for a candidate, and two shared
items for a profile pair. Eligible neighbors use exact signed similarity and a
normalized signed candidate score. Sparse profiles, sparse candidates, missing
neighbors, and equal scores resolve through the deterministic `content-v1`
order.

The CLI adds this model with `--collaborative` or as a comparator in the
`--hybrid` suite; the default command remains the baseline/content comparison.
The public evaluator enforces the same gate
when `CollaborativeV1Model()` is supplied. Direct `.fit()` calls remain useful
only for focused tests because the leakage-safe model protocol does not expose
the held-out events required by the full-snapshot gate.

## Built-in hybrid model

`hybrid-v1` converts each component's top-50-or-smaller rank to an exact common
score, then uses baseline-only, content-plus-baseline, or full
content-plus-collaborative-plus-baseline routes according to the candidate's
available evidence. Every detail carries a deterministic, non-identifying
reason; the aggregate report intentionally omits candidate details and raw IDs.
Its per-model artifact is null because it is closed-form rank fusion, while its
metadata and parameter hash record the component versions, weights, routes,
tie-break, and reason policy.

The public evaluator requires `ContentBasedV1Model()` and
`CollaborativeV1Model()` in the same call whenever `HybridV1Model()` is present,
then applies readiness before fitting. This preserves the required same-split
comparison rather than silently producing a baseline-versus-hybrid report.

## Built-in substitution rules

`substitution-rules-v1` considers only curated outgoing relationships for one
source ingredient. Required dietary flags and excluded declared allergens are
hard filters. The remaining candidates use relationship evidence first, then
exact recipe-context Jaccard similarity, normalized signed preference affinity,
and stable ingredient metadata tie-breaks. Every item retains its ratio or
guidance, provenance or confidence, components, and a deterministic
human-readable explanation.

Queries require the source ingredient to appear in the recipe context and
accept preference weights only for its direct curated replacements.
Relationship confidence describes the curated edge; it is never medical,
allergen, label, cross-contact, or food-safety confidence.

The Python API can build the catalog from the bundled seed, but no FastAPI
route or frontend consumes it. Missing dietary or allergen metadata is unknown,
not proof of suitability, and every result carries a label/cross-contact
caution. The rules engine is the offline baseline for later substitution work;
it is not a learned ranker.

## Add another comparison model

Implement the `EvaluationModel` protocol:

- declare a stable `ModelMetadata` ID, version, and JSON-safe parameters;
- fit using only the provided `ModelTrainingData` and derived seed; and
- rank the supplied complete candidate IDs without duplicates or unknown IDs.

Call `evaluate(snapshot, models=(your_model,), config=...)`. The runner always
adds `baseline-v1`, rejects attempts to replace it, and records raw metrics plus
baseline deltas for every model. Experiment code can supply additional adapters
through the Python API; the CLI intentionally exposes only the fixed built-in
content comparison and its explicit, readiness-gated collaborative and hybrid
suites rather than accepting an arbitrary import path.

## Checks

```powershell
python -m ruff format --check src tests
python -m ruff check src tests
python -m mypy src tests
python -m pytest
```

The complete split, relevance, metrics, insufficiency, privacy, and report
contract is documented in
[offline recommendation evaluation](../docs/evaluation.md). The separate
[collaborative-filtering data readiness](../docs/collaborative-readiness.md)
contract defines when the snapshot structure is sufficient to run the RCP-18
experiment, and the
[offline collaborative recommender](../docs/collaborative-recommender.md)
defines its scoring, fallback, artifact, and evaluation behavior. The
[offline hybrid recommender](../docs/hybrid-recommender.md) defines rank fusion,
explanation routes, and the conservative adoption policy. The separate
[offline substitution rules engine](../docs/substitution-engine.md) defines the
curated candidate, hard-constraint, ordering, caution, and benchmark contracts.
