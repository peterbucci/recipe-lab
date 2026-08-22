# Recipe Lab offline evaluation

This Python package evaluates recommendation approaches against Recipe Lab's
mandatory `baseline-v1`. It is deliberately separate from the FastAPI request
path and has no training or serving responsibility.

## Install

Install the local backend package so the evaluator and production API share the
same pure baseline scorer:

```powershell
cd ml
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ../backend -e ".[dev]"
```

## Run the synthetic verification snapshot

```powershell
recipe-lab-eval run `
  --snapshot tests/fixtures/synthetic_snapshot_v1.json `
  --k 5 --k 10 `
  --seed 20260821 `
  --output reports/synthetic-report.json
```

The fixture contains only invented recipes, opaque UUIDs, and synthetic typed
events. It verifies temporal isolation, metric arithmetic, baseline comparison,
and byte-for-byte reproducibility. It is not a benchmark or evidence about real
users.

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

## Add a comparison model

Implement the `EvaluationModel` protocol:

- declare a stable `ModelMetadata` ID, version, and JSON-safe parameters;
- fit using only the provided `ModelTrainingData` and derived seed; and
- rank the supplied complete candidate IDs without duplicates or unknown IDs.

Call `evaluate(snapshot, models=(your_model,), config=...)`. The runner always
adds `baseline-v1`, rejects attempts to replace it, and records raw metrics plus
baseline deltas for every model. The command-line entry point currently runs the
built-in baseline; experiment code can register additional adapters through the
Python API.

## Checks

```powershell
python -m ruff format --check src tests
python -m ruff check src tests
python -m mypy src tests
python -m pytest
```

The complete split, relevance, metrics, insufficiency, privacy, and report
contract is documented in
[offline recommendation evaluation](../docs/evaluation.md).
