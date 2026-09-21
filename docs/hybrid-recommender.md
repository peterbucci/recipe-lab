# Offline hybrid recommender

## Purpose and boundary

`hybrid-v1` is a deterministic rank-fusion experiment conducted only as offline
engineering research. It combines the API-only research-preview `baseline-v1`
order with the offline `content-v1` and `collaborative-v1` orders, while retaining
explicit cold-start routes and a short explanation for every ranked item. It
does not replace the recommendation API strategy, run in FastAPI, appear in the
frontend, persist a model, or change the database.

Run the complete comparison suite with:

```powershell
recipe-lab-eval run `
  --snapshot snapshots/readiness-simulated-v1.json `
  --hybrid `
  --k 1 --k 3 `
  --seed 20260822 `
  --output reports/hybrid-v1.json `
  --strict
```

`--hybrid` and `--collaborative` are mutually exclusive suite selectors. The
default run evaluates `baseline-v1` and `content-v1`; `--collaborative` adds
`collaborative-v1`; `--hybrid` evaluates all four built-ins in stable model-ID
order: `baseline-v1`, `collaborative-v1`, `content-v1`, and `hybrid-v1`.

Because the hybrid consumes collaborative evidence, the CLI applies the
complete [collaborative-readiness gate](collaborative-readiness.md) before
fitting any model. A failed gate exits 3 and does not create or overwrite an
evaluation report, regardless of `--strict`. The public `evaluate()` API applies
the same gate for `hybrid-v1` and requires the content and collaborative
comparators in the same call. This prevents a hybrid-only report from bypassing
readiness or the required same-split comparison.

## Normalized component scores

Each component receives the same fitted prefix, profile, and complete candidate
set. Let `N` be the candidate count and `W = min(N, 50)`. Each component ranks
its first `W` candidates. A candidate at one-indexed component rank `r` receives
the exact rational score:

```text
component_score(r) = (W - r + 1) / W
```

A candidate outside that component's first `W` receives zero. When `N = 1`,
the only candidate receives one from each applicable component. An empty
candidate set returns no recommendations. The 50-item window matches the
research-preview baseline's documented request limit; for larger evaluator
candidate pools this is an explicit top-window rank-fusion approximation, not a
claim that positions below 50 have equal model affinity.

Write `B`, `C`, and `CF` for the normalized baseline, content, and collaborative
rank scores. They are comparable because every component uses the same `W`,
not because their underlying raw scoring formulas share a scale.

## Routes and reasons

The model chooses a route per candidate. It does not invent collaborative
support for a sparse profile or item.

| Route | Evidence | Final score | Human-readable reason policy |
| --- | --- | --- | --- |
| `fallback` | The target has no nonzero signed preference profile | `B` | “Catalog quality and activity support this recommendation because this profile has no usable signed preference signal for hybrid ranking.” |
| `content_fallback` | The target has a profile, but the candidate has no usable collaborative score | `(2C + B) / 3` | "Recipe similarity supports this recommendation; collaborative evidence was unavailable." |
| `hybrid` | The candidate has usable collaborative evidence for a supported target | `(2C + 2CF + B) / 5` | "Recipe similarity and interaction patterns from similar profiles shaped this recommendation." |

Usable collaborative evidence follows the `collaborative-v1` contract: the
target has at least five nonzero signal items, the candidate has signals from
at least three profiles, at least one neighbor with two overlapping items
contributes, and the final exact signed collaborative aggregate is nonzero. A
negative nonzero score is evidence and remains eligible for the full hybrid
route; zero is not evidence.

The fitted model exposes deterministic recommendation details for focused tests
and future adapters: recipe-version ID, exact final and component scores, route,
and reason. `rank()` returns only the ordered IDs required by the evaluator.
Reasons are fixed, non-identifying summaries; they never name a neighbor,
profile, event, or source recipe. Candidate ties resolve by final score, content
rank, baseline-fallback rank, trimmed case-insensitive title, trimmed title,
version number, and recipe UUID. Input ordering and Python hash randomization
therefore do not change the result.

