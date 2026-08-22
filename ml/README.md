# Recipe Lab offline evaluation

This Python package fits and evaluates Recipe Lab's deterministic offline
`content-v1` and readiness-gated `collaborative-v1` recommenders against the
mandatory `baseline-v1`. It also provides a versioned synthetic cohort and a
structural readiness gate. It is deliberately separate from the FastAPI request
path, persists no serving model, and has no serving responsibility. Canonical
reports carry aggregate collaborative artifact provenance only.

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
  --catalog tests/fixtures/readiness_catalog_v1.json `
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
candidate-level neighbor evidence, and temporal-evaluation counts. `ready` for this synthetic
cohort authorizes only fitting and testing the offline collaborative experiment;
it is not evidence about real users, recommendation quality, or production
readiness. For an insufficient snapshot, the default command still writes an
`insufficient_data` report and exits zero; `--strict` exits 3 after writing that
same report. See
[collaborative-filtering data readiness](../docs/collaborative-readiness.md) for
the exact thresholds, assumptions, privacy rules, and proceed condition.

## Run the synthetic verification snapshot

```powershell
recipe-lab-eval run `
  --snapshot tests/fixtures/synthetic_snapshot_v1.json `
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

The exporter reads recipe versions, distinct canonical ingredient IDs, and
typed preference events in one repeatable-read transaction. It excludes user
names and emails, request fingerprints, network/device metadata, and free-form
context. Opaque activity IDs remain necessary for state reconstruction, so
local snapshots are ignored by Git. Reports contain aggregate metrics rather
than those raw IDs, but are also ignored as generated run artifacts and can
include caller-supplied dataset labels and limitation text.

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

The CLI adds this model only with `--collaborative`; the default command remains
the baseline/content comparison. The public evaluator enforces the same gate
when `CollaborativeV1Model()` is supplied. Direct `.fit()` calls remain useful
only for focused tests because the leakage-safe model protocol does not expose
the held-out events required by the full-snapshot gate.

## Add another comparison model

Implement the `EvaluationModel` protocol:

- declare a stable `ModelMetadata` ID, version, and JSON-safe parameters;
- fit using only the provided `ModelTrainingData` and derived seed; and
- rank the supplied complete candidate IDs without duplicates or unknown IDs.

Call `evaluate(snapshot, models=(your_model,), config=...)`. The runner always
adds `baseline-v1`, rejects attempts to replace it, and records raw metrics plus
baseline deltas for every model. Experiment code can supply additional adapters
through the Python API; the CLI intentionally exposes only the fixed built-in
content comparison and its explicit, readiness-gated collaborative extension
rather than accepting an arbitrary import path.

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
defines its scoring, fallback, artifact, and evaluation behavior.
