# Authored ingredient identity

Recipe ingredients preserve what an author wrote without promoting that text into
the curated ingredient catalog. Each stored recipe-ingredient row has two separate
values:

- `name` is the required authored text for the immutable recipe snapshot;
- `ingredient_id` is a nullable foreign key to a trusted catalog ingredient.

The recipe API exposes those values as required `display_name` plus nullable
`ingredient_id` and `canonical_name`. A null catalog identity means only that Recipe
Lab has not linked the authored text to a curated ingredient. It does not mean the
ingredient is invalid, safe, allergen-free, or suitable for a particular diet.

## Authoring and resolution

When an author adds or replaces an ingredient, Recipe Lab performs the existing
exact, case-insensitive canonical-name and alias lookup:

1. A canonical-name or alias match stores that catalog ID while preserving the
   submitted display text.
2. No match stores the authored text with a null catalog ID.
3. The authoring path never inserts or updates an ingredient, alias, category,
   dietary flag, allergen, or substitution relationship.

This boundary applies to copied ingredients as well as new or replaced ingredients.
The current variant editor keeps the same values in its local draft and the fork API
persists them in a new immutable child snapshot. Future original-recipe draft and
publication flows must use the same storage and response contract rather than adding
a second ingredient representation.

Catalog-backed ingredient filters remain exact canonical-or-alias filters. They do
not search or promote unlinked authored text; broader ingredient discovery and
catalog moderation are separate product concerns.

## Comparison semantics

Linked rows are paired by equal catalog ID. Only two linked catalog IDs can qualify
as a curated replacement, and only when the directed substitution edge exists.

Unlinked rows have no trusted identity. The diff cancels deterministic duplicate
occurrences only when their complete authored snapshots are exactly equal. If an
unlinked row changes, or a row moves between linked and unlinked states, the diff
reports a removal and an addition. It does not infer sameness from spelling,
position, or similar text.

## Recommendation and substitution limits

Recommendation ingredient similarity uses only non-null catalog IDs. Unlinked rows
remain in the recipe but do not contribute to the Jaccard overlap, so similarity can
understate recipes whose important ingredients are unresolved. A recipe with no
linked ingredients can still participate in global quality and engagement ranking,
but it cannot create or receive an ingredient-similarity match.

The substitution rules engine accepts only curated catalog identities and directed
catalog relationships. Unlinked authored text receives no inferred dietary,
allergen, substitution, quantity-conversion, provenance, confidence, or safety
metadata.

## Deliberate exclusions

This contract does not add catalog moderation, automatic synonyms, fuzzy or
full-text ingredient discovery, automatic substitution inference, or recipe-level
dietary, allergen, or food-safety claims.
