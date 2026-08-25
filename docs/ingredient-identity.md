# Published ingredient identity

Recipe Lab treats an ingredient's curated catalog identity and an author's
display wording as different data.

## Published snapshot invariant

Every `recipe_version_ingredients` row belongs to an immutable, publicly
readable recipe-version snapshot and has a non-null foreign key to exactly one
`ingredients` row. The database restricts deletion of a catalog ingredient
while a published snapshot references it.

Recipe add and replace operations accept a stable catalog ID plus a selected
display label. The server verifies that the label is the canonical name or a
reviewed alias belonging to that exact ID before a new recipe version is
written.

An unknown name fails the complete publication transaction. It creates no
recipe version, recipe-ingredient row, preference event, ingredient, or alias.
Recipe-writing APIs never promote user text into trusted global catalog data.

## Identity versus presentation

The resolved `ingredient_id` is the durable identity. Ingredient filters,
recipe comparisons, curated substitutions, and recommendation features use
catalog IDs rather than display strings.

When an ingredient is added or replaced, the submitted canonical-or-alias
wording is preserved as `display_name` on the immutable snapshot. This lets a
recipe say “white sugar” while the response also identifies the same curated
record as “Granulated sugar.” A variant may also switch between reviewed labels
for the same stable ingredient ID; submitting the exact existing ID and label
remains a no-op and is rejected.

## Draft and catalog boundaries

Private authoring uses a separate draft aggregate; every stored
`RecipeVersion` remains an immutable public snapshot. A draft catalog slot
still references one real curated ingredient and verified canonical-or-alias
label. An unresolved slot instead references one ingredient request belonging
to that draft's author and contains no canonical ingredient ID.

Catalog search, selection, and the separate missing-ingredient request/review
workflow are documented in [catalog intake](catalog-intake.md). Pending or
rejected request text is not a catalog identity. Approval or duplicate
resolution exposes a trusted catalog choice, but the author must explicitly
select it; status changes never rewrite the draft automatically. The storage,
privacy, discard, and future publication boundary is documented in
[private recipe drafts](private-recipe-drafts.md).

Curated measurement units and typed amount semantics belong to RCP-25B.
Human-readable instructions plus controlled step actions belong to RCP-25C.
The implemented [versioned structural fingerprint](recipe-fingerprints.md)
belongs to RCP-25D. The RCP-25E
[duplicate-candidate preflight](duplicate-detection.md) consumes that identity
for bounded exact and probable advice. A match does not block, merge, delete, or
transfer anything.
