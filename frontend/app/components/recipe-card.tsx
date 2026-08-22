import Link from "next/link";

import { formatServings } from "../../lib/format";
import type { RecipeSummary } from "../../lib/recipe-api";
import { RecipeArtwork } from "./recipe-artwork";

interface RecipeCardProps {
  recipe: RecipeSummary;
}

export function RecipeCard({ recipe }: RecipeCardProps) {
  const titleId = `recipe-card-title-${recipe.id}`;
  const versionLabel = recipe.parent_version_id
    ? `Variation · Version ${recipe.version_number}`
    : "Original recipe";

  return (
    <li className="recipe-grid__item">
      <article className="recipe-card" aria-labelledby={titleId}>
        <RecipeArtwork className="recipe-card__artwork" lineageKey={recipe.lineage_id} />
        <div className="recipe-card__body">
          <div className="recipe-card__meta">
            <span className="version-badge">{versionLabel}</span>
            <span>{formatServings(recipe.servings)}</span>
          </div>
          <h3 id={titleId}>
            <Link href={`/recipes/${recipe.id}`}>{recipe.title}</Link>
          </h3>
          <p className="recipe-card__description">
            {recipe.description ?? "A complete recipe from the Recipe Lab catalog."}
          </p>
          <span className="text-link recipe-card__link-hint" aria-hidden="true">
            View recipe <span aria-hidden="true">→</span>
          </span>
        </div>
      </article>
    </li>
  );
}
