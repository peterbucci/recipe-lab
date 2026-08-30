import type { RecipeCategory } from "../../lib/recipe-api";

interface RecipeCategoryListProps {
  categories: readonly RecipeCategory[] | undefined;
  label: string;
}

export function RecipeCategoryList({
  categories,
  label,
}: RecipeCategoryListProps) {
  if (!categories?.length) return null;

  return (
    <ul className="recipe-category-list" aria-label={label}>
      {categories.map((category) => (
        <li key={category.id}>{category.name}</li>
      ))}
    </ul>
  );
}

