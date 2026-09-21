# Recipe duplicate-candidate preflight

## Purpose and boundary

Recipe Lab runs a reusable, advisory duplicate check before a structurally
authored recipe is published. Its core accepts a completed fingerprint plus an
optional direct source. The maintained product adapter loads one saved original
or source-backed draft revision. A source-backed review binds the draft's exact
direct parent and applies the no-change contract.

The check answers a narrow structural question. It does not decide authorship,
originality, copyright, plagiarism, culinary equivalence, or which recipe is
better. Its evidence does not establish direct lineage, author intent, or a
cooking outcome. It never merges lineages, transfers ownership, deletes a
recipe, or makes a similarity match a publication prohibition: after the
required review, an author can explicitly continue. Ingredient-catalog request
deduplication is a separate curation workflow and shares neither these records
nor this policy.

## Preflight flow

The browser calls
`POST /api/recipe-drafts/{draft_id}/duplicate-preflights`, which accepts
`{ "revision": <saved_revision> }` and its own UUID `Idempotency-Key`. It
requires the active draft to belong to the session member, prepares its complete
saved aggregate, and supplies `source_version_id` only for a fork. The draft
adapter calls the same source-optional structural core. The service:

1. verifies any source is publicly readable and any draft is private to the
   active author;
2. validates and prepares the complete proposed structure without inserting a
   recipe version;
3. builds its `recipe-structure-v1` fingerprint;
4. finds exact public fingerprints first, then builds a bounded public shortlist
   by canonical ingredient overlap;
5. ranks at most five exact or probable candidates;
6. stores immutable, bounded audit evidence; and
7. returns `exact_duplicate`, `probable_duplicate`, or `distinct`.

Titles, descriptions, servings, ingredient display labels and aliases,
preparation notes, instruction prose, authors, and lineage metadata are absent
from scoring. A prose rewrite or a switch between reviewed labels for the same
curated ingredient therefore cannot turn an exact structural match into a
distinct recipe.

An unchanged structure relative to the direct source also returns the separate
`same_lineage_no_change` warning. The source is already known to the caller, so
it is not repeated as a candidate row.

## Exact and probable classifications

An exact match requires all three of the following:

- the same fingerprint algorithm version;
- the same lowercase SHA-256 digest; and
- byte-identical canonical JSON.

The payload comparison is mandatory. A digest collision alone is never treated
as exact.

Non-exact pairs use `duplicate-candidate-similarity-v1`. Every calculation uses
exact rational arithmetic. The versioned score is:

```text
score = 9/20 * ingredient multiset similarity
      + 1/4  * normalized quantity similarity
      + 3/10 * structured action similarity
```

Ingredient similarity is multiset Dice over stable curated ingredient IDs and
preserves repeated occurrences. Quantity similarity finds the one positive
global rational scale that maximizes exact same-ingredient measure matches.
Exact and range endpoints, unit semantics, qualitative modes, and curated
package-size identities remain explicit. Ties prefer scale 1, then the smallest
positive fraction.

Structured action similarity is itself versioned:

```text
structured actions = 1/2  * ordered action-type LCS Dice
                   + 3/10 * ordered (action, input ingredient) LCS Dice
                   + 1/5  * ordered (action, duration, temperature) LCS Dice
```

A non-exact score of at least `4/5` is probable; a lower score is distinct. The
threshold, weights, subweights, reason ordering, maximum of three reasons, and a
SHA-256 of the complete parameter document travel with the versioned evaluator.
No learned or opaque classifier participates.

The enclosing `recipe-duplicate-preflight-policy-v2` is versioned separately.
Its canonical parameter document pins the scorer version and hash, public-only
selection, exact-first ranking and UUID tie-break, source exclusion,
direct-parent warning semantics, response bounds, and fixed scoring work
budgets.

Candidate discovery no longer scans or rejects the whole public library. It
first uses the versioned fingerprint digest lookup and confirms byte-identical
canonical JSON. That exact lookup returns at most the five UUID-first candidates
that can fit in the response. If exact candidates leave response capacity, the
remaining public-comparison budget is filled deterministically from candidates
that share at least one curated ingredient ID, ordered by descending count of
distinct shared IDs and then ascending recipe-version UUID. The complete scorer
still classifies and orders every shortlisted pair; overlap is only retrieval,
not a replacement score.

A zero-overlap pair cannot reach the `4/5` probable threshold under scorer v1:
its ingredient, quantity, and ordered-input components are zero, leaving a
maximum total score of `21/100` from the other action components. Excluding it is
therefore complete for probable classification. When more than the bounded 500
public-comparison slots have positive overlap, the overlap shortlist is an
explicit recall limit; exact lookup remains independent of public-library size.

The overlap query is supported by the non-unique covering index on
`recipe_version_ingredients (ingredient_id, recipe_version_id)`. Migration
`20260902_0029` replaces the former ingredient-only index with that exact
column order; the existing fingerprint `(algorithm_version, digest)` index
continues to serve exact lookup.

Each structure is capped at 200 ingredient occurrences, 500 actions, and 2,000
flattened action inputs; a conservative quantity-scan and LCS estimate caps all
non-exact pair work at 10,000,000 units before any pair is scored. Work overflow
or invalid stored structure returns one generic failure without partial
evidence. The policy version and canonical policy-parameter hash are bound into
the result digest and persisted candidate/publication evidence.

## Public and privacy boundary

Candidate discovery starts from the shared publicly-readable recipe predicate;
it does not score every recipe and filter private results afterward. Responses
contain only a bounded public recipe-version UUID, immutable public title,
classification, six-decimal score, and up to three fixed explanation reasons.
They contain no candidate totals, hidden-match counts, timings, raw feature
vectors, private IDs, user data, or canonical payloads.

