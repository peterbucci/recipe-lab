# Baseline recommendation research preview

## Purpose and boundary

`GET /api/recommendations` and its deterministic `baseline-v1` strategy are an
API-only research preview. Recipe Lab has no consumer recommendation shelf or
other member-facing recommendation surface, and the endpoint is not evidence
for a sign-in, onboarding, home-page, or product-positioning promise. It remains
online as the tested deterministic reference point used by Recipe Lab's offline
evaluator for every comparison model, including `content-v1`. It does not train
a model, persist a user profile or recommendation artifact, introduce
randomness, or depend on a clock.

`GET /api/recommendations?limit=10` returns up to the requested number of
recommendations. Each item contains a recipe-version summary, its score, and a
short reason plus the six scoring components. The response identifies the
strategy as `baseline-v1`, reports whether positive history personalized the
ranking, and publishes the weights and quality prior it used. The read uses the
existing catalog, current saves and ratings, and the privacy-bounded preference
events. Every request uses the aggregate activity for publicly readable recipes.
A signed-in request additionally reads only the active member's private history
for personalization. A signed-out request loads no account-specific history and
sets `personalized` to false; it does not create anonymous tracking or return
additional personal data.

`limit` defaults to 10 and accepts values from 1 through 50. An invalid value
returns the standard HTTP 422 error envelope. Public cold-start requests do not
depend on the seeded Demo Cook identity.

Because the same URL may vary by the private member session, the API marks every
recommendation response `private, no-store` and varies it by cookie. No
recommendation result is embedded in a shared cache or public server-rendered
page, and there is no recommendation UI.

The endpoint has no frontend surface, database migration, or offline training
dependency. The separate offline harness reconstructs point-in-time state from
immutable event snapshots and calls the same pure scorer for the baseline
comparison; the API never imports or runs that harness or the offline
`content-v1` model.

## Actual-member data use, retention, and deletion

The global component aggregates every currently stored rating, active save, and
distinct-user fork or view event for publicly readable recipes. That aggregate
can include activity from actual members as well as retained legacy or demo
activity. A signed-out request uses only this aggregate ranking and does not
load an account-specific profile. A signed-in request additionally reads only
the active member's current saves and ratings plus that member's view, save,
rating, and fork preference events. Exact recipes already present in that
member's activity are excluded from the returned ranking.

Scoring happens in memory for the current request. Recipe Lab does not store the
returned order, scores, explanations, a derived member profile, or fitted model
state, and the response is `private, no-store`. Current save and rating rows
remain only as account activity until changed or deleted. Append-only preference
events remain for the lifetime of the account. Account deletion removes that
member's saves, ratings, and preference events in the deletion transaction, and
the backup policy requires deleted account data to age out within the documented
30-day maximum and to be reapplied before a restored database serves traffic.

Observed-member ML snapshots, retained row-level evaluation outputs, and online
fitted member state remain prohibited until a reviewed artifact registry can
enforce member binding, deletion propagation, and bounded expiry. The offline
experiments described below therefore do not represent a shipped learned
strategy. See [account-data governance](account-data-governance.md) for the
authoritative database, backup, export, and derived-artifact rules.

## Global score

Every candidate recipe version receives a rating-quality score and three
support signals. Rating quality uses a Bayesian prior with mean 3 and strength
5 so one rating cannot dominate a small catalog. For rating count `n` and
rating sum `R`:

```text
posterior_rating = (5 * 3 + R) / (5 + n)
Q = (posterior_rating - 1) / 4
```

`Q` maps the supported one-to-five rating range to zero through one. An unrated
candidate therefore starts at the neutral prior, `Q = 0.5`.

The support inputs are:

- distinct users with an active save for the candidate;
- distinct users with at least one fork event whose source is the candidate;
- distinct users with at least one view event for the candidate.

Each support input is normalized independently by the largest value for that
input across the eligible candidate set after exact interacted versions are
excluded. A candidate's normalized value is its count divided by that maximum;
when every eligible candidate has a zero count, the normalized value is zero.
Repeated views or forks by one user therefore do not increase that signal beyond
one user of support.

The global score is:

