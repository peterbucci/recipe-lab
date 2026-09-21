# Recommendations and Offline Evaluation

Recipe Lab has recommendation infrastructure for experimentation, but it does **not** currently have a member-facing recommendation feature.

There are two separate pieces:

1. an online, deterministic `baseline-v1` endpoint used as a reference implementation; and
2. an offline evaluation package for comparing content-based, collaborative, and hybrid approaches against that baseline.

The separation is intentional. Offline results do not automatically change what the application serves, and no learned recommendation model runs in the FastAPI request path today.

## Current product status

The backend exposes:

```text
GET /api/recommendations
```

This is a research-preview API. There is no recommendation shelf, personalized home feed, onboarding promise, or other frontend surface that consumes it.

The endpoint returns deterministic recommendations from `baseline-v1`. It does not:

- train a model;
- persist a recommendation list;
- persist a derived member profile;
- write recommendation artifacts;
- use random ranking;
- depend on the current time; or
- import the offline ML package.

Signed-out requests use public aggregate recipe activity only.

Signed-in requests may additionally use the current member's own positive history. They never read another member's private history.

Because a signed-in response can depend on private account activity, recommendation responses are private and not stored in shared caches.

## Why the data model is useful for recommendations

Recipe Lab stores more structure than a typical recipe document.

Published versions have stable identifiers, ingredients use curated canonical identities, and saves, ratings, views, and adaptations are recorded against exact recipe versions. That creates cleaner signals for recommendation experiments than trying to infer everything from free-form recipe text.

The current experiments can work with signals such as:

- canonical ingredient overlap;
- recipe titles;
- exact published-version identity;
- saves;
- ratings;
- views;
- adaptations/forks; and
- the history available before a fixed evaluation cutoff.

Structured cooking actions, instruction prose, dietary suitability, and substitution relationships are **not** features of the current recommendation models. Adding them would require a new model/snapshot version rather than silently changing an existing model.

## Online baseline: `baseline-v1`

`baseline-v1` is designed to be simple, explainable, deterministic, and cheap enough to run directly against the serving database.

It combines a global recipe score with an optional ingredient-similarity boost for signed-in members.

### Global score

The global score uses:

- Bayesian-smoothed rating quality;
- active saves;
- distinct users who adapted the recipe; and
- distinct users who viewed the recipe.

Rating quality receives the largest weight:

```text
global_score =
    0.55 * rating_quality
  + 0.20 * normalized_saves
  + 0.15 * normalized_adaptations
  + 0.10 * normalized_views
```

The rating component uses a neutral prior so a recipe with one high rating does not immediately outrank recipes with stronger evidence.

Support signals count distinct users rather than repeated actions from the same account.

### Member history

For a signed-in member, the baseline can use positive history from:

| Signal                     | Strength |
| -------------------------- | -------: |
| Active save                |   `1.00` |
| Rating 4                   |   `0.50` |
| Rating 5                   |   `1.00` |
| Adaptation source or child |   `1.00` |
| View                       |   `0.25` |

Ratings below four and inactive saves do not create positive similarity anchors.

Recipes are compared using the Jaccard similarity of their canonical ingredient sets:

```text
similarity(A, B) =
    shared_ingredients
    / ingredients_in_either_recipe
```

For each candidate, the personal component is its strongest strength-adjusted match to the member's positive history.

When positive history exists:

```text
score = 0.60 * global_score + 0.40 * personal_similarity
```

Without usable positive history:

```text
score = global_score
```

Recipes the member has already interacted with are excluded from the returned recommendations.

### Bounded retrieval

The endpoint does not load an unbounded catalog or an unbounded member history into memory.

Candidate retrieval and profile history are explicitly capped by configuration. Signed-in retrieval combines:

- globally strong public candidates; and
- candidates that overlap with bounded positive-history anchors.

The final ranking is still deterministic.

This keeps the online baseline usable as the catalog grows without pretending that it is a production-scale learned recommender.

### Explanations

Each result includes a short deterministic reason based on the signals that affected its rank.

Reasons describe things such as ingredient similarity or public rating/activity support. They do not expose user IDs, raw member history, or another member's activity.

## Offline recommendation research

The offline package lives under:

```text
ml/src/recipe_lab_evaluation/
```

It compares recommendation strategies using one evaluation protocol rather than giving each model its own custom metric or split.

Built-in models include:

