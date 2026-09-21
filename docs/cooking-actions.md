# Structured cooking actions

## Purpose and boundary

Recipe Lab keeps every instruction's human-readable prose and adds a reviewed,
machine-readable action sequence beside it. The prose remains the cooking
direction shown to people. Structured actions capture the ordered verbs,
ingredient-occurrence inputs, and optional duration and temperature parameters
needed for reliable comparison and future analysis. The runtime never parses
prose to invent these fields.

This is a data and authoring contract, not a claim that two recipes with equal
actions are interchangeable or that the structured graph captures every
culinary detail. Equipment, technique intensity, doneness, geometry, food
safety, and details that remain only in prose can still matter.

## Curated vocabulary

`GET /api/cooking-action-types` lists active reviewed action types for new
authoring. Each type has a stable UUID, a stable kebab-case key, one canonical
verb, an active flag, and provenance. Existing immutable recipe snapshots keep
referencing an inactive type; deactivation prevents new selection without
rewriting history. Keys and verbs are unique after normalization.

The versioned seed vocabulary is
`backend/app/seeds/data/actions-v1.json`. It contains common preparation and
cooking verbs, including `mix`, `knead`, `chop`, `slice`, `dice`, and `mince`.
Adding or reinterpreting a verb requires a reviewed catalog change. Free-form
action labels are not accepted as catalog identity.

## Instruction graph

Each immutable recipe instruction contains:

- the original prose and an instruction display position;
- one or more ordered action instances for newly published versions;
- a curated action-type identity for every action;
- zero or more ordered references to ingredient occurrences in the same recipe
  version; and
- optional duration and temperature measures.

An input references a recipe ingredient *occurrence*, not merely a canonical
ingredient. This preserves cases where the same canonical ingredient appears
more than once for different uses. Database constraints keep instructions,
actions, inputs, and ingredients in one recipe version and reject duplicate
input references within an action.

Duration and temperature use the existing curated measurement catalog. They
accept exact or range values only. Duration must use a time unit and be
positive; temperature must use a temperature unit. Values and unit identities
are stored structurally, while `unit_display` is a reviewed storage snapshot.
Qualitative ingredient-amount modes do not apply to action parameters.

Historical instructions that predate a reviewed mapping may be read with an
empty action list. The fork/publish boundary is stricter: every resulting
instruction must have at least one structured action. The prose and action
sequence can be edited independently, so the author remains responsible for
keeping them consistent.

## Forking and validation

Forking copies the complete source graph into a new immutable version. New
instruction, action, input, and ingredient-occurrence UUIDs are generated, and
copied action inputs are remapped to the child's fresh occurrence IDs. An
action can also reference an ingredient added by the same request through a
request-scoped edit reference; that reference is never persisted as identity.

The API rejects inactive or unknown action types, unknown/cross-recipe inputs,
inputs removed by the same fork, duplicate inputs, unsupported measurement
dimensions, invalid numeric shapes, and an instruction left without actions.
Validation completes before persistence, so a failed fork does not leave a
partial graph. The fork idempotency fingerprint covers action types, action
order, input references, and normalized duration and temperature values. An
exact retry can return the prior child; reusing its action key with a changed
graph is a conflict.

## Deterministic diffs

Recipe diffs serialize the prose and complete structured actions on both sides.
Instruction changes use this fixed field order:

1. `text`
2. `actions`
3. `inputs`
4. `action_order`
5. `duration`
6. `temperature`

Fresh row IDs created by an otherwise identical fork do not count as changes.
The comparison pairs ingredient occurrences by canonical identity and content
before comparing action inputs. A changed referenced occurrence remains an
`inputs` change. The response also includes
`ingredient_context: {base, target}` with every ingredient snapshot from both
versions, so clients can resolve input UUIDs even when those ingredients did
not otherwise appear in a change group.

The diff is a deterministic comparison of immutable snapshots, not a replay of
the author's edit operations. When several equal repeated actions exist,
persisted edit ancestry would be required to reconstruct intent beyond the
stable semantic pairing.

## Reviewed seed mappings

The bundled action asset contains an explicit mapping for every one of the 116
seed instructions: 54 action types, 252 action instances, 815 input references,
and 24 exact/range parameters. Recipe and instruction stable keys, action keys,
ingredient row keys, and unit keys are authored directly in the asset. Seed
validation fails on a missing or duplicate instruction mapping, unknown or
inactive verb, cross-recipe input, duplicate input, or incompatible parameter
unit.

The seed catalog loader does not inspect instruction text and contains no NLP,
regular-expression, or keyword inference fallback. If prose changes, its
reviewed mapping must be updated explicitly. Deterministic UUIDv5 identities
make independent loads and reruns agree while immutable-content checks reject
silent reinterpretation.

## Recommendation and export boundary

Structured actions are intentionally not consumed by the current production
`baseline-v1`, offline `content-v1`, collaborative, or hybrid recommenders.
Evaluation snapshot schema v2 also has no action graph. Existing model IDs,
weights, fingerprints, and reports therefore retain their published meaning.

The exact `recipe-structure-v1` identity does include the ordered action graph;
its canonical occurrence and ordering semantics are documented in [structural
recipe fingerprints](recipe-fingerprints.md). That identity is a duplicate/data
contract, not a recommendation feature. A future model may use action features
only behind a new versioned export and model contract with explicit leakage
rules, evaluation comparators, and user-facing explanation limits.