Every readable candidate has a `recipe_version_publications` row in the
supported `published` state. Seeded versions are backfilled into that state
without changing their stable IDs or lineage topology. Candidate lookup starts
from this explicit shared predicate, so private drafts cannot enter the scorer
and later visibility states can be added without filtering secrets after
comparison. A replay or publication rechecks every returned candidate. If any
evidence is no longer public or the policy version has changed, the API returns
one generic stale-result conflict and does not repeat prior candidate details.

## Acknowledgement and author decision

Every response carries this stable acknowledgement envelope:

```json
{
  "preflight_id": "00000000-0000-4000-8000-000000000000",
  "policy_version": "recipe-duplicate-preflight-policy-v2",
  "result_digest": "<lowercase sha256>",
  "required": true,
  "allowed_decisions": ["continue", "revise"]
}
```

`required` describes whether this classification requires an author decision;
it is false only for a distinct result. It does not make the review optional.
For an exact, probable, or direct-parent no-change result, the author can
explicitly continue or revise. The maintained browser flow sends that choice in
the saved draft's publication envelope. A `continue` decision is stored only as
part of the atomic publication transaction. Choosing `revise` means editing and
saving the draft, which invalidates the revision-bound preflight; there is no
standalone decision endpoint.

The browser pauses inline, shows neutral explanations and public candidate
links in a draft-safe new tab, and requires an acknowledgement before an
advisory match can continue. Editing and saving any field changes the revision
and invalidates the old preflight. If review is unavailable, publication pauses,
the saved draft remains unpublished, and the editor offers a retry. There is no
continue-without-review path: the service never pretends the result was distinct
or accepts publication without current evidence. If a fork's exact source is no
longer publicly readable, the API returns
`409 recipe_fork_source_unavailable`, keeps the draft intact, and offers no
source-free fallback.

Draft publication sends the revision and exact review envelope to
`POST /api/recipe-drafts/{draft_id}/publish`:

```json
{
  "revision": 4,
  "duplicate_review": {
    "preflight_id": "00000000-0000-4000-8000-000000000000",
    "policy_version": "recipe-duplicate-preflight-policy-v2",
    "result_digest": "<lowercase sha256>",
    "decision": null
  }
}
```

A distinct result uses `decision: null`; an exact or probable result uses
`decision: "continue"`. The publication transaction reloads and locks the
draft, recomputes its fingerprint, and validates the actor, revision, current
policy, optional exact source, result digest, bounded candidate visibility, and
decision. An original creates an immutable root. A fork rechecks source
visibility, locks the existing lineage, and creates a separate direct child even
when the parent structure is unchanged. The transaction binds the evidence only
if every check still passes. A stale or mismatched review or an unavailable
source leaves the draft active and creates no partial snapshot, publication
receipt, fork event, or completed state.

## Immutable evidence

Migration `20260825_0012` adds three append-only tables:

- `recipe_duplicate_preflights` stores actor, idempotency identity, source,
  subject fingerprint identity, policy, classification, warning state, and
  result digest;
- `recipe_duplicate_candidates` stores at most five public candidate pairs with
  rank, basis-point score, at most three reason codes, and exact-payload
  confirmation; and
- `recipe_duplicate_decisions` stores an actor-owned `continue` choice written
  atomically with publication. Historical `revise` rows created before the
  retired adapter was removed remain readable under the preserved migrations.

Database triggers reject update, delete, and truncate operations. Composite
foreign keys bind candidate policy/fingerprint versions and decision actor,
policy, and result digest to the referenced preflight. Database checks enforce
the supported ordered explanation families. An idempotent replay must also
match its stored request fingerprint, optional direct source, and subject
fingerprint algorithm and digest; mismatches return the same generic conflict.
Neither recipe prose nor canonical payloads are copied into these audit tables,
and the records are deliberately separate from `preference_events` so
duplicate-review choices cannot become recommendation signals.

`recipe_version_publications` is the immutable publication receipt. For an
RCP-27 root it binds the public version to one retained source draft, actor,
idempotency action, request fingerprint, saved revision, preflight, policy,
result digest, and any continue decision. A unique source-draft constraint and
member/action idempotency constraint prevent a second root while allowing an
exact network retry to look up and return the stored publication result with the
original `201` response and `Location`. This retry is the recovery lookup; it
does not run a second publication.

## Evaluation and limitations

The separate `recipe-lab-eval duplicate-run` command imports the production
fingerprint builder and scorer and evaluates a committed, labeled synthetic
recipe-pair fixture. Instruction prose remains outside each fingerprint
structure. The paraphrase case uses two distinct recipe records with genuinely
different instructions but an identical curated action graph. The report
contains no prose or recipe/pair identifiers. It reports
three-class accuracy, positive precision and recall, confusion counts, category
coverage, component-expectation coverage, ordered-explanation coverage, and
aggregate classification, component, explanation, false-positive, and
false-negative categories, plus scorer parameters and fixed limitations in a
byte-deterministic aggregate report.

The fixture exercises normalized units, distinct authored labels mapped to the
same canonical ingredients, ingredient display reordering, prose paraphrase
invariance, proportional scaling, quantity and action-type changes, action
ordering, duration, temperature, and an adversarial near-match. The loader
verifies each claimed source perturbation instead of treating a category label
as coverage; the evaluator also checks declared component relations and ordered
reason codes. It is a small synthetic engineering benchmark without human
adjudication, confidence intervals, user outcomes, or learned-model evidence.
Its results can validate implementation consistency; they cannot justify a hard
publication block or a claim about creative or legal identity. Any future
enforcement policy requires a separate reviewed product decision and evidence.