```text
G = 0.55 * Q
  + 0.20 * normalized_active_saves
  + 0.15 * normalized_fork_source_users
  + 0.10 * normalized_view_users
```

These weights make smoothed rating quality the primary signal while still
recognizing deliberate saves, forks, and views in descending order of
strength.

## Member-history personalization

Personalization is a bounded ingredient-similarity boost, not a learned content
model. When a valid member session is present, the server builds history
anchors from only that member's existing product state and events:

| Positive history signal | Strength |
| --- | ---: |
| Active save | `1.00` |
| Current rating of 4 | `0.50` |
| Current rating of 5 | `1.00` |
| Fork source | `1.00` |
| Forked child | `1.00` |
| View | `0.25` |

Ratings from one through three and inactive saves do not create positive
anchors. Repeated events do not accumulate strength. When a version qualifies
through more than one signal, taking the maximum below naturally retains its
strongest evidence.

Each recipe is represented by the set of its distinct canonical ingredient
IDs. For candidate `c` and history anchor `h`, ingredient similarity is the
Jaccard coefficient:

```text
J(c, h) = |ingredients(c) intersection ingredients(h)|
          / |ingredients(c) union ingredients(h)|
```

The database adapter retains every ingredient occurrence as a structured
measure signal before deriving that set. Each signal carries exact, range, or
qualitative shape, curated unit identity, and any reviewed package-size
identity without display labels. `baseline-v1` deliberately projects those
records to distinct ingredient IDs so this catalog change does not alter its
published score; later recommendation strategies can consume the structured
amounts without reparsing recipe text or changing the data-loading boundary.

Recipe instruction action graphs are available to product reads but are not a
`baseline-v1` feature. Action types, input order, duration, and temperature do
not affect its candidate loading, component values, ordering, reasons, or model
identity. Consuming those fields would require a separately versioned strategy
and evaluation rather than silently changing this published baseline. See
[structured cooking actions](cooking-actions.md).

The personal score is the best strength-adjusted match:

```text
P(c) = max over history anchors h of strength(h) * J(c, h)
```

If there is no positive history, `P` is unavailable and the request uses the
cold-start rule. Exact recipe versions already interacted with by the current
member are excluded from the returned candidates; their ingredients may still
act as history anchors. This favors novel versions without treating one
version's activity as activity on its lineage relatives.

## Final score and ordering

When positive history exists:

```text
score = 0.60 * G + 0.40 * P
```

For a cold-start profile with no positive history:

```text
score = G
```

Calculations use decimal arithmetic. The exposed score is rounded to six
decimal places with `ROUND_HALF_UP`, and ranking uses that rounded value. Ties
are resolved by descending rounded ingredient similarity, descending rounded
global score, ascending trimmed case-insensitive title, ascending trimmed title,
ascending version number, and ascending recipe-version UUID, in that order. The
same database snapshot and limit therefore produce the same order and scores.
There is no random shuffle, time window, or time-decay term.

Reasons are short deterministic summaries of the ranking signal. A
personalized item identifies ingredient similarity to the signed-in member's
activity; otherwise the reason identifies global rating or support evidence. A
catalog with no support still produces a stable Bayesian-prior fallback rather
than an arbitrary order. Reasons do not expose user IDs or raw event history.

## Known limitations

Member histories are isolated, but the available real-account cohort and
outcome evidence remain insufficient to claim that personalization improves
recommendation quality. Legacy Demo Cook activity may still contribute to the
same aggregate popularity and rating signals as other historical activity, but
it is never used as a member's personal history or transferred to an account.
`baseline-v1` remains an explainable online research-preview and evaluation
baseline. It deliberately has no recency model, popularity
dampening, semantic ingredient representation, collaborative signal, or
training pipeline. The [offline evaluation harness](evaluation.md) measures it
with a fixed-cutoff protocol and compares it with the
[offline `content-v1` recommender](content-recommender.md) and the opt-in,
readiness-gated
[offline `collaborative-v1` recommender](collaborative-recommender.md). Those
experiments also feed the evaluator-only
[offline `hybrid-v1` rank fusion](hybrid-recommender.md). Its human-readable
reasons are tested model details, not API output. None of these experiments
replaces this online research-preview strategy or adds a serving dependency.