| Model              | Purpose                                                                    |
| ------------------ | -------------------------------------------------------------------------- |
| `baseline-v1`      | Reference implementation shared with the online research-preview scorer    |
| `content-v1`       | Content-based ranking from recipe structure and signed member history      |
| `collaborative-v1` | User-neighborhood ranking from interaction patterns                        |
| `hybrid-v1`        | Deterministic rank fusion of baseline, content, and collaborative rankings |

The offline package does not run inside FastAPI and does not deploy a model.

## `content-v1`

`content-v1` represents each recipe using three feature groups:

- canonical ingredient IDs;
- normalized title tokens; and
- version number.

Its pairwise recipe similarity is:

```text
similarity =
    0.60 * ingredient_similarity
  + 0.30 * title_similarity
  + 0.10 * version_proximity
```

Ingredient and title similarity use Jaccard overlap. Version proximity is a small deterministic metadata term.

The model builds a **signed** profile from training interactions rather than treating every interaction as positive:

| Training signal   |              Weight |
| ----------------- | ------------------: |
| Active save       |                `+3` |
| Removed save      |                `-3` |
| Rating 1–5        | `-4, -2, 0, +2, +4` |
| Distinct view     |                `+1` |
| Adaptation source |                `+4` |
| Adapted child     |                `+4` |

Repeated events do not accumulate indefinitely. Current save/rating state is reconstructed from the event history available before the evaluation cutoff.

The candidate's affinity is the weighted similarity to the recipes in the member's training history.

`content-v1` is closed-form and deterministic. It does not train learned embeddings or use an LLM.

## `collaborative-v1`

`collaborative-v1` asks whether interaction patterns across profiles add useful information beyond structured recipe similarity.

It builds a signed profile-by-recipe interaction matrix from the same training signals used by `content-v1`.

Profiles become neighbors only when they share enough nonzero interaction history. Candidate scores are based on the signed preferences of qualifying neighbors.

The model is deliberately conservative with sparse data:

- profiles with too little history fall back to `content-v1`;
- items with too little support receive no invented collaborative evidence;
- profile pairs with insufficient overlap are not treated as neighbors; and
- zero-evidence candidates retain deterministic content ordering.

Collaborative evaluation is gated by a data-readiness check. A snapshot that does not contain enough support for a meaningful collaborative experiment is rejected before the model is fit.

Passing the readiness check means only that the offline experiment is technically supported. It is not a deployment or product-quality decision.

## `hybrid-v1`

`hybrid-v1` combines the rankings from:

- `baseline-v1`;
- `content-v1`; and
- `collaborative-v1`.

It uses deterministic rank fusion rather than assuming the raw model scores are directly comparable.

The route used for a candidate depends on the evidence available:

- **fallback** — baseline ranking when the profile has no usable signed preference signal;
- **content fallback** — content plus baseline when collaborative evidence is unavailable; or
- **hybrid** — content, collaborative, and baseline when collaborative evidence is supported.

The full hybrid route gives the most weight to content and collaborative evidence and a smaller weight to the baseline.

`hybrid-v1` also has a conservative offline adoption scorecard. A result must have enough evaluated profiles, improve the primary NDCG target, avoid regressions in NDCG and recall at the requested cutoffs, and stay within the coverage guardrail before the report can prefer the hybrid over a simpler model.

That scorecard still does **not** deploy anything. It only records what the offline evidence supports.

## Evaluation snapshots

Offline evaluation runs from an immutable, versioned JSON snapshot rather than directly querying mutable current account state during scoring.

The current snapshot format includes:

- a dataset ID;
- one UTC cutoff;
- recipe-version IDs and creation times;
- recipe titles and version numbers;
- structured ingredient occurrences; and
- typed view, save, rating, and adaptation events using opaque profile/event IDs.

It deliberately excludes data that the current recommendation experiments do not need, including:

- names;
- email addresses;
- IP addresses;
- user agents;
- referrers;
- search text;
- instruction prose; and
- structured cooking-action graphs.

Snapshot contents are canonicalized before hashing so equivalent inputs produce the same fingerprint.

## Leakage-safe evaluation

The offline protocol uses one fixed cutoff:

```text
before cutoff  → training information
at/after cutoff → held-out evaluation information
```

A model receives only:

- recipe versions available before the cutoff;
- events from before the cutoff; and
- the candidate IDs it is allowed to rank.

It cannot inspect held-out relevance labels.

Candidates are the complete available catalog minus exact recipe versions already interacted with during training. The evaluator does not use negative sampling.

