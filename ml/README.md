# Recipe Lab offline evaluation

This Python package fits and evaluates Recipe Lab's deterministic offline
`content-v1` recommender against the mandatory `baseline-v1`. It also provides a
versioned synthetic cohort and a structural readiness gate for later offline
collaborative-filtering work. It is deliberately separate from the FastAPI
request path, persists no model artifact, and has no serving responsibility.

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
  --output reports/readiness-v1.json `
  --strict
```

The simulator emits only opaque profile/event IDs and typed view, save, and
rating context. It refuses catalogs with recorded activity and omits fork events
because the snapshot has no lineage contract. The default cohort deterministically
produces 640 training events across 64 profiles and 320 distinct profile-item
pairs, plus 64 supported temporal profiles and 128 eligible holdout items.

The readiness report checks fixed minimums for profile, item, interaction,
support, sparsity, and temporal-evaluation counts. `ready` for this synthetic
cohort authorizes only implementation and testing of an offline RCP-18 adapter;
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

## Add another comparison model

Implement the `EvaluationModel` protocol:

- declare a stable `ModelMetadata` ID, version, and JSON-safe parameters;
- fit using only the provided `ModelTrainingData` and derived seed; and
- rank the supplied complete candidate IDs without duplicates or unknown IDs.

Call `evaluate(snapshot, models=(your_model,), config=...)`. The runner always
adds `baseline-v1`, rejects attempts to replace it, and records raw metrics plus
baseline deltas for every model. Experiment code can supply additional adapters
through the Python API; the CLI intentionally runs the fixed built-in
`content-v1` comparison rather than accepting an arbitrary import path.

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
contract defines when the snapshot structure is sufficient to begin RCP-18
experimentation.
