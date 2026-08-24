# Published ingredient identity

Recipe Lab treats an ingredient's curated catalog identity and an author's
display wording as different data.

## Published snapshot invariant

Every `recipe_version_ingredients` row belongs to an immutable, publicly
readable recipe-version snapshot and has a non-null foreign key to exactly one
`ingredients` row. The database restricts deletion of a catalog ingredient
while a published snapshot references it.

Recipe add and replace operations accept an exact canonical catalog name or an
exact catalog alias after trimming whitespace and comparing case-insensitively.
Canonical names take precedence over aliases. Resolution happens before a new
recipe version is written.

An unknown name fails the complete publication transaction. It creates no
recipe version, recipe-ingredient row, preference event, ingredient, or alias.
Recipe-writing APIs never promote user text into trusted global catalog data.

## Identity versus presentation

The resolved `ingredient_id` is the durable identity. Ingredient filters,
recipe comparisons, curated substitutions, and recommendation features use
catalog IDs rather than display strings.

When an ingredient is added, or a replacement changes its catalog identity,
the submitted canonical-or-alias wording is preserved as `display_name` on the
immutable snapshot. This lets a recipe say “white sugar” while the response
also identifies the same curated record as “Granulated sugar.” The current
variant endpoint rejects edits that only rename an existing ingredient to
another alias of the same identity; display-label selection for the unified
editor belongs to RCP-25A and RCP-26.

## Draft and catalog boundaries

The current application has no separate private draft model: every stored
`RecipeVersion` is immediately a published snapshot. Free text may therefore
exist only in browser state until it resolves to a catalog ingredient.

RCP-25A owns catalog search, selection, and the separate missing-ingredient
request/review workflow. A pending request is not a catalog identity and cannot
be published. Future private draft storage may preserve unresolved author text,
but it must not weaken the published snapshot foreign key.

Curated measurement units and typed amount semantics belong to RCP-25B.
Human-readable instructions plus controlled step actions belong to RCP-25C.
Versioned structural fingerprints and duplicate-candidate policy belong to
RCP-25D and RCP-25E.
