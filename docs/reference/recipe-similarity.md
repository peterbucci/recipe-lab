# Recipe similarity

Recipe Lab uses versioned structural fingerprints and a bounded advisory
preflight to help an author notice similar public recipes before publication.
The system answers a narrow data question: how similar are the reviewed
ingredients, typed measures, and ordered cooking actions?

It does not determine authorship, originality, copyright, plagiarism, culinary
equivalence, safety, or which recipe is better. A match does not merge recipes,
transfer ownership, rewrite lineage, or prohibit publication.

The input graph is defined in [Structured recipe data](structured-data.md), and
the publication transaction is defined in [Recipe lifecycle](../recipe-model.md).

## Exact structural fingerprint

Every structurally complete immutable recipe version receives a
`recipe-structure-v1` identity containing:

- the algorithm version;
- a lowercase SHA-256 digest; and
- the exact canonical JSON that was hashed.

The algorithm version is separate from SHA-256. A future canonicalization must
use a new version and coexist with stored v1 results; it cannot reinterpret
existing payloads.

The root canonical document is:

```json
{
  "ingredients": [],
  "instructions": [],
  "schema": "recipe-lab.recipe-structure",
  "version": 1
}
```

Those empty arrays illustrate shape only. A fingerprintable recipe has at
least one ingredient and one instruction, and every instruction has at least
one structured action.

Canonical bytes are compact UTF-8 JSON with recursively sorted object keys,
unescaped Unicode, and no non-finite values. Decimal inputs are converted to
reduced exact rationals rather than floating point:

```json
{"denominator": 2, "numerator": 1}
```

The stored JSON uses compact separators; examples here contain spaces only for
readability.

## Canonical ingredients and occurrences

Each ingredient occurrence is reduced to its curated ingredient ID and
canonical measure. Equal cores are grouped as a multiset with explicit
multiplicity. Authored display order and database row UUIDs do not enter the
payload.

Repeated occurrences still need stable identities because structured actions
can use them separately. V1 sorts equal occurrences by their complete ordered
action-use paths and assigns local tokens such as `ingredient:0000` and
`ingredient:0001`. Two equal unreferenced occurrences are intentionally
indistinguishable.

This scheme preserves multiplicity and meaningful input references while
remaining stable when a copied recipe receives fresh database IDs or its
ingredient display rows are reordered.

### Measures

Exact and range values retain their mode and exact rational values.
`to_taste`, `as_needed`, and `unspecified` contain only their mode. Duration and
temperature parameters accept only exact and range measures.

V1 normalizes a numeric value only through the selected unit's reviewed affine
rule when dimension and conversion family agree:

```text
base value = (value + offset numerator / offset denominator)
             * scale numerator / scale denominator
```

This makes reviewed relationships such as `1 kg = 1000 g`, `1 minute = 60
seconds`, and `356 °F = 180 °C` exact without rounding. The reviewed rule is
part of v1's meaning even if that catalog rule is later inactive.

When no safe v1 rule exists, the selected curated unit remains part of the
identity. V1 never guesses density, expands package contents, or equates
teaspoons, tablespoons, cups, counts, packages, or unrelated conversion
families. A package amount retains its exact package-size ID.

## Ordered action graph

Instructions remain in authored order, but their prose is excluded. Each
instruction contributes its ordered actions. An action contributes:

- the stable curated action-type key;
- ordered local ingredient-occurrence tokens; and
- parameters in fixed semantic order: duration, then temperature.

Instruction, action, input, and parameter order are structural. Fresh row IDs
are not. Consequently, changing an action or meaningful order changes the
fingerprint, while paraphrasing prose alone does not.

## Included and excluded data

V1 includes:

- curated ingredient identity and multiplicity;
- amount mode, values, non-equivalent unit semantics, and package identity;
- instruction and action order, action types, and ordered occurrence inputs;
  and
- duration and temperature values and safely normalized units.

V1 excludes:

- title, description, servings, author, lineage, timestamps, and row IDs;
- ingredient names, aliases, display labels, preparation notes, and display
  order;
- instruction prose and display-only action verbs; and
- equipment, geometry, intensity, doneness, and other prose-only detail.

An equal v1 payload therefore means equal encoded structure, not equality of
every human-significant cooking detail.

## Completeness and persistence

The canonicalizer produces no partial result. Missing collections, an
instruction without an action, missing catalog or measure identity, an unknown
input target, a duplicate action input, or an incompatible measure makes the
structure ineligible.

Stored results are keyed by recipe version and algorithm version. The digest
index is non-unique because exact duplicates are allowed. A candidate is exact
only when both digest and canonical JSON match; digest equality alone is never
trusted. An exact retry may reuse the stored result, while different canonical
data for the same version and algorithm is a conflict.

Complete new publications persist their fingerprint in the same transaction as
the immutable version. The bounded idempotent backfill gives complete legacy
versions the same v1 result without editing recipe content; incomplete legacy
versions receive no fingerprint.

