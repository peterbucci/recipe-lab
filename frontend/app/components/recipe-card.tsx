import Link from "next/link";
import type { ReactNode } from "react";

import { formatServings } from "../../lib/format";
import type { RecipeSummary } from "../../lib/recipe-api";
import { PublicCookAttribution } from "./public-cook-attribution";
import { RecipeArtwork } from "./recipe-artwork";

interface RecipeCardProps {
  actions?: ReactNode;
  publiclyAccessible?: boolean;
  recipe: RecipeSummary;
  visibilityLabel?: string;
}

export function RecipeCard({
  actions,
  publiclyAccessible = true,
  recipe,
  visibilityLabel,
}: RecipeCardProps) {
  const titleId = `recipe-card-title-${recipe.id}`;

  return (
    <li className="recipe-grid__item">
      <article className="recipe-card" aria-labelledby={titleId}>
        <div className="recipe-card__body">
          <h3 id={titleId}>
            {publiclyAccessible ? (
              <Link href={`/recipes/${recipe.id}`}>{recipe.title}</Link>
            ) : (
              recipe.title
            )}
          </h3>
          <div className="recipe-card__summary">
            <p className="recipe-card__attribution">
              By <PublicCookAttribution author={recipe.author} />
            </p>
            <p className="recipe-card__servings">{formatServings(recipe.servings)}</p>
          </div>
          {recipe.description ? (
            <p className="recipe-card__description">{recipe.description}</p>
          ) : null}
          {recipe.parent ? (
            <p className="recipe-card__parent">
              Based on{" "}
              <Link href={`/recipes/${recipe.parent.id}`}>{recipe.parent.title}</Link>
              {" by "}
              <PublicCookAttribution author={recipe.parent.author} />
            </p>
          ) : recipe.parent_version_id ? (
            <p className="recipe-card__parent">Source unavailable</p>
          ) : null}
          {visibilityLabel ? <p className="recipe-card__status">{visibilityLabel}</p> : null}
          {actions ? <div className="recipe-card__actions">{actions}</div> : null}
        </div>
        <RecipeArtwork className="recipe-card__artwork" lineageKey={recipe.lineage_id} />
      </article>
    </li>
  );
}