This matters because present-day save or rating rows cannot tell the evaluator what the member's state was at an older cutoff. Historical state is reconstructed from the append-only interaction events instead.

## Relevance

A held-out recipe version is treated as relevant when the held-out behavior includes one of these positive outcomes:

- final save state is active;
- final rating is at least four; or
- the member adapts that version.

Views provide training context but are not positive evaluation labels.

Unobserved recipes are not treated as known dislikes.

## Metrics

All models are evaluated with the same candidate sets and metric implementation.

Reports include:

- Precision@K;
- Recall@K;
- NDCG@K;
- catalog coverage; and
- popularity bias.

Non-baseline models also report their deltas from `baseline-v1`.

Popularity bias compares the popularity of recommended recipes with the popularity of the candidate pool available to the same profiles. The signed direction is reported rather than automatically labeling more or less popularity as better.

Metrics are deterministic and serialized to six decimal places.

## Reproducibility

Reproducibility is part of the evaluation contract.

Evaluation runs use:

- one immutable snapshot;
- one cutoff;
- stable event ordering;
- stable candidate ordering;
- deterministic model IDs and parameters;
- fixed tie-break rules; and
- model-specific seeds derived from the run seed.

Closed-form models record the seed for provenance even when they do not consume randomness.

Equivalent snapshots, parameters, seeds, and K values are expected to produce the same report.

The repository's ML tests verify these properties.

## Running the evaluator

The normal evaluator automatically includes `baseline-v1` and `content-v1`.

A typical run looks like:

```powershell
recipe-lab-eval run `
  --snapshot snapshots/example.json `
  --k 5 --k 10 `
  --seed 20260821 `
  --output reports/recommendations.json `
  --strict
```

Add collaborative evaluation with:

```text
--collaborative
```

or run the complete hybrid comparison with:

```text
--hybrid
```

Collaborative and hybrid runs first apply the collaborative-readiness gate.

The evaluator also exposes a lower-level Python API for focused model tests, but qualifying comparisons should use the shared split and metric implementation rather than custom one-off evaluations.

See [Testing](testing.md) for how the ML suite is verified in the repository.

## Privacy and data lifecycle

The online and offline paths have different privacy boundaries.

### Online

A signed-out request uses only aggregate activity for public recipes.

A signed-in request may read:

- the current member's active saves;
- the current member's ratings; and
- that member's view, save, rating, and adaptation events.

The online scorer does not persist its ranking, scores, explanation output, derived profile, or fitted model state.

Account deletion removes the member's source interaction data under the account-lifecycle rules documented in [Security](security.md).

### Offline

Durable research fixtures committed to the repository are synthetic.

Real-member evaluation snapshots and reports require stronger lifecycle controls because deleting the source database rows would not automatically delete copies in research artifacts.

Until an approved artifact lifecycle can bind derived files to deletion and expiry rules, observed-member snapshots are treated as disposable research data rather than durable project artifacts.

Do not commit real-member snapshots or generated reports to the repository.

## What the results do and do not mean

The offline system is built to answer engineering questions such as:

- Does a model obey the fixed-cutoff boundary?
- Does it rank the complete candidate set deterministically?
- Does collaborative evidence add anything beyond structured content on a supported dataset?
- Does a hybrid improve the agreed metrics without violating coverage guardrails?
- Can the experiment be reproduced from the same inputs?

It does **not** establish, by itself:

- real-user lift;
- statistical significance;
- causal improvement;
- culinary correctness;
- dietary or allergy safety;
- calibration;
- long-term satisfaction; or
- that a model should be deployed.

Synthetic fixtures prove implementation and reproducibility. They are not evidence that one model is better for real Recipe Lab members.

Moving any offline model into the product would require a separate product, privacy, serving, monitoring, and artifact-lifecycle decision.

## Current limitations

The recommendation work intentionally remains limited.

Among the current limitations:

- the catalog and observed interaction history are small;
- there is no impression log distinguishing "not shown" from "shown and ignored";
- views are weak behavioral evidence;
- removing a save does not necessarily mean dislike;
- exact ingredient overlap does not capture full culinary similarity;
- current content features do not model quantities, preparation, dietary suitability, or cooking outcomes;
- collaborative methods depend heavily on having enough overlapping interaction history;
- the baseline has no recency or popularity-dampening model; and
- none of the current offline comparisons establish online usefulness.

Those limitations are part of the reason the recommendation work remains an evaluation/research subsystem rather than a shipped product feature.