The fallback component may still use baseline-v1's own positive-history rules
when signed content signals cancel to zero. Its reason deliberately says that
the *signed hybrid signal* is unavailable rather than claiming that the profile
has no recorded activity. The qualifying evaluator always supplies the complete
novel candidate set. Lower-level subset calls score that requested subset before
the shared 50-item fusion window is applied, so excluded catalog leaders cannot
consume positions intended for requested candidates.

## Evaluation and adoption policy

One `--hybrid` report compares all four candidates on the same fixed cutoff,
training prefix, holdout labels, candidate sets, K values, and metric
implementation. Report schema `recipe-lab-offline-evaluation-report-v3` adds a
top-level `hybrid_adoption` decision. It is null for runs without `hybrid-v1`.
For a hybrid suite it records the versioned policy, status, candidate and
reference model IDs, primary K, evaluated-profile support, aggregate metric
deltas, stable reason codes, policy thresholds, and per-K comparisons.

The decision is conservative. The primary cutoff is the largest requested K.
`hybrid-v1` may be recommended over the best simpler model only when all of the
following hold:

- the report is complete and at least 40 profiles are evaluated;
- primary-K NDCG improves by at least `0.010000`;
- NDCG and recall do not regress at any requested K; and
- coverage does not trail the best-NDCG simpler reference by more than
  `0.050000` at any requested K.

The comparison uses six-decimal report metrics. At each K, the reference is the
simpler model with the largest NDCG; an exact tie prefers baseline, then content,
then collaborative in increasing-complexity order. Missing metrics, insufficient
support, or any failed guardrail retains the simpler approach. A simulator
dataset is also forced to `retain_simpler`: the complete fixed
simulator-assumption set marks synthetic evidence. This is a conservative
provenance marker, not an authentication mechanism.

The adoption status never changes the command's exit code. A ready, complete
run that retains a simpler model is a successful experiment, not a CI failure.
Likewise, `adopt_hybrid` is only offline evidence under one explicitly limited
snapshot; it does not deploy the model or establish causal, statistical, or
real-user improvement.

## Synthetic engineering result

The deterministic 64-profile readiness cohort exercises all 192 candidate
details through the full `hybrid` route. At K=1, `hybrid-v1` reports precision
`0.718750`, recall `0.359375`, NDCG `0.718750`, and coverage `0.875000`. At K=3,
it reports precision `0.666667`, recall `1.000000`, NDCG `0.887435`, and coverage
`1.000000`. Mean recommended popularity and mean candidate popularity are both
`1.000000`, so popularity bias is `0.000000` at both cutoffs.

The best simpler reference is the tied, lower-complexity `baseline-v1` at K=1
and `content-v1` at the primary K=3. Hybrid leads those references by `0.015625`
and `0.001028` NDCG respectively, but the primary lift remains below the
policy's `0.010000` minimum. The result therefore retains the simpler model,
and synthetic evidence independently bars adoption. These numbers verify the
deterministic plumbing and conservative decision contract; they are not
product-quality evidence and must not be tuned into an artificial win.

## Artifact and privacy boundary

`hybrid-v1` is closed form and has no separately persisted training artifact,
so its per-model `artifact` value is null. Its versioned metadata records the
component IDs and versions, fusion window and weights, evidence routes,
tie-break, reason policy, and isolated component-seed policy; the report parameter hash
captures those choices.

The aggregate report does not include recommendation details, reasons,
component score maps, raw recipe/event/profile IDs, or neighbor evidence. The
collaborative model retains its existing aggregate-only fitted artifact. The
hybrid adoption object contains only fixed model IDs, K values, aggregate
support and metrics, thresholds, status, and reason codes.

## Known limitations

- Rank fusion uses relative top-window positions and discards raw score
  magnitudes below the component boundary.
- The fixed `2:2:1` full-route and `2:1` content-fallback weights are transparent
  engineering defaults, not learned parameters.
- A single fixed-cutoff offline report cannot establish statistical
  significance, causality, calibration, or online usefulness.
- Shared demo activity is not a coherent account-level profile, and no
  impression log exists to distinguish non-exposure from dislike.
- Serving, monitoring, online experimentation, frontend display, and any
  product-strategy change remain separate work.
