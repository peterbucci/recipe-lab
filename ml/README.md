# Recipe Lab research workspace

Recipe Lab's `ml` package is a deterministic **offline research and evaluation
workspace**. It compares transparent ranking strategies, checks whether a
snapshot can support collaborative experiments, and evaluates the substitution
and duplicate-scoring baselines.

These models are not shipped in the normal application. They are not imported
by FastAPI, do not run in the request path, do not power a frontend surface, and
do not deploy or persist a serving model. The sole online ranker,
`baseline-v1`, remains an API-only research preview and a shared reference
implementation; it has no consumer recommendation UI.

## Current evidence

| Area | Current result | What it means |
| --- | --- | --- |
| Recommendation comparison | `baseline-v1` and `content-v1` run on the committed synthetic fixture | The split, metrics, and deterministic comparison work; this is not evidence of real-user lift. |
| Collaborative readiness | The fixed 64-profile simulated cohort passes the structural gate | The cohort can exercise `collaborative-v1` and `hybrid-v1`; it says nothing about observed-user readiness or quality. |
| Hybrid adoption | The fixed cohort retains `content-v1` | Primary-K NDCG lift is `0.001028`, below the `0.010000` policy minimum, and synthetic evidence is independently ineligible for adoption. |
| Substitution rules | The six-case synthetic benchmark is `engineering_validated` | Direct-edge filtering, ordering, cautions, and reporting match the fixture; taste and safety are not validated. |
| Duplicate scorer | The labeled synthetic benchmark is `engineering_validated` | The production structural scorer matches its engineering fixture; duplicate suggestions remain advisory. |

The detailed contracts live in two places:

- [Models](docs/models.md) — exact formulas, support rules, fallbacks,
  explanations, and change boundaries.
- [Evaluation](docs/evaluation.md) — snapshots, temporal splitting, metrics,
  readiness, reproducibility, benchmark interpretation, and limitations.

## Set up

The root workspace locks the evaluator and the local backend package together,
so the offline baseline adapter and the API call the same pure scorer.

```powershell
cd ml
uv lock --check
uv sync --frozen --package recipe-lab-evaluation --extra dev
uv pip check
..\.venv\Scripts\Activate.ps1
```

See [locked dependencies](../docs/development.md#backend-dependencies) for the
dependency-update contract.

## Run an experiment

The committed fixtures are synthetic and safe to retain. Generated snapshots
and reports go under ignored `snapshots/` and `reports/` directories.

```powershell
# Baseline and content comparison.
recipe-lab-eval run `
  --snapshot tests/fixtures/synthetic_snapshot_v2.json `
  --k 5 --k 10 `
  --seed 20260821 `
  --output reports/synthetic-report.json

# Generate the fixed collaborative engineering cohort and verify readiness.
recipe-lab-eval simulate `
  --catalog tests/fixtures/readiness_catalog_v2.json `
  --profiles 64 --seed 20260822 `
  --output snapshots/readiness-simulated-v1.json

recipe-lab-eval readiness `
  --snapshot snapshots/readiness-simulated-v1.json `
  --output reports/readiness-v2.json `
  --strict

# Compare all four built-in recommenders on that same ready snapshot.
recipe-lab-eval run `
  --snapshot snapshots/readiness-simulated-v1.json `
  --hybrid --k 1 --k 3 --seed 20260822 `
  --output reports/hybrid-v1.json `
  --strict

# Evaluate the two independent engineering benchmarks.
recipe-lab-eval substitution-run `
  --benchmark tests/fixtures/substitution_benchmark_v1.json `
  --output reports/substitution-rules-v1.json `
  --strict

recipe-lab-eval duplicate-run `
  --benchmark tests/fixtures/duplicate_candidates_v1.json `
  --output reports/duplicate-candidates-v1.json `
  --strict
```

Use `run --collaborative` instead of `--hybrid` for the three-model
baseline/content/collaborative suite. The two flags are mutually exclusive and
both require the complete readiness gate to pass before fitting.

## Observed-data warning

The `snapshot` command is a disposable local research tool, not a production
export path. Do not point it at production or real-member data until Recipe Lab
has an artifact registry that binds derived data to account deletion and a
bounded expiry. Delete locally captured observed-data snapshots and their
reports after the run. See
[account deletion and retained history](../docs/security.md#account-deletion-and-retained-history).

## Verify the workspace

```powershell
uv lock --check
uv sync --frozen --package recipe-lab-evaluation --extra dev
uv pip check
..\.venv\Scripts\Activate.ps1
python -m ruff format --check src tests
python -m ruff check src tests
python -m mypy src tests
python -m pytest
```

Passing these checks establishes deterministic engineering behavior. It does
not authorize deployment, product claims, medical or food-safety advice, or a
consumer recommendation experience.
