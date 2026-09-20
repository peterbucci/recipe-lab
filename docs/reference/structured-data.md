# Structured recipe data

Recipe Lab stores recipe structure as reviewed identities and typed values
alongside the cook's wording. This makes publication, comparison, and exact
structural matching deterministic without pretending that the structured graph
captures every culinary detail.

This reference owns ingredient identity, catalog intake, measurements, and
structured cooking actions. The surrounding draft and publication lifecycle is
in [Recipe lifecycle](../recipe-model.md); fingerprinting and advisory
similarity review are in [Recipe similarity](recipe-similarity.md).

## Ingredient identity and presentation

Every published ingredient occurrence references exactly one curated
`ingredients` row. That stable ID is the identity used by filters,
comparisons, curated substitutions, and similarity logic. The cook-facing
wording is stored separately on the immutable recipe snapshot.

For example, a cook may select the reviewed alias **white sugar** for the
canonical ingredient **Granulated sugar**. The version preserves “white sugar”
as its `display_name`, while identity-based behavior uses the catalog ID. A
later catalog-label change does not rewrite that published wording.

New catalog-backed authoring submits both `ingredient_id` and the selected
label. The server verifies that the label is the canonical name or a reviewed
alias belonging to that exact ID. Unknown text, a label from another ingredient,
or an inactive selection fails the operation. Recipe writes never promote
member text into the trusted global catalog.

Restrictive foreign keys prevent deletion of catalog identities referenced by
published snapshots. Catalog records and aliases may be deactivated for new
authoring while historical versions remain readable.

## Catalog search and missing items

Public catalog search is bounded and paginated across canonical names and
reviewed aliases. Search treats member input as literal text, including percent
and underscore characters. Each catalog ingredient appears at most once and
returns its stable ID, canonical name, and sorted aliases.

The editor keeps search text separate from the selected catalog object. Typing
text is not a hidden selection and cannot make a draft publishable.

When an ingredient is missing, an active onboarded member can submit a bounded
proposed name and optional context. The request is stored separately from
`ingredients` and `ingredient_aliases`; pending or rejected text therefore
cannot enter catalog search, published recipes, substitutions, or
recommendation features.

Requests move once from `pending` to one terminal state:

- **approved** creates a reviewed canonical ingredient and any explicitly
  reviewed aliases;
- **duplicate** points to an existing reviewed ingredient; or
- **rejected** creates no catalog identity.

Approval and duplicate responses expose the trusted resolved catalog object.
The original proposal remains untrusted. A private draft may reference its
author's unresolved request, but the author must explicitly replace that slot
with the resolved catalog selection. Polling or a curator decision never
rewrites the draft.

### Catalog authority and concurrency

Catalog curation is a narrow backend capability granted independently from
account identity or general moderation. It is never inferred from email,
handle, signup order, or a frontend route. Members can read only their own
request history; curators receive a separate private review queue.

Canonical names and aliases occupy one durable normalized namespace. Unicode
compatibility normalization, whitespace folding, and case folding identify
possible collisions, but normalization alone never creates or selects an
ingredient. PostgreSQL advisory locks serialize approvals and seed loads for a
normalized candidate, and database uniqueness plus deferred guards prevent
cross-table name collisions. A decision, catalog write, and audit event commit
together or not at all.

Every terminal decision retains bounded requester, curator, resolution, reason,
time, and audit evidence. Curator-only provenance stays out of member-facing
responses. This workflow does not infer synonyms, bulk-import member text,
attach nutrition or safety claims, or confer broader staff authority.

## Ingredient measures

An ingredient amount has one explicit shape:

| Mode | Numeric values | Unit | Additional identity |
| --- | --- | --- | --- |
| `exact` | One positive value | Required active curated unit | Optional compatible package size |
| `range` | Positive minimum and greater maximum | Required active curated unit | Optional compatible package size |
| `to_taste` | None | None | None |
| `as_needed` | None | None | None |
| `unspecified` | None | None | None |

Private drafts may temporarily have no measure. They still cannot store half a
measure: numeric mode, values, unit, and package metadata must form a complete
valid shape or all be absent. Immutable publication requires every ingredient
to have a measure, including the explicit `unspecified` mode when that is the
author's choice.

Exact decimal values remain decimals across the API and are serialized without
floating-point reinterpretation. `unit_display` is a preserved storage and
migration snapshot, not an editable identity or the public rendering source.
Reads format the amount from the referenced curated unit and stored values.

### Unit catalog and conversion

Measurement units have stable deterministic identities, aliases, immutable
display metadata, dimensions, and explicit conversion families. New exact and
range values use active units. Historical versions remain readable when a unit
is later inactive.

Conversion is deliberately conservative:

- reviewed affine relationships support metric mass, metric volume, elapsed
  time, and Celsius/Fahrenheit conversion;
