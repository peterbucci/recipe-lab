import type {
  CatalogIngredient,
  CatalogIngredientSelection,
} from "./ingredient-model";

export function selectionForCatalogIngredient(
  ingredient: CatalogIngredient,
  query: string,
): CatalogIngredientSelection {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const exactCanonical =
    ingredient.canonical_name.toLocaleLowerCase() === normalizedQuery;
  const exactAlias = ingredient.aliases.find(
    (alias) => alias.toLocaleLowerCase() === normalizedQuery,
  );
  const canonicalContains = ingredient.canonical_name
    .toLocaleLowerCase()
    .includes(normalizedQuery);
  const matchingAlias = ingredient.aliases.find((alias) =>
    alias.toLocaleLowerCase().includes(normalizedQuery),
  );

  let displayName = ingredient.canonical_name;
  if (!exactCanonical && exactAlias) {
    displayName = exactAlias;
  } else if (!exactCanonical && !canonicalContains && matchingAlias) {
    displayName = matchingAlias;
  }

  return {
    ingredientId: ingredient.id,
    canonicalName: ingredient.canonical_name,
    displayName,
  };
}
