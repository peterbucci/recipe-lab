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
  const versionLabel = recipe.parent_version_id
    ? `Version ${recipe.version_number}`
    : "Original";

  return (
    <li className="recipe-grid__item">
      <article className="recipe-card" aria-labelledby={titleId}>
        <RecipeArtwork className="recipe-card__artwork" lineageKey={recipe.lineage_id} />
        <div className="recipe-card__body">
          <div className="recipe-card__meta">
            <span className="version-badge">{versionLabel}</span>
            {visibilityLabel ? <span>{visibilityLabel}</span> : null}
            <span>{formatServings(recipe.servings)}</span>
          </div>
          <h3 id={titleId}>
            {publiclyAccessible ? (
              <Link href={`/recipes/${recipe.id}`}>{recipe.title}</Link>
            ) : (
              recipe.title
            )}
          </h3>
          <p className="recipe-card__attribution">
            By <PublicCookAttribution author={recipe.author} />
          </p>
          <p className="recipe-card__description">
            {recipe.description ?? "No description provided."}
          </p>
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
          {publiclyAccessible ? (
            <span className="text-link recipe-card__link-hint" aria-hidden="true">
              View recipe <span aria-hidden="true">→</span>
            </span>
          ) : null}
          {actions ? <div className="recipe-card__actions">{actions}</div> : null}
        </div>
      </article>
    </li>
  );
}