- teaspoon, tablespoon, cup, count-like units, and package units remain in
  distinct families unless an explicit reviewed rule says otherwise;
- density conversion requires a reviewed ingredient-specific density rule; and
- package conversion requires a package-size record for the selected ingredient
  and package unit.

The service never guesses density, package contents, or equivalence between
unrelated families. Changing an ingredient or unit clears or invalidates
package metadata that no longer belongs to the selected pair.

The versioned measurement seed is an immutable catalog contract. Schema
migrations classify legacy quantity and unit rows with the same fail-closed
rules used by the audit tooling. Unknown, ambiguous, blank, inactive, or
incomplete legacy values abort migration instead of silently changing meaning.
A downgrade likewise refuses any structured state the old two-column shape
cannot represent losslessly.

## Structured cooking actions

Every instruction keeps its human-readable title and prose and may own an
ordered machine-readable action graph. The prose remains the direction shown
to cooks. The graph records reviewed verbs, ingredient-occurrence inputs, and
optional duration and temperature parameters. Recipe Lab never parses prose to
invent that structure.

For a newly published version, each instruction has:

```text
instruction (ordered within version)
  -> action instance (ordered within instruction)
       -> curated action type
       -> ingredient occurrence inputs (ordered)
       -> optional duration
       -> optional temperature
```

An action input references a particular recipe ingredient occurrence, not only
the canonical ingredient. This preserves recipes that use the same ingredient
in separate slots for different purposes. Composite foreign keys require the
instruction, action, input, and occurrence to belong to the same draft or
version; one action cannot reference the same occurrence twice.

The active action catalog supplies reviewed stable keys and display verbs for
new authoring. Deactivation prevents new selection but does not reinterpret a
published version. Free-form action labels are not identities.

Duration and temperature reuse the measurement catalog with narrower
semantics. Both accept exact or range values only. Duration requires a positive
time measure; temperature requires a temperature unit and may contain signed
values. Qualitative ingredient modes and package metadata never apply to action
parameters.

Historical seed instructions that predate reviewed mappings may be readable
with no actions. New publication is stricter: every instruction needs prose
and at least one structured action. Prose and graph remain independently
authored, so equal structured actions do not prove that two human-readable
instructions are equivalent.

## Copying, publication, and comparison

Copying a public version into an adaptation or revision draft creates fresh
draft row identities while preserving explicit order and semantic references.
Publishing creates fresh immutable ingredient, instruction, action, and input
identities and remaps action inputs to the new version's occurrences. A
request-scoped reference may connect an action to an ingredient added by the
same edit, but that temporary reference is never persisted as domain identity.

The shared `RecipeDocument` boundary carries one complete ordered graph between
validated data and either draft or immutable materialization. Materializers
allocate identities and stage rows; they do not commit. The draft or
publication workflow remains the transaction owner.

Validation rejects unknown or inactive authoring choices, cross-document
inputs, removed inputs, duplicate inputs, malformed measures, incompatible
dimensions, and a publishable instruction without an action. A failed
publication cannot leave a partial graph.

Recipe diffs compare semantic structure rather than row UUIDs. They preserve
instruction order and distinguish changes to prose, action membership, input
occurrences, action order, duration, and temperature. Complete ingredient
context accompanies the result so the frontend can name an input even when
that ingredient is otherwise unchanged. The result is a deterministic snapshot
comparison, not a replay of the author's edit operations.

## Categories, metadata, and substitutions

Recipe categories and ingredient dietary or allergen assignments use
data-backed vocabularies rather than fixed application enums. Missing metadata
means unknown; it is never a safety claim.

Ingredient substitutions are curated directed relationships. A lookup returns
only explicitly stored outgoing edges and never invents a reverse or transitive
substitution. An edge carries either a reviewed positive quantity ratio or
written guidance, together with provenance or confidence. Relationship
confidence describes catalog evidence, not medical, allergen, or food-safety
confidence.

## Versioned seed data and provenance

Measurement units, cooking actions, catalog ingredients, aliases, recipes, and
reviewed action mappings are versioned source assets. Stable UUIDv5 identities
come from immutable dataset keys and dedicated namespaces. The loader runs as
an explicit operation, takes a PostgreSQL advisory lock, and commits one
transaction. Compatible catalog rows may be reused; changed immutable recipe
content fails loudly rather than being rewritten.

The seed action mappings are authored data, not NLP output. If instruction
prose or its reviewed graph changes, the source asset must change explicitly.
The accompanying provenance file records origins and licensing close to the
data.

## Limits of the structure

The graph does not fully encode equipment, technique intensity, geometry,
doneness, food-safety context, or every detail retained in prose. Catalog
identity does not imply nutritional equivalence, and a reviewed conversion does
not authorize unrecorded density or package assumptions. Structural equality
therefore remains a data comparison, not a claim that recipes are creatively,
legally, or culinarily interchangeable.