## Advisory duplicate preflight

Before publication, the backend prepares the saved draft's complete structure
without inserting a public recipe version. It verifies owner and optional
source, builds the v1 fingerprint, searches only publicly readable versions,
stores bounded immutable evidence, and returns one classification:

- `exact_duplicate`;
- `probable_duplicate`; or
- `distinct`.

For an adaptation or revision, the exact direct source is excluded from the
ordinary candidate list and compared separately. Equal structure produces a
`same_lineage_no_change` warning because the caller already knows the source.

Titles, descriptions, servings, display labels, preparation notes,
instruction prose, authors, and lineage metadata do not affect classification.
Changing only those fields cannot turn an exact structural match into a
distinct result.

### Exact candidates

An exact match requires the same algorithm version, the same lowercase digest,
and byte-identical canonical JSON. Exact lookup is independent of public
library size and confirms payload equality before classifying a candidate.

### Probable candidates

Non-exact pairs use versioned `duplicate-candidate-similarity-v1` scoring with
exact rational arithmetic:

```text
score = 9/20 * ingredient multiset similarity
      + 1/4  * normalized quantity similarity
      + 3/10 * structured action similarity

structured actions = 1/2  * ordered action-type LCS Dice
                   + 3/10 * ordered (action, input ingredient) LCS Dice
                   + 1/5  * ordered (action, duration, temperature) LCS Dice
```

Ingredient similarity is multiset Dice over curated IDs. Quantity comparison
selects the one positive global rational scale that maximizes exact
same-ingredient measure matches, with deterministic tie-breaking. Package IDs,
qualitative modes, and unsupported unit semantics remain explicit. A non-exact
score of at least `4/5` is probable; a lower score is distinct.

After exact lookup, probable discovery uses a deterministic shortlist of public
versions sharing at least one curated ingredient ID. It orders by distinct
shared-ID count and then version UUID before applying the complete scorer. A
zero-overlap pair cannot reach the probable threshold under v1. Positive-overlap
retrieval is nevertheless an explicit bounded-recall policy when the shortlist
exceeds its 500-comparison budget.

The enclosing `recipe-duplicate-preflight-policy-v2` pins the scorer version
and parameter hash, public-only selection, exact-first ordering, UUID
tie-breaks, source exclusion, no-change semantics, response bounds, and work
limits. Responses contain at most five candidates and three fixed explanation
reasons per candidate.

## Author decision and publication

Every preflight is bound to the member, draft, saved revision, optional exact
source, fingerprint, policy, and result digest. A distinct result requires no
decision. An exact, probable, or direct-source no-change result requires the
author to choose whether to continue or revise.

The match is advisory, but review is not optional. Choosing revise means
editing and saving the draft, which changes its revision and invalidates the
old evidence. If the review is unavailable, publication waits. There is no
fallback that pretends the result was distinct.

Publication reloads and locks the draft, recomputes its fingerprint, and
revalidates the actor, revision, policy, optional source, result digest,
candidate visibility, and required continue decision. Evidence supplied by the
browser is never authoritative. Stale evidence or a source that is no longer
public leaves the draft active and creates no partial snapshot, receipt, event,
or completed state.

## Privacy and audit evidence

Candidate discovery begins with the shared public-visibility policy. Private
drafts and unavailable versions never enter scoring and are not filtered out
only after a comparison has already exposed them.

The browser receives only bounded public version ID, title, classification,
six-decimal score, and fixed explanation reasons. It does not receive hidden
match counts, candidate totals, timing details, raw feature vectors, canonical
payloads, private IDs, or member data.

Append-only preflight, candidate, and decision tables retain versioned bounded
evidence. Database constraints bind decisions and candidates to their actor,
policy, fingerprint, and result digest; ordinary writes cannot update, delete,
or truncate them. A narrow account-deletion exception removes unbound evidence
owned only by the deleting member while publication-bound evidence remains
protected. The audit records do not copy recipe prose or canonical fingerprint
JSON. A continue decision is written as part of successful publication and is
deliberately separate from `preference_events`, so reviewing similarity cannot
become a recommendation signal.

## Work limits and limitations

One structure is capped at 200 ingredient occurrences, 500 actions, and 2,000
flattened action inputs. Conservative quantity and longest-common-subsequence
estimates cap all non-exact pair work at 10,000,000 units before scoring. Work
overflow or invalid stored structure returns a generic failure without partial
evidence.

The synthetic evaluator exercises normalized units, alias display differences,
ingredient reordering, prose paraphrase invariance, proportional scaling,
action and parameter changes, and adversarial near matches. It is useful for
implementation consistency, not for claims about real recipes or people. It
has no human adjudication, confidence intervals, user outcomes, or learned
model evidence. Any future hard publication block would require a separate
product, policy, and evidence decision.
