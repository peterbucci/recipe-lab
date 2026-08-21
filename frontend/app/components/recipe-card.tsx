import Link from "next/link";

import { formatServings } from "../../lib/format";
import type { RecipeSummary } from "../../lib/recipe-api";

interface RecipeCardProps {
  recipe: RecipeSummary;
}

export function RecipeCard({ recipe }: RecipeCardProps) {
  const versionLabel = recipe.parent_version_id
    ? `Variant · Version ${recipe.version_number}`
    : "Original recipe";

  return (
    <li className="recipe-grid__item">
      <article className="recipe-card">
        <div className="recipe-card__meta">
          <span className="version-badge">{versionLabel}</span>
          <span>{formatServings(recipe.servings)}</span>
        </div>
        <h2>
          <Link href={`/recipes/${recipe.id}`}>{recipe.title}</Link>
        </h2>
        <p>{recipe.description ?? "A structured recipe version from the Recipe Lab catalog."}</p>
        <span className="text-link" aria-hidden="true">
          View recipe <span aria-hidden="true">→</span>
        </span>
      </article>
    </li>
  );
}
