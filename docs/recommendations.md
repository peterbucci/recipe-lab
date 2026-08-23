# Baseline recommendations

## Purpose and boundary

`baseline-v1` is a deterministic, request-time recommender with an anonymous
global cold start and optional signed-in member personalization. It establishes
the explainable reference point used by Recipe Lab's
offline evaluator for every comparison model, including `content-v1`. It does
not train a model, persist a user profile or recommendation artifact, introduce
randomness, or depend on a clock.

`GET /api/recommendations?limit=10` returns up to the requested number of
recommendations. Each item contains a recipe-version summary, its score, and a
short reason plus the six scoring components. The response identifies the
strategy as `baseline-v1`, reports whether positive history personalized the
ranking, and publishes the weights and quality prior it used. The read uses the
existing catalog, current saves and ratings, and the privacy-bounded preference
events. A signed-in request reads only that member's private history. A
signed-out request reads no personal history and sets `personalized` to false;
it does not create anonymous tracking or return additional personal data.

`limit` defaults to 10 and accepts values from 1 through 50. An invalid value
returns the standard HTTP 422 error envelope. Public cold-start requests do not
depend on the seeded Demo Cook identity.

Because the same URL may vary by the private member session, the API marks every
recommendation response `private, no-store` and varies it by cookie. No
recommendation result is embedded in a shared cache or public server-rendered
page, and this story adds no recommendation UI.

The endpoint is API-only in this milestone. It does not add a frontend surface,
a database migration, or an offline training job. The separate offline harness
reconstructs point-in-time state from immutable event snapshots and calls the
same pure scorer for the baseline comparison; the API never imports or runs
that harness or the offline `content-v1` model.

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
`baseline-v1` remains an explainable product and evaluation baseline. It
deliberately has no recency model, popularity
dampening, semantic ingredient representation, collaborative signal, or
training pipeline. The [offline evaluation harness](evaluation.md) measures it
with a fixed-cutoff protocol and compares it with the
[offline `content-v1` recommender](content-recommender.md) and the opt-in,
readiness-gated
[offline `collaborative-v1` recommender](collaborative-recommender.md). Those
experiments also feed the evaluator-only
[offline `hybrid-v1` rank fusion](hybrid-recommender.md). Its human-readable
reasons are tested model details, not API output. None of these experiments
replaces this production strategy or adds a serving dependency.
